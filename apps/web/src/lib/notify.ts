"use client";

import { toastManager } from "@/components/ui/toast";

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

/** Convert any thrown value into a user-facing error toast. */
export function notifyThrown(fallbackTitle: string, e: unknown): void {
  notifyError(fallbackTitle, e instanceof Error ? e.message : String(e));
}
