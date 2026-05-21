import { createAuthClient } from "better-auth/react";

// API Worker — for /api/v1/* (data + ws) calls. Cross-origin.
export const apiOrigin =
  process.env.NEXT_PUBLIC_RALTIC_API_URL ?? "https://api.raltic.com";

// Auth lives on the WEB origin so cookies and verification email links share
// a single domain. better-auth client posts to the same origin (relative).
export const authClient = createAuthClient({
  // baseURL omitted → uses location.origin (browser) / current origin (SSR).
  fetchOptions: {
    credentials: "include",
  },
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
