"use client";

import * as React from "react";
import { AlertDialog as HeroAlertDialog } from "@heroui/react/alert-dialog";
import { cn } from "@/lib/utils";

export function AlertDialog({ open, onOpenChange, children }: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <HeroAlertDialog.Root isOpen={open} onOpenChange={onOpenChange}>
      {children}
    </HeroAlertDialog.Root>
  );
}

export function AlertDialogPortal({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function AlertDialogBackdrop() {
  return null;
}

export function AlertDialogPopup({ className, children, ...props }: { className?: string; children?: React.ReactNode; [key: string]: unknown }) {
  return (
    <HeroAlertDialog.Backdrop variant="blur">
      <HeroAlertDialog.Container placement="center" size={className?.includes("max-w-sm") ? "sm" : "md"}>
        <HeroAlertDialog.Dialog className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-overlay", className)} {...(props as Record<string, unknown>)}>
          {children}
        </HeroAlertDialog.Dialog>
      </HeroAlertDialog.Container>
    </HeroAlertDialog.Backdrop>
  );
}

export function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroAlertDialog.Header className={cn("mb-3", className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroAlertDialog.Footer className={cn("mt-4 flex justify-end gap-2", className)} {...props} />;
}

export function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof HeroAlertDialog.Heading>) {
  return <HeroAlertDialog.Heading className={cn("text-base font-semibold", className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <HeroAlertDialog.Body className={cn("mt-2 text-sm text-muted-foreground", className)} {...props} />;
}

export function AlertDialogClose({ render, children, ...props }: React.ComponentProps<"button"> & { render?: React.ReactElement }) {
  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, { ...props, slot: "close" } as React.HTMLAttributes<HTMLElement>);
  }
  return <button type="button" slot="close" {...props}>{children}</button>;
}

export const AlertDialogTrigger = HeroAlertDialog.Trigger;
export const AlertDialogIcon = HeroAlertDialog.Icon;
