"use client";

import * as React from "react";
import { Tabs as HeroTabs } from "@heroui/react/tabs";
import { cn } from "@/lib/utils";

export function Tabs({ className, ...props }: React.ComponentProps<typeof HeroTabs.Root>) {
  return <HeroTabs.Root className={cn("w-full", className)} {...props} />;
}

export function TabsListContainer({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <HeroTabs.ListContainer
      className={cn("overflow-x-auto overflow-y-hidden", className)}
      {...props}
    />
  );
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof HeroTabs.List>) {
  return <HeroTabs.List className={cn("min-w-max", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof HeroTabs.Tab>) {
  return <HeroTabs.Tab className={cn("shrink-0", className)} {...props} />;
}

export function TabsIndicator({ className, ...props }: React.ComponentProps<typeof HeroTabs.Indicator>) {
  void className;
  void props;
  // HeroUI's animated Indicator currently depends on a SharedElementTransition
  // provider that our workspace shell does not mount. Use explicit active
  // trigger styling instead so tabs cannot trip the route error boundary.
  return null;
}

export function TabsPanel({ className, ...props }: React.ComponentProps<typeof HeroTabs.Panel>) {
  return <HeroTabs.Panel className={cn("outline-none", className)} {...props} />;
}
