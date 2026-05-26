/**
 * Raltic logo mark — two overlapping orbs in the brand's cyan + amber.
 * The overlap is the visual metaphor: humans (cyan) and AI (amber)
 * working in the same channels.
 *
 * Rendered as SVG so it scales crisp at any size. The visual treatment
 * is "jelly" — inspired by app-icon styles like base.app's: each orb
 * is a layered composite of a base gradient + a bright specular
 * highlight + a soft inner bottom shadow + a sharp top rim light.
 * Overlap uses screen blend so the two colors fuse to a bright cyan-
 * gold halo rather than occluding each other.
 */

interface Props {
  size?: number;
  className?: string;
  /** When true, render on a dark surface — adjusts highlight intensity
   *  for better legibility. Defaults to false (light surface). */
  onDark?: boolean;
  /** Unique id suffix for defs — must differ across multiple instances
   *  on the same page to avoid SVG def id collisions. */
  idSuffix?: string;
}

export function RalticLogo({ size = 32, className, onDark = false, idSuffix = "default" }: Props) {
  const u = idSuffix;
  const baseHi = onDark ? 0.7 : 0.6;
  const rimHi = onDark ? 0.85 : 0.7;
  const innerShadow = onDark ? 0.32 : 0.28;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ isolation: "isolate" }}
      aria-hidden
    >
      <defs>
        {/* Cyan orb — base hue gradient.
            Darker at the edges, vivid in the middle = sphere shading. */}
        <radialGradient id={`c-base-${u}`} cx="38%" cy="36%" r="68%">
          <stop offset="0%"  stopColor="#a5f3fc" />
          <stop offset="40%" stopColor="#22d3ee" />
          <stop offset="85%" stopColor="#0e7490" />
          <stop offset="100%" stopColor="#083344" />
        </radialGradient>
        {/* Amber orb — same shading recipe, warm palette. */}
        <radialGradient id={`a-base-${u}`} cx="38%" cy="36%" r="68%">
          <stop offset="0%"  stopColor="#fef3c7" />
          <stop offset="40%" stopColor="#fbbf24" />
          <stop offset="85%" stopColor="#b45309" />
          <stop offset="100%" stopColor="#451a03" />
        </radialGradient>

        {/* Specular highlight — bright white wet-look spot on top-left
            of each orb. The "jelly" cue: human eye reads it as
            light bouncing off a glossy sphere. */}
        <radialGradient id={`spec-${u}`} cx="30%" cy="22%" r="36%">
          <stop offset="0%"  stopColor="white" stopOpacity={baseHi} />
          <stop offset="70%" stopColor="white" stopOpacity="0" />
        </radialGradient>

        {/* Inner bottom shadow — soft dark crescent at the bottom of
            each orb. Adds depth so the sphere doesn't look flat. */}
        <radialGradient id={`shad-${u}`} cx="68%" cy="82%" r="55%">
          <stop offset="0%"  stopColor="black" stopOpacity={innerShadow} />
          <stop offset="65%" stopColor="black" stopOpacity="0" />
        </radialGradient>

        {/* Rim light — thin bright stroke at the very top of each orb.
            Pure white, fades fast — sells the glass material. */}
        <linearGradient id={`rim-${u}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"  stopColor="white" stopOpacity={rimHi} />
          <stop offset="22%" stopColor="white" stopOpacity="0" />
        </linearGradient>

        {/* Drop-shadow filters — colored, large blur for the candy halo. */}
        <filter id={`glow-c-${u}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" in="SourceAlpha" />
          <feOffset dy="0.8" />
          <feComponentTransfer><feFuncA type="linear" slope="0.55" /></feComponentTransfer>
          <feFlood floodColor="#06b6d4" floodOpacity="0.6" result="cyanGlow" />
          <feComposite in="cyanGlow" in2="SourceAlpha" operator="in" result="cyanShadow" />
          <feMerge>
            <feMergeNode in="cyanShadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`glow-a-${u}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" in="SourceAlpha" />
          <feOffset dy="0.8" />
          <feFlood floodColor="#f59e0b" floodOpacity="0.55" result="amberGlow" />
          <feComposite in="amberGlow" in2="SourceAlpha" operator="in" result="amberShadow" />
          <feMerge>
            <feMergeNode in="amberShadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Cyan orb stack — base hue → inner shadow → rim → specular.
          Each layer is the same circle with a different paint. */}
      <g filter={`url(#glow-c-${u})`}>
        <circle cx="14.5" cy="20" r="12.5" fill={`url(#c-base-${u})`} />
        <circle cx="14.5" cy="20" r="12.5" fill={`url(#shad-${u})`} />
        <circle cx="14.5" cy="20" r="12.5" fill={`url(#rim-${u})`} />
        <circle cx="14.5" cy="20" r="12.5" fill={`url(#spec-${u})`} />
      </g>

      {/* Amber orb on top — screen-blended so the overlap area
          brightens to a peachy-white rather than occluding cyan. */}
      <g filter={`url(#glow-a-${u})`} style={{ mixBlendMode: "screen" }}>
        <circle cx="25.5" cy="20" r="12.5" fill={`url(#a-base-${u})`} />
        <circle cx="25.5" cy="20" r="12.5" fill={`url(#shad-${u})`} />
        <circle cx="25.5" cy="20" r="12.5" fill={`url(#rim-${u})`} />
        <circle cx="25.5" cy="20" r="12.5" fill={`url(#spec-${u})`} />
      </g>
    </svg>
  );
}

/**
 * Logo + wordmark together — used in nav header.
 */
export function RalticWordmark({
  size = 28,
  className,
  onDark = false,
  idSuffix = "wordmark",
}: Props) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <RalticLogo size={size} onDark={onDark} idSuffix={idSuffix} />
      <span className={`font-semibold tracking-tight ${onDark ? "text-white" : "text-foreground"}`}>
        Raltic
      </span>
    </span>
  );
}
