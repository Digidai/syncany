"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionBody,
  AccordionHeading,
  AccordionIndicator,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/heroui-pro/accordion";

type FaqItem = { q: string; a: string };

type FaqTheme = "dark" | "light";

export interface MarketingFaqListProps {
  items: FaqItem[];
  idPrefix: string;
  theme?: FaqTheme;
}

const THEME = {
  dark: {
    container: "bg-zinc-900 border-zinc-900 text-zinc-400",
    item: "text-zinc-300 border-zinc-900",
    title: "text-white",
    open: "bg-zinc-950",
    border: "border-zinc-900",
  },
  light: {
    container: "bg-zinc-50 border-zinc-200 text-zinc-500",
    item: "text-zinc-800 border-zinc-200",
    title: "text-zinc-900",
    open: "bg-zinc-100",
    border: "border-zinc-200",
  },
} satisfies Record<FaqTheme, {
  container: string;
  item: string;
  title: string;
  open: string;
  border: string;
}>;

export function MarketingFaqList({ items, idPrefix, theme = "dark" }: MarketingFaqListProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const palette = THEME[theme];

  function handleToggle(indexOrNull: number | null) {
    setOpenIndex((current) => (indexOrNull === null ? null : current === indexOrNull ? null : indexOrNull));
  }

  const expandedKeys = openIndex === null ? new Set<string>() : new Set([`${idPrefix}-faq-${openIndex}`]);

  return (
    <Accordion
      selectionMode="single"
      expandedKeys={expandedKeys}
      onExpandedChange={(keys) => {
        const next = Array.from(keys ?? [])[0];
        handleToggle(next ? Number(String(next).replace(`${idPrefix}-faq-`, "")) : null);
      }}
      className={cn("mt-10 rounded-2xl border", palette.container)}
    >
      {items.map((item, index) => {
        const itemId = `${idPrefix}-faq-${index}`;
        const isOpen = openIndex === index;

        return (
          <AccordionItem
            id={itemId}
            key={itemId}
            className={cn(
              "group border-b border-current/20 last:border-b-0",
              palette.item,
              isOpen && palette.open,
              "transition-colors duration-150",
            )}
          >
            <AccordionHeading>
              <AccordionTrigger className="flex w-full items-start justify-between px-5 py-4 text-left sm:py-3">
                <span className={cn("block text-sm font-medium leading-tight text-balance sm:text-base", palette.title)}>
                  {item.q}
                </span>
                <AccordionIndicator className="text-muted-foreground mt-1 shrink-0 transition-transform duration-200 data-[expanded]:rotate-180" />
              </AccordionTrigger>
            </AccordionHeading>
            <AccordionPanel>
              <AccordionBody>
                <p className={cn("border-t border-current/10 px-6 pb-5 pt-2 text-sm leading-relaxed", palette.item)}>
                  {item.a}
                </p>
              </AccordionBody>
            </AccordionPanel>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
