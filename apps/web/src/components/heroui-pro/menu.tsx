"use client";

import * as React from "react";
import { Dropdown } from "@heroui/react/dropdown";
import { Menu as HeroMenu } from "@heroui/react/menu";
import { cn } from "@/lib/utils";

type MenuSide = "top" | "right" | "bottom" | "left";
type MenuAlign = "start" | "end";

type HeroDropdownMenuProps = React.ComponentProps<typeof Dropdown>;
type HeroDropdownItemProps = React.ComponentProps<typeof Dropdown.Item>;
type HeroMenuSectionProps = React.ComponentProps<typeof HeroMenu.Section>;

type LegacyItemVariant = "default" | "destructive";

type DropdownPlacement = "top" | "top start" | "top end" | "top left" | "top right"
  | "bottom" | "bottom start" | "bottom end" | "bottom left" | "bottom right"
  | "left" | "left top" | "left bottom"
  | "right" | "right top" | "right bottom"
  | "start" | "end";

function toPlacement(side: MenuSide, align: MenuAlign): DropdownPlacement {
  if (side === "top") return align === "start" ? "top start" : "top end";
  if (side === "bottom") return align === "start" ? "bottom start" : "bottom end";
  if (side === "left") return align === "start" ? "left top" : "left bottom";
  return align === "start" ? "right top" : "right bottom";
}

function deriveTextValue(children: React.ReactNode) {
  const walk = (nodes: React.ReactNode): string[] => {
    return React.Children.toArray(nodes).flatMap((node) => {
      if (typeof node === "string" || typeof node === "number") return [String(node)];
      if (React.isValidElement(node)) {
        const props = node.props as { children?: React.ReactNode };
        return walk(props.children);
      }
      return [];
    });
  };

  const text = walk(children).join(" ").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : undefined;
}

export function DropdownMenu({
  children,
  onOpenChange,
}: {
  children: React.ReactNode;
  onOpenChange?: HeroDropdownMenuProps["onOpenChange"];
}) {
  return (
    <Dropdown onOpenChange={onOpenChange}>
      {children}
    </Dropdown>
  );
}

export function DropdownMenuTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Dropdown.Trigger>) {
  return (
    <Dropdown.Trigger className={className} {...props}>
      {children}
    </Dropdown.Trigger>
  );
}

export function DropdownMenuContent({
  className,
  align = "start",
  side = "bottom",
  sideOffset = 4,
  alignOffset = 0,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Dropdown.Popover>, "placement"> & {
  align?: MenuAlign;
  side?: MenuSide;
  sideOffset?: number;
  alignOffset?: number;
}) {
  return (
    <Dropdown.Popover
      {...props}
      placement={toPlacement(side, align)}
      offset={sideOffset}
      crossOffset={alignOffset}
      className={cn(
        "raltic-overlay-scope min-w-40 rounded-xl border border-border bg-[var(--popover)] p-1 text-[var(--overlay-foreground)] shadow-overlay",
        className,
      )}
    >
      <div>
        <Dropdown.Menu className="min-w-full">
          {children}
        </Dropdown.Menu>
      </div>
    </Dropdown.Popover>
  );
}

export function DropdownMenuItem({
  className,
  children,
  onClick,
  disabled,
  variant,
  textValue,
  ...props
}: Omit<HeroDropdownItemProps, "variant" | "onAction" | "children"> & {
  disabled?: boolean;
  variant?: LegacyItemVariant;
  textValue?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const baseClassName = cn(
    "px-2 py-1.5",
    "[&>svg]:text-muted-foreground",
    "flex min-h-8 w-full items-center gap-2 rounded-md text-left text-sm outline-none transition-colors",
    "text-foreground hover:bg-default focus-visible:bg-default focus-visible:ring-2 focus-visible:ring-ring",
    variant === "destructive" && "text-danger hover:bg-danger/10",
    disabled && "pointer-events-none opacity-50",
  );

  const itemProps = {
    ...props,
    disabled,
    textValue,
  };

  return (
    <Dropdown.Item
      {...itemProps}
      textValue={textValue ?? deriveTextValue(children)}
      onAction={() => {
        onClick?.();
      }}
      className={cn(baseClassName, className)}
    >
      {children}
    </Dropdown.Item>
  );
}

export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    role="separator"
    className={cn("mx-1 my-1 h-px overflow-hidden bg-border", className)}
    {...props}
  />
);

export const DropdownMenuGroup = ({
  children,
  className,
  ...props
}: { children: React.ReactNode } & Omit<HeroMenuSectionProps, "children">) => (
  <HeroMenu.Section className={cn("px-0 py-0", className)} {...props}>
    {children}
  </HeroMenu.Section>
);

export const DropdownMenuLabel = ({ className, children, ...props }: React.ComponentProps<"div">) => (
  <div
    role="presentation"
    className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
    {...props}
  >
    {children}
  </div>
);

export const Menu = DropdownMenu;
export const MenuTrigger = DropdownMenuTrigger;
export const MenuPopup = DropdownMenuContent;
export const MenuItem = DropdownMenuItem;
export const MenuSeparator = DropdownMenuSeparator;
