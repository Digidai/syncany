"use client";

import * as React from "react";
import { Radio as HeroRadio } from "@heroui/react/radio";
import { RadioGroup as HeroRadioGroup } from "@heroui/react/radio-group";
import { cn } from "@/lib/utils";

export interface RadioGroupProps extends Omit<React.ComponentProps<typeof HeroRadioGroup.Root>, "onChange"> {
  value?: string;
  onValueChange?: (value: string) => void;
}

export function RadioGroup({ className, value, onValueChange, ...props }: RadioGroupProps) {
  return (
    <HeroRadioGroup.Root
      {...props}
      value={value}
      onChange={(next) => onValueChange?.(String(next))}
      className={cn("gap-2", className)}
    />
  );
}

export interface RadioProps extends Omit<React.ComponentProps<typeof HeroRadio.Root>, "children"> {
  children?: React.ReactNode;
  controlClassName?: string;
  contentClassName?: string;
}

export function Radio({ className, controlClassName, contentClassName, children, ...props }: RadioProps) {
  return (
    <HeroRadio.Root
      {...props}
      className={cn("items-start gap-2 rounded-lg border border-border bg-card/40 p-3 transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/5", className)}
    >
      <HeroRadio.Control className={controlClassName}>
        <HeroRadio.Indicator />
      </HeroRadio.Control>
      <HeroRadio.Content className={cn("min-w-0 flex-1", contentClassName)}>
        {children}
      </HeroRadio.Content>
    </HeroRadio.Root>
  );
}
