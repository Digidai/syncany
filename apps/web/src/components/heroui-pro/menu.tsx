"use client";

import * as React from "react";
import { Dropdown } from "@heroui/react/dropdown";
import { cn } from "@/lib/utils";

export const DropdownMenu = Dropdown.Root;

export function DropdownMenuTrigger({ className, children, ...props }: React.ComponentProps<"button">) {
  return (
    <Dropdown.Trigger className={className} {...(props as Record<string, unknown>)}>
      {children}
    </Dropdown.Trigger>
  );
}

export function DropdownMenuContent({
  className,
  align,
  side,
  sideOffset,
  children,
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "center" | "end"; side?: "top" | "right" | "bottom" | "left"; sideOffset?: number }) {
  void sideOffset;
  const placement = side === "top" ? "top" : side === "left" ? "left" : side === "right" ? "right" : "bottom";
  return (
    <Dropdown.Popover placement={placement} className={cn("min-w-40 rounded-lg border border-border bg-background p-1 shadow-overlay", className)} {...(props as Record<string, unknown>)}>
      <Dropdown.Menu aria-label="Menu" className={align === "end" ? "origin-top-right" : undefined}>
        {children}
      </Dropdown.Menu>
    </Dropdown.Popover>
  );
}

export function DropdownMenuItem({
  className,
  children,
  onClick,
  disabled,
  variant,
  render,
  ...props
}: React.ComponentProps<"div"> & {
  disabled?: boolean;
  variant?: "default" | "destructive";
  render?: React.ReactElement;
}) {
  const content = render && React.isValidElement(render)
    ? React.cloneElement(render, {
        className: cn("flex w-full items-center gap-2", (render.props as { className?: string }).className),
        children,
      } as React.HTMLAttributes<HTMLElement>)
    : children;

  return (
    <Dropdown.Item
      {...(props as Record<string, unknown>)}
      className={cn(variant === "destructive" && "text-danger", className)}
      isDisabled={disabled}
      onAction={() => onClick?.({} as React.MouseEvent<HTMLDivElement>)}
      textValue={typeof children === "string" ? children : undefined}
    >
      {content}
    </Dropdown.Item>
  );
}

export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div className={cn("mx-1 my-1 h-px bg-border", className)} role="separator" {...props} />
);

export const DropdownMenuGroup = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const DropdownMenuLabel = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />
);

export const Menu = DropdownMenu;
export const MenuTrigger = DropdownMenuTrigger;
export const MenuPopup = DropdownMenuContent;
export const MenuItem = DropdownMenuItem;
export const MenuSeparator = DropdownMenuSeparator;
