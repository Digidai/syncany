"use client";

import { toastManager } from "@raltic/ui/components/ui/toast";
import { ApiError, NetworkError } from "./api";

/** Brief success toast (auto-dismiss). */
export function notifySuccess(title: string, description?: string): void {
  toastManager.add({ type: "success", title, description, timeout: 4000 });
}

/** Error toast — slightly longer timeout so users can read it. */
export function notifyError(title: string, description?: string): void {
  toastManager.add({
    type: "error",
    title,
    description,
    timeout: 7000,
    priority: "high",
  });
}

/**
 * Convert any thrown value into a user-facing error toast, categorised so
 * the surface copy matches the actual fault domain:
 *
 *   • ApiError(auth)    → "Please sign in again"
 *   • ApiError(4xx)     → server's own message + caller's fallback title
 *   • ApiError(5xx)     → "Server hiccup — try again"
 *   • NetworkError      → "You appear to be offline"
 *   • anything else     → fallback title + Error.message
 *
 * Always logs to console too so the underlying error stays diagnosable in
 * the browser devtools even when the toast says something friendlier.
 */
export function notifyThrown(fallbackTitle: string, e: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[${fallbackTitle}]`, e);

  if (e instanceof ApiError) {
    if (e.isAuthFault) {
      notifyError("Please sign in again", "Your session expired.");
      return;
    }
    if (e.isServerFault) {
      notifyError("Server hiccup — try again", e.message);
      return;
    }
    // 4xx user-fault: server's own message is usually the right thing to show.
    notifyError(fallbackTitle, e.message);
    return;
  }

  if (e instanceof NetworkError) {
    notifyError("You appear to be offline", "Check your connection and try again.");
    return;
  }

  notifyError(fallbackTitle, e instanceof Error ? e.message : String(e));
}
