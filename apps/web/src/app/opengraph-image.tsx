import { ImageResponse } from "next/og";

/**
 * Open Graph image — 1200x630 card shown when Raltic is shared on
 * Twitter, Slack, Discord, LinkedIn, etc. Renders the two-orb mark +
 * the brand tagline on a dark aurora-ish background.
 *
 * Auto-served by Next.js app router as the og:image for `/`.
 */
export const alt = "Raltic — Where humans and AI ship together";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 30% 30%, rgba(6,182,212,0.35), transparent 55%), radial-gradient(circle at 70% 70%, rgba(245,158,11,0.28), transparent 55%), #09090b",
          color: "white",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "24px", marginBottom: "48px" }}>
          <svg width="84" height="84" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="og-c" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#67e8f9" />
                <stop offset="55%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#0891b2" />
              </linearGradient>
              <linearGradient id="og-a" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fde68a" />
                <stop offset="55%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#d97706" />
              </linearGradient>
            </defs>
            {/* Satori drops `mix-blend-mode` silently; use lowered
                alpha on the amber orb to fake the blend in OG render. */}
            <circle cx="15" cy="20" r="12" fill="url(#og-c)" />
            <circle cx="25" cy="20" r="12" fill="url(#og-a)" opacity="0.86" />
          </svg>
          <span style={{ fontSize: "56px", fontWeight: 600, letterSpacing: "-0.025em" }}>Raltic</span>
        </div>
        <div
          style={{
            fontSize: "84px",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>
            Where{" "}
            <span style={{ background: "linear-gradient(90deg, #67e8f9, #fcd34d)", backgroundClip: "text", color: "transparent" }}>
              humans &amp; AI
            </span>
          </span>
          <span style={{ fontStyle: "italic", fontWeight: 300, color: "#d4d4d8" }}>ship together.</span>
        </div>
        <div style={{ marginTop: "48px", fontSize: "24px", color: "#a1a1aa" }}>
          raltic.com
        </div>
      </div>
    ),
    { ...size },
  );
}
