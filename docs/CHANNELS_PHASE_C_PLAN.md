# Channels Phase C — file/image attachments (DEFERRED)

Status: **PLANNED, NOT STARTED**
Owner: TBD
Estimate: 5–7h end-to-end (schema + R2 flow + UI + codex review)

## Why deferred

Phase C requires more than additive schema + endpoint work — it needs
a thought-through upload protocol (signed PUT URLs vs proxy), MIME
validation, per-workspace storage quotas, EXIF stripping for privacy,
abuse rate limits, and inline rendering of multiple media types.
Doing it well takes a dedicated session.

R2 binding `UPLOADS → raltic-uploads` is already declared in
`apps/api/wrangler.jsonc`, and `apps/api/src/routes/uploads.ts`
exists today scoped to avatar uploads — that's the reference shape
for the bytes path.

## Scope

### Schema (one migration)

New table `message_attachments`:

```ts
export const messageAttachments = sqliteTable("message_attachments", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  uploaderId: text("uploader_id").notNull().references(() => user.id, { onDelete: "set null" }),
  r2Key: text("r2_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  // Width/height for image previews (server-derived, null for non-images).
  width: integer("width"),
  height: integer("height"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [
  index("ix_attachments_message").on(t.messageId),
  index("ix_attachments_channel_created").on(t.channelId, t.createdAt),
]);
```

### Backend

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/v1/uploads/message-attachment/sign` | `{channelId, filename, contentType, sizeBytes}` | `{uploadUrl, r2Key, attachmentId}` |
| `POST /api/v1/uploads/message-attachment/finalize` | `{attachmentId}` | `{ok}` — server HEADs R2 to confirm bytes landed + computes width/height for images |
| `POST /api/v1/messages` | extend body with `attachmentIds: string[]` | unchanged |
| `GET  /api/v1/uploads/:attachmentId` | — | streams R2 object with `Content-Disposition: inline` for images / `attachment` for files |

Policy: `policy.attachments.canUpload(ctx, channelId)` = `canAddMember`
(channel participant). `canRead(ctx, attachmentId)` = `canRead` for the
attachment's channel. **Don't** allow attachment uploads to archived
channels (HTTP 423).

Quotas: per-user 100MB/day, per-workspace 10GB total. Reject
single-file > 25MB up front in the `sign` endpoint to avoid wasted
R2 multipart starts.

MIME allowlist (minimum viable): `image/*`, `application/pdf`,
`text/plain`, `text/markdown`, `application/zip`. Reject anything
else with 415.

### Web

- `apps/web/src/components/message-area.tsx` composer: add file-input + drag-drop overlay
- Upload flow: PUT to signed URL (browser → R2 direct, bypasses Worker bandwidth), then finalize, then sendMessage with attachmentId
- Inline render in message body:
  - Images: lazy-load thumbnail, click → lightbox
  - PDF: icon + filename + size + download link
  - Other: icon + filename + size + download link
- Show upload progress per file
- Drag-drop hint in composer when channel has zero messages

### Security review checklist (before ship)

- SSRF: Signed URLs are R2-direct (no Worker fetch); safe
- XSS: filenames rendered via React text, never innerHTML
- Path traversal: r2Key is `${channelId}/${attachmentId}` — namespaced
- Stripping EXIF from images on finalize (sharp not available in CF Workers; either accept the leak v1 or add a sidecar)
- CSP `img-src` already permits `https:` so signed R2 URLs work without policy change
- Rate limits per-user + per-channel
- Archived channels reject uploads (`/finalize` returns 423)

### Codex review angles (do after build)

1. Upload flow security: signed URL TTL, replay-attack window
2. Storage quota correctness: race between two parallel uploads filling the quota
3. UI/a11y: drag-drop targets are keyboard-accessible? File-input has correct label?
4. Cost: signed-URL approach vs Worker-proxy bandwidth math at 1000 attachments/day
5. Mobile UX: tap-to-attach using `accept=image/*` + Web Share Target

### Files touched (estimate)

- `packages/db/src/schema.ts` + migration
- `packages/protocol/src/rest.ts` (schemas)
- `apps/api/src/routes/uploads.ts` (extend) OR new `attachments.ts`
- `apps/api/src/routes/messages.ts` (accept attachmentIds)
- `apps/api/src/routes/channels.ts` (GET /channels/:id/messages returns attachments)
- `apps/web/src/lib/api.ts` (signMessageAttachment, finalizeAttachment, listAttachments)
- `apps/web/src/components/message-area.tsx` (composer + render)
- `apps/web/src/components/attachment-render.tsx` (new)
- `apps/web/src/components/attachment-uploader.tsx` (new)
