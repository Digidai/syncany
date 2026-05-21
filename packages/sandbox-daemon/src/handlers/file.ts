import { Hono } from "hono";
import { z } from "zod";
import { stat, writeFile, mkdir, readdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppOptions, EditResult, FileReadResult } from "../types.js";
import { resolveSafeForFs } from "../security.js";

/**
 * /file routes — read/write/edit/list, all rooted under workspaceRoot.
 *
 * Design notes:
 *   - We deliberately do NOT support symlink resolution outside root.
 *     fs.readFile follows symlinks; if /workspace contains a symlink to
 *     /etc/passwd, this leaks. Production sandbox should mount with
 *     `nosymfollow` or equivalent; we defense-in-depth via st.isFile().
 *   - File size cap: 5 MiB. Larger files get truncated with a flag so
 *     the agent can offer to read in chunks instead of OOM-ing the DO.
 */

const READ_LIMIT = 5 * 1024 * 1024;     // 5 MiB
const WRITE_LIMIT = 5 * 1024 * 1024;    // 5 MiB
const EDIT_OCCURRENCES_LIMIT = 1000;    // safety against runaway replace

const readBody = z.object({
  path: z.string().min(1).max(4096),
  encoding: z.enum(["utf-8", "base64"]).optional(),
});

const writeBody = z.object({
  path: z.string().min(1).max(4096),
  content: z.string(),
  encoding: z.enum(["utf-8", "base64"]).optional(),
});

const editBody = z.object({
  path: z.string().min(1).max(4096),
  oldStr: z.string().min(1),
  newStr: z.string(),
  /** When true, replace every occurrence. When false (default), require
   *  exactly one occurrence and error otherwise — matches Edit tool semantics. */
  replaceAll: z.boolean().optional(),
});

const listBody = z.object({
  path: z.string().min(1).max(4096),
});

export function fileRoutes(opts: AppOptions) {
  const app = new Hono();

  app.post("/read", async (c) => {
    const body = readBody.parse(await c.req.json());
    const abs = await resolveSafeForFs(opts.workspaceRoot, body.path);
    const st = await stat(abs);
    if (!st.isFile()) {
      return c.json({ error: { code: "NOT_A_FILE", message: "not a regular file" } }, 400);
    }
    // Pre-check size BEFORE allocating any buffer — codex review caught
    // the prior "readFile then slice" pattern as an OOM vector on PID 1.
    // Stream only up to READ_LIMIT bytes via fd; the daemon stays bounded
    // regardless of file size on disk.
    const wantBase64 = body.encoding === "base64";
    const toRead = Math.min(st.size, READ_LIMIT);
    const fh = await open(abs, "r");
    let buf: Buffer;
    try {
      buf = Buffer.allocUnsafe(toRead);
      let pos = 0;
      while (pos < toRead) {
        const { bytesRead } = await fh.read(buf, pos, toRead - pos, pos);
        if (bytesRead === 0) break;
        pos += bytesRead;
      }
      if (pos < toRead) buf = buf.subarray(0, pos);
    } finally {
      await fh.close();
    }
    const truncated = st.size > READ_LIMIT;
    const result: FileReadResult = {
      path: body.path,
      encoding: wantBase64 ? "base64" : "utf-8",
      content: wantBase64 ? buf.toString("base64") : buf.toString("utf-8"),
      bytes: buf.byteLength,
      truncated,
    };
    return c.json(result);
  });

  app.post("/write", async (c) => {
    const body = writeBody.parse(await c.req.json());
    const abs = await resolveSafeForFs(opts.workspaceRoot, body.path);
    const data = body.encoding === "base64"
      ? Buffer.from(body.content, "base64")
      : Buffer.from(body.content, "utf-8");
    if (data.byteLength > WRITE_LIMIT) {
      return c.json({ error: { code: "TOO_LARGE", message: `max ${WRITE_LIMIT} bytes` } }, 413);
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
    return c.json({ ok: true, path: body.path, bytes: data.byteLength });
  });

  app.post("/edit", async (c) => {
    const body = editBody.parse(await c.req.json());
    const abs = await resolveSafeForFs(opts.workspaceRoot, body.path);
    // Cap edit-target size by READ_LIMIT — we'd otherwise readFile a
    // potentially-huge file into memory. Same OOM concern as /read.
    const st = await stat(abs);
    if (!st.isFile()) {
      return c.json({ error: { code: "NOT_A_FILE", message: "not a regular file" } }, 400);
    }
    if (st.size > READ_LIMIT) {
      return c.json({ error: { code: "TOO_LARGE", message: `file > ${READ_LIMIT} bytes; edit unsupported` } }, 413);
    }
    const fh = await open(abs, "r");
    let before: string;
    try {
      const buf = Buffer.allocUnsafe(st.size);
      let pos = 0;
      while (pos < st.size) {
        const { bytesRead } = await fh.read(buf, pos, st.size - pos, pos);
        if (bytesRead === 0) break;
        pos += bytesRead;
      }
      before = buf.subarray(0, pos).toString("utf-8");
    } finally {
      await fh.close();
    }
    // Count occurrences without regex to avoid metacharacter surprises.
    let count = 0;
    {
      let i = before.indexOf(body.oldStr);
      while (i !== -1) {
        count++;
        if (count > EDIT_OCCURRENCES_LIMIT) break;
        i = before.indexOf(body.oldStr, i + body.oldStr.length);
      }
    }
    if (count === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "oldStr not present in file" } }, 404);
    }
    if (!body.replaceAll && count > 1) {
      return c.json({
        error: { code: "AMBIGUOUS", message: `oldStr matches ${count} times; pass replaceAll:true or include more context` },
      }, 409);
    }
    const after = body.replaceAll
      ? before.split(body.oldStr).join(body.newStr)
      : before.replace(body.oldStr, body.newStr);
    await writeFile(abs, after, "utf-8");
    const result: EditResult = { path: body.path, occurrences: count };
    return c.json(result);
  });

  app.post("/list", async (c) => {
    const body = listBody.parse(await c.req.json());
    const abs = await resolveSafeForFs(opts.workspaceRoot, body.path);
    const entries = await readdir(abs, { withFileTypes: true });
    return c.json({
      path: body.path,
      entries: entries.map(e => ({
        name: e.name,
        kind: e.isDirectory() ? "dir" : e.isFile() ? "file" : e.isSymbolicLink() ? "symlink" : "other",
      })),
    });
  });

  return app;
}
