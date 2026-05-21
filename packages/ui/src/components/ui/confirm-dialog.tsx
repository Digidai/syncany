"use client";

import { useState, useRef, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog, AlertDialogPopup, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogClose,
} from "./alert-dialog";
import { Button } from "./button";
import { Input } from "./input";

// Shared "are you sure?" dialog built on base-ui AlertDialog. Gets focus
// trap, Escape-to-cancel, aria-modal, scroll lock, and the same z-index
// stacking as every other dialog in the app — all things the previous
// hand-rolled div overlay lacked.
//
// Two confirmation modes:
//   • Plain (default): two buttons, primary = destructive accent.
//   • Type-to-confirm (`requireText` prop): user must type the exact
//     value (trim + NFC-normalized) before the confirm button enables.
//     Use for high-stakes destructive actions like "Delete workspace".
//
// `onConfirm` may return a Promise — the button stays in a loading
// state until it resolves. Errors are surfaced via the standard
// notifyThrown channel at the call site, not by this component.
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Render the primary button in destructive accent. Defaults to true
   *  since this dialog is almost always used for destructive flows. */
  destructive?: boolean;
  /** When set, user must type this exact value to enable the confirm
   *  button. Comparison is trim + NFC-normalized so whitespace and
   *  Unicode encoding variants don't lock the user out. */
  requireText?: string;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel,
  cancelLabel = "Cancel", destructive = true, requireText, onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset typed state every time the dialog closes — otherwise reopening
  // a delete confirm for a DIFFERENT entity would still show the prior
  // entity's typed text, which is confusing at best and dangerous at
  // worst (could pre-satisfy the requireText check for the new entity).
  useEffect(() => {
    if (!open) {
      setTyped("");
      setBusy(false);
    }
  }, [open]);

  const norm = (s: string) => s.trim().normalize("NFC");
  const textReady = !requireText || norm(typed) === norm(requireText);
  const canConfirm = textReady && !busy;

  async function handleConfirm() {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm();
      // Caller is expected to flip `open` to false; we only flip the busy
      // flag here so a slow confirm that errored at the call site doesn't
      // leave the button permanently spinning.
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle className={destructive ? "flex items-center gap-2" : undefined}>
            {destructive && (
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive-foreground" aria-hidden="true" />
            )}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {requireText && (
          <div className="px-6 pb-2">
            <Input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped((e.target as HTMLInputElement).value)}
              placeholder={requireText}
              autoFocus
              aria-label={`Type ${requireText} to confirm`}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Type{" "}
              <code className="rounded bg-muted px-1 font-mono text-[10px]">{requireText}</code>{" "}
              to enable the {confirmLabel} button.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button variant="outline" size="sm" disabled={busy}>{cancelLabel}</Button>}
          />
          <Button
            size="sm"
            disabled={!canConfirm}
            loading={busy}
            onClick={handleConfirm}
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
