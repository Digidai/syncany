/**
 * Outbound email via Cloudflare Email Service (Workers Paid plan).
 *
 * The `EMAIL` binding is provisioned in apps/web/wrangler.jsonc and uses
 * the public-beta Email Sending API. Set `EMAIL_FROM` to a verified sender
 * on the syncany.app domain.
 */
export interface EmailEnv {
  EMAIL?: { send: (msg: { from: string; to: string; subject: string; html: string; text?: string }) => Promise<{ messageId: string }> };
  EMAIL_FROM?: string;
  /** Set in apps/web/wrangler.jsonc vars to "development" to enable the
   *  dev fallback (console.log instead of throw on missing EMAIL binding). */
  ENVIRONMENT?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text alternative. Auto-derived from html if absent. */
  text?: string;
}

const isDev = (env: EmailEnv): boolean =>
  env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test";

export async function sendEmail(env: EmailEnv, msg: EmailMessage): Promise<void> {
  if (!env.EMAIL || !env.EMAIL_FROM) {
    if (isDev(env)) {
      console.log("[email:dev]", msg.to, msg.subject, msg.html);
      return;
    }
    // FAIL LOUD in prod. Silently logging meant signup created a user row
    // but the verification email never went out, locking the user out of
    // their own email forever (P0 from 6-agent diagnostic).
    throw new Error(
      "Email binding missing in production. Set send_email[] binding " +
      "in wrangler.jsonc + EMAIL_FROM var, or set ENVIRONMENT=development " +
      "to enable the console.log fallback.",
    );
  }
  const text = msg.text ?? htmlToText(msg.html);
  // One transparent retry on transient failure (CF Email Sending in beta
  // can throttle). Bounded so signup doesn't hang on a 5xx loop.
  try {
    await env.EMAIL.send({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text });
  } catch (firstErr) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      await env.EMAIL.send({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text });
    } catch (retryErr) {
      throw new Error(
        `email send failed (after 1 retry): ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
        { cause: firstErr },
      );
    }
  }
}

/** Tiny html→text fallback for clients that don't render HTML. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
