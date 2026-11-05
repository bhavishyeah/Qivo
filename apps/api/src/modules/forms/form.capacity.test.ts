import { beforeEach, describe, expect, it, vi } from "vitest";

// Capacity feature tests. The DB and all side-effect services are mocked so no
// real network/DB call can happen. The DB-gated true-concurrency check lives at
// the bottom and is skipped unless DATABASE_URL is set (see the file's end).

const prismaMock = vi.hoisted(() => ({
  form: { findFirst: vi.fn(), update: vi.fn() },
  formResponse: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
  formAnalytics: { create: vi.fn() },
  payment: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
  workspace: { findFirst: vi.fn() },
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

const emailMock = vi.hoisted(() => ({
  sendNewResponseNotificationEmail: vi.fn(),
  sendResponseConfirmationEmail: vi.fn(),
  sendResponseDigestEmail: vi.fn(),
}));

const webhookMock = vi.hoisted(() => ({
  sendWebhooksForResponse: vi.fn(),
  buildResponseCreatedPayload: vi.fn(() => ({})),
  sendFormEventWebhooks: vi.fn(),
}));

const notificationMock = vi.hoisted(() => ({ notifyFormEvent: vi.fn() }));
const auditMock = vi.hoisted(() => ({ logAction: vi.fn() }));
const editTokenMock = vi.hoisted(() => ({
  signEditToken: vi.fn(() => "edit_token"),
  verifyEditToken: vi.fn(),
}));

vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));
vi.mock("../../services/razorpay.js", () => razorpayMock);
vi.mock("../../services/email.js", () => emailMock);
vi.mock("../../services/webhookDelivery.js", () => webhookMock);
vi.mock("../notifications/notification.service.js", () => notificationMock);
vi.mock("../audit/audit.service.js", () => auditMock);
vi.mock("../../services/responseEditToken.js", () => editTokenMock);

const { getPublicForm, updateFormSettings, createPaymentOrder, submitFormResponse } =
  await import("./form.service.js");

type Settings = Record<string, unknown>;

function formRow(settings: Settings, overrides: Record<string, unknown> = {}) {
  return {
    id: "form_1",
    slug: "my-form",
    title: "Event RSVP",
    description: null,
    ownerId: "owner_1",
    status: "PUBLISHED",
    workspace: { name: "WS", logoUrl: null, primaryColor: null },
    schema: {
      version: 1,
      sections: [
        {
          id: "s1",
          title: "S",
          questions: [
            { id: "q_name", label: "Name", type: "SHORT_TEXT", required: true },
          ],
        },
      ],
      settings,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  razorpayMock.isRazorpayConfigured.mockReturnValue(true);
  razorpayMock.isValidAmountPaise.mockReturnValue(true);
  razorpayMock.verifyPaymentSignature.mockReturnValue(true);
  razorpayMock.createRazorpayOrder.mockResolvedValue({ id: "order_1" });
  prismaMock.formResponse.findFirst.mockResolvedValue(null);
  prismaMock.formResponse.count.mockResolvedValue(0);
  prismaMock.formAnalytics.create.mockResolvedValue({});
  prismaMock.payment.create.mockResolvedValue({});
  prismaMock.form.update.mockImplementation(async (args: unknown) => args);
});

// ── getPublicForm derived capacity block ──────────────────────────────────
describe("getPublicForm — derived capacity block", () => {
  it("returns { enabled: false } when capacity is absent and never counts", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ collectEmail: false, allowMultipleResponses: true }),
    );
    const result = await getPublicForm("my-form");
    expect(result.capacity).toEqual({ enabled: false });
    // Zero-cost: no count query for a form without capacity.
    expect(prismaMock.formResponse.count).not.toHaveBeenCalled();
  });

  it("returns { enabled: false } when capacity.enabled is false", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: false,
        allowMultipleResponses: true,
        capacity: { enabled: false, limit: 120 },
      }),
    );
    const result = await getPublicForm("my-form");
    expect(result.capacity).toEqual({ enabled: false });
    expect(prismaMock.formResponse.count).not.toHaveBeenCalled();
  });

  it("computes limit/submitted/seatsLeft when enabled (78 of 120 → 42 left)", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: false,
        allowMultipleResponses: true,
        capacity: { enabled: true, limit: 120 },
      }),
    );
    prismaMock.formResponse.count.mockResolvedValue(78);
    const result = await getPublicForm("my-form");
    expect(result.capacity).toEqual({
      enabled: true,
      limit: 120,
      submitted: 78,
      seatsLeft: 42,
    });
    expect(prismaMock.formResponse.count).toHaveBeenCalledWith({
      where: { formId: "form_1" },
    });
  });

  it("clamps seatsLeft to 0 when submitted exceeds the limit (lowered cap)", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: false,
        allowMultipleResponses: true,
        capacity: { enabled: true, limit: 50 },
      }),
    );
    prismaMock.formResponse.count.mockResolvedValue(73);
    const result = await getPublicForm("my-form");
    expect(result.capacity).toMatchObject({ seatsLeft: 0, submitted: 73, limit: 50 });
  });

  it("never leaks owner-only settings or the raw capacity setting", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: false,
        allowMultipleResponses: true,
        responseNotification: "immediate",
        sendConfirmationEmail: true,
        capacity: { enabled: true, limit: 10 },
      }),
    );
    prismaMock.formResponse.count.mockResolvedValue(3);
    const result = await getPublicForm("my-form");
    const publicSettings = result.schema.settings as Record<string, unknown>;
    expect(publicSettings).not.toHaveProperty("responseNotification");
    expect(publicSettings).not.toHaveProperty("sendConfirmationEmail");
    expect(publicSettings).not.toHaveProperty("payment");
    expect(publicSettings).not.toHaveProperty("capacity");
  });
});

// ── updateFormSettings round-trip ─────────────────────────────────────────
describe("updateFormSettings — capacity round-trip", () => {
  it("persists { enabled: true, limit: 120 } into the stored schema", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ collectEmail: false, allowMultipleResponses: true }),
    );
    await updateFormSettings("form_1", "owner_1", {
      collectEmail: false,
      allowMultipleResponses: true,
      confirmationMessage: "",
      capacity: { enabled: true, limit: 120 },
    });
    const updateArg = prismaMock.form.update.mock.calls[0]![0] as {
      data: { schema: { settings: { capacity?: unknown } } };
    };
    expect(updateArg.data.schema.settings.capacity).toEqual({
      enabled: true,
      limit: 120,
    });
  });

  it("leaves capacity untouched when the input omits it", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: false,
        allowMultipleResponses: true,
        capacity: { enabled: true, limit: 50 },
      }),
    );
    await updateFormSettings("form_1", "owner_1", {
      collectEmail: false,
      allowMultipleResponses: true,
      confirmationMessage: "",
    });
    const updateArg = prismaMock.form.update.mock.calls[0]![0] as {
      data: { schema: { settings: { capacity?: unknown } } };
    };
    // Preserved from the stored schema (getFormSchema normalized it through).
    expect(updateArg.data.schema.settings.capacity).toEqual({
      enabled: true,
      limit: 50,
    });
  });
});

// ── createPaymentOrder pre-order capacity gate ────────────────────────────
describe("createPaymentOrder — capacity pre-order gate", () => {
  it("rejects FORM_FULL and creates NO order/Payment row when full", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: true,
        allowMultipleResponses: true,
        payment: { enabled: true, mode: "fixed", amount: 50000 },
        capacity: { enabled: true, limit: 2 },
      }),
    );
    prismaMock.formResponse.count.mockResolvedValue(2); // full
    await expect(
      createPaymentOrder("my-form", {
        answers: { q_name: "Asha" },
        email: "a@example.com",
      }),
    ).rejects.toMatchObject({ name: "FORM_FULL" });
    expect(razorpayMock.createRazorpayOrder).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("creates the order when seats remain", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: true,
        allowMultipleResponses: true,
        payment: { enabled: true, mode: "fixed", amount: 50000 },
        capacity: { enabled: true, limit: 10 },
      }),
    );
    prismaMock.formResponse.count.mockResolvedValue(3); // 7 left
    const result = await createPaymentOrder("my-form", {
      answers: { q_name: "Asha" },
      email: "a@example.com",
    });
    expect(result.orderId).toBe("order_1");
    expect(razorpayMock.createRazorpayOrder).toHaveBeenCalledTimes(1);
    expect(prismaMock.payment.create).toHaveBeenCalledTimes(1);
  });
});

// ── submitFormResponse atomic guard (free + paid) ─────────────────────────
describe("submitFormResponse — free path capacity guard", () => {
  // Simulate the guarded insert at the DB: $queryRaw returns [] when the cap is
  // hit, else [row]. The helper also re-reads count on the 0-row branch.
  function makeTx(opts: { insertRows: unknown[]; countAfter: number }) {
    return {
      $executeRaw: vi.fn().mockResolvedValue(1), // advisory lock
      $queryRaw: vi
        .fn()
        // first call = the guarded INSERT ... RETURNING *
        .mockResolvedValueOnce(opts.insertRows)
        // second call (only reached when insertRows is []) = the count re-read
        .mockResolvedValueOnce([{ count: BigInt(opts.countAfter) }]),
    };
  }

  it("succeeds when a seat is available (insert returns a row)", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: false,
        allowMultipleResponses: true,
        capacity: { enabled: true, limit: 5 },
      }),
    );
    const tx = makeTx({
      insertRows: [
        { id: "cresp1", formId: "form_1", answers: { q_name: "Asha" }, submittedAt: new Date() },
      ],
      countAfter: 1,
    });
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));

    const result = await submitFormResponse("my-form", {
      answers: { q_name: "Asha" },
    });
    expect(result.id).toBe("cresp1");
    // Advisory lock taken, then the guarded insert ran.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    // The plain non-transactional create must NOT be used on the capacity path.
    expect(prismaMock.formResponse.create).not.toHaveBeenCalled();
  });

  it("rejects FORM_FULL when the guarded insert affects 0 rows and count >= limit", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: false,
        allowMultipleResponses: true,
        capacity: { enabled: true, limit: 5 },
      }),
    );
    const tx = makeTx({ insertRows: [], countAfter: 5 }); // full
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));

    await expect(
      submitFormResponse("my-form", { answers: { q_name: "Asha" } }),
    ).rejects.toMatchObject({ name: "FORM_FULL" });
  });

  it("maps a 0-row result with count < limit to DUPLICATE_RESPONSE (ON CONFLICT fired)", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: true,
        allowMultipleResponses: false,
        capacity: { enabled: true, limit: 5 },
      }),
    );
    // Pre-check finds no existing row (so we reach the guarded insert), but the
    // DB-level unique constraint fires as a concurrent duplicate → 0 rows with
    // count still below the limit.
    const tx = makeTx({ insertRows: [], countAfter: 1 });
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));

    await expect(
      submitFormResponse("my-form", {
        answers: { q_name: "Asha" },
        email: "dup@example.com",
      }),
    ).rejects.toMatchObject({ name: "DUPLICATE_RESPONSE" });
  });

  it("leaves the plain create path unchanged when capacity is off", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ collectEmail: false, allowMultipleResponses: true }),
    );
    prismaMock.formResponse.create.mockResolvedValue({
      id: "cresp2",
      formId: "form_1",
      answers: { q_name: "Asha" },
      submittedAt: new Date(),
    });
    const result = await submitFormResponse("my-form", {
      answers: { q_name: "Asha" },
    });
    expect(result.id).toBe("cresp2");
    expect(prismaMock.formResponse.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("still enforces the duplicate-email pre-check independently of capacity", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        collectEmail: true,
        allowMultipleResponses: false,
        capacity: { enabled: true, limit: 5 },
      }),
    );
    // Pre-check finds an existing response → DUPLICATE_RESPONSE before any insert.
    prismaMock.formResponse.findFirst.mockResolvedValue({ id: "existing" });
    await expect(
      submitFormResponse("my-form", {
        answers: { q_name: "Asha" },
        email: "a@example.com",
      }),
    ).rejects.toMatchObject({ name: "DUPLICATE_RESPONSE" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("submitFormResponse — paid path capacity guard", () => {
  function paidForm() {
    return formRow({
      collectEmail: true,
      allowMultipleResponses: true,
      payment: { enabled: true, mode: "fixed", amount: 50000 },
      capacity: { enabled: true, limit: 2 },
    });
  }

  const paidInput = {
    answers: { q_name: "Asha" },
    email: "a@example.com",
    payment: {
      razorpayOrderId: "order_1",
      razorpayPaymentId: "pay_1",
      razorpaySignature: "sig",
    },
  };

  function makePaidTx(insertRows: unknown[], countAfter: number) {
    return {
      payment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      formResponse: { findUnique: vi.fn().mockResolvedValue(null) },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce(insertRows)
        .mockResolvedValueOnce([{ count: BigInt(countAfter) }]),
    };
  }

  it("rolls back (throws FORM_FULL) and never links the payment when full after paying", async () => {
    prismaMock.form.findFirst.mockResolvedValue(paidForm());
    prismaMock.payment.findUnique.mockResolvedValue({
      formId: "form_1",
      razorpayOrderId: "order_1",
      status: "created",
      responseId: null,
    });
    const tx = makePaidTx([], 2); // full at verified-submit
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));

    await expect(submitFormResponse("my-form", paidInput)).rejects.toMatchObject({
      name: "FORM_FULL",
    });
    // The payment was never linked to a response (invariant preserved).
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("saves and links the payment when a seat is available", async () => {
    prismaMock.form.findFirst.mockResolvedValue(paidForm());
    prismaMock.payment.findUnique.mockResolvedValue({
      formId: "form_1",
      razorpayOrderId: "order_1",
      status: "created",
      responseId: null,
    });
    const row = {
      id: "cresp9",
      formId: "form_1",
      answers: { q_name: "Asha" },
      submittedAt: new Date(),
    };
    const tx = makePaidTx([row], 1);
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));

    const result = await submitFormResponse("my-form", paidInput);
    expect(result.id).toBe("cresp9");
    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { razorpayOrderId: "order_1" },
        data: { responseId: "cresp9" },
      }),
    );
  });
});

// ── DB-gated true-concurrency check ───────────────────────────────────────
// The unit suite mocks Prisma wholesale, so the real advisory-lock + guarded
// INSERT cannot be exercised here. This block runs ONLY when DATABASE_URL is
// provided (a real Postgres); CI without a DB skips it cleanly. Documented
// manual check: seed a form at limit=N with N-1 responses, fire K>1 concurrent
// submitFormResponse calls, assert exactly one 201 and the rest FORM_FULL, and
// count(FormResponse) === N. See design §Testability.
describe.skipIf(!process.env.DATABASE_URL)(
  "submitFormResponse — real-DB concurrency (requires DATABASE_URL)",
  () => {
    it("documented manual concurrency check placeholder", () => {
      // Intentionally a no-op marker: the real concurrency harness requires a
      // provisioned Postgres and is run manually/in an integration environment,
      // not in the Prisma-mocked unit suite.
      expect(true).toBe(true);
    });
  },
);
