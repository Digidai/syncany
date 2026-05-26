"use client";

import * as React from "react";
import { Alert as HeroAlert } from "@heroui/react/alert";
import { cn } from "@/lib/utils";

type LegacyVariant = "default" | "error" | "info" | "success" | "warning";

function mapStatus(variant: LegacyVariant | undefined): React.ComponentProps<typeof HeroAlert>["status"] {
  if (variant === "error") return "danger";
  if (variant === "info") return "accent";
  return (variant ?? "default") as React.ComponentProps<typeof HeroAlert>["status"];
}

export function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<"div"> & { variant?: LegacyVariant }) {
  return (
    <HeroAlert.Root status={mapStatus(variant)} className={cn("items-start", className)} role="alert" {...props}>
      <HeroAlert.Content>{children}</HeroAlert.Content>
    </HeroAlert.Root>
  );
}

export function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroAlert.Title className={cn("font-medium", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <HeroAlert.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex gap-2", className)} data-slot="alert-action" {...props} />;
}
