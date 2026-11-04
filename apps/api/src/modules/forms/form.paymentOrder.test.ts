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
  isValidAmountPaise: vi.fn(() => true),
  verifyPaymentSignature: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}));

vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));
vi.mock("../../services/razorpay.js", () => razorpayMock);

const { createPaymentOrder, isValidPhoneNumber } = await import("./form.service.js");

function formRow(opts: {
  paid?: boolean;
  collectEmail?: boolean;
  allowMultipleResponses?: boolean;
}) {
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
        ...(opts.paid === false ? {} : { payment: { enabled: true, amount: 50000 } }),
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
