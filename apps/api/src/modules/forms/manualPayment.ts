// Pure helpers for the manual UPI payment feature. No DB, no I/O.
// The web mirror lives in apps/web/src/lib/manualUpi.ts — keep identical.

export const MANUAL_MIN_PAISE = 100; // keep in sync with razorpay.ts MIN_PAISE
export const MANUAL_MAX_PAISE = 15_000_000; // keep in sync with razorpay.ts MAX_PAISE

export type ManualPaymentStatus = "pending" | "verified" | "rejected";

export type ManualPaymentRecord = {
  utr: string;
  proofUrl?: string;
  amount?: number; // PAISE snapshot from settings
  status: ManualPaymentStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
};

export type ManualUpiInput = {
  enabled: boolean;
  upiId?: string | undefined;
  payeeName?: string | undefined;
  amount?: number | undefined;
  instructions?: string | undefined;
  requireScreenshot: boolean;
};

export type StoredManualUpi = {
  enabled: boolean;
  upiId?: string;
  payeeName?: string;
  amount?: number;
  instructions?: string;
  requireScreenshot: boolean;
};

export type ActiveManualUpi = {
  upiId: string;
  payeeName: string;
  amount?: number;
  instructions?: string;
  requireScreenshot: boolean;
};

type FormSettingsLike = {
  manualUpi?: unknown;
  payment?: { enabled?: unknown } | null | undefined;
};

const UPI_ID_RE = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.]{1,31}$/;
const UTR_RE = /^[A-Za-z0-9]{8,35}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_NEWLINE_RE = /[\u0000-\u0009\u000B-\u001F\u007F]/;

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

export function isValidInstructions(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length <= 300 &&
    !CONTROL_EXCEPT_NEWLINE_RE.test(value)
  );
}

export function isValidManualAmountPaise(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= MANUAL_MIN_PAISE &&
    n <= MANUAL_MAX_PAISE
  );
}

/** Builds the stored settings object (conditional spreads only). */
export function normalizeManualUpiInput(
  input: ManualUpiInput,
): StoredManualUpi {
  return {
    enabled: input.enabled,
    ...(input.upiId ? { upiId: input.upiId.trim() } : {}),
    ...(input.payeeName ? { payeeName: input.payeeName.trim() } : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.instructions ? { instructions: input.instructions.trim() } : {}),
    requireScreenshot: input.requireScreenshot,
  };
}

/**
 * Returns a fully-valid public-facing config, or null (disabled, Razorpay on,
 * or invalid stored values).
 */
export function getActiveManualUpi(
  settings: FormSettingsLike | null | undefined,
): ActiveManualUpi | null {
  const m = settings?.manualUpi as
    | {
        enabled?: unknown;
        upiId?: unknown;
        payeeName?: unknown;
        amount?: unknown;
        instructions?: unknown;
        requireScreenshot?: unknown;
      }
    | null
    | undefined;
  if (!m || typeof m !== "object" || m.enabled !== true) return null;
  if (settings?.payment?.enabled === true) return null;
  if (typeof m.upiId !== "string" || !isValidUpiId(m.upiId)) return null;
  if (typeof m.payeeName !== "string" || !isValidPayeeName(m.payeeName)) {
    return null;
  }
  return {
    upiId: m.upiId,
    payeeName: m.payeeName,
    requireScreenshot:
      typeof m.requireScreenshot === "boolean" ? m.requireScreenshot : true,
    ...(isValidManualAmountPaise(m.amount) ? { amount: m.amount } : {}),
    ...(typeof m.instructions === "string" &&
    m.instructions.length > 0 &&
    isValidInstructions(m.instructions)
      ? { instructions: m.instructions }
      : {}),
  };
}

/** Own-key strip. Returns a NEW object without "manualPayment". Pure. */
export function stripReservedMetadata(
  meta: Record<string, unknown> | undefined,
): { metadata: Record<string, unknown>; stripped: boolean } {
  if (!meta) return { metadata: {}, stripped: false };
  const stripped = Object.prototype.hasOwnProperty.call(meta, "manualPayment");
  const metadata: Record<string, unknown> = {};
  for (const key of Object.keys(meta)) {
    if (key === "manualPayment") continue;
    metadata[key] = meta[key];
  }
  return { metadata, stripped };
}

/**
 * Server-built record. status is the literal "pending"; amount comes ONLY from
 * `config.amount` (there is deliberately no client amount parameter).
 */
export function buildManualPaymentRecord(args: {
  utr: string;
  proofUrl?: string;
  config: { amount?: number | undefined };
  now: Date;
}): ManualPaymentRecord {
  return {
    utr: args.utr,
    ...(args.proofUrl ? { proofUrl: args.proofUrl } : {}),
    ...(args.config.amount !== undefined ? { amount: args.config.amount } : {}),
    status: "pending",
    submittedAt: args.now.toISOString(),
  };
}

/** Defensive parse of stored JSON. Null when absent or malformed. */
export function readManualPayment(
  metadata: unknown,
): ManualPaymentRecord | null {
  if (!metadata || typeof metadata !== "object") return null;
  const mp = (metadata as Record<string, unknown>).manualPayment as
    | Record<string, unknown>
    | null
    | undefined;
  if (!mp || typeof mp !== "object" || Array.isArray(mp)) return null;
  if (typeof mp.utr !== "string" || mp.utr.length === 0) return null;
  const status: ManualPaymentStatus =
    mp.status === "verified" || mp.status === "rejected"
      ? mp.status
      : "pending";
  return {
    utr: mp.utr,
    status,
    submittedAt: typeof mp.submittedAt === "string" ? mp.submittedAt : "",
    ...(typeof mp.proofUrl === "string" ? { proofUrl: mp.proofUrl } : {}),
    ...(typeof mp.amount === "number" ? { amount: mp.amount } : {}),
    ...(typeof mp.reviewedAt === "string" ? { reviewedAt: mp.reviewedAt } : {}),
    ...(typeof mp.reviewedBy === "string" ? { reviewedBy: mp.reviewedBy } : {}),
  };
}
