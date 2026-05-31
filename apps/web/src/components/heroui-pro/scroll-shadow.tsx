"use client";

import * as React from "react";
import { ScrollShadow as HeroScrollShadow } from "@heroui/react/scroll-shadow";
import { cn } from "@/lib/utils";

type ScrollShadowProps = React.ComponentProps<typeof HeroScrollShadow>;

export function ScrollShadow({ className, ...props }: ScrollShadowProps) {
  return <HeroScrollShadow className={cn("scrollbar-compact", className)} {...props} />;
}
