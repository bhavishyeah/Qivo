import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

// Inject known secrets BEFORE importing the module under test so the functions
// read stable, deterministic values for the HMAC (same recipe as
// responseEditToken.test.ts).
process.env.RAZORPAY_KEY_ID = "rzp_test_keyid";
process.env.RAZORPAY_KEY_SECRET = "test_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";

const {
  isRazorpayConfigured,
  getPublicKeyId,
  rupeesToPaise,
  paiseToRupees,
  isValidAmountPaise,
  buildOrderPayload,
  verifyPaymentSignature,
  verifyWebhookSignature,
  MIN_PAISE,
  MAX_PAISE,
} = await import("./razorpay.js");

describe("razorpay — configuration", () => {
  it("isRazorpayConfigured true when key id + secret present", () => {
    expect(isRazorpayConfigured()).toBe(true);
  });

  it("getPublicKeyId returns the public key id only", () => {
    expect(getPublicKeyId()).toBe("rzp_test_keyid");
  });
});

describe("razorpay — rupee/paise conversion", () => {
  it("converts whole rupees exactly", () => {
    expect(rupeesToPaise(1)).toBe(100);
    expect(rupeesToPaise(100)).toBe(10000);
  });

  it("converts 2-decimal rupees exactly", () => {
    expect(rupeesToPaise(99.99)).toBe(9999);
  });

  it("paise → rupees is exact", () => {
    expect(paiseToRupees(100)).toBe(1);
    expect(paiseToRupees(9999)).toBe(99.99);
  });

  it("rejects ₹0 (below the ₹1 minimum)", () => {
    expect(() => rupeesToPaise(0)).toThrowError(/Amount/);
  });

  it("rejects negative amounts", () => {
    expect(() => rupeesToPaise(-5)).toThrowError(/negative/i);
  });

  it("rejects amounts above the cap", () => {
    expect(() => rupeesToPaise(MAX_PAISE / 100 + 1)).toThrowError(/Amount/);
  });

  it("rejects >2-decimal amounts", () => {
    expect(() => rupeesToPaise(1.239)).toThrowError(/2 decimal/i);
  });

  it("rejects non-finite amounts", () => {
    expect(() => rupeesToPaise(Number.NaN)).toThrowError(/finite/i);
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrowError(
      /finite/i,
    );
  });
});

describe("razorpay — isValidAmountPaise bounds", () => {
  it("rejects just below the floor and accepts the floor", () => {
    expect(isValidAmountPaise(MIN_PAISE - 1)).toBe(false); // 99
    expect(isValidAmountPaise(MIN_PAISE)).toBe(true); // 100
  });

  it("accepts the ceiling and rejects just above it", () => {
    expect(isValidAmountPaise(MAX_PAISE)).toBe(true); // 15_000_000
    expect(isValidAmountPaise(MAX_PAISE + 1)).toBe(false); // 15_000_001
  });

  it("rejects non-integers and non-numbers", () => {
    expect(isValidAmountPaise(100.5)).toBe(false);
    expect(isValidAmountPaise("100")).toBe(false);
    expect(isValidAmountPaise(undefined)).toBe(false);
  });
});

describe("razorpay — buildOrderPayload (deterministic with injected now)", () => {
  it("produces the exact receipt for a fixed now and passes the amount through", () => {
    const payload = buildOrderPayload({
      amountPaise: 50000,
      slug: "my-form",
      now: 1_700_000_000_000,
    });
    expect(payload).toEqual({
      amount: 50000,
      currency: "INR",
      receipt: "form_my-form_1700000000000",
      notes: { slug: "my-form" },
    });
  });
});

describe("razorpay — verifyPaymentSignature (HMAC fixed vector)", () => {
  const orderId = "order_X";
  const paymentId = "pay_Y";
  const valid = createHmac("sha256", "test_secret")
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  it("accepts the correct signature", () => {
    expect(
      verifyPaymentSignature({ orderId, paymentId, signature: valid }),
    ).toBe(true);
  });

  it("matches the pinned known vector", () => {
    expect(valid).toBe(
      "ae2b944eb1654e2b4141164ad2d208eb27280bb98bce1501150c241a7ed31d71",
    );
  });

  it("rejects a tampered signature", () => {
    const tampered = `0${valid.slice(1)}`;
    expect(
      verifyPaymentSignature({ orderId, paymentId, signature: tampered }),
    ).toBe(false);
  });

  it("rejects a wrong order id", () => {
    expect(
      verifyPaymentSignature({
        orderId: "order_Z",
        paymentId,
        signature: valid,
      }),
    ).toBe(false);
  });

  it("rejects a wrong payment id", () => {
    expect(
      verifyPaymentSignature({
        orderId,
        paymentId: "pay_Z",
        signature: valid,
      }),
    ).toBe(false);
  });

  it("rejects a length-mismatched signature", () => {
    expect(
      verifyPaymentSignature({ orderId, paymentId, signature: "deadbeef" }),
    ).toBe(false);
  });

  it("rejects a non-hex signature of the right length", () => {
    const nonHex = "z".repeat(valid.length);
    expect(
      verifyPaymentSignature({ orderId, paymentId, signature: nonHex }),
    ).toBe(false);
  });
});

describe("razorpay — verifyWebhookSignature (HMAC fixed vector + fail-closed)", () => {
  const rawBody = JSON.stringify({ event: "payment.captured" });
  const valid = createHmac("sha256", "test_webhook_secret")
    .update(rawBody)
    .digest("hex");

  it("accepts a correctly-signed raw body", () => {
    expect(verifyWebhookSignature(rawBody, valid)).toBe(true);
  });

  it("accepts a Buffer raw body with the same bytes", () => {
    expect(verifyWebhookSignature(Buffer.from(rawBody), valid)).toBe(true);
  });

  it("rejects a byte-mutated body", () => {
    const mutated = `${rawBody} `; // one extra byte
    expect(verifyWebhookSignature(mutated, valid)).toBe(false);
  });

  it("fails closed for an undefined body", () => {
    expect(verifyWebhookSignature(undefined, valid)).toBe(false);
  });

  it("fails closed for an empty body", () => {
    expect(verifyWebhookSignature("", valid)).toBe(false);
    expect(verifyWebhookSignature(Buffer.alloc(0), valid)).toBe(false);
  });
});

describe("razorpay — source uses constant-time compare", () => {
  it("imports and calls timingSafeEqual from node:crypto", () => {
    const src = readFileSync(
      new URL("./razorpay.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("timingSafeEqual");
    expect(src).toMatch(/from "node:crypto"/);
  });
});
