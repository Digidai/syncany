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
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text alternative. Auto-derived from html if absent. */
  text?: string;
}

export async function sendEmail(env: EmailEnv, msg: EmailMessage): Promise<void> {
  if (!env.EMAIL || !env.EMAIL_FROM) {
    // Development fallback — log instead of throwing so onboarding still works
    // when running `wrangler dev` without the email binding.
    console.log("[email:dev]", msg.to, msg.subject, msg.html);
    return;
  }
  const text = msg.text ?? htmlToText(msg.html);
  await env.EMAIL.send({
    from: env.EMAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text,
  });
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
