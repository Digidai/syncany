"use client";

import * as React from "react";
import { TextArea as HeroTextArea } from "@heroui/react/textarea";
import { cn } from "@/lib/utils";

export type TextareaProps = React.ComponentProps<typeof HeroTextArea>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return <HeroTextArea ref={ref} className={cn("w-full", className)} variant="primary" {...props} />;
});
