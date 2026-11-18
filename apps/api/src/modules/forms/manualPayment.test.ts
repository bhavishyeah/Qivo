import { describe, expect, it } from "vitest";

import {
  buildManualPaymentRecord,
  getActiveManualUpi,
  isValidManualAmountPaise,
  isValidPayeeName,
  isValidUpiId,
  isValidUtr,
  normalizeManualUpiInput,
  normalizeUtr,
  readManualPayment,
  stripReservedMetadata,
} from "./manualPayment.js";

describe("isValidUpiId", () => {
  it.each(["name@okicici", "9876543210@ybl", "a.b-c_d@paytm"])("accepts %s", (v) => {
    expect(isValidUpiId(v)).toBe(true);
  });
  it.each([
    "noatsign",
    "@ybl",
    "a@ybl",
    "ab@1bank",
    "a b@ybl",
    " ab@ybl",
    "ab@@ybl",
    "nämé@ybl",
    `${"a".repeat(65)}@ybl`,
    "ab@",
  ])("rejects %j", (v) => {
    expect(isValidUpiId(v)).toBe(false);
  });
});

describe("UTR helpers", () => {
  it("validates length and charset", () => {
    expect(isValidUtr("1234567")).toBe(false);
    expect(isValidUtr("12345678")).toBe(true);
    expect(isValidUtr("A".repeat(35))).toBe(true);
    expect(isValidUtr("A".repeat(36))).toBe(false);
    expect(isValidUtr("1234-5678")).toBe(false);
    expect(isValidUtr("  12345678  ")).toBe(true);
  });
  it("normalizes to trimmed uppercase", () => {
    expect(normalizeUtr("  ab12cd34ef ")).toBe("AB12CD34EF");
  });
});

describe("amount and payee validation", () => {
  it("bounds amount paise", () => {
    expect(isValidManualAmountPaise(99)).toBe(false);
    expect(isValidManualAmountPaise(100)).toBe(true);
    expect(isValidManualAmountPaise(15_000_000)).toBe(true);
    expect(isValidManualAmountPaise(15_000_001)).toBe(false);
    expect(isValidManualAmountPaise(100.5)).toBe(false);
    expect(isValidManualAmountPaise("100")).toBe(false);
  });
  it("rejects control chars and empty payee names", () => {
    expect(isValidPayeeName("Asha")).toBe(true);
    expect(isValidPayeeName("   ")).toBe(false);
    expect(isValidPayeeName("A\u0007")).toBe(false);
    expect(isValidPayeeName("x".repeat(61))).toBe(false);
  });
});

describe("normalizeManualUpiInput", () => {
  it("omits empty optional fields", () => {
    expect(
      normalizeManualUpiInput({ enabled: false, requireScreenshot: true }),
    ).toEqual({ enabled: false, requireScreenshot: true });
  });
  it("trims and keeps provided fields", () => {
    expect(
      normalizeManualUpiInput({
        enabled: true,
        upiId: " a@ybl ",
        payeeName: " A ",
        amount: 5000,
        instructions: " hi ",
        requireScreenshot: false,
      }),
    ).toEqual({
      enabled: true,
      upiId: "a@ybl",
      payeeName: "A",
      amount: 5000,
      instructions: "hi",
      requireScreenshot: false,
    });
  });
});

describe("getActiveManualUpi", () => {
  const valid = {
    enabled: true,
    upiId: "name@okicici",
    payeeName: "Asha",
    requireScreenshot: true,
  };
  it("returns null when missing or disabled", () => {
    expect(getActiveManualUpi({})).toBeNull();
    expect(getActiveManualUpi({ manualUpi: { ...valid, enabled: false } })).toBeNull();
  });
  it("returns null when Razorpay is enabled", () => {
    expect(
      getActiveManualUpi({ manualUpi: valid, payment: { enabled: true } }),
    ).toBeNull();
  });
  it("returns null for invalid stored values", () => {
    expect(getActiveManualUpi({ manualUpi: { ...valid, upiId: "bad" } })).toBeNull();
    expect(getActiveManualUpi({ manualUpi: { ...valid, payeeName: "" } })).toBeNull();
  });
  it("returns exactly the whitelisted shape", () => {
    const r = getActiveManualUpi({
      manualUpi: { ...valid, amount: 5000, instructions: "Pay now", secret: "x" },
    });
    expect(r).toEqual({
      upiId: "name@okicici",
      payeeName: "Asha",
      requireScreenshot: true,
      amount: 5000,
      instructions: "Pay now",
    });
  });
});

describe("stripReservedMetadata", () => {
  it("removes manualPayment without mutating the input", () => {
    const input = { manualPayment: { status: "verified" }, source: "web" };
    const r = stripReservedMetadata(input);
    expect(r.metadata).toEqual({ source: "web" });
    expect(r.stripped).toBe(true);
    expect(input).toHaveProperty("manualPayment");
  });
  it("handles undefined and clean metadata", () => {
    expect(stripReservedMetadata(undefined)).toEqual({ metadata: {}, stripped: false });
    expect(stripReservedMetadata({ a: 1 })).toEqual({ metadata: { a: 1 }, stripped: false });
  });
});

describe("buildManualPaymentRecord", () => {
  const now = new Date("2025-01-01T10:00:00.000Z");
  it("is always pending and takes amount only from config", () => {
    const r = buildManualPaymentRecord({
      utr: "ABC12345678",
      proofUrl: "https://res.cloudinary.com/c/image/upload/a.jpg",
      config: { amount: 5000 },
      now,
    });
    expect(r).toEqual({
      utr: "ABC12345678",
      proofUrl: "https://res.cloudinary.com/c/image/upload/a.jpg",
      amount: 5000,
      status: "pending",
      submittedAt: "2025-01-01T10:00:00.000Z",
    });
  });
  it("omits proofUrl and amount when absent", () => {
    const r = buildManualPaymentRecord({ utr: "ABC12345678", config: {}, now });
    expect(r).not.toHaveProperty("amount");
    expect(r).not.toHaveProperty("proofUrl");
  });
});

describe("readManualPayment", () => {
  it("returns null for garbage", () => {
    expect(readManualPayment(null)).toBeNull();
    expect(readManualPayment({})).toBeNull();
    expect(readManualPayment({ manualPayment: "x" })).toBeNull();
    expect(readManualPayment({ manualPayment: { utr: "" } })).toBeNull();
  });
  it("defaults unknown status to pending", () => {
    expect(
      readManualPayment({ manualPayment: { utr: "ABC12345678", status: "weird" } })?.status,
    ).toBe("pending");
  });
});
