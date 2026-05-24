/**
 * Cron-triggered handlers. Mounted from index.ts via `export default
 * { fetch, scheduled }`. Cloudflare invokes `scheduled(event, env, ctx)`
 * for each cron pattern declared in wrangler.jsonc.
 *
 * Adding a new job:
 *   1. Add a cron pattern under `triggers.crons` in wrangler.jsonc.
 *   2. Branch on `event.cron` inside `scheduled()` below.
 *   3. Wrap the work in `ctx.waitUntil(...)` so CF's invocation timer
 *      doesn't kill long-running jobs mid-write.
 *
 * Why D1 export here vs. relying on CF's 30-day PITR:
 *   PITR (Paid plan) can restore to any point in the last 30 days but
 *   the restored DB is a NEW database with a new id — useful as
 *   recovery, useless as an offline-readable artifact. Our R2-hosted
 *   `.sql` dumps give us:
 *     • greppable text (grep through schema history without spinning up a DB)
 *     • portable to any other SQLite-compatible store (local, Turso, etc.)
 *     • free off-site copy independent of CF account compromise
 */
import * as Sentry from "@sentry/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { asc, inArray, isNull } from "drizzle-orm";
import { messages as messagesTable } from "@raltic/db";
import type { Env } from "./lib/env";

const BACKUP_BUCKET = "raltic-backups"; // matches wrangler.jsonc R2 binding name
const RETENTION_DAYS = 30;

interface ExportPollState {
  filename?: string;
  signed_url?: string;
  current_bookmark?: string;
}

interface ExportPollResponse {
  success: boolean;
  result: {
    at_bookmark?: string;
    status: "active" | "complete" | "error";
    error?: string;
    result?: ExportPollState;
    messages?: string[];
  };
  errors?: { code: number; message: string }[];
}

// `ScheduledController` is the canonical Workers type; `ScheduledEvent`
// is the older alias and isn't compatible with ExportedHandler<Env>.
export async function scheduled(
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    msg: "scheduled.fired",
    cron: event.cron,
    scheduled_time: event.scheduledTime,
  }));

  // One handler per cron pattern.
  switch (event.cron) {
    case "0 3 * * *":
      // Daily 03:00 UTC — D1 dump to R2 + prune old backups.
      // CRITICAL: the throw inside runDailyBackup needs to reach Sentry.
      // If we just `ctx.waitUntil(runDailyBackup(env))` the rejected
      // promise gets unhandled and Sentry's withSentry wrapper never
      // sees it (it only wraps the outer scheduled() invocation, which
      // already returned). Wrap the call to actively `captureException`
      // so failure ALWAYS reaches whatever DSN is configured.
      ctx.waitUntil(
        runDailyBackup(env).catch(async (err) => {
          Sentry.captureException(err, {
            tags: { source: "scheduled", cron: event.cron, job: "daily-backup" },
          });
          // Re-emit as a structured log too, so even without Sentry the
          // failure is greppable in CF Workers Logs / Logpush.
          // eslint-disable-next-line no-console
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            msg: "scheduled.job_failed",
            cron: event.cron,
            job: "daily-backup",
            error: err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
          }));
          // CRITICAL: captureException only QUEUES the event. The Worker
          // isolate can tear down between waitUntil ending and the Sentry
          // transport actually flushing the HTTP POST. Without an explicit
          // flush, cron-failure events silently never reach Sentry. 2s
          // budget is generous on CF's hot-network path.
          try { await Sentry.flush(2000); } catch { /* best-effort */ }
        }),
      );
      break;
    case "*/5 * * * *":
      // Every 5 minutes — incremental Vectorize backfill for any
      // messages whose channel's ChatRoom DO failed to index them
      // inline (rate-limit, transient AI error). Cursor-based: KV
      // remembers `last_indexed_createdat_ms`, we process the next
      // batch after that. Cheap to no-op if everything's caught up.
      ctx.waitUntil(
        runVectorizeBackfill(env).catch(async (err) => {
          Sentry.captureException(err, {
            tags: { source: "scheduled", cron: event.cron, job: "vectorize-backfill" },
          });
          // eslint-disable-next-line no-console
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            msg: "scheduled.job_failed",
            cron: event.cron,
            job: "vectorize-backfill",
            error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
          }));
          try { await Sentry.flush(2000); } catch { /* best-effort */ }
        }),
      );
      break;
    default:
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        msg: "scheduled.unknown_cron",
        cron: event.cron,
      }));
  }
}

async function runDailyBackup(env: Env): Promise<void> {
  const start = Date.now();
  const today = new Date();
  const timestamp = today.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  const r2Key = `d1/${timestamp}.sql.gz`;

  try {
    const sql = await exportD1ToString(env);
    const originalBytes = new TextEncoder().encode(sql).length;
    const gzipped = await gzipString(sql);
    await uploadToR2Bucket(env, r2Key, gzipped, {
      contentType: "application/gzip",
      originalBytes,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: "backup.complete",
      key: r2Key,
      bytes: gzipped.byteLength,
      original_bytes: originalBytes,
      dur_ms: Date.now() - start,
    }));

    // Prune anything older than retention window. Best-effort — failures
    // here don't fail the whole job because the new backup is what matters.
    try {
      await pruneOldBackups(env);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        msg: "backup.prune_failed",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "backup.failed",
      key: r2Key,
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
      dur_ms: Date.now() - start,
    }));
    throw e;
  }
}

/**
 * D1 export via the Cloudflare REST API. The DB binding doesn't expose
 * an export RPC, so we go through the public API (the same one wrangler
 * uses). Two-phase:
 *   1. POST /export → returns a polling bookmark + initial status
 *   2. POST /export with the bookmark, repeat until status === "complete"
 *   3. GET the signed_url returned in the final response → the .sql text
 *
 * The export job runs on D1's side; the Worker just orchestrates.
 */
async function exportD1ToString(env: Env): Promise<string> {
  const apiToken = env.CF_API_TOKEN;
  const accountId = env.CF_ACCOUNT_ID;
  const databaseId = env.D1_DATABASE_ID;
  if (!apiToken || !accountId || !databaseId) {
    throw new Error(
      "Backup needs CF_API_TOKEN + CF_ACCOUNT_ID + D1_DATABASE_ID secrets set. " +
      "See docs/SELF_HOSTING.md (or set them via `wrangler secret put`).",
    );
  }
  const exportUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/export`;

  // Start the export. `output_format: 'polling'` makes D1 return a bookmark
  // we can poll on instead of blocking the worker for the full export.
  let bookmark: string | undefined;
  let signedUrl: string | undefined;
  const maxPolls = 120; // 120 * 2s = 4 minutes ceiling (Worker cron has 30min budget)
  for (let i = 0; i < maxPolls; i++) {
    const body: Record<string, unknown> = {
      output_format: "polling",
      dump_options: { no_schema: false, no_data: false },
    };
    if (bookmark) body.current_bookmark = bookmark;
    const res = await fetch(exportUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Branch the message so ops can read one line and know what to do,
      // rather than seeing "D1 export API 403" daily for a week before
      // realising it's a misconfigured token.
      const body = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `D1 export forbidden (${res.status}). Likely cause: CF_API_TOKEN ` +
          `is missing the 'Account / D1 / Edit' scope, or has expired. ` +
          `Rotate via Cloudflare Dashboard → My Profile → API Tokens, ` +
          `then \`wrangler secret put CF_API_TOKEN\`. Body: ${body}`,
        );
      }
      if (res.status === 429) {
        throw new Error(
          `D1 export rate-limited (429). CF caps export frequency; ` +
          `retry tomorrow or contact CF support if persistent. Body: ${body}`,
        );
      }
      if (res.status >= 500) {
        throw new Error(
          `D1 export server error (${res.status}). Likely a transient ` +
          `Cloudflare-side issue — next cron will retry. Body: ${body}`,
        );
      }
      throw new Error(`D1 export API ${res.status}: ${body}`);
    }
    const json = (await res.json()) as ExportPollResponse;
    if (!json.success) {
      throw new Error(`D1 export failed: ${JSON.stringify(json.errors ?? json)}`);
    }
    if (json.result.status === "error") {
      throw new Error(`D1 export errored: ${json.result.error ?? "unknown"}`);
    }
    bookmark = json.result.at_bookmark ?? json.result.result?.current_bookmark ?? bookmark;
    if (json.result.status === "complete" && json.result.result?.signed_url) {
      signedUrl = json.result.result.signed_url;
      break;
    }
    // active: sleep before polling again
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!signedUrl) throw new Error("D1 export timed out after 4 minutes of polling");

  const dumpRes = await fetch(signedUrl);
  if (!dumpRes.ok) {
    throw new Error(`Dump download ${dumpRes.status}: ${await dumpRes.text()}`);
  }
  return await dumpRes.text();
}

async function gzipString(content: string): Promise<ArrayBuffer> {
  const stream = new Blob([content]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function uploadToR2Bucket(
  env: Env,
  key: string,
  content: string | ArrayBuffer,
  opts?: { contentType?: string; originalBytes?: number },
): Promise<void> {
  // BACKUPS binding declared in wrangler.jsonc → R2 binding.
  // Note: env has no static typing for BACKUPS because the bucket is
  // optional in tests. Runtime-narrow.
  const bucket = (env as unknown as { BACKUPS?: R2Bucket }).BACKUPS;
  if (!bucket) throw new Error("BACKUPS R2 binding missing — add to wrangler.jsonc");
  const putOpts: R2PutOptions = {
    httpMetadata: { contentType: opts?.contentType ?? "application/sql; charset=utf-8" },
    customMetadata: {
      generated_at: new Date().toISOString(),
      source_db: env.D1_DATABASE_ID ?? "unknown",
      ...(opts?.originalBytes ? { original_bytes: String(opts.originalBytes) } : {}),
    },
  };
  // Retry with jittered backoff — a single .put() that transient-fails
  // silently loses the day's backup. We get one shot per day; spending a
  // few seconds on retries is worth it. 3 attempts × ~base 500ms + jitter.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await bucket.put(key, content, putOpts);
      return;
    } catch (e) {
      lastErr = e;
      const base = 500 * Math.pow(2, attempt);          // 500, 1000, 2000
      const jitter = Math.floor(Math.random() * 250);   // 0–250
      await new Promise((r) => setTimeout(r, base + jitter));
    }
  }
  throw lastErr instanceof Error
    ? new Error(`R2 put failed after 3 attempts: ${lastErr.message}`)
    : new Error(`R2 put failed after 3 attempts: ${String(lastErr)}`);
}

/** Delete backups older than RETENTION_DAYS. Handles both current
 *  `d1/YYYY-MM-DDTHH-MM-SSZ.sql.gz` keys and legacy
 *  `YYYY/MM/YYYY-MM-DD.sql` keys from the pre-gzip layout. */
async function pruneOldBackups(env: Env): Promise<void> {
  const bucket = (env as unknown as { BACKUPS?: R2Bucket }).BACKUPS;
  if (!bucket) return;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let cursor: string | undefined;
  const toDelete: string[] = [];
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const obj of page.objects) {
      const datePart = backupDatePart(obj.key);
      if (datePart && datePart < cutoffStr) toDelete.push(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  if (toDelete.length > 0) {
    await bucket.delete(toDelete);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: "backup.pruned",
      count: toDelete.length,
      cutoff: cutoffStr,
    }));
  }
}

function backupDatePart(key: string): string {
  if (key.startsWith("d1/")) {
    return key.split("/").pop()?.slice(0, 10) ?? "";
  }
  const legacy = /^\d{4}\/\d{2}\/(\d{4}-\d{2}-\d{2})\.sql(?:\.gz)?$/.exec(key);
  return legacy?.[1] ?? "";
}

// ─── Vectorize backfill ─────────────────────────────────────────────────────

/**
 * Incremental Vectorize backfill — runs every 5 minutes.
 *
 * Why we need it: the ChatRoom DO indexes messages inline on alarm
 * flush (see packages/chat-room/src/chat-room.ts indexMessageBatch),
 * but that path is best-effort — Workers AI rate limits, Vectorize
 * quota, or DO eviction can drop a batch. This cron sweeps any rows
 * D1 has that aren't in Vectorize yet, using a KV cursor of
 * createdAt-ms (D1 has no global monotonic id, but createdAt is the
 * sort key on the channel index and is server-assigned at write time
 * so it's a safe progression key).
 *
 * Backfill semantics:
 *   - Cursor stored at RATE_LIMITS["vector_backfill_cursor"] = ms_string
 *   - Pull up to BACKFILL_BATCH messages with createdAt > cursor
 *   - Embed all in one Workers AI call
 *   - Upsert all in one Vectorize call
 *   - Advance cursor to the max createdAt in the batch
 *
 * Worst case: a single bad batch (AI error, Vectorize error) blocks
 * progress until next tick. Acceptable for a 5-min cadence. If we
 * later need to recover from a "stuck" cursor we can manually delete
 * the KV key to retry from the start (or set it back to a known good
 * timestamp).
 */
const BACKFILL_BATCH = 50;
const BACKFILL_WALLCLOCK_BUDGET_MS = 20_000;     // leave headroom in CF's 30s cron budget
const BACKFILL_MAX_CONTENT_CHARS = 6_000;        // chars (not bytes) — bge-m3 8k tokens; CJK ≈ 1 char/token so still safe

/**
 * Incremental backfill. Replaces the prior KV-cursor design (codex
 * P3-W2 HIGH findings):
 *   - Double-indexing: source-of-truth is now `messages.vectorIndexedAt`
 *     stamped by both inline indexer + this cron. We query
 *     `WHERE vectorIndexedAt IS NULL` so the inline-indexed rows are
 *     skipped — no duplicate AI spend.
 *   - Cursor durability: KV eviction could re-scan history. With a
 *     D1 column we don't need a cursor at all — we just keep
 *     processing the un-indexed tail.
 */
async function runVectorizeBackfill(env: Env): Promise<void> {
  if (!env.AI || !env.VECTORIZE) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      msg: "vector_backfill.disabled",
      reason: !env.AI ? "no AI binding" : "no VECTORIZE binding",
    }));
    return;
  }
  const started = Date.now();
  const drizzleDb = drizzle(env.DB);

  let processedBatches = 0;
  let totalIndexed = 0;
  let totalSkipped = 0;
  while (Date.now() - started < BACKFILL_WALLCLOCK_BUDGET_MS) {
    const rows = await drizzleDb
      .select({
        id: messagesTable.id,
        channelId: messagesTable.channelId,
        senderId: messagesTable.senderId,
        senderType: messagesTable.senderType,
        content: messagesTable.content,
        createdAt: messagesTable.createdAt,
      })
      .from(messagesTable)
      .where(isNull(messagesTable.vectorIndexedAt))
      .orderBy(asc(messagesTable.createdAt))
      .limit(BACKFILL_BATCH);

    if (rows.length === 0) break;

    const indexable = rows
      .filter(r => typeof r.content === "string" && r.content.trim().length > 0);
    if (indexable.length === 0) {
      // All non-text rows (system events etc). Stamp them as indexed
      // so we don't keep re-scanning the same set.
      await drizzleDb.update(messagesTable)
        .set({ vectorIndexedAt: new Date() })
        .where(inArray(messagesTable.id, rows.map(r => r.id)));
      totalSkipped += rows.length;
      if (rows.length < BACKFILL_BATCH) break;
      continue;
    }

    const aiRes = await env.AI.run("@cf/baai/bge-m3" as never, {
      text: indexable.map(r => r.content.slice(0, BACKFILL_MAX_CONTENT_CHARS)),
    } as never) as unknown as { data: number[][] };
    if (!aiRes?.data?.length) {
      throw new Error("vector_backfill: bge-m3 returned no vectors");
    }
    const vectors = indexable.map((r, i) => ({
      id: r.id,
      values: aiRes.data[i]!,
      metadata: {
        channelId: r.channelId,
        senderId: r.senderId,
        senderType: r.senderType,
        ts: r.createdAt.getTime(),
      },
    }));
    await env.VECTORIZE.upsert(vectors);
    // Stamp EVERY row in the batch (indexed + skipped non-text)
    // atomically so retries see them as done.
    await drizzleDb.update(messagesTable)
      .set({ vectorIndexedAt: new Date() })
      .where(inArray(messagesTable.id, rows.map(r => r.id)));

    totalIndexed += vectors.length;
    totalSkipped += rows.length - vectors.length;
    processedBatches++;
    if (rows.length < BACKFILL_BATCH) break;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    msg: "vector_backfill.done",
    batches: processedBatches,
    indexed: totalIndexed,
    skipped: totalSkipped,
    elapsed_ms: Date.now() - started,
  }));
}
