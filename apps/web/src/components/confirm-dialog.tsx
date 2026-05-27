"use client";

import {
  AlertDialog, AlertDialogBackdrop, AlertDialogPopup, AlertDialogPortal,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogClose,
} from "@/components/heroui-pro/alert-dialog";
import { Button } from "@/components/heroui-pro/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Defaults to "Continue". */
  confirmLabel?: string;
  /** When true, renders the confirm button in destructive variant. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * In-app replacement for `window.confirm()` — keeps focus management,
 * dark theme, and keyboard semantics consistent with the rest of the
 * dialog system. Use for SIMPLE yes/no destructive prompts (Leave
 * channel, Remove member). For "type-the-name" confirmations use the
 * inline pattern in ChannelSettingsDialog instead.
 *
 * Codex C3 MED follow-up: native confirm() was breaking focus traps +
 * looked alien against the rest of the in-app dialog stack.
 */
export function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel = "Continue", destructive = false, busy = false, onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPortal>
        <AlertDialogBackdrop />
        <AlertDialogPopup className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </AlertDialogHeader>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" type="button" disabled={busy} className="w-full sm:w-auto">Cancel</Button>} />
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              loading={busy}
              onClick={async () => { await onConfirm(); }}
              className="w-full sm:w-auto"
            >
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialogPortal>
    </AlertDialog>
  );
}
