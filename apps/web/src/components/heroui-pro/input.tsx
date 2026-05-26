"use client";

import * as React from "react";
import { Input as HeroInput } from "@heroui/react/input";
import { cn } from "@/lib/utils";

type LegacySize = "sm" | "default" | "lg" | "md" | number;

const CONTROL_CONTRAST_CLASS = [
  "[&_input]:text-foreground",
  "[&_input]:caret-foreground",
  "[&_input::placeholder]:text-[var(--field-placeholder)]",
  "[&_input::placeholder]:opacity-100",
  "[&_input:disabled]:text-muted-foreground",
  "[&_input:disabled]:opacity-100",
  "[&_input:disabled]:[-webkit-text-fill-color:var(--muted-foreground)]",
  "[&_input:disabled::placeholder]:text-muted-foreground",
].join(" ");

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
        CONTROL_CONTRAST_CLASS,
        size === "sm" && "[&_input]:h-8 [&_input]:text-sm",
        size === "lg" && "[&_input]:h-11",
        className as string | undefined,
      )}
      variant="primary"
      {...props}
    />
  );
});
