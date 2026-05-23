import type { ReactNode } from "react";

/**
 * Section header shared across marketing pages. Pared-down version
 * of the one inlined in apps/web/src/app/page.tsx — same visual
 * rhythm so secondary pages match the primary landing.
 */
export function SectionHeader({
  eyebrow,
  title,
  description,
  dark = true,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  dark?: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      {eyebrow && (
        <p className={`text-[10.5px] font-medium uppercase tracking-[0.18em] ${dark ? "text-cyan-400/80" : "text-cyan-700"}`}>
          {eyebrow}
        </p>
      )}
      <h2 className={`mt-4 text-balance text-4xl font-medium leading-[1.1] tracking-[-0.02em] sm:text-5xl ${dark ? "text-white" : "text-zinc-900"}`}>
        {title}
      </h2>
      {description && (
        <p className={`mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed sm:text-lg ${dark ? "text-zinc-400" : "text-zinc-600"}`}>
          {description}
        </p>
      )}
    </div>
  );
}
