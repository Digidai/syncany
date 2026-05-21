import { ImageResponse } from "next/og";

/**
 * Apple touch icon — shown when iOS users "Add to Home Screen". Without
 * this, iOS picks an arbitrary screenshot or falls back to the URL
 * letter. Renders the same brand mark as the tab favicon, sized for
 * iOS's home-screen tile (180×180 is the Apple-recommended max).
 *
 * Slightly enlarged orbs vs the 32×32 favicon — at home-screen size
 * the same proportions felt thin against the rounded-tile background
 * iOS applies automatically.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        <svg width="160" height="160" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="c" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#67e8f9" />
              <stop offset="55%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#0891b2" />
            </linearGradient>
            <linearGradient id="a" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fde68a" />
              <stop offset="55%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
          </defs>
          <circle cx="15" cy="20" r="12" fill="url(#c)" />
          <circle cx="25" cy="20" r="12" fill="url(#a)" style={{ mixBlendMode: "screen" }} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
