"use client";

import { File as FileIcon, Image as ImageIcon, Download, X } from "lucide-react";
import { useState } from "react";

interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  width?: number | null;
  height?: number | null;
}

/**
 * Phase C — inline attachment rendering inside a message body.
 *
 * Images: thumbnail with click-to-lightbox. Lazy-loaded so a channel
 * with many image messages doesn't fetch every one on initial paint.
 *
 * Non-images: file card with icon + filename + size + download link.
 * Both paths go through the API-gated `/uploads/attachments/...` URL,
 * so membership re-check happens on every byte fetch.
 */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {attachments.map((a) =>
        a.contentType.startsWith("image/")
          ? <ImageAttachment key={a.id} a={a} />
          : <FileAttachment key={a.id} a={a} />
      )}
    </div>
  );
}

function ImageAttachment({ a }: { a: Attachment }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative overflow-hidden rounded-md border bg-card transition-colors hover:border-foreground/30"
        aria-label={`Open ${a.filename} in lightbox`}
      >
        {/* max-h keeps tall screenshots from eating the message column */}
        <img
          src={a.url}
          alt={a.filename}
          loading="lazy"
          className="block max-h-64 max-w-xs cursor-zoom-in object-contain"
          referrerPolicy="no-referrer"
        />
      </button>
      {open && (
        <Lightbox attachment={a} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function FileAttachment({ a }: { a: Attachment }) {
  return (
    <a
      href={a.url}
      download={a.filename}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex max-w-xs items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs transition-colors hover:border-foreground/30"
    >
      <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{a.filename}</div>
        <div className="text-[10.5px] text-muted-foreground">
          {formatSize(a.sizeBytes)} · {a.contentType.split("/")[1] ?? a.contentType}
        </div>
      </div>
      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
    </a>
  );
}

function Lightbox({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Image: ${attachment.filename}`}
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-4"
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
        aria-label="Close lightbox"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={attachment.url}
        alt={attachment.filename}
        className="max-h-full max-w-full object-contain"
        onClick={(e) => e.stopPropagation()}
        referrerPolicy="no-referrer"
      />
      <a
        href={attachment.url}
        download={attachment.filename}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
      >
        <Download className="h-4 w-4" /> Download
      </a>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
