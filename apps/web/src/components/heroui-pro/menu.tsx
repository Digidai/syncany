"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type MenuSide = "top" | "right" | "bottom" | "left";
type MenuAlign = "start" | "center" | "end";

interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  getTrigger: () => HTMLButtonElement | null;
  getContent: () => HTMLDivElement | null;
  setTriggerNode: (node: HTMLButtonElement | null) => void;
  setContentNode: (node: HTMLDivElement | null) => void;
}

const MenuContext = React.createContext<MenuContextValue | null>(null);

function restoreTriggerFocus(trigger: HTMLElement | null) {
  requestAnimationFrame(() => {
    trigger?.focus();
  });
}

export function DropdownMenu({
  children,
  onOpenChange,
}: {
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const setOpen = React.useCallback((next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  }, [onOpenChange]);
  const getTrigger = React.useCallback(() => triggerRef.current, []);
  const getContent = React.useCallback(() => contentRef.current, []);
  const setTriggerNode = React.useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node;
  }, []);
  const setContentNode = React.useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
  }, []);

  return (
    <MenuContext.Provider value={{ open, setOpen, getTrigger, getContent, setTriggerNode, setContentNode }}>
      {children}
    </MenuContext.Provider>
  );
}

export function DropdownMenuTrigger({
  id,
  className,
  children,
  onClick,
  onKeyDown,
  ...props
}: React.ComponentProps<"button">) {
  const menu = React.useContext(MenuContext);
  const generatedId = React.useId();
  const triggerId = id ?? generatedId;
  return (
    <button
      id={triggerId}
      type="button"
      aria-haspopup="menu"
      aria-expanded={menu?.open ?? false}
      data-slot="dropdown-trigger"
      className={className}
      ref={(node) => {
        menu?.setTriggerNode(node);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) menu?.setOpen(!(menu.open));
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          menu?.setOpen(true);
        }
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
  alignOffset = 0,
  children,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  align?: MenuAlign;
  side?: MenuSide;
  sideOffset?: number;
  alignOffset?: number;
}) {
  const menu = React.useContext(MenuContext);
  const [mounted, setMounted] = React.useState(false);
  const [position, setPosition] = React.useState<React.CSSProperties>({
    left: -9999,
    top: -9999,
    visibility: "hidden",
  });

  React.useEffect(() => setMounted(true), []);

  const updatePosition = React.useCallback(() => {
    const trigger = menu?.getTrigger();
    const content = menu?.getContent();
    if (!trigger || !content) return;

    const triggerRect = trigger.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    let left = triggerRect.left;
    let top = triggerRect.bottom + sideOffset;

    if (side === "top") top = triggerRect.top - contentRect.height - sideOffset;
    if (side === "left") left = triggerRect.left - contentRect.width - sideOffset;
    if (side === "right") left = triggerRect.right + sideOffset;

    if (side === "top" || side === "bottom") {
      if (align === "center") left = triggerRect.left + (triggerRect.width - contentRect.width) / 2;
      if (align === "end") left = triggerRect.right - contentRect.width;
      left += alignOffset;
    } else {
      if (align === "center") top = triggerRect.top + (triggerRect.height - contentRect.height) / 2;
      if (align === "end") top = triggerRect.bottom - contentRect.height;
      top += alignOffset;
    }

    const padding = 8;
    left = Math.min(Math.max(padding, left), window.innerWidth - contentRect.width - padding);
    top = Math.min(Math.max(padding, top), window.innerHeight - contentRect.height - padding);

    setPosition({
      left,
      top,
      visibility: "visible",
      "--anchor-width": `${triggerRect.width}px`,
    } as React.CSSProperties);
  }, [align, alignOffset, menu, side, sideOffset]);

  const getEnabledItems = React.useCallback(() => {
    const content = menu?.getContent();
    if (!content) return [];
    return Array.from(
      content.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'),
    );
  }, [menu]);

  const focusItem = React.useCallback((index: number) => {
    const items = getEnabledItems();
    if (items.length === 0) return;
    const next = (index + items.length) % items.length;
    items[next]?.focus();
  }, [getEnabledItems]);

  React.useLayoutEffect(() => {
    if (!menu?.open) return;
    updatePosition();
    const frame = requestAnimationFrame(() => {
      updatePosition();
      focusItem(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusItem, menu?.open, updatePosition]);

  React.useEffect(() => {
    if (!menu || !menu.open) return;
    const activeMenu = menu;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (activeMenu.getTrigger()?.contains(target)) return;
      if (activeMenu.getContent()?.contains(target)) return;
      activeMenu.setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        activeMenu.setOpen(false);
        activeMenu.getTrigger()?.focus();
      }
    }
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu, updatePosition]);

  if (!mounted || !menu?.open) return null;

  return createPortal(
    <div
      {...props}
      ref={(node) => { menu.setContentNode(node); }}
      role="menu"
      aria-label={props["aria-label"] ?? undefined}
      aria-labelledby={props["aria-label"] || props["aria-labelledby"] ? props["aria-labelledby"] : menu.getTrigger()?.id}
      data-slot="dropdown-menu"
      style={{ ...position, ...style, position: "fixed", zIndex: 60 }}
      className={cn("min-w-40 rounded-lg border border-border bg-background p-1 shadow-overlay", className)}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const items = getEnabledItems();
        const currentIndex = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          focusItem(currentIndex < 0 ? 0 : currentIndex + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          focusItem(currentIndex < 0 ? items.length - 1 : currentIndex - 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          focusItem(0);
        } else if (event.key === "End") {
          event.preventDefault();
          focusItem(items.length - 1);
        } else if (event.key === "Tab") {
          event.preventDefault();
          restoreTriggerFocus(menu.getTrigger());
          menu.setOpen(false);
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function DropdownMenuItem({
  className,
  children,
  onClick,
  onKeyDown,
  disabled,
  variant,
  render,
  textValue,
  ...props
}: React.ComponentProps<"div"> & {
  disabled?: boolean;
  variant?: "default" | "destructive";
  render?: React.ReactElement;
  textValue?: string;
}) {
  const menu = React.useContext(MenuContext);
  void textValue;
  const itemClassName = cn(
    "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors",
    "text-foreground hover:bg-default focus-visible:bg-default focus-visible:ring-2 focus-visible:ring-ring",
    variant === "destructive" && "text-danger hover:bg-danger/10",
    disabled && "pointer-events-none opacity-50",
    className,
  );

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event as React.MouseEvent<HTMLDivElement>);
    if (!event.defaultPrevented) menu?.setOpen(false);
  };

  if (render && React.isValidElement(render)) {
    const renderProps = render.props as {
      className?: string;
      onClick?: React.MouseEventHandler<HTMLElement>;
      onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
      children?: React.ReactNode;
    };
    return React.cloneElement(render, {
      ...props,
      role: "menuitem",
      tabIndex: disabled ? -1 : 0,
      "aria-disabled": disabled || undefined,
      className: cn(itemClassName, renderProps.className),
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        renderProps.onClick?.(event);
        if (!event.defaultPrevented) handleClick(event);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        renderProps.onKeyDown?.(event);
        if (event.defaultPrevented || disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          (event.currentTarget as HTMLElement).click();
        }
      },
      children,
    } as React.HTMLAttributes<HTMLElement>);
  }

  return (
    <div
      {...props}
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      className={itemClassName}
      onClick={handleClick}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleClick(event as unknown as React.MouseEvent<HTMLElement>);
        }
      }}
    >
      {children}
    </div>
  );
}

export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    role="separator"
    className={cn("mx-1 my-1 h-px overflow-hidden bg-border", className)}
    {...props}
  />
);

export const DropdownMenuGroup = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

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
