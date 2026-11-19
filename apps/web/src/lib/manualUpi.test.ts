import { describe, it, expect } from "vitest";
import {
  buildUpiUri,
  formatInr,
  formatSummary,
  getManualPayment,
  isValidPayeeName,
  isValidUpiId,
  isValidUtr,
  neutralizeFormula,
  normalizeUtr,
  paiseToRupeesInput,
  rupeesToPaise,
  summarizeManualPayments,
  toPublicManualUpi,
  validateManualPayment,
} from "./manualUpi";

describe("isValidUpiId (parity with API)", () => {
  it.each(["name@okicici", "9876543210@ybl", "a.b-c_d@paytm"])("accepts %s", (v) => {
    expect(isValidUpiId(v)).toBe(true);
  });
  it.each([
    "noatsign",
    "@ybl",
    "a@ybl",
    "name@1bank",
    "a b@ybl",
    " ab@ybl",
    "naïve@ybl",
    "ab@@ybl",
    `${"a".repeat(65)}@ybl`,
  ])("rejects %j", (v) => {
    expect(isValidUpiId(v)).toBe(false);
  });
});

describe("isValidUtr / normalizeUtr", () => {
  it("enforces 8..35 alphanumerics after trim", () => {
    expect(isValidUtr("1234567")).toBe(false);
    expect(isValidUtr("12345678")).toBe(true);
    expect(isValidUtr("a".repeat(35))).toBe(true);
    expect(isValidUtr("a".repeat(36))).toBe(false);
    expect(isValidUtr("1234-5678")).toBe(false);
    expect(isValidUtr("1234 5678")).toBe(false);
    expect(isValidUtr("  12345678  ")).toBe(true);
  });
  it("uppercases and trims", () => {
    expect(normalizeUtr("  ab12cd34 ")).toBe("AB12CD34");
  });
});

describe("isValidPayeeName", () => {
  it("bounds and control chars", () => {
    expect(isValidPayeeName("Asha")).toBe(true);
    expect(isValidPayeeName("   ")).toBe(false);
    expect(isValidPayeeName("a".repeat(61))).toBe(false);
    expect(isValidPayeeName("bad\nname")).toBe(false);
  });
});

describe("buildUpiUri", () => {
  it("builds exact string with amount and note", () => {
    expect(
      buildUpiUri({ upiId: "name@ybl", payeeName: "Asha", amountPaise: 5050, note: "Fest" }),
    ).toBe("upi://pay?pa=name%40ybl&pn=Asha&cu=INR&am=50.50&tn=Fest");
  });
  it("omits am and tn when absent", () => {
    expect(buildUpiUri({ upiId: "name@ybl", payeeName: "Asha" })).toBe(
      "upi://pay?pa=name%40ybl&pn=Asha&cu=INR",
    );
  });
  it("encodes hostile payee and note values", () => {
    const uri = buildUpiUri({
      upiId: "name@ybl",
      payeeName: "A&B=C #1",
      note: "Fee & more 🎉",
    });
    expect(uri).toContain("pn=A%26B%3DC%20%231");
    expect(uri).toContain("tn=Fee%20%26%20more%20%F0%9F%8E%89");
    expect(uri.split("&")).toHaveLength(4);
  });
  it("omits an invalid amount without throwing", () => {
    for (const a of [0, -5, 1.5, NaN, Infinity]) {
      expect(buildUpiUri({ upiId: "a1@ybl", payeeName: "X", amountPaise: a })).not.toContain("am=");
    }
  });
  it("keeps a constant scheme even if payee contains ://", () => {
    expect(buildUpiUri({ upiId: "a1@ybl", payeeName: "evil://x" }).startsWith("upi://pay?pa=")).toBe(true);
  });
});

describe("rupees/paise", () => {
  it("rupeesToPaise", () => {
    expect(rupeesToPaise("50")).toBe(5000);
    expect(rupeesToPaise("50.5")).toBe(5050);
    expect(rupeesToPaise("50.55")).toBe(5055);
    expect(rupeesToPaise("50.555")).toBeNull();
    expect(rupeesToPaise("0.5")).toBeNull();
    expect(rupeesToPaise("150001")).toBeNull();
    expect(rupeesToPaise("150000")).toBe(15_000_000);
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
  });
  it("paiseToRupeesInput", () => {
    expect(paiseToRupeesInput(5000)).toBe("50");
    expect(paiseToRupeesInput(5050)).toBe("50.50");
    expect(paiseToRupeesInput(5005)).toBe("50.05");
  });
  it("formatInr", () => {
    expect(formatInr(150000)).toBe("₹1,500.00");
  });
});

describe("toPublicManualUpi", () => {
  const base = { collectEmail: false, allowMultipleResponses: true };
  it("returns null when disabled, Razorpay on, or invalid", () => {
    expect(toPublicManualUpi({ ...base })).toBeNull();
    expect(
      toPublicManualUpi({ ...base, manualUpi: { enabled: false, requireScreenshot: true } }),
    ).toBeNull();
    expect(
      toPublicManualUpi({
        ...base,
        payment: { enabled: true, mode: "fixed", amount: 100 },
        manualUpi: { enabled: true, upiId: "a1@ybl", payeeName: "X", requireScreenshot: true },
      }),
    ).toBeNull();
    expect(
      toPublicManualUpi({
        ...base,
        manualUpi: { enabled: true, upiId: "bad", payeeName: "X", requireScreenshot: true },
      }),
    ).toBeNull();
  });
  it("returns only the whitelisted keys", () => {
    const out = toPublicManualUpi({
      ...base,
      manualUpi: {
        enabled: true,
        upiId: "a1@ybl",
        payeeName: "Asha",
        amount: 5000,
        instructions: "Hi",
        requireScreenshot: false,
      },
    });
    expect(Object.keys(out!).sort()).toEqual(
      ["amount", "enabled", "instructions", "payeeName", "requireScreenshot", "upiId"].sort(),
    );
    expect(out!.requireScreenshot).toBe(false);
  });
});

describe("validateManualPayment", () => {
  it("returns messages", () => {
    expect(validateManualPayment({ utr: "", proofUrl: "" }, true)).toEqual({
      utr: "Enter the UTR from your payment app.",
      proof: "Upload a screenshot of your payment.",
    });
    expect(validateManualPayment({ utr: "ab 12", proofUrl: "" }, false).utr).toMatch(/valid UTR/);
    expect(validateManualPayment({ utr: "AB12CD34", proofUrl: "" }, false)).toEqual({});
    expect(validateManualPayment({ utr: "AB12CD34", proofUrl: "https://x" }, true)).toEqual({});
  });
});

describe("getManualPayment", () => {
  it("returns null for garbage", () => {
    expect(getManualPayment(null)).toBeNull();
    expect(getManualPayment({})).toBeNull();
    expect(getManualPayment({ manualPayment: "x" })).toBeNull();
    expect(getManualPayment({ manualPayment: { utr: "" } })).toBeNull();
  });
  it("defaults garbage status to pending and drops non-https proof", () => {
    const mp = getManualPayment({
      manualPayment: { utr: "ABC12345", status: "weird", proofUrl: "javascript:alert(1)" },
    });
    expect(mp?.status).toBe("pending");
    expect(mp?.proofUrl).toBeUndefined();
  });
  it("keeps valid fields", () => {
    const mp = getManualPayment({
      manualPayment: {
        utr: "ABC12345",
        status: "verified",
        proofUrl: "https://res.cloudinary.com/x/image/upload/a.jpg",
        amount: 5000,
        submittedAt: "t",
      },
    });
    expect(mp).toMatchObject({ status: "verified", amount: 5000 });
    expect(mp?.proofUrl).toBeDefined();
  });
});

describe("summaries", () => {
  it("counts and formats", () => {
    const c = summarizeManualPayments([
      { metadata: { manualPayment: { utr: "AAAAAAAA", status: "verified" } } },
      { metadata: { manualPayment: { utr: "BBBBBBBB", status: "pending" } } },
      { metadata: { manualPayment: { utr: "CCCCCCCC", status: "pending" } } },
      { metadata: null },
    ]);
    expect(c).toEqual({ pending: 2, verified: 1, rejected: 0 });
    expect(formatSummary({ pending: 3, verified: 12, rejected: 1 })).toBe(
      "12 verified · 3 pending · 1 rejected",
    );
  });
});

describe("neutralizeFormula", () => {
  it.each(["=1+1", "+1", "-1", "@SUM", "\tx", "\rx"])("prefixes %j", (v) => {
    expect(neutralizeFormula(v)).toBe(`'${v}`);
  });
  it("leaves safe text alone", () => {
    expect(neutralizeFormula("ABC123")).toBe("ABC123");
    expect(neutralizeFormula("")).toBe("");
  });
});
