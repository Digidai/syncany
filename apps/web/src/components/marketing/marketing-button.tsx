"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/heroui-pro/button";
import { cn } from "@/lib/utils";

type MarketingButtonVariant =
  | "primary"
  | "secondary"
  | "nav-primary"
  | "desktop-primary"
  | "desktop-secondary";

type MarketingButtonProps = {
  href: string;
  children: ReactNode;
  variant?: MarketingButtonVariant;
  className?: string;
  target?: string;
  rel?: string;
};

const variants: Record<MarketingButtonVariant, string> = {
  primary: "h-11 px-6 text-[15px] font-semibold",
  secondary: "h-11 px-5 text-sm font-medium",
  "nav-primary": "h-8 px-3 text-sm font-medium",
  "desktop-primary": "h-11 px-5 text-sm font-semibold",
  "desktop-secondary": "h-11 px-5 text-sm font-semibold",
};

const visualVariants: Record<MarketingButtonVariant, string> = {
  primary:
    "!border-white !bg-white !text-zinc-950 shadow-[0_0_28px_rgba(103,232,249,0.18)] hover:!border-zinc-200 hover:!bg-zinc-200 focus-visible:!ring-cyan-300",
  secondary:
    "!border-zinc-700 !bg-transparent !text-zinc-100 hover:!border-zinc-500 hover:!bg-zinc-950 focus-visible:!ring-cyan-300",
  "nav-primary":
    "!border-white !bg-white !text-zinc-950 hover:!border-zinc-200 hover:!bg-zinc-200 focus-visible:!ring-cyan-300",
  "desktop-primary":
    "!border-zinc-950 !bg-zinc-950 !text-white hover:!border-zinc-800 hover:!bg-zinc-800 focus-visible:!ring-cyan-300",
  "desktop-secondary":
    "!border-zinc-300 !bg-white !text-zinc-950 hover:!border-zinc-400 hover:!bg-zinc-50 focus-visible:!ring-cyan-300",
};

const buttonVariants: Record<MarketingButtonVariant, ComponentProps<typeof Button>["variant"]> = {
  primary: "primary",
  secondary: "outline",
  "nav-primary": "primary",
  "desktop-primary": "primary",
  "desktop-secondary": "outline",
};

export function MarketingButton({
  href,
  children,
  variant = "primary",
  className,
  target,
  rel,
}: MarketingButtonProps) {
  const render = target ? (
    <a href={href} target={target} rel={rel ?? "noreferrer"} />
  ) : (
    <Link href={href} />
  );

  return (
    <Button
      variant={buttonVariants[variant]}
      render={render}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 transition-[transform,box-shadow,background-color,border-color,color] duration-150 active:translate-y-px",
        variants[variant],
        visualVariants[variant],
        className,
      )}
    >
      {children}
    </Button>
  );
}
