"use client";

// Catches errors thrown by the root layout itself (font loading,
// metadata generation, etc.). `app/error.tsx` only catches errors
// inside a route — if the layout crashes, you need this. Must render
// its own <html>+<body> because Next.js skipped the root layout.
//
// Sentry will capture this via the SDK's automatic instrumentation
// (no manual report needed). Keep this file minimal — anything fancy
// risks crashing itself.

import { useEffect } from "react";

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Last-resort log. Sentry catches this automatically once integrated.
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0a0a0a",
          color: "#e4e4e7",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.75rem", margin: "0 0 0.5rem", fontWeight: 600 }}>
            Raltic stopped responding
          </h1>
          <p style={{ color: "#a1a1aa", margin: "0 0 1.5rem" }}>
            The app hit an unrecoverable error before the page could load.
            Try refreshing. If it persists, our team has been notified.
          </p>
          {error.digest && (
            <p style={{ color: "#71717a", fontSize: "0.75rem", fontFamily: "ui-monospace, monospace", margin: "0 0 1.5rem" }}>
              {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              padding: "0.625rem 1.25rem",
              background: "white",
              color: "black",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "0.875rem",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
