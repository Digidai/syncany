"use client";

import Link from "next/link";
import type { ReactNode } from "react";
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
  primary:
    "!h-11 !rounded-xl !bg-white !px-6 !text-[15px] !font-semibold !text-black !shadow-[0_8px_24px_-8px_rgba(34,211,238,0.45)] hover:!bg-zinc-100 hover:!text-black hover:!shadow-[0_10px_28px_-8px_rgba(34,211,238,0.65)]",
  secondary:
    "!h-11 !rounded-lg !border !border-zinc-800 !bg-zinc-950 !px-5 !text-sm !font-medium !text-zinc-100 hover:!border-zinc-700 hover:!bg-zinc-900 hover:!text-white",
  "nav-primary":
    "!h-8 !rounded-lg !bg-white !px-3 !text-sm !font-medium !text-black hover:!bg-zinc-200 hover:!text-black",
  "desktop-primary":
    "!h-11 !rounded-lg !bg-[#1f1d1a] !px-5 !text-sm !font-semibold !text-white hover:!bg-[#34302a] hover:!text-white",
  "desktop-secondary":
    "!h-11 !rounded-lg !border !border-[#d6cec1] !bg-white/70 !px-5 !text-sm !font-semibold !text-[#2d2923] hover:!bg-white hover:!text-[#2d2923]",
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
      variant="ghost"
      render={render}
      className={cn(
        "!inline-flex !items-center !justify-center !gap-1.5 transition-[transform,box-shadow,background-color,border-color,color] duration-150 active:translate-y-px",
        variants[variant],
        className,
      )}
    >
      {children}
    </Button>
  );
}
