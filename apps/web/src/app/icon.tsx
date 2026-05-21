import { ImageResponse } from "next/og";

/**
 * Dynamic favicon — same two-orb mark as the in-app logo, sized for
 * the favicon slot. Renders at build time via @vercel/og, served at
 * `/icon` per Next.js app router convention.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <svg width="32" height="32" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
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
