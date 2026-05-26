"use client";

import * as React from "react";
import { TextArea as HeroTextArea } from "@heroui/react/textarea";
import { cn } from "@/lib/utils";

export type TextareaProps = React.ComponentProps<typeof HeroTextArea>;

const TEXTAREA_CONTRAST_CLASS = [
  "[&_textarea]:text-foreground",
  "[&_textarea]:caret-foreground",
  "[&_textarea::placeholder]:text-[var(--field-placeholder)]",
  "[&_textarea::placeholder]:opacity-100",
  "[&_textarea:disabled]:text-muted-foreground",
  "[&_textarea:disabled]:opacity-100",
  "[&_textarea:disabled]:[-webkit-text-fill-color:var(--muted-foreground)]",
  "[&_textarea:disabled::placeholder]:text-muted-foreground",
].join(" ");

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return <HeroTextArea ref={ref} className={cn("w-full", TEXTAREA_CONTRAST_CLASS, className)} variant="primary" {...props} />;
});
