"use client";

import * as React from "react";
import { Modal } from "@heroui/react/modal";
import { cn } from "@/lib/utils";

const MODAL_CLOSE_CLASS = [
  "close-button",
  "absolute right-3 top-3",
  "!size-9 !rounded-full",
  "!border-2 !border-[var(--overlay-close-border)]",
  "!bg-[var(--overlay-close-bg)] !text-[var(--overlay-close-fg)] !shadow-md",
  "transition-colors hover:!bg-[var(--overlay-close-bg-hover)] hover:!text-[var(--overlay-close-fg-hover)]",
  "focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-ring focus-visible:!ring-offset-2",
  "[&_svg]:!opacity-100 [&_svg]:!text-current [&_svg]:!stroke-[2.5]",
].join(" ");

type OpenProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

const DialogOpenContext = React.createContext<Pick<OpenProps, "open" | "onOpenChange"> | null>(null);
const DialogTitleIdContext = React.createContext<string | null>(null);

export function Dialog({ open, onOpenChange, children }: OpenProps) {
  return (
    <DialogOpenContext.Provider value={{ open, onOpenChange }}>
      {children}
    </DialogOpenContext.Provider>
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
  const overlay = React.useContext(DialogOpenContext);
  const titleId = React.useId();
  const dialogProps = props as Record<string, unknown>;
  const hasAccessibleName = Boolean(dialogProps["aria-label"] || dialogProps["aria-labelledby"]);

  if (overlay?.open === false) return null;

  return (
    <Modal.Backdrop
      variant="blur"
      isOpen={overlay?.open}
      onOpenChange={overlay?.onOpenChange}
    >
      <Modal.Container placement="center" scroll="inside" size={sizeFromClass(className)} className="px-3 py-3 sm:px-4">
        <Modal.Dialog
          data-raltic-overlay="dialog"
          className={cn(
            "raltic-overlay-scope flex w-[calc(100vw-1.5rem)] max-h-[calc(var(--raltic-visual-viewport-height)-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-[var(--overlay)] text-[var(--overlay-foreground)] shadow-overlay sm:w-full",
            className,
          )}
          aria-label={hasAccessibleName ? undefined : "Dialog"}
          aria-labelledby={hasAccessibleName ? undefined : titleId}
          {...dialogProps}
        >
          <DialogTitleIdContext.Provider value={titleId}>
            {children}
          </DialogTitleIdContext.Provider>
          {showCloseButton && <Modal.CloseTrigger className={MODAL_CLOSE_CLASS} aria-label="Close" />}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <Modal.Header className={cn("px-5 pb-3 pt-5 text-[var(--overlay-foreground)]", className)} {...props} />;
}

export function DialogTitle({ className, id, ...props }: React.ComponentProps<typeof Modal.Heading>) {
  const generatedTitleId = React.useContext(DialogTitleIdContext);
  return (
    <Modal.Heading
      {...props}
      id={id ?? generatedTitleId ?? undefined}
      className={cn("pr-10 text-base font-semibold text-[var(--overlay-foreground)]", className)}
    />
  );
}

export function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function DialogPanel({ className, scrollFade, ...props }: React.ComponentProps<"div"> & { scrollFade?: boolean }) {
  void scrollFade;
  return <Modal.Body className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-3 text-sm text-[var(--overlay-foreground)]", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div"> & { variant?: "default" | "bare" }) {
  return <Modal.Footer className={cn("flex shrink-0 flex-col-reverse gap-2 border-t border-border/70 bg-[var(--overlay)] px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:flex-row sm:justify-end sm:pb-5", className)} {...props} />;
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
