/**
 * Structured facts tools — D1-backed semantic memory (P3-W2).
 *
 * Companion to filesystem memory (memory.ts): use this layer when the
 * agent needs to QUERY a piece of knowledge structurally
 * (`fact_query({subjectId: 'gene', predicate: 'timezone'})`) rather than
 * grep for prose. The two layers reinforce each other — reflection
 * writes BOTH a markdown note (memory_remember) AND structured triples
 * (fact_record) when the same fact has both narrative and discrete
 * forms.
 *
 * Predicate vocabulary is whitelisted to prevent agents from inventing
 * fields that fragment query patterns over time. To add a predicate:
 * append to PREDICATE_WHITELIST and document the expected `object`
 * shape in the agent system prompt.
 *
 * Supersede semantics: when a fact's value changes (e.g. "gene moved
 * to Seoul"), call fact_supersede(oldId, newObject) which inserts a
 * new row and marks the old one as historical via superseded_by. Lets
 * us preserve why the agent used to believe X.
 */
import { tool } from "ai";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { agentFacts } from "@raltic/db/schema";
import type { ToolDispatchCtx, ToolRegistry } from "./registry.js";

const SUBJECT_KINDS = ["user", "agent", "channel", "project", "concept"] as const;
type SubjectKind = (typeof SUBJECT_KINDS)[number];

// Predicate whitelist. Keeping this small forces semantic discipline.
// Notes on expected `object` content:
//   works_on      — project/repo name (string)
//   prefers       — short label (e.g. "concise replies", "Pacific time")
//   role_is       — job/role (string)
//   member_of     — team/org name (string)
//   owns          — repo/project (string)
//   dislikes      — short label
//   expert_in     — domain/tool (string)
//   timezone      — IANA tz (string, e.g. "America/Los_Angeles")
//   email         — RFC email (string)
//   note          — freeform short fact (string, ≤200 chars; for longer
//                   prose use memory_remember instead)
const PREDICATE_WHITELIST = new Set([
  "works_on", "prefers", "role_is", "member_of", "owns",
  "dislikes", "expert_in", "timezone", "email", "note",
]);

// Cap object size — facts are meant to be discrete values, not prose.
const MAX_OBJECT_BYTES = 1_000;
// Cap result rows — defends against query patterns that match thousands.
const MAX_QUERY_LIMIT = 100;

export function factsTools(ctx: ToolDispatchCtx): ToolRegistry {
  return {
    fact_record: tool({
      description:
        "Record a single durable fact as a (subjectKind, subjectId, predicate, object) triple. " +
        "Use for atomic, queryable knowledge ('gene timezone Asia/Taipei'). " +
        "For multi-paragraph context use memory_remember instead. " +
        "Predicate must be one of the whitelisted vocabulary; if you need a new predicate use 'note'.",
      inputSchema: z.object({
        subjectKind: z.enum(SUBJECT_KINDS),
        subjectId: z.string().min(1).max(200),
        predicate: z.string().min(1).max(64),
        object: z.string().min(1).max(MAX_OBJECT_BYTES),
        sourceMessageId: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
      execute: async ({ subjectKind, subjectId, predicate, object, sourceMessageId, confidence }) => {
        if (!PREDICATE_WHITELIST.has(predicate)) {
          throw new Error(
            `predicate '${predicate}' not in whitelist. Use one of: ` +
            [...PREDICATE_WHITELIST].join(", ") + " — or 'note' for freeform.",
          );
        }
        const db = drizzle(ctx.env.DB);
        const id = crypto.randomUUID();
        const now = new Date();
        await db.insert(agentFacts).values({
          id,
          agentId: ctx.state.agentId,
          subjectKind: subjectKind as SubjectKind,
          subjectId,
          predicate,
          object,
          sourceMessageId: sourceMessageId ?? null,
          confidence: confidence ?? 0.8,
          createdAt: now,
          updatedAt: now,
          supersededBy: null,
        });
        return { ok: true, id };
      },
    }),

    fact_query: tool({
      description:
        "Query stored facts for this agent. Filter by any combination of subjectKind, subjectId, predicate. Returns only active (non-superseded) facts. Use to answer 'what do I know about X?' style questions before asking the user.",
      inputSchema: z.object({
        subjectKind: z.enum(SUBJECT_KINDS).optional(),
        subjectId: z.string().min(1).max(200).optional(),
        predicate: z.string().min(1).max(64).optional(),
        limit: z.number().int().positive().max(MAX_QUERY_LIMIT).optional(),
      }),
      execute: async ({ subjectKind, subjectId, predicate, limit }) => {
        const db = drizzle(ctx.env.DB);
        const conds = [
          eq(agentFacts.agentId, ctx.state.agentId),
          isNull(agentFacts.supersededBy),
        ];
        if (subjectKind) conds.push(eq(agentFacts.subjectKind, subjectKind));
        if (subjectId) conds.push(eq(agentFacts.subjectId, subjectId));
        if (predicate) conds.push(eq(agentFacts.predicate, predicate));
        const rows = await db.select({
          id: agentFacts.id,
          subjectKind: agentFacts.subjectKind,
          subjectId: agentFacts.subjectId,
          predicate: agentFacts.predicate,
          object: agentFacts.object,
          confidence: agentFacts.confidence,
          createdAt: agentFacts.createdAt,
        })
          .from(agentFacts)
          .where(and(...conds))
          .limit(Math.min(limit ?? 20, MAX_QUERY_LIMIT));
        return { count: rows.length, facts: rows };
      },
    }),

    fact_supersede: tool({
      description:
        "Replace an existing fact's value with a new one. Use when a fact has CHANGED (e.g. user moved to a new timezone). Inserts a fresh row and marks the old one as historical — preserves audit trail.",
      inputSchema: z.object({
        oldId: z.string().min(1).max(64),
        newObject: z.string().min(1).max(MAX_OBJECT_BYTES),
        confidence: z.number().min(0).max(1).optional(),
      }),
      execute: async ({ oldId, newObject, confidence }) => {
        const db = drizzle(ctx.env.DB);
        const existing = await db.select({
          id: agentFacts.id,
          agentId: agentFacts.agentId,
          subjectKind: agentFacts.subjectKind,
          subjectId: agentFacts.subjectId,
          predicate: agentFacts.predicate,
          supersededBy: agentFacts.supersededBy,
        }).from(agentFacts).where(eq(agentFacts.id, oldId)).limit(1);
        if (existing.length === 0) {
          throw new Error(`no fact with id ${oldId}`);
        }
        const e = existing[0]!;
        // Agent ACL: agents can only supersede their own facts. Without
        // this check a prompt-injected agent could overwrite another
        // agent's knowledge graph by guessing ids.
        if (e.agentId !== ctx.state.agentId) {
          throw new Error("not authorized to supersede this fact");
        }
        if (e.supersededBy) {
          throw new Error("fact already superseded — query for the current id first");
        }
        const newId = crypto.randomUUID();
        const now = new Date();
        // Two-step: insert new, then update old. SQLite has no strong
        // transactional guarantee on D1 multi-statement, so we accept
        // an apparent transient state where both rows are active for
        // a moment. fact_query uses isNull(supersededBy) so seeing
        // both briefly returns two values — agent should treat them
        // as equivalent (same predicate + subject).
        await db.insert(agentFacts).values({
          id: newId,
          agentId: ctx.state.agentId,
          subjectKind: e.subjectKind as SubjectKind,
          subjectId: e.subjectId,
          predicate: e.predicate,
          object: newObject,
          sourceMessageId: null,
          confidence: confidence ?? 0.8,
          createdAt: now,
          updatedAt: now,
          supersededBy: null,
        });
        // Guard against concurrent supersede: the row MUST still be
        // un-superseded when we write the link. Without this, two
        // racing supersede calls on the same oldId would each insert
        // a new active row AND mark the old one twice, leaving two
        // active successors. Drizzle's update().where().returning is
        // best supported on D1; we check rowCount via D1's prepared
        // path. If zero rows updated, the new row we already inserted
        // is orphaned — clean it up to keep the graph consistent
        // (codex P3-W2 LOW finding).
        const updateRes = await db.update(agentFacts)
          .set({ supersededBy: newId, updatedAt: now })
          .where(and(eq(agentFacts.id, oldId), isNull(agentFacts.supersededBy)));
        // D1 drizzle doesn't always return rowCount cleanly; do a
        // verification read instead — if the old row's supersededBy
        // doesn't point to OUR newId, the race victim is us.
        const after = await db.select({ supersededBy: agentFacts.supersededBy })
          .from(agentFacts).where(eq(agentFacts.id, oldId)).limit(1);
        if (after.length === 0 || after[0]!.supersededBy !== newId) {
          // Another supersede won; roll back our orphan insert.
          await db.delete(agentFacts).where(eq(agentFacts.id, newId));
          throw new Error("fact_supersede: concurrent update won — retry with the new current id");
        }
        // Silence unused-warning — keep updateRes binding for future
        // rowCount-aware D1 driver upgrades.
        void updateRes;
        return { ok: true, oldId, newId };
      },
    }),
  };
}

// Exports for tests
export { PREDICATE_WHITELIST, SUBJECT_KINDS, MAX_OBJECT_BYTES };
export type { SubjectKind };
