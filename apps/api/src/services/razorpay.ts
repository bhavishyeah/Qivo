import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay integration — fixed-INR payment gate for form submission.
 *
 * Mirrors the external-integration conventions already in the codebase
 * (`email.ts` / `cloudinary.ts`): keys are read from `process.env` AT CALL TIME
 * (never at module load), an `isRazorpayConfigured()` predicate gates the
 * feature, and a clean typed error is thrown when unconfigured. The feature is
 * a no-op when the vars are unset, so the app boots and runs with no keys.
 *
 * Secrets (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) are read only inside
 * signing/verifying functions and the impure order-create call; they are never
 * logged and never returned to any client. `RAZORPAY_KEY_ID` is public.
 *
 * All signature comparisons are constant-time via node:crypto timingSafeEqual,
 * reusing the pattern proven in `responseEditToken.ts` / `webhookDelivery.ts`.
 */

export function isRazorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
  );
}

/** The publishable key id, safe to send to the client. `null` when unset. */
export function getPublicKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID ?? null;
}

function paymentsNotConfigured(): Error {
  const error = new Error("Payments are not configured.");
  error.name = "PAYMENTS_NOT_CONFIGURED";
  return error;
}

// ── Amount unit: paise is the single stored & transported unit ──

export const MIN_PAISE = 100; // ₹1 — Razorpay's documented INR minimum
export const MAX_PAISE = 15_000_000; // ₹1,50,000 — a sane cap well under limits

/**
 * Convert a rupee value to integer paise. Rejects non-finite, negative, or
 * values with more than 2 decimal places (anything that can't be an exact
 * integer-paise amount) and amounts outside [MIN_PAISE, MAX_PAISE].
 */
export function rupeesToPaise(rupees: number): number {
  if (typeof rupees !== "number" || !Number.isFinite(rupees)) {
    const error = new Error("Amount must be a finite number.");
    error.name = "PAYMENT_AMOUNT_INVALID";
    throw error;
  }
  if (rupees < 0) {
    const error = new Error("Amount must not be negative.");
    error.name = "PAYMENT_AMOUNT_INVALID";
    throw error;
  }
  const paise = Math.round(rupees * 100);
  // Reject >2-decimal inputs: the rounded paise must reproduce the rupee value.
  if (Math.abs(paise / 100 - rupees) > 1e-9) {
    const error = new Error("Amount must have at most 2 decimal places.");
    error.name = "PAYMENT_AMOUNT_INVALID";
    throw error;
  }
  if (!isValidAmountPaise(paise)) {
    const error = new Error(
      `Amount must be between ₹${MIN_PAISE / 100} and ₹${MAX_PAISE / 100}.`,
    );
    error.name = "PAYMENT_AMOUNT_INVALID";
    throw error;
  }
  return paise;
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

export function isValidAmountPaise(paise: unknown): paise is number {
  return (
    typeof paise === "number" &&
    Number.isInteger(paise) &&
    paise >= MIN_PAISE &&
    paise <= MAX_PAISE
  );
}

// ── Pure: order payload (amount comes from settings, never input) ──

// `now` is INJECTED (not read via Date.now() inside the helper) so the function
// is genuinely pure/deterministic and the unit test can assert a fixed receipt.
export function buildOrderPayload(args: {
  amountPaise: number;
  slug: string;
  now: number;
}): {
  amount: number;
  currency: "INR";
  receipt: string;
  notes: { slug: string };
} {
  return {
    amount: args.amountPaise,
    currency: "INR" as const,
    receipt: `form_${args.slug}_${args.now}`,
    notes: { slug: args.slug },
  };
}

// ── Pure: Checkout payment-signature verification ──
// expected = HMAC-SHA256(key_secret, `${order_id}|${payment_id}`) hex
export function verifyPaymentSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret)
    .update(`${args.orderId}|${args.paymentId}`)
    .digest("hex");
  return safeEqualHex(expected, args.signature);
}

// ── Pure: webhook signature verification (raw body) ──
// expected = HMAC-SHA256(webhook_secret, rawBody) hex vs x-razorpay-signature
export function verifyWebhookSignature(
  rawBody: Buffer | string | undefined,
  signature: string,
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  // Fail-closed guard: an absent/empty/wrong-typed body can never be a validly
  // signed Razorpay payload, so reject BEFORE createHmac().update(...) —
  // calling .update(undefined) would throw a TypeError the route swallows into
  // a 200.
  if (rawBody == null) return false;
  if (typeof rawBody !== "string" && !Buffer.isBuffer(rawBody)) return false;
  if (rawBody.length === 0) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return safeEqualHex(expected, signature);
}

// Length-guarded constant-time hex compare (timingSafeEqual throws on length
// mismatch, so guard the lengths first — a length difference already means a
// mismatch).
function safeEqualHex(expectedHex: string, providedHex: string): boolean {
  if (typeof providedHex !== "string" || providedHex.length !== expectedHex.length) {
    return false;
  }
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(providedHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Impure: create an order via the Razorpay REST API ──
// Single authenticated POST; no npm SDK (mirrors the Resend/Cloudinary
// precedent of calling the REST API with fetch directly).
export async function createRazorpayOrder(args: {
  amountPaise: number;
  slug: string;
}): Promise<{ id: string; amount: number; currency: string }> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw paymentsNotConfigured();

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    // Date.now() is read HERE (the impure caller) and injected into the pure
    // builder, keeping buildOrderPayload deterministic/testable.
    body: JSON.stringify(
      buildOrderPayload({
        amountPaise: args.amountPaise,
        slug: args.slug,
        now: Date.now(),
      }),
    ),
  });
  const text = await res.text();
  if (!res.ok) {
    // text is Razorpay's error body (no secret present in it); safe to log.
    console.error(
      `[razorpay] order creation failed (${res.status}): ${text}`,
    );
    const error = new Error(
      `Razorpay order creation failed (${res.status}).`,
    );
    error.name = "PAYMENT_ORDER_FAILED"; // → 502
    throw error;
  }
  const order = JSON.parse(text) as {
    id: string;
    amount: number;
    currency: string;
  };
  return { id: order.id, amount: order.amount, currency: order.currency };
}
