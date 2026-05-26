"use client";

import * as React from "react";
import { Modal } from "@heroui/react/modal";
import { cn } from "@/lib/utils";

const MODAL_CLOSE_CLASS = [
  "absolute right-3 top-3",
  "!size-8 !rounded-full !border !border-border",
  "!bg-background/95 !text-foreground !shadow-sm",
  "transition-colors hover:!bg-muted hover:!text-foreground",
  "focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-ring focus-visible:!ring-offset-2",
].join(" ");

type OpenProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

export function Dialog({ open, onOpenChange, children }: OpenProps) {
  return (
    <Modal.Root isOpen={open} onOpenChange={onOpenChange}>
      {children}
    </Modal.Root>
  );
}

export function DialogPortal({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function DialogBackdrop() {
  return null;
}

function sizeFromClass(className?: string): React.ComponentProps<typeof Modal.Container>["size"] {
  if (className?.includes("max-w-full")) return "full";
  if (className?.includes("max-w-xs")) return "xs";
  if (className?.includes("max-w-sm")) return "sm";
  if (className?.includes("max-w-md")) return "md";
  if (className?.includes("max-w-lg")) return "lg";
  if (className?.includes("max-w-xl")) return "lg";
  return "md";
}

export function DialogPopup({
  className,
  children,
  showCloseButton = true,
  ...props
}: { className?: string; children?: React.ReactNode; showCloseButton?: boolean; bottomStickOnMobile?: boolean; closeProps?: unknown; portalProps?: unknown; [key: string]: unknown }) {
  return (
    <Modal.Backdrop variant="blur">
      <Modal.Container placement="center" scroll="inside" size={sizeFromClass(className)}>
        <Modal.Dialog
          className={cn("flex max-h-[calc(var(--raltic-visual-viewport-height)-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-overlay", className)}
          {...(props as Record<string, unknown>)}
        >
          {children}
          {showCloseButton && <Modal.CloseTrigger className={MODAL_CLOSE_CLASS} aria-label="Close" />}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <Modal.Header className={cn("px-5 pb-3 pt-5", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof Modal.Heading>) {
  return <Modal.Heading className={cn("text-base font-semibold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function DialogPanel({ className, scrollFade, ...props }: React.ComponentProps<"div"> & { scrollFade?: boolean }) {
  void scrollFade;
  return <Modal.Body className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-3", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div"> & { variant?: "default" | "bare" }) {
  return <Modal.Footer className={cn("shrink-0 border-t border-border/70 bg-background/95 px-5 pb-5 pt-3 backdrop-blur flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

export function DialogClose({ render, children, ...props }: React.ComponentProps<"button"> & { render?: React.ReactElement }) {
  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, { ...props, slot: "close" } as React.HTMLAttributes<HTMLElement>);
  }
  return (
    <button type="button" slot="close" {...props}>
      {children}
    </button>
  );
}

export function DialogTrigger({ render, children, ...props }: React.ComponentProps<"button"> & { render?: React.ReactElement }) {
  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, { ...props } as React.HTMLAttributes<HTMLElement>);
  }
  return <Modal.Trigger {...(props as Record<string, unknown>)}>{children}</Modal.Trigger>;
}

export const DialogViewport = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const DialogCreateHandle = undefined;
