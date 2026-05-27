"use client";

import { useEffect, useState } from "react";
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

  return (
    <AlertDialog.Root isOpen={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Backdrop variant="blur">
        <AlertDialog.Container placement="center" size="sm">
          <AlertDialog.Dialog className="max-h-[calc(var(--raltic-visual-viewport-height)-2rem)] overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-overlay">
            <AlertDialog.Header>
              <AlertDialog.Heading className="flex items-center gap-2 text-base font-semibold">
                {destructive && <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />}
                {title}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="mt-2 space-y-3 text-sm text-muted-foreground">
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
            <AlertDialog.Footer className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
    </AlertDialog.Root>
  );
}
