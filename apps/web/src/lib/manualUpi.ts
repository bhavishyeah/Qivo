// Pure helpers for the manual UPI payment feature (web side). The validation
// rules mirror apps/api/src/modules/forms/manualPayment.ts — keep identical.
// Client validation is UX only; the server is authoritative.

import type {
  FormSchema,
  ManualPaymentRecord,
  ManualPaymentStatus,
  PublicManualUpi,
} from "../types";

export const MANUAL_MIN_PAISE = 100; // ₹1
export const MANUAL_MAX_PAISE = 15_000_000; // ₹1,50,000

const UPI_ID_RE = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.]{1,31}$/;
const UTR_RE = /^[A-Za-z0-9]{8,35}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/;

/** No implicit trim: callers trim first. */
export function isValidUpiId(value: string): boolean {
  return typeof value === "string" && UPI_ID_RE.test(value);
}

export function isValidUtr(value: string): boolean {
  return typeof value === "string" && UTR_RE.test(value.trim());
}

export function normalizeUtr(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidPayeeName(value: string): boolean {
  if (typeof value !== "string") return false;
  const t = value.trim();
  return t.length >= 1 && t.length <= 60 && !CONTROL_RE.test(t);
}

/**
 * Build the UPI deep-link / QR payload. The scheme is a constant; every value
 * is percent-encoded. An invalid amount is omitted (never throws in render).
 * Param order: pa, pn, cu, am, tn.
 */
export function buildUpiUri(args: {
  upiId: string;
  payeeName: string;
  amountPaise?: number | undefined;
  note?: string | undefined;
}): string {
  const parts = [
    `pa=${encodeURIComponent(args.upiId)}`,
    `pn=${encodeURIComponent(args.payeeName)}`,
    "cu=INR",
  ];
  if (
    typeof args.amountPaise === "number" &&
    Number.isInteger(args.amountPaise) &&
    args.amountPaise >= 1
  ) {
    parts.push(`am=${(args.amountPaise / 100).toFixed(2)}`);
  }
  const note = args.note?.trim();
  if (note) parts.push(`tn=${encodeURIComponent(note)}`);
  return `upi://pay?${parts.join("&")}`;
}

/** Rupees text ("50", "50.5") -> integer paise in [100, 15_000_000], else null. */
export function rupeesToPaise(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) return null;
  if (paise < MANUAL_MIN_PAISE || paise > MANUAL_MAX_PAISE) return null;
  return paise;
}

/** 5000 -> "50", 5050 -> "50.50" (editor field prefill). */
export function paiseToRupeesInput(paise: number): string {
  const whole = Math.floor(paise / 100);
  const frac = paise % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** "₹1,500.00" */
export function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Same whitelist as the server's public block; used by the preview. */
export function toPublicManualUpi(
  settings: FormSchema["settings"] | undefined,
): PublicManualUpi | null {
  const m = settings?.manualUpi;
  if (!m || m.enabled !== true) return null;
  if (settings?.payment?.enabled === true) return null;
  if (typeof m.upiId !== "string" || !isValidUpiId(m.upiId)) return null;
  if (typeof m.payeeName !== "string" || !isValidPayeeName(m.payeeName)) return null;
  return {
    enabled: true,
    upiId: m.upiId,
    payeeName: m.payeeName,
    requireScreenshot: m.requireScreenshot !== false,
    ...(typeof m.amount === "number" ? { amount: m.amount } : {}),
    ...(m.instructions ? { instructions: m.instructions } : {}),
  };
}

export function validateManualPayment(
  v: { utr: string; proofUrl: string },
  requireScreenshot: boolean,
): { utr?: string; proof?: string } {
  const errors: { utr?: string; proof?: string } = {};
  if (!v.utr.trim()) {
    errors.utr = "Enter the UTR from your payment app.";
  } else if (!isValidUtr(v.utr)) {
    errors.utr = "Enter a valid UTR (8-35 letters or digits, no spaces).";
  }
  if (requireScreenshot && !v.proofUrl) {
    errors.proof = "Upload a screenshot of your payment.";
  }
  return errors;
}

const STATUSES: ManualPaymentStatus[] = ["pending", "verified", "rejected"];

/** Defensive parse of stored metadata.manualPayment. */
export function getManualPayment(metadata: unknown): ManualPaymentRecord | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).manualPayment;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.utr !== "string" || !r.utr) return null;
  const status: ManualPaymentStatus = STATUSES.includes(r.status as ManualPaymentStatus)
    ? (r.status as ManualPaymentStatus)
    : "pending";
  return {
    utr: r.utr,
    status,
    submittedAt: typeof r.submittedAt === "string" ? r.submittedAt : "",
    ...(typeof r.proofUrl === "string" && /^https:\/\//.test(r.proofUrl)
      ? { proofUrl: r.proofUrl }
      : {}),
    ...(typeof r.amount === "number" ? { amount: r.amount } : {}),
    ...(typeof r.reviewedAt === "string" ? { reviewedAt: r.reviewedAt } : {}),
    ...(typeof r.reviewedBy === "string" ? { reviewedBy: r.reviewedBy } : {}),
  };
}

export function summarizeManualPayments(
  responses: Array<{ metadata?: unknown }>,
): { pending: number; verified: number; rejected: number } {
  const counts = { pending: 0, verified: 0, rejected: 0 };
  for (const r of responses) {
    const mp = getManualPayment(r.metadata);
    if (mp) counts[mp.status] += 1;
  }
  return counts;
}

export function formatSummary(c: {
  pending: number;
  verified: number;
  rejected: number;
}): string {
  return `${c.verified} verified · ${c.pending} pending · ${c.rejected} rejected`;
}

/** Defuse spreadsheet formula injection: prefix "'" when the first char is = + - @ TAB CR. */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
