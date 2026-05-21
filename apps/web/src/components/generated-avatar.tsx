"use client";

import { useMemo } from "react";
import { getAvatarGradient } from "@/lib/avatar";
import { cn } from "@/lib/utils";

interface GeneratedAvatarProps {
  /** Stable identifier (agentId / userId) — used as the gradient seed
   *  unless `seed` is explicitly provided. */
  id: string;
  /** Display name — first character renders inside the gradient circle. */
  name?: string;
  /** Optional override seed (e.g. agent.avatarSeed) — lets the user
   *  shuffle the gradient without changing identity. Falls back to `id`. */
  seed?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Reserved — older callers passed this; kept as no-op so we don't break
   *  the API. The gradient + initial is now the only render mode. */
  initials?: boolean;
}

const SIZE_CLASSES = {
  xs: "size-6",
  sm: "size-7",
  md: "size-8",
  lg: "size-10",
  xl: "size-16",
};

const INITIAL_TEXT_SIZES = {
  xs: "text-[10px]",
  sm: "text-[11px]",
  md: "text-xs",
  lg: "text-sm",
  xl: "text-2xl",
};

export function GeneratedAvatar({
  id,
  name,
  seed,
  size = "md",
  className,
}: GeneratedAvatarProps) {
  // Defensive: callers in MessageRowView occasionally pass system-row
  // senderIds that are empty/null. Without a fallback, getAvatarGradient
  // returns NaN palette stops and `id.charAt(0)` on undefined throws.
  const safeId = (id && id.length > 0) ? id : "?";
  const effectiveSeed = seed && seed.length > 0 ? seed : safeId;
  const palette = useMemo(() => getAvatarGradient(effectiveSeed), [effectiveSeed]);
  const initial = ((name?.trim()?.charAt(0) || safeId.charAt(0)) || "?").toUpperCase();

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white",
        // Layered shadows = jelly. Inner top highlight + inner bottom
        // shadow give it gloss; outer colored glow + tight ring add
        // depth without going full skeuomorph.
        "ring-1 ring-black/10",
        SIZE_CLASSES[size],
        INITIAL_TEXT_SIZES[size],
        className,
      )}
      style={{
        background: palette.background,
        color: palette.fg,
        boxShadow: [
          "inset 0 1px 0 rgba(255,255,255,0.45)",  // top rim highlight
          "inset 0 -2px 4px rgba(0,0,0,0.18)",     // bottom inner depth
          `0 4px 14px -4px ${palette.accentA}`,    // colored drop-glow A
          `0 2px 6px -2px ${palette.accentB}55`,   // softer secondary glow B
        ].join(", "),
        textShadow: "0 1px 2px rgba(0,0,0,0.18)",
      }}
      title={name}
    >
      <span className="relative z-[1]">{initial}</span>
      {/* Specular highlight — a soft white ellipse on top that sells the
          "wet jelly" look. Pointer-events-none so it doesn't interfere. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[15%] top-[8%] h-[35%] rounded-full bg-gradient-to-b from-white/55 to-white/0 blur-[1px]"
      />
    </div>
  );
}
