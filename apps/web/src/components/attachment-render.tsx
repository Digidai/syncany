"use client";

import { File as FileIcon, Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { authedAttachmentObjectURL } from "@/lib/api";

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
  // The attachment GET requires auth, but <img src> can't send a
  // bearer header. Fetch the bytes once + use an object URL. Revoke
  // on unmount so we don't leak blobs (codex C-sec HIGH).
  const objectUrl = useAuthedAttachment(a.url);
  return (
    <>
      <button
        type="button"
        onClick={() => objectUrl && setOpen(true)}
        disabled={!objectUrl}
        className="group relative overflow-hidden rounded-md border bg-card transition-colors hover:border-foreground/30 disabled:cursor-default"
        aria-label={`Open ${a.filename} in lightbox`}
      >
        {objectUrl ? (
          <img
            src={objectUrl}
            alt={a.filename}
            loading="lazy"
            className="block max-h-64 max-w-xs cursor-zoom-in object-contain"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-32 w-48 items-center justify-center bg-muted/40 text-[10.5px] text-muted-foreground">
            Loading {a.filename}…
          </div>
        )}
      </button>
      {open && objectUrl && (
        <Lightbox attachment={a} objectUrl={objectUrl} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** Fetch the bearer-protected attachment once and return an object URL.
 *  Returns null while loading. Revokes on unmount. */
function useAuthedAttachment(apiUrl: string): string | null {
  const [obj, setObj] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const u = await authedAttachmentObjectURL(apiUrl);
        if (cancelled) { URL.revokeObjectURL(u); return; }
        createdUrl = u;
        setObj(u);
      } catch { /* swallow — UI shows placeholder */ }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) try { URL.revokeObjectURL(createdUrl); } catch { /* ignore */ }
    };
  }, [apiUrl]);
  return obj;
}

function FileAttachment({ a }: { a: Attachment }) {
  // Same bearer issue as images — anchor href can't send Authorization,
  // so fetch once + serve from object URL. The browser still treats the
  // download="..." attribute correctly against blob: URLs.
  const objectUrl = useAuthedAttachment(a.url);
  return (
    <a
      href={objectUrl ?? "#"}
      onClick={(e) => { if (!objectUrl) e.preventDefault(); }}
      download={a.filename}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Download ${a.filename} (${formatSize(a.sizeBytes)}, opens in new tab)`}
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

function Lightbox({ attachment, objectUrl, onClose }: { attachment: Attachment; objectUrl: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Codex C-ui HIGH 1+2 — focus management: capture the previously-focused
  // element on mount so we can restore on unmount, focus the Close
  // button immediately so screen readers + keyboard users land inside
  // the dialog, and bind Escape at the window level (the role=dialog
  // div is not focusable so a div-level handler wouldn't fire).
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      try { prev?.focus(); } catch { /* element may be gone */ }
    };
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Image: ${attachment.filename}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-4"
    >
      <button
        ref={closeRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white"
        aria-label="Close lightbox"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={objectUrl}
        alt={attachment.filename}
        className="max-h-full max-w-full object-contain"
        onClick={(e) => e.stopPropagation()}
        referrerPolicy="no-referrer"
      />
      <a
        href={objectUrl}
        download={attachment.filename}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Download ${attachment.filename} (opens in new tab)`}
        className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
      >
        <Download className="h-4 w-4" aria-hidden="true" /> Download
      </a>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
