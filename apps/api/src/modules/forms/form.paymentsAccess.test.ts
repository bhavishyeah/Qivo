import { beforeEach, describe, expect, it, vi } from "vitest";

// Allow-list enforcement across the payment path. DB and side-effect services
// are mocked; paymentsAccess.ts is intentionally REAL (reads the env at call time).

const prismaMock = vi.hoisted(() => ({
  form: { findFirst: vi.fn(), update: vi.fn() },
  formResponse: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
  formAnalytics: { create: vi.fn() },
  payment: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
  workspace: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

const razorpayMock = vi.hoisted(() => ({
  createRazorpayOrder: vi.fn(),
  getPublicKeyId: vi.fn(() => "rzp_test_key"),
  isRazorpayConfigured: vi.fn(() => true),
  isValidAmountPaise: vi.fn(() => true),
  verifyPaymentSignature: vi.fn(() => true),
  verifyWebhookSignature: vi.fn(() => true),
  MIN_PAISE: 100,
  MAX_PAISE: 15_000_000,
  paiseToRupees: (paise: number) => paise / 100,
}));

vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));
vi.mock("../../services/razorpay.js", () => razorpayMock);
vi.mock("../../services/email.js", () => ({
  sendNewResponseNotificationEmail: vi.fn(),
  sendResponseConfirmationEmail: vi.fn(),
  sendResponseDigestEmail: vi.fn(),
}));
vi.mock("../../services/webhookDelivery.js", () => ({
  sendWebhooksForResponse: vi.fn(),
  buildResponseCreatedPayload: vi.fn(() => ({})),
  sendFormEventWebhooks: vi.fn(),
}));
vi.mock("../notifications/notification.service.js", () => ({ notifyFormEvent: vi.fn() }));
vi.mock("../audit/audit.service.js", () => ({ logAction: vi.fn() }));
vi.mock("../../services/responseEditToken.js", () => ({
  signEditToken: vi.fn(() => "edit_token"),
  verifyEditToken: vi.fn(),
}));
vi.mock("../formShares/formShare.access.js", () => ({
  hasEditorShare: vi.fn(async () => false),
  hasResponseViewShare: vi.fn(async () => false),
}));

const {
  getPublicForm,
  updateFormSettings,
  createPaymentOrder,
  submitFormResponse,
  handleRazorpayWebhook,
  isWorkspacePaymentsAllowed,
} = await import("./form.service.js");

const OWNER = "owner@example.com";

function setOwner(email: string | null) {
  prismaMock.workspace.findUnique.mockResolvedValue(
    email === null ? null : { owner: { email } },
  );
}

function formRow(settings: Record<string, unknown>) {
  return {
    id: "form_1",
    slug: "my-form",
    title: "T",
    description: null,
    ownerId: "u1",
    workspaceId: "ws_1",
    status: "PUBLISHED",
    workspace: { name: "WS", logoUrl: null, primaryColor: null },
    schema: {
      version: 1,
      sections: [
        {
          id: "s1",
          title: "S",
          questions: [{ id: "q_name", label: "Name", type: "SHORT_TEXT", required: true }],
        },
      ],
      settings,
    },
  };
}

const paidSettings = {
  collectEmail: false,
  allowMultipleResponses: true,
  payment: { enabled: true, mode: "fixed", amount: 50000 },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYMENTS_ALLOWED_OWNER_EMAILS = OWNER;
  setOwner(OWNER);
  razorpayMock.isRazorpayConfigured.mockReturnValue(true);
  razorpayMock.isValidAmountPaise.mockReturnValue(true);
  razorpayMock.verifyPaymentSignature.mockReturnValue(true);
  razorpayMock.verifyWebhookSignature.mockReturnValue(true);
  razorpayMock.createRazorpayOrder.mockResolvedValue({ id: "order_1" });
  prismaMock.formResponse.findFirst.mockResolvedValue(null);
  prismaMock.formResponse.count.mockResolvedValue(0);
  prismaMock.formAnalytics.create.mockResolvedValue({});
  prismaMock.payment.create.mockResolvedValue({});
  prismaMock.form.update.mockImplementation(async (args: unknown) => args);
});

describe("isWorkspacePaymentsAllowed", () => {
  it("is false and skips the DB when the env var is unset (fail closed)", async () => {
    delete process.env.PAYMENTS_ALLOWED_OWNER_EMAILS;
    expect(await isWorkspacePaymentsAllowed("ws_1")).toBe(false);
    expect(prismaMock.workspace.findUnique).not.toHaveBeenCalled();
  });
  it("is true for an allow-listed owner, case-insensitively", async () => {
    process.env.PAYMENTS_ALLOWED_OWNER_EMAILS = " OWNER@Example.com ";
    expect(await isWorkspacePaymentsAllowed("ws_1")).toBe(true);
  });
  it("is false for another owner or a missing workspace", async () => {
    setOwner("someone@else.com");
    expect(await isWorkspacePaymentsAllowed("ws_1")).toBe(false);
    setOwner(null);
    expect(await isWorkspacePaymentsAllowed("ws_1")).toBe(false);
  });
});

describe("updateFormSettings — payments allow-list", () => {
  const base = {
    collectEmail: false,
    allowMultipleResponses: true,
    confirmationMessage: "Thanks",
  };
  const enable = {
    ...base,
    payment: { enabled: true, mode: "fixed" as const, amount: 50000 },
  };
  const disable = {
    ...base,
    payment: { enabled: false, mode: "fixed" as const, amount: 50000 },
  };

  beforeEach(() => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ collectEmail: false, allowMultipleResponses: true }),
    );
  });

  it("rejects enabling for a non-allowed owner with PAYMENTS_NOT_ALLOWED and saves nothing", async () => {
    setOwner("someone@else.com");
    await expect(updateFormSettings("form_1", "u1", enable)).rejects.toMatchObject({
      name: "PAYMENTS_NOT_ALLOWED",
      message:
        "Online payments aren't available for your workspace. You can collect payments with the manual UPI option instead.",
    });
    expect(prismaMock.form.update).not.toHaveBeenCalled();
  });

  it("rejects enabling for everyone when the env var is unset", async () => {
    delete process.env.PAYMENTS_ALLOWED_OWNER_EMAILS;
    await expect(updateFormSettings("form_1", "u1", enable)).rejects.toMatchObject({
      name: "PAYMENTS_NOT_ALLOWED",
    });
    expect(prismaMock.form.update).not.toHaveBeenCalled();
  });

  it("still allows disabling payments for a non-allowed owner", async () => {
    setOwner("someone@else.com");
    await updateFormSettings("form_1", "u1", disable);
    expect(prismaMock.form.update).toHaveBeenCalledTimes(1);
  });

  it("still allows unrelated settings saves for a non-allowed owner", async () => {
    setOwner("someone@else.com");
    await updateFormSettings("form_1", "u1", { ...base, collectEmail: true });
    expect(prismaMock.form.update).toHaveBeenCalledTimes(1);
  });

  it("allows enabling for an allow-listed owner", async () => {
    await updateFormSettings("form_1", "u1", enable);
    expect(prismaMock.form.update).toHaveBeenCalledTimes(1);
  });
});

describe("getPublicForm — payment.configured", () => {
  it("is true for an allowed owner", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow(paidSettings));
    const result = await getPublicForm("my-form");
    expect(result.payment).toMatchObject({ required: true, configured: true });
  });

  it("is false for a non-allowed owner (legacy enabled form) and leaks no emails", async () => {
    setOwner("someone@else.com");
    prismaMock.form.findFirst.mockResolvedValue(formRow(paidSettings));
    const result = await getPublicForm("my-form");
    expect(result.payment).toMatchObject({ required: true, configured: false });
    const json = JSON.stringify(result);
    expect(json).not.toContain("someone@else.com");
    expect(json).not.toContain(OWNER);
  });

  it("is false for everyone when the env var is unset", async () => {
    delete process.env.PAYMENTS_ALLOWED_OWNER_EMAILS;
    prismaMock.form.findFirst.mockResolvedValue(formRow(paidSettings));
    const result = await getPublicForm("my-form");
    expect(result.payment).toMatchObject({ required: true, configured: false });
  });

  it("is false when Razorpay keys are missing even for an allowed owner", async () => {
    razorpayMock.isRazorpayConfigured.mockReturnValue(false);
    prismaMock.form.findFirst.mockResolvedValue(formRow(paidSettings));
    const result = await getPublicForm("my-form");
    expect(result.payment).toMatchObject({ configured: false });
  });

  it("does not query the workspace for a free form", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ collectEmail: false, allowMultipleResponses: true }),
    );
    const result = await getPublicForm("my-form");
    expect(result.payment).toEqual({ required: false });
    expect(prismaMock.workspace.findUnique).not.toHaveBeenCalled();
  });
});

describe("createPaymentOrder — allow-list", () => {
  it("refuses with PAYMENTS_NOT_CONFIGURED and creates no order/Payment for a non-allowed owner", async () => {
    setOwner("someone@else.com");
    prismaMock.form.findFirst.mockResolvedValue(formRow(paidSettings));
    await expect(
      createPaymentOrder("my-form", { answers: { q_name: "Asha" } }),
    ).rejects.toMatchObject({ name: "PAYMENTS_NOT_CONFIGURED" });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("creates the order for an allowed owner (unchanged flow)", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow(paidSettings));
    const result = await createPaymentOrder("my-form", { answers: { q_name: "Asha" } });
    expect(result).toMatchObject({ orderId: "order_1", amount: 50000 });
    expect(prismaMock.payment.create).toHaveBeenCalledTimes(1);
  });
});

describe("submitFormResponse — paid path allow-list", () => {
  const paidInput = {
    answers: { q_name: "Asha" },
    payment: {
      razorpayOrderId: "order_1",
      razorpayPaymentId: "pay_1",
      razorpaySignature: "sig",
    },
  };

  it("throws PAYMENTS_NOT_CONFIGURED and saves NO response for a non-allowed owner", async () => {
    setOwner("someone@else.com");
    prismaMock.form.findFirst.mockResolvedValue(formRow(paidSettings));
    await expect(submitFormResponse("my-form", paidInput)).rejects.toMatchObject({
      name: "PAYMENTS_NOT_CONFIGURED",
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.formResponse.create).not.toHaveBeenCalled();
    expect(razorpayMock.verifyPaymentSignature).not.toHaveBeenCalled();
  });

  it("also throws (never a free save) when no payment is supplied", async () => {
    setOwner("someone@else.com");
    prismaMock.form.findFirst.mockResolvedValue(formRow(paidSettings));
    await expect(
      submitFormResponse("my-form", { answers: { q_name: "Asha" } }),
    ).rejects.toMatchObject({ name: "PAYMENT_REQUIRED" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.formResponse.create).not.toHaveBeenCalled();
  });

  it("throws when the env var is unset, even for the owner", async () => {
    delete process.env.PAYMENTS_ALLOWED_OWNER_EMAILS;
    prismaMock.form.findFirst.mockResolvedValue(formRow(paidSettings));
    await expect(submitFormResponse("my-form", paidInput)).rejects.toMatchObject({
      name: "PAYMENTS_NOT_CONFIGURED",
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("proceeds past the gate for an allowed owner (signature check reached)", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow(paidSettings));
    prismaMock.payment.findUnique.mockResolvedValue({
      formId: "form_1",
      razorpayOrderId: "order_1",
      status: "created",
      responseId: null,
    });
    razorpayMock.verifyPaymentSignature.mockReturnValue(false);
    await expect(submitFormResponse("my-form", paidInput)).rejects.toMatchObject({
      name: expect.not.stringMatching(/^PAYMENTS_NOT_CONFIGURED$/),
    });
    expect(razorpayMock.verifyPaymentSignature).toHaveBeenCalledTimes(1);
  });
});

describe("handleRazorpayWebhook — unaffected by the allow-list", () => {
  it("still reconciles a captured payment when the allow-list is unset", async () => {
    delete process.env.PAYMENTS_ALLOWED_OWNER_EMAILS;
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test";
    prismaMock.payment.findUnique.mockResolvedValue({
      razorpayOrderId: "order_1",
      razorpayPaymentId: null,
      amount: 50000,
      status: "created",
      notes: {},
    });
    prismaMock.payment.update.mockResolvedValue({});
    await handleRazorpayWebhook(Buffer.from("{}"), "sig", {
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 50000 } } },
    });
    expect(prismaMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { razorpayOrderId: "order_1" },
        data: expect.objectContaining({ status: "paid" }),
      }),
    );
    expect(prismaMock.workspace.findUnique).not.toHaveBeenCalled();
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });
});
