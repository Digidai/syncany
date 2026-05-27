"use client";

import * as React from "react";
import { AlertDialog as HeroAlertDialog } from "@heroui/react/alert-dialog";
import { cn } from "@/lib/utils";

type AlertOpenProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const AlertDialogOpenContext = React.createContext<AlertOpenProps | null>(null);
const AlertDialogTitleIdContext = React.createContext<string | null>(null);
const AlertDialogDescriptionIdContext = React.createContext<string | null>(null);

export function AlertDialog({ open, onOpenChange, children }: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <AlertDialogOpenContext.Provider value={{ open, onOpenChange }}>
      {children}
    </AlertDialogOpenContext.Provider>
  );
}

export function AlertDialogPortal({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function AlertDialogBackdrop() {
  return null;
}

export function AlertDialogPopup({ className, children, ...props }: { className?: string; children?: React.ReactNode; [key: string]: unknown }) {
  const overlay = React.useContext(AlertDialogOpenContext);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const dialogProps = props as Record<string, unknown>;
  const hasAccessibleName = Boolean(dialogProps["aria-label"] || dialogProps["aria-labelledby"]);
  const hasAccessibleDescription = Boolean(dialogProps["aria-describedby"]);

  if (overlay?.open === false) return null;

  return (
    <HeroAlertDialog.Backdrop
      variant="blur"
      isOpen={overlay?.open}
      onOpenChange={overlay?.onOpenChange}
    >
      <HeroAlertDialog.Container placement="center" size={className?.includes("max-w-sm") ? "sm" : "md"} className="px-3 py-3 sm:px-4">
        <HeroAlertDialog.Dialog
          data-raltic-overlay="alert-dialog"
          className={cn(
            "raltic-overlay-scope flex max-h-[calc(var(--raltic-visual-viewport-height)-2rem)] w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-[var(--overlay)] text-[var(--overlay-foreground)] shadow-overlay sm:w-full",
            className,
          )}
          aria-label={hasAccessibleName ? undefined : "Alert dialog"}
          aria-labelledby={hasAccessibleName ? undefined : titleId}
          aria-describedby={hasAccessibleDescription ? undefined : descriptionId}
          {...dialogProps}
        >
          <AlertDialogTitleIdContext.Provider value={titleId}>
            <AlertDialogDescriptionIdContext.Provider value={descriptionId}>
              {children}
            </AlertDialogDescriptionIdContext.Provider>
          </AlertDialogTitleIdContext.Provider>
        </HeroAlertDialog.Dialog>
      </HeroAlertDialog.Container>
    </HeroAlertDialog.Backdrop>
  );
}

export function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroAlertDialog.Header className={cn("shrink-0 px-5 pb-3 pt-5", className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroAlertDialog.Footer className={cn("flex shrink-0 flex-col-reverse gap-2 border-t border-border/70 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end sm:pb-5", className)} {...props} />;
}

export function AlertDialogTitle({ className, id, ...props }: React.ComponentProps<typeof HeroAlertDialog.Heading>) {
  const generatedTitleId = React.useContext(AlertDialogTitleIdContext);
  return (
    <HeroAlertDialog.Heading
      {...props}
      id={id ?? generatedTitleId ?? undefined}
      className={cn("text-base font-semibold text-[var(--overlay-foreground)]", className)}
    />
  );
}

export function AlertDialogDescription({ className, id, ...props }: React.ComponentProps<"p">) {
  const generatedDescriptionId = React.useContext(AlertDialogDescriptionIdContext);
  return (
    <HeroAlertDialog.Body
      {...props}
      id={id ?? generatedDescriptionId ?? undefined}
      className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-1 text-sm text-muted-foreground", className)}
    />
  );
}

export function AlertDialogClose({ render, children, ...props }: React.ComponentProps<"button"> & { render?: React.ReactElement }) {
  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, { ...props, slot: "close" } as React.HTMLAttributes<HTMLElement>);
  }
  return <button type="button" slot="close" {...props}>{children}</button>;
}

export const AlertDialogTrigger = HeroAlertDialog.Trigger;
export const AlertDialogIcon = HeroAlertDialog.Icon;
