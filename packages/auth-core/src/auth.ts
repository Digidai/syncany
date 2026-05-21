import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@raltic/db/schema";
import { runOnboarding } from "./onboarding";
import { sendEmail, type EmailEnv } from "./email";

export interface AuthEnv extends EmailEnv {
  DB: D1Database;
  CHAT_ROOM: DurableObjectNamespace;
  CHAT_ROOM_AUTH_SECRET: string;
  BETTER_AUTH_SECRET: string;
  WEB_ORIGIN: string;
  GOOGLE_CLIENT_ID?: string;
  BETTER_AUTH_GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  BETTER_AUTH_GITHUB_CLIENT_SECRET?: string;
}

/**
 * Build the better-auth instance for a request.
 *
 * Important: do NOT cache this at module scope. The `env` is request-bound
 * under OpenNext for Cloudflare; constructing per request keeps secrets
 * scoped to the current invocation. The construction itself is cheap.
 */
export function createAuth(env: AuthEnv) {
  // Defensive: fail loud if the signing secret is missing. Without this,
  // better-auth silently falls back to a randomly-generated secret per
  // isolate — every Worker cold-start re-issues a fresh secret and every
  // existing session cookie becomes unverifiable. Looks like "logout on
  // every deploy" but is actually "logout on every cold start", made
  // worse on deploy because deploys evict all isolates simultaneously.
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 16) {
    throw new Error(
      "[auth-core] BETTER_AUTH_SECRET is missing or too short. " +
      "Set it via `wrangler secret put BETTER_AUTH_SECRET` (≥32 random bytes)."
    );
  }

  const db = drizzle(env.DB, { schema });

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.WEB_ORIGIN,
    trustedOrigins: [env.WEB_ORIGIN],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // Keep this in sync with the UI hints in signup / reset-password.
      // Bumped from the better-auth default (8) — we previously had a
      // mismatch where signup placeholder said "≥6" but reset enforced 8.
      minPasswordLength: 8,
      maxPasswordLength: 256,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your Raltic password",
          html: `<p>Hi ${escapeHtml(user.name)},</p>
            <p><a href="${url}">Click here to set a new password</a></p>
            <p style="color:#888;font-size:12px">If you didn't request a reset, just ignore this email.</p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        // Append a callbackURL so users land on a friendly success page
        // instead of being bounced to the protected home (which would
        // redirect them to /login if their session isn't yet active).
        const u = new URL(url);
        if (!u.searchParams.has("callbackURL")) {
          u.searchParams.set("callbackURL", "/verify-email");
        }
        try {
          await sendEmail(env, {
            to: user.email,
            subject: "Verify your Raltic email",
            html: `<p>Welcome to Raltic, ${escapeHtml(user.name)}.</p>
              <p><a href="${u.toString()}">Click to verify your email</a></p>
              <p style="color:#888;font-size:12px">If you didn't sign up, just ignore this.</p>`,
          });
        } catch (err) {
          // Atomic-ish signup: if we can't send the verification email, the
          // user is permanently locked out (can't log in without verifying,
          // can't re-signup because email is taken). Roll back the user row
          // so they can try again. Onboarding artifacts (server, channels)
          // get garbage-collected by the FK cascade on `user`.
          console.error("[auth] verification email failed — rolling back user", {
            userId: user.id, email: user.email, error: String(err),
          });
          try {
            await db.delete(schema.user).where(eq(schema.user.id, user.id));
          } catch (rollbackErr) {
            console.error("[auth] FAILED TO ROLL BACK USER", {
              userId: user.id, error: String(rollbackErr),
            });
          }
          // Re-throw so better-auth returns a 5xx and the UI shows an error
          // instead of a misleading "verification email sent" toast.
          throw err;
        }
      },
    },
    socialProviders: env.GOOGLE_CLIENT_ID && env.BETTER_AUTH_GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.BETTER_AUTH_GOOGLE_CLIENT_SECRET,
          },
          ...(env.GITHUB_CLIENT_ID && env.BETTER_AUTH_GITHUB_CLIENT_SECRET
            ? {
                github: {
                  clientId: env.GITHUB_CLIENT_ID,
                  clientSecret: env.BETTER_AUTH_GITHUB_CLIENT_SECRET,
                },
              }
            : {}),
        }
      : {},
    session: {
      // cookieCache: signed cookie carrying the session payload, so
      // hot reads skip the DB roundtrip. Bumped from 5min → 1hr because:
      //   • The cache is forge-resistant (HMAC'd with BETTER_AUTH_SECRET).
      //   • Shorter cache means more DB hits during a cold-start / first-
      //     request burst, which on Cloudflare's free D1 plan is the
      //     window where intermittent 500s are most likely.
      //   • 1hr is well below the session lifetime (1 year) and updateAge
      //     (1 day) so revocation lag is bounded.
      cookieCache: { enabled: true, maxAge: 60 * 60 },
      // Effectively "never expires" while the user keeps using the app:
      // a fresh session lasts 1 year, and `updateAge` rolls the expiry
      // forward by another year on every visit that's > 1 day old.
      // A truly infinite session is a security footgun (lost laptops,
      // shared browsers); 1-year-rolling gives the same UX without
      // ever surprising an active user with a sign-in prompt.
      expiresIn: 60 * 60 * 24 * 365,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      // 10/min/IP is enough for a real human + a fat-finger or two and
      // tight enough to slow a credential-stuffer. Was 30 — too generous.
      max: 10,
      // Best-effort — uses better-auth's in-memory store. KV-backed store
      // would require a custom adapter; per-isolate is enough at our scale
      // (an attacker can rotate colos but pays a real latency tax).
    },
    account: {
      // Account linking IS enabled, but `trustedProviders` is intentionally
      // empty: silent auto-link on a Google sign-in lets an attacker who
      // controls a Gmail at the same address as an unverified local
      // account take it over (better-auth doesn't gate trusted-provider
      // linking on the local account being email-verified). With no
      // trusted providers, linking still works — but only after the user
      // is already signed into the local account and explicitly initiates
      // it from settings. Fail-closed beats fail-merge.
      accountLinking: {
        enabled: true,
        trustedProviders: [],
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await runOnboarding(env, user as typeof schema.user.$inferSelect);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
