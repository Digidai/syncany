/**
 * Raltic brand primitives — tiny set of building blocks so we don't
 * repeat the cyan→amber gradient string in 20 files. Keep it small.
 */

import { cn } from "@/lib/utils";

/** Two-stop brand gradient as a text fill — use for hero words / titles. */
export function GradientText({
  className,
  children,
}: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn(
      "bg-gradient-to-r from-cyan-500 via-cyan-600 to-amber-500 bg-clip-text text-transparent",
      className,
    )}>
      {children}
    </span>
  );
}

/** Small monogram circle filled with the brand gradient — used as the
 *  workspace icon in the sidebar header so the chrome carries the brand
 *  without resorting to a logo image. Jelly-style: layered radial
 *  highlights + colored drop-glow so it reads as glossy, not a flat
 *  CSS-gradient disc. */
export function BrandMonogram({
  letter,
  size = "md",
  className,
}: {
  letter: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizes = {
    sm: "size-6 text-[11px]",
    md: "size-8 text-xs",
    lg: "size-10 text-sm",
    xl: "size-14 text-lg",
  };
  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white ring-1 ring-black/10",
        sizes[size],
        className,
      )}
      style={{
        background: [
          "radial-gradient(circle at 28% 22%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 42%)",
          "radial-gradient(circle at 72% 78%, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0) 55%)",
          "linear-gradient(140deg, hsl(190,90%,55%) 0%, hsl(38,95%,58%) 100%)",
        ].join(", "),
        boxShadow: [
          "inset 0 1px 0 rgba(255,255,255,0.5)",
          "inset 0 -2px 4px rgba(0,0,0,0.18)",
          "0 4px 14px -4px rgba(6,182,212,0.55)",
          "0 2px 6px -2px rgba(245,158,11,0.4)",
        ].join(", "),
        textShadow: "0 1px 2px rgba(0,0,0,0.2)",
      }}
      aria-hidden
    >
      <span className="relative z-[1]">{letter.charAt(0).toUpperCase()}</span>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[15%] top-[8%] h-[35%] rounded-full bg-gradient-to-b from-white/55 to-white/0 blur-[1px]"
      />
    </div>
  );
}

/** Section divider that fades cyan→transparent — used between sidebar
 *  groups to add a hint of structure without a hard line. */
export function BrandHairline({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent",
        className,
      )}
    />
  );
}
