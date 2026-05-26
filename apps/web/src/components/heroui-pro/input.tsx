"use client";

import * as React from "react";
import { Input as HeroInput } from "@heroui/react/input";
import { cn } from "@/lib/utils";

type LegacySize = "sm" | "default" | "lg" | "md" | number;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: LegacySize;
  unstyled?: boolean;
  nativeInput?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size, unstyled, nativeInput, ...props },
  ref,
) {
  void nativeInput;
  if (unstyled) {
    return <input ref={ref} className={className as string | undefined} size={typeof size === "number" ? size : undefined} {...(props as React.InputHTMLAttributes<HTMLInputElement>)} />;
  }
  return (
    <HeroInput
      ref={ref}
      className={cn(
        "w-full",
        size === "sm" && "[&_input]:h-8 [&_input]:text-sm",
        size === "lg" && "[&_input]:h-11",
        className as string | undefined,
      )}
      variant="primary"
      {...props}
    />
  );
});
