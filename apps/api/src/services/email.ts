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

type FormShareRole = "RESPONDER" | "EDITOR" | "VIEWER";

// Keeps the invite copy consistent across the two form-share templates.
const roleLabel: Record<FormShareRole, string> = {
  EDITOR: "editor",
  VIEWER: "viewer",
  RESPONDER: "responder",
};
const roleVerb: Record<FormShareRole, string> = {
  EDITOR: "edit",
  VIEWER: "view responses for",
  RESPONDER: "respond to",
};

/**
 * Invite a NEW user (no account yet) to a shared form. Links to the signup page
 * carrying the invite token so the acceptance flow can resume post-signup.
 */
export async function sendFormShareInviteEmail(
  to: string,
  opts: {
    inviterName: string;
    formTitle: string;
    role: FormShareRole;
    token: string;
  },
): Promise<void> {
  const webUrl = getWebUrl();
  const signupUrl = `${webUrl}/signup?invite=${opts.token}`;

  await sendEmail({
    to,
    subject: `${opts.inviterName} invited you to ${roleVerb[opts.role]} the form "${opts.formTitle}" on Qivo`,
    html: layout(
      "You've been invited to a form",
      `<p style="color:#475569;font-size:15px;line-height:1.6;">${opts.inviterName} invited you to ${roleLabel[opts.role]} the form <strong>${opts.formTitle}</strong> on Qivo Forms. Create your account to accept:</p>
       ${button(signupUrl, "Accept invite")}
       <p style="color:#94a3b8;font-size:13px;margin-top:16px;">Or copy this link: ${signupUrl}</p>`,
    ),
    text: `${opts.inviterName} invited you to ${roleVerb[opts.role]} the form "${opts.formTitle}" on Qivo. Create your account to accept: ${signupUrl}`,
  });
}

/**
 * Notify an EXISTING user that a form was shared with them. Links straight to
 * the role-appropriate destination (edit / responses / public form).
 */
export async function sendFormShareExistingUserEmail(
  to: string,
  opts: {
    inviterName: string;
    formTitle: string;
    role: FormShareRole;
    slug: string;
    formId: string;
  },
): Promise<void> {
  const webUrl = getWebUrl();
  const link =
    opts.role === "EDITOR"
      ? `${webUrl}/forms/${opts.formId}/edit`
      : opts.role === "VIEWER"
        ? `${webUrl}/forms/${opts.formId}/responses`
        : `${webUrl}/f/${opts.slug}`;
  const buttonLabel =
    opts.role === "EDITOR"
      ? "Open form editor"
      : opts.role === "VIEWER"
        ? "View responses"
        : "Open form";

  await sendEmail({
    to,
    subject: `You've been given ${roleLabel[opts.role]} access to "${opts.formTitle}" on Qivo`,
    html: layout(
      "A form was shared with you",
      `<p style="color:#475569;font-size:15px;line-height:1.6;">${opts.inviterName} gave you ${roleLabel[opts.role]} access to the form <strong>${opts.formTitle}</strong> on Qivo Forms.</p>
       ${button(link, buttonLabel)}
       <p style="color:#94a3b8;font-size:13px;margin-top:16px;">Or copy this link: ${link}</p>`,
    ),
    text: `${opts.inviterName} gave you ${roleLabel[opts.role]} access to "${opts.formTitle}" on Qivo. Open it: ${link}`,
  });
}

/**
 * Notify a form OWNER immediately that a new response arrived. Fire-and-forget
 * from the submit path; links to the form's responses dashboard.
 */
export async function sendNewResponseNotificationEmail(
  to: string,
  opts: { formTitle: string; formId: string },
): Promise<void> {
  const webUrl = getWebUrl();
  const link = `${webUrl}/forms/${opts.formId}/responses`;

  await sendEmail({
    to,
    subject: `New response to "${opts.formTitle}"`,
    html: layout(
      "You have a new response",
      `<p style="color:#475569;font-size:15px;line-height:1.6;">Someone just submitted a response to your form <strong>${opts.formTitle}</strong> on Qivo Forms.</p>
       ${button(link, "View responses")}
       <p style="color:#94a3b8;font-size:13px;margin-top:16px;">Or copy this link: ${link}</p>`,
    ),
    text: `You have a new response to "${opts.formTitle}" on Qivo. View responses: ${link}`,
  });
}

/**
 * Daily digest to a form OWNER summarizing how many responses arrived in the
 * last 24 hours. Sent by the scheduled sweep (at most once per ~24h per form).
 */
export async function sendResponseDigestEmail(
  to: string,
  opts: { formTitle: string; formId: string; count: number },
): Promise<void> {
  const webUrl = getWebUrl();
  const link = `${webUrl}/forms/${opts.formId}/responses`;
  const plural = opts.count === 1 ? "response" : "responses";

  await sendEmail({
    to,
    subject: `${opts.count} new ${plural} to "${opts.formTitle}"`,
    html: layout(
      "Your daily response digest",
      `<p style="color:#475569;font-size:15px;line-height:1.6;">Your form <strong>${opts.formTitle}</strong> received <strong>${opts.count}</strong> new ${plural} in the last 24 hours.</p>
       ${button(link, "View responses")}
       <p style="color:#94a3b8;font-size:13px;margin-top:16px;">Or copy this link: ${link}</p>`,
    ),
    text: `Your form "${opts.formTitle}" received ${opts.count} new ${plural} in the last 24 hours. View responses: ${link}`,
  });
}

/**
 * Confirmation email to the RESPONDENT after they submit. The `answers` list
 * arrives pre-sanitized/pre-escaped (plain strings) from the submit path — this
 * function only lays them out.
 */
export async function sendResponseConfirmationEmail(
  to: string,
  opts: {
    formTitle: string;
    formId: string;
    slug: string;
    answers: Array<{ label: string; value: string }>;
  },
): Promise<void> {
  const webUrl = getWebUrl();
  const link = `${webUrl}/f/${opts.slug}`;

  const answersHtml =
    opts.answers.length > 0
      ? `<div style="margin:16px 0;border:1px solid #eef2f7;border-radius:12px;padding:16px;">${opts.answers
          .map(
            (a) =>
              `<p style="margin:0 0 10px;color:#475569;font-size:14px;line-height:1.5;"><strong style="color:#111827;">${a.label}:</strong> ${a.value}</p>`,
          )
          .join("")}</div>`
      : "";

  const answersText =
    opts.answers.length > 0
      ? `\n\nYour answers:\n${opts.answers
          .map((a) => `${a.label}: ${a.value}`)
          .join("\n")}`
      : "";

  await sendEmail({
    to,
    subject: `Thanks for your response to "${opts.formTitle}"`,
    html: layout(
      "Thanks for your response",
      `<p style="color:#475569;font-size:15px;line-height:1.6;">We received your response to <strong>${opts.formTitle}</strong>. Thank you!</p>
       ${answersHtml}
       ${button(link, "Open form")}`,
    ),
    text: `Thanks for your response to "${opts.formTitle}".${answersText}\n\nOpen form: ${link}`,
  });
}
