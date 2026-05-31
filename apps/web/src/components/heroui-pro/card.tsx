import * as React from "react";
import { Card as HeroCard } from "@heroui/react/card";
import { cn } from "@/lib/utils";

type DivProps = React.ComponentProps<"div"> & { render?: React.ReactElement };

function renderDiv(defaultClassName: string, { className, render, children, ...props }: DivProps) {
  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, {
      ...props,
      className: cn(defaultClassName, className, (render.props as { className?: string }).className),
      children,
    } as React.HTMLAttributes<HTMLElement>);
  }
  return <div className={cn(defaultClassName, className)} {...props}>{children}</div>;
}

export function Card({ className, render, children, ...props }: DivProps) {
  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, {
      ...props,
      className: cn("rounded-xl border border-border bg-background shadow-surface", className, (render.props as { className?: string }).className),
      children,
    } as React.HTMLAttributes<HTMLElement>);
  }
  return (
    <HeroCard.Root variant="default" className={cn("rounded-xl border-border bg-background shadow-surface", className)} {...props}>
      {children}
    </HeroCard.Root>
  );
}

export function CardHeader(props: DivProps) {
  const { render, ...rest } = props;
  void render;
  return <div {...rest} className={cn("px-5 py-4", props.className)} data-slot="card-header" />;
}

export function CardTitle(props: DivProps) {
  const { render, ...rest } = props;
  void render;
  return <div {...rest} className={cn("text-base font-semibold", props.className)} data-slot="card-title" />;
}

export function CardDescription(props: DivProps) {
  const { render, ...rest } = props;
  void render;
  return <div {...rest} className={cn("text-sm text-muted-foreground", props.className)} data-slot="card-description" />;
}

export function CardPanel(props: DivProps) {
  const { render, ...rest } = props;
  void render;
  return <div {...rest} className={cn("px-5 py-4", props.className)} data-slot="card-panel" />;
}

export function CardFooter(props: DivProps) {
  const { render, ...rest } = props;
  void render;
  return <div {...rest} className={cn("flex gap-2 px-5 py-4", props.className)} data-slot="card-footer" />;
}

export function CardAction(props: DivProps) {
  return renderDiv("col-start-2 row-span-2 row-start-1 inline-flex self-start justify-self-end", props);
}

export const CardFrame = Card;
export const CardFrameHeader = CardHeader;
export const CardFrameTitle = CardTitle;
export const CardFrameDescription = CardDescription;
export const CardFrameAction = CardAction;
export const CardFrameFooter = CardFooter;
