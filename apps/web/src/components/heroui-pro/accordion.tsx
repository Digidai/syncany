"use client";

import * as React from "react";
import {
  Accordion as HeroAccordion,
  AccordionBody as HeroAccordionBody,
  AccordionHeading as HeroAccordionHeading,
  AccordionIndicator as HeroAccordionIndicator,
  AccordionItem as HeroAccordionItem,
  AccordionPanel as HeroAccordionPanel,
  AccordionTrigger as HeroAccordionTrigger,
} from "@heroui/react/accordion";
import { cn } from "@/lib/utils";

export type AccordionSelectionMode = "single" | "multiple";

export interface AccordionProps extends Omit<React.ComponentProps<typeof HeroAccordion>, "children"> {
  className?: string;
  children?: React.ReactNode;
  selectionMode?: AccordionSelectionMode;
}

export type AccordionItemProps = React.ComponentProps<typeof HeroAccordionItem>;
export type AccordionHeadingProps = React.ComponentProps<typeof HeroAccordionHeading>;
export type AccordionTriggerProps = React.ComponentProps<typeof HeroAccordionTrigger>;
export type AccordionPanelProps = React.ComponentProps<typeof HeroAccordionPanel>;
export type AccordionIndicatorProps = React.ComponentProps<typeof HeroAccordionIndicator>;
export type AccordionBodyProps = React.ComponentProps<typeof HeroAccordionBody>;

export function Accordion({ className, children, selectionMode = "single", ...props }: AccordionProps) {
  const allowsMultipleExpanded = selectionMode === "multiple";

  return (
    <HeroAccordion
      allowsMultipleExpanded={allowsMultipleExpanded}
      className={cn("w-full", className)}
      {...props}
    >
      {children}
    </HeroAccordion>
  );
}

export function AccordionItem({ className, ...props }: AccordionItemProps) {
  return <HeroAccordionItem className={cn("px-0", className)} {...props} />;
}

export function AccordionHeading({ className, ...props }: AccordionHeadingProps) {
  return <HeroAccordionHeading className={cn("px-1", className)} {...props} />;
}

export function AccordionTrigger({ className, ...props }: AccordionTriggerProps) {
  return <HeroAccordionTrigger className={cn("px-0", className)} {...props} />;
}

export function AccordionPanel({ className, ...props }: AccordionPanelProps) {
  return <HeroAccordionPanel className={cn("px-0", className)} {...props} />;
}

export function AccordionIndicator({ className, ...props }: AccordionIndicatorProps) {
  return <HeroAccordionIndicator className={cn("h-4 w-4", className)} {...props} />;
}

export function AccordionBody({ className, ...props }: AccordionBodyProps) {
  return <HeroAccordionBody className={cn("px-0", className)} {...props} />;
}
