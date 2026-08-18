/**
 * Email service abstraction.
 *
 * In development (no RESEND_API_KEY set), emails are logged to the console.
 * In production, set RESEND_API_KEY and EMAIL_FROM to send real emails via Resend.
 *
 * This design keeps business logic decoupled from the delivery mechanism —
 * swap the provider here without touching auth/notification code.
 */

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Qivo Forms <onboarding@resend.dev>";
const WEB_URL = process.env.WEB_URL || "http://localhost:5173";

async function sendViaResend(payload: EmailPayload): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Email delivery failed (${response.status}): ${body}`);
  }
}

function logToConsole(payload: EmailPayload): void {
  console.log("\n========== [DEV EMAIL] ==========");
  console.log(`To:      ${payload.to}`);
  console.log(`Subject: ${payload.subject}`);
  console.log(`Text:\n${payload.text}`);
  console.log("=================================\n");
}

/**
 * Send an email. Falls back to console logging when no provider is configured.
 * Never throws to the caller — email failures should not break the request flow.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  try {
    if (RESEND_API_KEY) {
      await sendViaResend(payload);
    } else {
      logToConsole(payload);
    }
  } catch (error) {
    // Log but don't propagate — a failed email should not crash the request
    console.error("[email] Failed to send:", error);
  }
}

// ---- Email templates ----

function layout(title: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 8px 40px rgba(30,64,175,0.08);">
      <p style="color:#2563eb;font-size:12px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;margin:0 0 16px;">Qivo Forms</p>
      <h1 style="color:#111827;font-size:26px;margin:0 0 16px;">${title}</h1>
      ${body}
      <hr style="border:none;border-top:1px solid #eef2f7;margin:32px 0;" />
      <p style="color:#94a3b8;font-size:13px;margin:0;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </body>
</html>`;
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:700;margin:8px 0;">${label}</a>`;
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const resetUrl = `${WEB_URL}/reset-password?token=${token}`;

  await sendEmail({
    to,
    subject: "Reset your Qivo password",
    html: layout(
      "Reset your password",
      `<p style="color:#475569;font-size:15px;line-height:1.6;">We received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.</p>
       ${button(resetUrl, "Reset password")}
       <p style="color:#94a3b8;font-size:13px;margin-top:16px;">Or copy this link: ${resetUrl}</p>`,
    ),
    text: `Reset your Qivo password by visiting: ${resetUrl}\n\nThis link expires in 1 hour.`,
  });
}

export async function sendVerificationEmail(to: string, token: string) {
  const verifyUrl = `${WEB_URL}/verify-email?token=${token}`;

  await sendEmail({
    to,
    subject: "Verify your Qivo email",
    html: layout(
      "Verify your email",
      `<p style="color:#475569;font-size:15px;line-height:1.6;">Please confirm your email address to secure your account. This link expires in 24 hours.</p>
       ${button(verifyUrl, "Verify email")}
       <p style="color:#94a3b8;font-size:13px;margin-top:16px;">Or copy this link: ${verifyUrl}</p>`,
    ),
    text: `Verify your Qivo email by visiting: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  });
}

export async function sendTeamInviteEmail(
  to: string,
  workspaceName: string,
  inviterName: string,
) {
  await sendEmail({
    to,
    subject: `${inviterName} added you to ${workspaceName} on Qivo`,
    html: layout(
      "You've been added to a team",
      `<p style="color:#475569;font-size:15px;line-height:1.6;">${inviterName} added you to the <strong>${workspaceName}</strong> workspace on Qivo Forms.</p>
       ${button(`${WEB_URL}/login`, "Open Qivo")}`,
    ),
    text: `${inviterName} added you to ${workspaceName} on Qivo. Log in at ${WEB_URL}/login`,
  });
}
