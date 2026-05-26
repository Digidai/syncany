"use client";

import * as React from "react";
import { Button as HeroButton, buttonVariants } from "@heroui/react/button";
import { Spinner } from "@heroui/react/spinner";
import { cn } from "@/lib/utils";

type LegacyVariant =
  | "default"
  | "destructive"
  | "destructive-outline"
  | "ghost"
  | "link"
  | "outline"
  | "secondary"
  | "primary"
  | "tertiary"
  | "danger"
  | "danger-soft";

type LegacySize =
  | "default"
  | "icon"
  | "icon-lg"
  | "icon-sm"
  | "icon-xl"
  | "icon-xs"
  | "lg"
  | "sm"
  | "xl"
  | "xs"
  | "md";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  variant?: LegacyVariant;
  size?: LegacySize;
  loading?: boolean;
  disabled?: boolean;
  render?: React.ReactElement;
  fullWidth?: boolean;
  isIconOnly?: boolean;
  onPress?: (...args: unknown[]) => void;
  [key: string]: unknown;
}

function mapVariant(variant: LegacyVariant | undefined): React.ComponentProps<typeof HeroButton>["variant"] {
  if (variant === "default") return "primary";
  if (variant === "destructive") return "danger";
  if (variant === "destructive-outline") return "danger-soft";
  if (variant === "link") return "ghost";
  return (variant ?? "primary") as React.ComponentProps<typeof HeroButton>["variant"];
}

function mapSize(size: LegacySize | undefined): React.ComponentProps<typeof HeroButton>["size"] {
  if (!size || size === "default") return "md";
  if (size === "xs" || size === "icon-xs" || size === "icon-sm") return "sm";
  if (size === "xl" || size === "icon-xl" || size === "icon-lg") return "lg";
  if (size === "icon") return "md";
  return size as React.ComponentProps<typeof HeroButton>["size"];
}

function isIconOnly(size: LegacySize | undefined, explicit?: boolean): boolean | undefined {
  return explicit || (typeof size === "string" && size.startsWith("icon")) || undefined;
}

export function Button({
  children,
  className,
  variant,
  size,
  loading = false,
  disabled,
  isIconOnly: explicitIconOnly,
  render,
  fullWidth,
  ...props
}: ButtonProps) {
  const mappedVariant = mapVariant(variant);
  const mappedSize = mapSize(size);
  const disabledState = Boolean(disabled || loading || props["aria-disabled"]);
  const iconOnly = isIconOnly(size, explicitIconOnly);
  const linkish = variant === "link";

  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, {
      ...props,
      "aria-disabled": disabledState || undefined,
      className: cn(
        buttonVariants({ variant: mappedVariant, size: mappedSize, isIconOnly: iconOnly, fullWidth }),
        linkish && "underline-offset-4 hover:underline",
        className,
        (render.props as { className?: string }).className,
      ),
      children: (
        <>
          {children}
          {loading && <Spinner className="h-4 w-4" />}
        </>
      ),
    } as React.HTMLAttributes<HTMLElement>);
  }

  return (
    <HeroButton
      {...(props as Record<string, unknown>)}
      className={cn(linkish && "underline-offset-4 hover:underline", className)}
      fullWidth={fullWidth}
      isDisabled={disabledState}
      isIconOnly={iconOnly}
      size={mappedSize}
      variant={mappedVariant}
    >
      {children}
      {loading && <Spinner className="h-4 w-4" />}
    </HeroButton>
  );
}
