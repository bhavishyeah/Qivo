import { publicPost } from "./api";

export type ReportReason = "SCAM" | "SPAM" | "IMPERSONATION" | "OTHER";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "SCAM", label: "Looks like a scam or wrong UPI ID" },
  { value: "SPAM", label: "Spam or offensive" },
  { value: "IMPERSONATION", label: "Impersonation" },
  { value: "OTHER", label: "Other" },
];

export const MAX_REPORT_DETAILS = 500;
export const REPORT_SUCCESS_MESSAGE = "Thanks, we will review this form.";

export type ReportDraft = {
  reason: ReportReason | "";
  details: string;
  email: string;
};

export type ReportErrors = { reason?: string; details?: string; email?: string };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateReport(draft: ReportDraft): ReportErrors {
  const errors: ReportErrors = {};
  if (!draft.reason) errors.reason = "Choose a reason for your report.";
  if (draft.details.trim().length > MAX_REPORT_DETAILS) {
    errors.details = `Details must be at most ${MAX_REPORT_DETAILS} characters.`;
  }
  const email = draft.email.trim();
  if (email && !EMAIL_SHAPE.test(email)) errors.email = "Enter a valid email address.";
  return errors;
}

export async function sendReport(
  slug: string,
  draft: ReportDraft,
  honeypot: string,
): Promise<void> {
  await publicPost(`/api/public/forms/${encodeURIComponent(slug)}/report`, {
    reason: draft.reason,
    details: draft.details.trim() || undefined,
    reporterEmail: draft.email.trim() || undefined,
    website: honeypot,
  });
}