import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@syncany/db/schema";
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
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.WEB_ORIGIN,
    trustedOrigins: [env.WEB_ORIGIN],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your Syncany password",
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
            subject: "Verify your Syncany email",
            html: `<p>Welcome to Syncany, ${escapeHtml(user.name)}.</p>
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
      cookieCache: { enabled: true, maxAge: 5 * 60 },
      expiresIn: 60 * 60 * 24 * 30,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      // Best-effort — uses better-auth's in-memory store. KV-backed store
      // would require a custom adapter; in-memory is enough at our scale
      // (one Worker isolate handles bursts within seconds).
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
