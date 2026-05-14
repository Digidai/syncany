"use client";

import { useMemo } from "react";
import NotionAvatar from "react-notion-avatar";
import { getAvatarColor, getNotionAvatarConfig } from "@/lib/avatar";

import { cn } from "@/lib/utils";

interface GeneratedAvatarProps {
  id: string;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  /** If true, show initials instead of notion avatar (for workspace icons) */
  initials?: boolean;
}

const SIZE_CLASSES = {
  xs: "size-6",
  sm: "size-7",
  md: "size-8",
  lg: "size-10",
};

const INITIALS_TEXT_SIZES = {
  xs: "text-[10px]",
  sm: "text-[11px]",
  md: "text-xs",
  lg: "text-sm",
};

export function GeneratedAvatar({
  id,
  name,
  size = "md",
  className,
  initials,
}: GeneratedAvatarProps) {
  const color = useMemo(() => getAvatarColor(id), [id]);
  const config = useMemo(() => getNotionAvatarConfig(id), [id]);

  const showInitials = initials && name;

  return (
    <div
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        showInitials ? "" : "border-[0.5px] border-border bg-background",
        SIZE_CLASSES[size],
        className,
      )}
      style={showInitials ? { backgroundColor: color.bg, color: color.fg } : undefined}
      title={name}
    >
      {showInitials ? (
        <span className={cn("font-semibold", INITIALS_TEXT_SIZES[size])}>
          {name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <NotionAvatar
          className="h-full w-full"
          style={{ width: "100%", height: "100%" }}
          config={config}
        />
      )}
    </div>
  );
}
