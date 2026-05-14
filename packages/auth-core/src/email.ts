export interface EmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(env: EmailEnv, msg: EmailMessage): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    // Development fallback — log instead of throwing so onboarding still works.
    console.log("[email:dev]", msg.to, msg.subject, msg.html);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed: ${res.status} ${body}`);
  }
}
