"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardPanel } from "@/components/heroui-pro/card";

type WorkspacePageTone = "cyan" | "amber" | "emerald" | "violet" | "default";

const toneClass: Record<WorkspacePageTone, string> = {
  cyan: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  default: "bg-default text-muted-foreground",
};

export function WorkspacePage({
  title,
  description,
  icon,
  tone = "default",
  actions,
  toolbar,
  children,
  contentClassName,
}: {
  title: string;
  description?: ReactNode;
  icon: ReactNode;
  tone?: WorkspacePageTone;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border/70 bg-background/85 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", toneClass[tone])}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">{title}</h1>
            {description && (
              <p className="text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {toolbar && (
          <div className="mx-auto mt-3 w-full max-w-5xl">
            {toolbar}
          </div>
        )}
      </header>

      <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className={cn("mx-auto w-full max-w-5xl", contentClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="mx-auto w-full max-w-xl border-dashed border-border/70 bg-surface/70 text-center !shadow-none">
      <CardPanel className="p-8">
        <div className="mx-auto flex h-8 w-8 items-center justify-center text-muted-foreground/60" aria-hidden="true">
          {icon}
        </div>
        <p className="mt-3 text-sm font-medium">{title}</p>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">
            {description}
          </p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </CardPanel>
    </Card>
  );
}
