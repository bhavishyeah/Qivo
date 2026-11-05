import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB and Razorpay so no real network/DB call can happen.
const prismaMock = vi.hoisted(() => ({
  form: { findFirst: vi.fn() },
  formResponse: { findFirst: vi.fn() },
  payment: { create: vi.fn() },
}));
const razorpayMock = vi.hoisted(() => ({
  createRazorpayOrder: vi.fn(),
  getPublicKeyId: vi.fn(() => "rzp_test_key"),
  isRazorpayConfigured: vi.fn(() => true),
  isValidAmountPaise: vi.fn((_p: unknown) => true),
  verifyPaymentSignature: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  // Global paise bounds + rupee formatter used by the respondent-mode switch.
  MIN_PAISE: 100,
  MAX_PAISE: 15_000_000,
  paiseToRupees: (paise: number) => paise / 100,
}));

vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));
vi.mock("../../services/razorpay.js", () => razorpayMock);

const { createPaymentOrder, isValidPhoneNumber } = await import("./form.service.js");

function formRow(opts: {
  paid?: boolean;
  collectEmail?: boolean;
  allowMultipleResponses?: boolean;
  // Override the stored payment block (respondent mode, legacy-no-mode, etc.).
  // When omitted, defaults to the fixed-amount block (back-compat shape).
  payment?: Record<string, unknown>;
}) {
  const paymentBlock =
    opts.payment !== undefined
      ? opts.payment
      : { enabled: true, amount: 50000 };
  return {
    id: "form_1",
    slug: "my-form",
    schema: {
      version: 1,
      sections: [
        {
          id: "s1",
          title: "S",
          questions: [
            { id: "q_name", label: "Name", type: "SHORT_TEXT", required: true },
            { id: "q_phone", label: "Phone", type: "PHONE", required: false },
          ],
        },
      ],
      settings: {
        collectEmail: opts.collectEmail ?? true,
        allowMultipleResponses: opts.allowMultipleResponses ?? true,
        ...(opts.paid === false ? {} : { payment: paymentBlock }),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  razorpayMock.isRazorpayConfigured.mockReturnValue(true);
  razorpayMock.isValidAmountPaise.mockReturnValue(true);
  razorpayMock.createRazorpayOrder.mockResolvedValue({ id: "order_1" });
  prismaMock.formResponse.findFirst.mockResolvedValue(null);
  prismaMock.payment.create.mockResolvedValue({});
});

describe("createPaymentOrder — pre-validation before any order", () => {
  it("creates an order for a valid submission", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({}));
    const result = await createPaymentOrder("my-form", {
      answers: { q_name: "Asha", q_phone: "+91 98765 43210" },
      email: "Asha@Example.com",
    });
    expect(result.orderId).toBe("order_1");
    expect(result.amount).toBe(50000);
    expect(razorpayMock.createRazorpayOrder).toHaveBeenCalledTimes(1);
    expect(prismaMock.payment.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing email with EMAIL_REQUIRED and creates NO order", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({}));
    await expect(
      createPaymentOrder("my-form", { answers: { q_name: "Asha" } }),
    ).rejects.toMatchObject({ name: "EMAIL_REQUIRED" });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("rejects a missing required answer with INVALID_RESPONSE and creates NO order", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({}));
    await expect(
      createPaymentOrder("my-form", { answers: {}, email: "a@example.com" }),
    ).rejects.toMatchObject({
      name: "INVALID_RESPONSE",
      message: "Answer required for question: Name",
    });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid per-question value (bad phone) and creates NO order", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({}));
    await expect(
      createPaymentOrder("my-form", {
        answers: { q_name: "Asha", q_phone: "rewrwe" },
        email: "a@example.com",
      }),
    ).rejects.toMatchObject({
      name: "INVALID_RESPONSE",
      message: 'Invalid answer for "Phone": invalid phone number',
    });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email on a single-response form and creates NO order", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ allowMultipleResponses: false }),
    );
    prismaMock.formResponse.findFirst.mockResolvedValue({ id: "resp_1" });
    await expect(
      createPaymentOrder("my-form", {
        answers: { q_name: "Asha" },
        email: " A@Example.com ",
      }),
    ).rejects.toMatchObject({ name: "DUPLICATE_RESPONSE" });
    // Looked up with the normalized email.
    expect(prismaMock.formResponse.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { formId: "form_1", respondentEmail: "a@example.com" },
      }),
    );
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("does not touch the duplicate table when multiple responses are allowed", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({}));
    await createPaymentOrder("my-form", {
      answers: { q_name: "Asha" },
      email: "a@example.com",
    });
    expect(prismaMock.formResponse.findFirst).not.toHaveBeenCalled();
  });

  it("leaves free forms untouched: PAYMENT_NOT_REQUIRED, no order", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({ paid: false }));
    await expect(
      createPaymentOrder("my-form", { answers: {}, email: "a@example.com" }),
    ).rejects.toMatchObject({ name: "PAYMENT_NOT_REQUIRED" });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
  });
});

describe("createPaymentOrder — respondent mode", () => {
  const validAnswers = { q_name: "Asha" };

  it("accepts a valid in-range requestedAmount, creates the order with it, and snapshots it", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        payment: {
          enabled: true,
          mode: "respondent",
          minAmount: 10000, // ₹100
          maxAmount: 500000, // ₹5000
        },
      }),
    );
    const result = await createPaymentOrder("my-form", {
      answers: validAnswers,
      email: "a@example.com",
      requestedAmount: 25000, // ₹250, in range
    });
    expect(result.amount).toBe(25000);
    // Razorpay order created with the validated amount.
    expect(razorpayMock.createRazorpayOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaise: 25000 }),
    );
    // Payment row snapshots the validated amount.
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 25000 }),
      }),
    );
  });

  it("accepts exactly the min and max bounds (inclusive)", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        payment: { enabled: true, mode: "respondent", minAmount: 10000, maxAmount: 500000 },
      }),
    );
    const atMin = await createPaymentOrder("my-form", {
      answers: validAnswers,
      email: "a@example.com",
      requestedAmount: 10000,
    });
    expect(atMin.amount).toBe(10000);

    vi.clearAllMocks();
    razorpayMock.isRazorpayConfigured.mockReturnValue(true);
    razorpayMock.isValidAmountPaise.mockReturnValue(true);
    razorpayMock.createRazorpayOrder.mockResolvedValue({ id: "order_2" });
    prismaMock.formResponse.findFirst.mockResolvedValue(null);
    prismaMock.payment.create.mockResolvedValue({});
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        payment: { enabled: true, mode: "respondent", minAmount: 10000, maxAmount: 500000 },
      }),
    );
    const atMax = await createPaymentOrder("my-form", {
      answers: validAnswers,
      email: "a@example.com",
      requestedAmount: 500000,
    });
    expect(atMax.amount).toBe(500000);
  });

  it("falls back to the global [₹1, ₹1,50,000] range when bounds are unset", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ payment: { enabled: true, mode: "respondent" } }),
    );
    const result = await createPaymentOrder("my-form", {
      answers: validAnswers,
      email: "a@example.com",
      requestedAmount: 100, // global floor ₹1
    });
    expect(result.amount).toBe(100);
  });

  it("rejects below-min with PAYMENT_AMOUNT_INVALID and creates NO order", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ payment: { enabled: true, mode: "respondent", minAmount: 10000, maxAmount: 500000 } }),
    );
    await expect(
      createPaymentOrder("my-form", {
        answers: validAnswers,
        email: "a@example.com",
        requestedAmount: 9999,
      }),
    ).rejects.toMatchObject({ name: "PAYMENT_AMOUNT_INVALID" });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("rejects above-max with PAYMENT_AMOUNT_INVALID and creates NO order", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ payment: { enabled: true, mode: "respondent", minAmount: 10000, maxAmount: 500000 } }),
    );
    await expect(
      createPaymentOrder("my-form", {
        answers: validAnswers,
        email: "a@example.com",
        requestedAmount: 500001,
      }),
    ).rejects.toMatchObject({ name: "PAYMENT_AMOUNT_INVALID" });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("rejects a non-integer requestedAmount (service guard) and creates NO order", async () => {
    // Make the amount validator reflect real integer-checking for this case.
    razorpayMock.isValidAmountPaise.mockImplementation(
      (p: unknown) =>
        typeof p === "number" && Number.isInteger(p) && p >= 100 && p <= 15_000_000,
    );
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ payment: { enabled: true, mode: "respondent", minAmount: 10000, maxAmount: 500000 } }),
    );
    await expect(
      createPaymentOrder("my-form", {
        answers: validAnswers,
        email: "a@example.com",
        requestedAmount: 25000.5,
      }),
    ).rejects.toMatchObject({ name: "PAYMENT_AMOUNT_INVALID" });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("rejects an out-of-global-bounds requestedAmount and creates NO order", async () => {
    razorpayMock.isValidAmountPaise.mockImplementation(
      (p: unknown) =>
        typeof p === "number" && Number.isInteger(p) && p >= 100 && p <= 15_000_000,
    );
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ payment: { enabled: true, mode: "respondent" } }),
    );
    await expect(
      createPaymentOrder("my-form", {
        answers: validAnswers,
        email: "a@example.com",
        requestedAmount: 15_000_001, // above global max
      }),
    ).rejects.toMatchObject({ name: "PAYMENT_AMOUNT_INVALID" });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("rejects a missing requestedAmount with PAYMENT_AMOUNT_INVALID and creates NO order", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ payment: { enabled: true, mode: "respondent", minAmount: 10000 } }),
    );
    await expect(
      createPaymentOrder("my-form", {
        answers: validAnswers,
        email: "a@example.com",
      }),
    ).rejects.toMatchObject({ name: "PAYMENT_AMOUNT_INVALID" });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });
});

describe("createPaymentOrder — fixed mode & back-compat", () => {
  it("fixed mode ignores a client requestedAmount and uses settings.amount", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ payment: { enabled: true, mode: "fixed", amount: 50000 } }),
    );
    const result = await createPaymentOrder("my-form", {
      answers: { q_name: "Asha" },
      email: "a@example.com",
      requestedAmount: 999999, // must be ignored
    });
    expect(result.amount).toBe(50000);
    expect(razorpayMock.createRazorpayOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaise: 50000 }),
    );
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 50000 }) }),
    );
  });

  it("legacy row { enabled, amount } with no mode charges as fixed and ignores requestedAmount", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ payment: { enabled: true, amount: 50000 } }),
    );
    const result = await createPaymentOrder("my-form", {
      answers: { q_name: "Asha" },
      email: "a@example.com",
      requestedAmount: 12345, // ignored on a legacy/fixed form
    });
    expect(result.amount).toBe(50000);
    expect(razorpayMock.createRazorpayOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaise: 50000 }),
    );
  });

  it("a respondent form with only minAmount (no amount) survives normalization (not dropped)", async () => {
    // If the normalizer dropped the amount-less respondent block, this would
    // throw PAYMENT_NOT_REQUIRED instead of validating the respondent amount.
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ payment: { enabled: true, mode: "respondent", minAmount: 10000 } }),
    );
    const result = await createPaymentOrder("my-form", {
      answers: { q_name: "Asha" },
      email: "a@example.com",
      requestedAmount: 20000,
    });
    expect(result.amount).toBe(20000);
  });
});

describe("paymentOrderSchema — requestedAmount Zod gate", () => {
  it("rejects a non-integer requestedAmount at the schema boundary", async () => {
    const { paymentOrderSchema } = await import("./form.schemas.js");
    const parsed = paymentOrderSchema.safeParse({
      answers: {},
      requestedAmount: 25000.5,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an out-of-global-range requestedAmount at the schema boundary", async () => {
    const { paymentOrderSchema } = await import("./form.schemas.js");
    expect(
      paymentOrderSchema.safeParse({ answers: {}, requestedAmount: 99 }).success,
    ).toBe(false);
    expect(
      paymentOrderSchema.safeParse({ answers: {}, requestedAmount: 15_000_001 })
        .success,
    ).toBe(false);
  });

  it("accepts a valid in-global-range integer requestedAmount", async () => {
    const { paymentOrderSchema } = await import("./form.schemas.js");
    expect(
      paymentOrderSchema.safeParse({ answers: {}, requestedAmount: 25000 }).success,
    ).toBe(true);
  });
});

describe("isValidPhoneNumber — lenient phone rule", () => {
  it.each(["+91 98765 43210", "(555) 123-4567", "555.123.4567", "1234567", "+44 20 7946 0958"])(
    "accepts %s",
    (value) => expect(isValidPhoneNumber(value)).toBe(true),
  );

  it.each(["rewrwe", "123456", "1234567890123456", "555-CALL-NOW", "12345 ext 6", "+++", ""])(
    "rejects %s",
    (value) => expect(isValidPhoneNumber(value)).toBe(false),
  );

  it("accepts exactly 7 and 15 digits, rejects 6 and 16", () => {
    expect(isValidPhoneNumber("1".repeat(7))).toBe(true);
    expect(isValidPhoneNumber("1".repeat(15))).toBe(true);
    expect(isValidPhoneNumber("1".repeat(6))).toBe(false);
    expect(isValidPhoneNumber("1".repeat(16))).toBe(false);
  });
});
