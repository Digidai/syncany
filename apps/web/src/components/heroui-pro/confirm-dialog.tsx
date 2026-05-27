"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Input } from "./input";
import { Button } from "./button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  requireText?: string;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = true,
  requireText,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setTyped("");
      setBusy(false);
    }
  }, [open]);

  const norm = (s: string) => s.trim().normalize("NFC");
  const canConfirm = !busy && (!requireText || norm(typed) === norm(requireText));
  function handleOpenChange(next: boolean) {
    if (busy && !next) return;
    onOpenChange(next);
  }

  async function handleConfirm() {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <AlertDialog.Backdrop variant="blur" isOpen={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Container placement="center" size="sm" className="px-3 py-3 sm:px-4">
        <AlertDialog.Dialog
          data-raltic-overlay="confirm-dialog"
          aria-label="Confirm action"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="raltic-overlay-scope flex max-h-[calc(var(--raltic-visual-viewport-height)-2rem)] w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-[var(--overlay)] text-[var(--overlay-foreground)] shadow-overlay sm:w-full"
        >
          <AlertDialog.Header className="shrink-0 px-5 pb-3 pt-5">
            <AlertDialog.Heading id={titleId} className="flex items-center gap-2 text-base font-semibold text-[var(--overlay-foreground)]">
              {destructive && <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />}
              {title}
            </AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body id={descriptionId} className="min-h-0 flex-1 overflow-y-auto px-5 py-1 text-sm text-muted-foreground">
            <p>{description}</p>
            {requireText && (
              <div>
                <Input
                  autoFocus
                  aria-label={`Type ${requireText} to confirm`}
                  placeholder={requireText}
                  value={typed}
                  onChange={(e) => setTyped((e.target as HTMLInputElement).value)}
                />
                <p className="mt-1.5 text-[11px]">
                  Type <code className="rounded bg-default px-1 font-mono text-[10px]">{requireText}</code> to continue.
                </p>
              </div>
            )}
          </AlertDialog.Body>
          <AlertDialog.Footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-border/70 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end sm:pb-5">
            <Button type="button" variant="outline" disabled={busy} slot="close" className="w-full sm:w-auto">{cancelLabel}</Button>
            <Button
              type="button"
              variant={destructive ? "danger" : "primary"}
              disabled={!canConfirm}
              loading={busy}
              onClick={handleConfirm}
              className="w-full sm:w-auto"
            >
              {confirmLabel}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
