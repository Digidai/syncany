import { createAuthClient } from "better-auth/react";

const API_FALLBACK_LOCALHOST = ["localhost", "127.0.0.1", "::1"];

function isLocalHost(hostname: string): boolean {
  return API_FALLBACK_LOCALHOST.includes(hostname) || hostname.endsWith(".localhost");
}

export function getApiOrigin(envValue = process.env.NEXT_PUBLIC_RALTIC_API_URL): string {
  if (envValue) return envValue;

  if (typeof window === "undefined") return "https://api.raltic.com";

  if (isLocalHost(window.location.hostname)) {
    const localProtocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${localProtocol}//${window.location.hostname}:8787`;
  }

  return "https://api.raltic.com";
}

// API Worker — for /api/v1/* (data + ws) calls. Cross-origin.
export const apiOrigin = getApiOrigin();

// Auth lives on the WEB origin so cookies and verification email links share
// a single domain. better-auth client posts to the same origin (relative).
export const authClient = createAuthClient({
  // baseURL omitted → uses location.origin (browser) / current origin (SSR).
  fetchOptions: {
    credentials: "include",
  },
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
