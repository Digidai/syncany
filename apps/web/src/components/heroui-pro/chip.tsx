"use client";

import * as React from "react";
import { Chip as HeroChip } from "@heroui/react/chip";
import { cn } from "@/lib/utils";

type ChipProps = React.ComponentProps<typeof HeroChip>;

export function Chip({ className, ...props }: ChipProps) {
  return <HeroChip className={cn("transition-colors", className)} {...props} />;
}
