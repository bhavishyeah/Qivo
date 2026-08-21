/**
 * Email service abstraction.
 *
 * In development (no RESEND_API_KEY set), emails are logged to the console.
 * In production, set RESEND_API_KEY and EMAIL_FROM to send real emails via Resend.
 */

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

// Read env at call time, not module load time
function getResendKey(): string | undefined {
  return process.env.RESEND_API_KEY;
}

function getEmailFrom(): string {
  return process.env.EMAIL_FROM || "Qivo Forms <onboarding@resend.dev>";
}

function getWebUrl(): string {
  return process.env.WEB_URL || "http://localhost:5173";
}

async function sendViaResend(payload: EmailPayload): Promise<void> {
  const apiKey = getResendKey();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const body = JSON.stringify({
    from: getEmailFrom(),
    to: [payload.to],
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });

  console.log(`[email] Sending via Resend to ${payload.to}...`);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error(`[email] Resend failed (${response.status}): ${responseText}`);
    throw new Error(`Email delivery failed (${response.status}): ${responseText}`);
  }

  console.log(`[email] Sent successfully: ${responseText}`);
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
    if (getResendKey()) {
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
  const webUrl = getWebUrl();
  const resetUrl = `${webUrl}/reset-password?token=${token}`;

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
  const webUrl = getWebUrl();
  const verifyUrl = `${webUrl}/verify-email?token=${token}`;

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
  const webUrl = getWebUrl();
  await sendEmail({
    to,
    subject: `${inviterName} added you to ${workspaceName} on Qivo`,
    html: layout(
      "You've been added to a team",
      `<p style="color:#475569;font-size:15px;line-height:1.6;">${inviterName} added you to the <strong>${workspaceName}</strong> workspace on Qivo Forms.</p>
       ${button(`${webUrl}/login`, "Open Qivo")}`,
    ),
    text: `${inviterName} added you to ${workspaceName} on Qivo. Log in at ${webUrl}/login`,
  });
}
