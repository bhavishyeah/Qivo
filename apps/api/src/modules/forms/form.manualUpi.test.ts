import { beforeEach, describe, expect, it, vi } from "vitest";

// Manual UPI service tests. DB and side-effect services are mocked.

const prismaMock = vi.hoisted(() => ({
  form: { findFirst: vi.fn(), update: vi.fn() },
  formResponse: {
    findFirst: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  formAnalytics: { create: vi.fn() },
  payment: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  workspace: { findUnique: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

const webhookMock = vi.hoisted(() => ({
  sendWebhooksForResponse: vi.fn(),
  buildResponseCreatedPayload: vi.fn(() => ({})),
  sendFormEventWebhooks: vi.fn(),
}));
const auditMock = vi.hoisted(() => ({
  logAction: vi.fn(() => Promise.resolve()),
}));
const shareMock = vi.hoisted(() => ({
  hasEditorShare: vi.fn(),
  hasResponseViewShare: vi.fn(),
}));
const editTokenMock = vi.hoisted(() => ({
  signEditToken: vi.fn(() => "edit_token"),
  verifyEditToken: vi.fn(),
}));

vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));
vi.mock("../../services/razorpay.js", () => ({
  createRazorpayOrder: vi.fn(),
  getPublicKeyId: vi.fn(() => "rzp_test_key"),
  isRazorpayConfigured: vi.fn(() => true),
  isValidAmountPaise: vi.fn(() => true),
  verifyPaymentSignature: vi.fn(() => true),
  verifyWebhookSignature: vi.fn(() => true),
  MIN_PAISE: 100,
  MAX_PAISE: 15_000_000,
  paiseToRupees: (p: number) => p / 100,
}));
vi.mock("../../services/email.js", () => ({
  sendNewResponseNotificationEmail: vi.fn(),
  sendResponseConfirmationEmail: vi.fn(),
  sendResponseDigestEmail: vi.fn(),
}));
vi.mock("../../services/webhookDelivery.js", () => webhookMock);
vi.mock("../notifications/notification.service.js", () => ({
  notifyFormEvent: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => auditMock);
vi.mock("../formShares/formShare.access.js", () => shareMock);
vi.mock("../../services/responseEditToken.js", () => editTokenMock);

const {
  getPublicForm,
  updateFormSettings,
  submitFormResponse,
  editFormResponse,
  setManualPaymentStatus,
  getManualPaymentSummary,
  validateProofUrl,
} = await import("./form.service.js");

const PROOF = "https://res.cloudinary.com/democloud/image/upload/v1/proof.jpg";
const MANUAL = {
  enabled: true,
  upiId: "name@okicici",
  payeeName: "Asha",
  amount: 50000,
  requireScreenshot: true,
};

function formRow(settings: Record<string, unknown>) {
  return {
    id: "form_1",
    workspaceId: "ws_1",
    slug: "my-form",
    title: "Fest",
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
          questions: [{ id: "q_name", label: "Name", type: "SHORT_TEXT", required: true }],
        },
      ],
      settings: { collectEmail: false, allowMultipleResponses: true, ...settings },
    },
  };
}

const baseSettingsInput = {
  collectEmail: false,
  allowMultipleResponses: true,
  confirmationMessage: "",
};

function makeTx(hit: boolean) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue(hit ? [{ hit: 1 }] : []),
    formResponse: {
      create: vi.fn().mockImplementation(async (a: { data: unknown }) => ({
        id: "resp_1",
        submittedAt: new Date(),
        ...(a.data as object),
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYMENTS_ALLOWED_OWNER_EMAILS = "owner@example.com";
  delete process.env.CLOUDINARY_CLOUD_NAME;
  prismaMock.workspace.findUnique.mockResolvedValue({ owner: { email: "owner@example.com" } });
  prismaMock.formResponse.findFirst.mockResolvedValue(null);
  prismaMock.formResponse.count.mockResolvedValue(0);
  prismaMock.formAnalytics.create.mockResolvedValue({});
  prismaMock.form.update.mockImplementation(async (a: unknown) => a);
  prismaMock.formResponse.create.mockImplementation(async (a: { data: unknown }) => ({
    id: "resp_plain",
    submittedAt: new Date(),
    ...(a.data as object),
  }));
});

describe("validateProofUrl", () => {
  it("accepts a Cloudinary image upload", () => {
    expect(validateProofUrl(PROOF)).toBeNull();
  });
  it("rejects non-cloudinary, non-image and raw uploads", () => {
    expect(validateProofUrl("https://evil.example.com/image/upload/a.jpg")).not.toBeNull();
    expect(validateProofUrl("https://res.cloudinary.com/democloud/image/upload/a.pdf")).not.toBeNull();
    expect(validateProofUrl("https://res.cloudinary.com/democloud/raw/upload/v1/a")).not.toBeNull();
    expect(validateProofUrl("http://res.cloudinary.com/democloud/image/upload/a.jpg")).not.toBeNull();
  });
  it("requires the configured cloud name", () => {
    process.env.CLOUDINARY_CLOUD_NAME = "mycloud";
    expect(validateProofUrl(PROOF)).not.toBeNull();
    expect(
      validateProofUrl("https://res.cloudinary.com/mycloud/image/upload/v1/p.jpg"),
    ).toBeNull();
  });
});

describe("settings round-trip and mutual exclusion", () => {
  it("writes the normalized manualUpi object", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({}));
    await updateFormSettings("form_1", "owner_1", {
      ...baseSettingsInput,
      manualUpi: { enabled: true, upiId: "name@okicici", payeeName: "Asha", requireScreenshot: true },
    });
    const arg = prismaMock.form.update.mock.calls[0]![0] as {
      data: { schema: { settings: { manualUpi: unknown } } };
    };
    expect(arg.data.schema.settings.manualUpi).toEqual({
      enabled: true,
      upiId: "name@okicici",
      payeeName: "Asha",
      requireScreenshot: true,
    });
  });

  it("drops a corrupt stored block through the normalizer", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ manualUpi: { enabled: "yes", upiId: "x" } }),
    );
    await updateFormSettings("form_1", "owner_1", baseSettingsInput);
    const arg = prismaMock.form.update.mock.calls[0]![0] as {
      data: { schema: { settings: Record<string, unknown> } };
    };
    expect(arg.data.schema.settings).not.toHaveProperty("manualUpi");
  });

  it("rejects enabling manual UPI while Razorpay is enabled", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ payment: { enabled: true, mode: "fixed", amount: 10000 } }),
    );
    await expect(
      updateFormSettings("form_1", "owner_1", {
        ...baseSettingsInput,
        manualUpi: { enabled: true, upiId: "a@ybl", payeeName: "A", requireScreenshot: true },
      }),
    ).rejects.toMatchObject({ name: "PAYMENT_METHODS_CONFLICT" });
  });

  it("rejects enabling Razorpay while manual UPI is enabled", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({ manualUpi: MANUAL }));
    await expect(
      updateFormSettings("form_1", "owner_1", {
        ...baseSettingsInput,
        payment: { enabled: true, mode: "fixed", amount: 10000 },
      }),
    ).rejects.toMatchObject({ name: "PAYMENT_METHODS_CONFLICT" });
  });

  it("allows switching: disable one while enabling the other", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({ manualUpi: MANUAL }));
    await expect(
      updateFormSettings("form_1", "owner_1", {
        ...baseSettingsInput,
        manualUpi: { enabled: false, requireScreenshot: true },
        payment: { enabled: true, mode: "fixed", amount: 10000 },
      }),
    ).resolves.toBeDefined();
  });

  it("PAYMENTS_NOT_ALLOWED takes precedence over the conflict", async () => {
    process.env.PAYMENTS_ALLOWED_OWNER_EMAILS = "someone-else@example.com";
    prismaMock.form.findFirst.mockResolvedValue(formRow({ manualUpi: MANUAL }));
    await expect(
      updateFormSettings("form_1", "owner_1", {
        ...baseSettingsInput,
        payment: { enabled: true, mode: "fixed", amount: 10000 },
      }),
    ).rejects.toMatchObject({ name: "PAYMENTS_NOT_ALLOWED" });
  });
});

describe("getPublicForm manual UPI block", () => {
  it("exposes only whitelisted keys and strips the raw setting", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ manualUpi: { ...MANUAL, instructions: "Pay now" } }),
    );
    const result = await getPublicForm("my-form");
    expect(Object.keys(result.manualUpi).sort()).toEqual(
      ["amount", "enabled", "instructions", "payeeName", "requireScreenshot", "upiId"].sort(),
    );
    expect(result.schema.settings).not.toHaveProperty("manualUpi");
    expect(JSON.stringify(result)).not.toContain("owner@example.com");
  });

  it("returns { enabled: false } when off, invalid, or Razorpay is on", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({}));
    expect((await getPublicForm("my-form")).manualUpi).toEqual({ enabled: false });
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ manualUpi: { ...MANUAL, upiId: "bad" } }),
    );
    expect((await getPublicForm("my-form")).manualUpi).toEqual({ enabled: false });
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({
        manualUpi: MANUAL,
        payment: { enabled: true, mode: "fixed", amount: 10000 },
      }),
    );
    expect((await getPublicForm("my-form")).manualUpi).toEqual({ enabled: false });
  });
});

describe("submitFormResponse manual UPI", () => {
  const answers = { q_name: "Asha" };
  const goodManual = { utr: "abc123456789", proofUrl: PROOF };

  function useManualForm(extra: Record<string, unknown> = {}) {
    prismaMock.form.findFirst.mockResolvedValue(formRow({ manualUpi: MANUAL, ...extra }));
  }

  it("requires manualPayment", async () => {
    useManualForm();
    await expect(submitFormResponse("my-form", { answers })).rejects.toMatchObject({
      name: "MANUAL_PAYMENT_REQUIRED",
    });
  });

  it("rejects a bad UTR, missing proof, and bad proof URLs", async () => {
    useManualForm();
    await expect(
      submitFormResponse("my-form", { answers, manualPayment: { utr: "short", proofUrl: PROOF } }),
    ).rejects.toMatchObject({ name: "MANUAL_PAYMENT_INVALID" });
    await expect(
      submitFormResponse("my-form", { answers, manualPayment: { utr: "ABC123456789" } }),
    ).rejects.toMatchObject({ name: "MANUAL_PAYMENT_INVALID" });
    for (const bad of [
      "https://evil.example.com/image/upload/a.jpg",
      "https://res.cloudinary.com/democloud/image/upload/a.pdf",
      "https://res.cloudinary.com/democloud/raw/upload/v1/a",
    ]) {
      await expect(
        submitFormResponse("my-form", {
          answers,
          manualPayment: { utr: "ABC123456789", proofUrl: bad },
        }),
      ).rejects.toMatchObject({ name: "MANUAL_PAYMENT_INVALID" });
    }
  });

  it("allows a missing proof when not required", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ manualUpi: { ...MANUAL, requireScreenshot: false } }),
    );
    const tx = makeTx(false);
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
    const result = await submitFormResponse("my-form", {
      answers,
      manualPayment: { utr: "ABC123456789" },
    });
    expect(result.id).toBe("resp_1");
  });

  it("rejects manualPayment on a non-manual form", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({}));
    await expect(
      submitFormResponse("my-form", { answers, manualPayment: goodManual }),
    ).rejects.toMatchObject({ name: "MANUAL_PAYMENT_NOT_ENABLED" });
  });

  it("fails closed when enabled with corrupt stored settings", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ manualUpi: { enabled: true, requireScreenshot: true } }),
    );
    await expect(submitFormResponse("my-form", { answers })).rejects.toMatchObject({
      name: "MANUAL_PAYMENT_UNAVAILABLE",
    });
  });

  it("stores a pending record with the settings amount and normalized UTR (non-capacity tx path)", async () => {
    useManualForm();
    const tx = makeTx(false);
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
    await submitFormResponse("my-form", { answers, manualPayment: goodManual });
    const data = tx.formResponse.create.mock.calls[0]![0].data as {
      metadata: { manualPayment: Record<string, unknown> };
    };
    expect(data.metadata.manualPayment).toMatchObject({
      utr: "ABC123456789",
      proofUrl: PROOF,
      amount: 50000,
      status: "pending",
    });
    // Lock is taken before the duplicate check.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.formResponse.create).not.toHaveBeenCalled();
  });

  it("ignores spoofed client metadata.manualPayment on a manual form", async () => {
    useManualForm();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tx = makeTx(false);
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
    await submitFormResponse("my-form", {
      answers,
      manualPayment: goodManual,
      metadata: { source: "x", manualPayment: { status: "verified", utr: "SPOOF", amount: 1 } },
    });
    const data = tx.formResponse.create.mock.calls[0]![0].data as {
      metadata: { source: string; manualPayment: Record<string, unknown> };
    };
    expect(data.metadata.source).toBe("x");
    expect(data.metadata.manualPayment).toMatchObject({
      status: "pending",
      utr: "ABC123456789",
      amount: 50000,
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops client metadata.manualPayment on a non-manual form (plain create, no transaction)", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({}));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await submitFormResponse("my-form", {
      answers,
      metadata: { source: "x", manualPayment: { status: "verified" } },
    });
    const data = prismaMock.formResponse.create.mock.calls[0]![0].data as {
      metadata: Record<string, unknown>;
    };
    expect(data.metadata).toEqual({ source: "x" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("maps a duplicate UTR hit to MANUAL_PAYMENT_DUPLICATE_UTR (non-capacity)", async () => {
    useManualForm();
    const tx = makeTx(true);
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
    await expect(
      submitFormResponse("my-form", { answers, manualPayment: goodManual }),
    ).rejects.toMatchObject({ name: "MANUAL_PAYMENT_DUPLICATE_UTR" });
    expect(tx.formResponse.create).not.toHaveBeenCalled();
  });

  it("duplicate check excludes rejected rows", async () => {
    useManualForm();
    const tx = makeTx(false);
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
    await submitFormResponse("my-form", { answers, manualPayment: goodManual });
    const sql = tx.$queryRaw.mock.calls[0]![0] as { strings: string[] };
    expect(sql.strings.join("?")).toContain("<> 'rejected'");
  });

  it("capacity path: lock, duplicate check, then guarded insert storing the record", async () => {
    useManualForm({ capacity: { enabled: true, limit: 10 } });
    const row = { id: "cresp1", submittedAt: new Date() };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([]) // duplicate check
        .mockResolvedValueOnce([row]), // guarded insert
    };
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
    const result = await submitFormResponse("my-form", { answers, manualPayment: goodManual });
    expect(result.id).toBe("cresp1");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const insert = tx.$queryRaw.mock.calls[1]![0] as { values: unknown[] };
    const metaJson = insert.values.find(
      (v) => typeof v === "string" && v.includes("manualPayment"),
    ) as string;
    expect(JSON.parse(metaJson).manualPayment).toMatchObject({ status: "pending", amount: 50000 });
  });

  it("capacity path: duplicate UTR throws before the insert", async () => {
    useManualForm({ capacity: { enabled: true, limit: 10 } });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValueOnce([{ hit: 1 }]),
    };
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
    await expect(
      submitFormResponse("my-form", { answers, manualPayment: goodManual }),
    ).rejects.toMatchObject({ name: "MANUAL_PAYMENT_DUPLICATE_UTR" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("passes manualPayment to the webhook payload", async () => {
    useManualForm();
    const tx = makeTx(false);
    prismaMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
    await submitFormResponse("my-form", { answers, manualPayment: goodManual });
    expect(webhookMock.buildResponseCreatedPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        manualPayment: { utr: "ABC123456789", proofUrl: PROOF, status: "pending" },
      }),
    );
  });
});

describe("editFormResponse preserves manualPayment", () => {
  it("keeps the stored record byte-equal and ignores client metadata", async () => {
    const stored = {
      utr: "ABC123456789",
      proofUrl: PROOF,
      amount: 50000,
      status: "verified",
      submittedAt: "2025-01-01T10:00:00.000Z",
    };
    editTokenMock.verifyEditToken.mockReturnValue({
      responseId: "resp_1",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ responseEditing: "timed", responseEditMinutes: 15, manualUpi: MANUAL }),
    );
    prismaMock.formResponse.findFirst.mockResolvedValue({
      id: "resp_1",
      submittedAt: new Date(),
      metadata: { source: "web", manualPayment: stored },
    });
    prismaMock.formResponse.update.mockResolvedValue({ id: "resp_1", submittedAt: new Date() });
    await editFormResponse(
      "my-form",
      "resp_1",
      {
        answers: { q_name: "New" },
        metadata: { manualPayment: { status: "pending", utr: "HACKED" } },
      },
      "tok",
    );
    const data = prismaMock.formResponse.update.mock.calls[0]![0].data as {
      metadata: { manualPayment: unknown; editedAt: string; source: string };
    };
    expect(data.metadata.manualPayment).toEqual(stored);
    expect(data.metadata.editedAt).toBeTruthy();
    expect(data.metadata.source).toBe("web");
  });
});

describe("setManualPaymentStatus", () => {
  const storedMeta = {
    email: "a@b.com",
    source: "web",
    elapsedSeconds: 41,
    manualPayment: {
      utr: "ABC123456789",
      proofUrl: PROOF,
      amount: 50000,
      status: "pending",
      submittedAt: "2025-01-01T10:00:00.000Z",
    },
  };

  beforeEach(() => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({ manualUpi: MANUAL }));
    prismaMock.formResponse.findFirst.mockResolvedValue({ id: "resp_1", metadata: storedMeta });
    prismaMock.formResponse.update.mockImplementation(async (a: { data: unknown }) => ({
      id: "resp_1",
      ...(a.data as object),
    }));
  });

  it("verifies, preserves other metadata and audits once", async () => {
    await setManualPaymentStatus("form_1", "resp_1", "user_9", "verified");
    const data = prismaMock.formResponse.update.mock.calls[0]![0].data as {
      metadata: Record<string, unknown> & { manualPayment: Record<string, unknown> };
    };
    expect(data.metadata).toMatchObject({ email: "a@b.com", source: "web", elapsedSeconds: 41 });
    expect(data.metadata.manualPayment).toMatchObject({
      utr: "ABC123456789",
      proofUrl: PROOF,
      amount: 50000,
      submittedAt: "2025-01-01T10:00:00.000Z",
      status: "verified",
      reviewedBy: "user_9",
    });
    expect(data.metadata.manualPayment.reviewedAt).toBeTruthy();
    expect(auditMock.logAction).toHaveBeenCalledTimes(1);
    expect(auditMock.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "MANUAL_PAYMENT_REVIEWED",
        metadata: { formId: "form_1", from: "pending", to: "verified" },
      }),
    );
  });

  it("pending removes reviewedAt/reviewedBy", async () => {
    prismaMock.formResponse.findFirst.mockResolvedValue({
      id: "resp_1",
      metadata: {
        manualPayment: {
          ...storedMeta.manualPayment,
          status: "rejected",
          reviewedAt: "2025-01-02T00:00:00.000Z",
          reviewedBy: "u",
        },
      },
    });
    await setManualPaymentStatus("form_1", "resp_1", "user_9", "pending");
    const data = prismaMock.formResponse.update.mock.calls[0]![0].data as {
      metadata: { manualPayment: Record<string, unknown> };
    };
    expect(data.metadata.manualPayment).not.toHaveProperty("reviewedAt");
    expect(data.metadata.manualPayment).not.toHaveProperty("reviewedBy");
    expect(data.metadata.manualPayment.status).toBe("pending");
  });

  it("allows an EDITOR share when the workspace lookup misses", async () => {
    prismaMock.form.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(formRow({ manualUpi: MANUAL }));
    shareMock.hasEditorShare.mockResolvedValue(true);
    await expect(
      setManualPaymentStatus("form_1", "resp_1", "user_9", "verified"),
    ).resolves.toBeDefined();
  });

  it("returns FORM_NOT_FOUND for a viewer", async () => {
    prismaMock.form.findFirst.mockResolvedValue(null);
    shareMock.hasEditorShare.mockResolvedValue(false);
    await expect(
      setManualPaymentStatus("form_1", "resp_1", "viewer", "verified"),
    ).rejects.toMatchObject({ name: "FORM_NOT_FOUND" });
    expect(prismaMock.formResponse.update).not.toHaveBeenCalled();
  });

  it("returns RESPONSE_NOT_FOUND and MANUAL_PAYMENT_NOT_FOUND", async () => {
    prismaMock.formResponse.findFirst.mockResolvedValueOnce(null);
    await expect(
      setManualPaymentStatus("form_1", "nope", "user_9", "verified"),
    ).rejects.toMatchObject({ name: "RESPONSE_NOT_FOUND" });
    prismaMock.formResponse.findFirst.mockResolvedValueOnce({ id: "r", metadata: { email: "a@b.com" } });
    await expect(
      setManualPaymentStatus("form_1", "r", "user_9", "verified"),
    ).rejects.toMatchObject({ name: "MANUAL_PAYMENT_NOT_FOUND" });
  });
});

describe("getManualPaymentSummary", () => {
  it("maps rows to counts with zeros and returns duplicates", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow({ manualUpi: MANUAL }));
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        { status: "verified", count: 2 },
        { status: "pending", count: 3 },
      ])
      .mockResolvedValueOnce([{ utr: "DUP123456789" }]);
    const r = await getManualPaymentSummary("form_1", "user_9");
    expect(r).toEqual({
      counts: { pending: 3, verified: 2, rejected: 0 },
      duplicateUtrs: ["DUP123456789"],
    });
  });

  it("uses response-access authorization (not found when no access)", async () => {
    prismaMock.form.findFirst.mockResolvedValue(null);
    shareMock.hasResponseViewShare.mockResolvedValue(false);
    await expect(getManualPaymentSummary("form_1", "stranger")).rejects.toMatchObject({
      name: "FORM_NOT_FOUND",
    });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});
