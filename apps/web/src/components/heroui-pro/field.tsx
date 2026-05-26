"use client";

import * as React from "react";
import { Label } from "@heroui/react/label";
import { FieldError as HeroFieldError } from "@heroui/react/field-error";
import { cn } from "@/lib/utils";

export function Field({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col items-start gap-2", className)} data-slot="field" {...props} />;
}

export function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return <Label className={cn("text-sm font-medium text-foreground", className)} data-slot="field-label" {...props} />;
}

export function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted-foreground", className)} data-slot="field-description" {...props} />;
}

export function FieldError({ className, match, ...props }: React.ComponentProps<"p"> & { match?: boolean }) {
  void match;
  return <HeroFieldError className={cn("text-xs text-danger", className)} data-slot="field-error" {...(props as Record<string, unknown>)} />;
}

export const FieldItem = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div className={cn("flex", className)} data-slot="field-item" {...props} />
);
export const FieldControl = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const FieldValidity = ({ children }: { children: React.ReactNode }) => <>{children}</>;
