import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock DB and side-effect services.
const prismaMock = vi.hoisted(() => ({
  form: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  formVersion: { create: vi.fn() },
  $transaction: vi.fn(async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock)),
}));

vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));
vi.mock("../notifications/notification.service.js", () => ({
  notifyFormEvent: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({
  logAction: vi.fn(),
}));
vi.mock("../../services/webhookDelivery.js", () => ({
  sendWebhooksForResponse: vi.fn(),
  buildResponseCreatedPayload: vi.fn(),
  sendFormEventWebhooks: vi.fn(),
}));
vi.mock("../../services/email.js", () => ({
  sendNewResponseNotificationEmail: vi.fn(),
  sendResponseConfirmationEmail: vi.fn(),
  sendResponseDigestEmail: vi.fn(),
}));
vi.mock("../../services/cloudinary.js", () => ({
  signUpload: vi.fn(),
}));
vi.mock("../../services/responseEditToken.js", () => ({
  signEditToken: vi.fn(),
  verifyEditToken: vi.fn(),
}));
vi.mock("../../services/razorpay.js", () => ({
  createRazorpayOrder: vi.fn(),
  getPublicKeyId: vi.fn(),
  isRazorpayConfigured: vi.fn(() => false),
  isValidAmountPaise: vi.fn(() => true),
  MIN_PAISE: 100,
  MAX_PAISE: 15_000_000,
  paiseToRupees: (p: number) => p / 100,
  verifyPaymentSignature: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}));
vi.mock("../formShares/formShare.access.js", () => ({
  hasEditorShare: vi.fn(),
  hasResponseViewShare: vi.fn(),
}));

const { publishDueForms } = await import("./form.service.js");

const PAST_DATE = new Date("2020-01-01T00:00:00.000Z").toISOString();

function makeCandidates(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `form_${i}`,
    title: `Form ${i}`,
    description: null,
    version: 1,
    schema: {
      version: 1,
      sections: [],
      settings: {
        collectEmail: false,
        allowMultipleResponses: true,
        scheduledPublishAt: PAST_DATE,
      },
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishDueForms — MEDIUM-8 FormVersion snapshot", () => {
  it("creates a FormVersion row for each auto-published form", async () => {
    const candidates = makeCandidates(3);
    prismaMock.form.findMany.mockResolvedValue(candidates);
    prismaMock.form.findUnique.mockResolvedValue({ version: 1 });
    prismaMock.formVersion.create.mockResolvedValue({});
    prismaMock.form.update.mockResolvedValue({ status: "PUBLISHED" });

    const count = await publishDueForms(new Date());

    expect(count).toBe(3);
    // One formVersion.create per form.
    expect(prismaMock.formVersion.create).toHaveBeenCalledTimes(3);
    // Each call must set createdBy: "system".
    for (const call of prismaMock.formVersion.create.mock.calls) {
      expect((call[0] as { data: { createdBy: string } }).data.createdBy).toBe("system");
    }
  });

  it("returns 0 and creates no rows when no forms are due", async () => {
    prismaMock.form.findMany.mockResolvedValue([
      {
        id: "form_0",
        title: "Future Form",
        description: null,
        version: 1,
        schema: {
          version: 1,
          sections: [],
          settings: {
            collectEmail: false,
            allowMultipleResponses: true,
            scheduledPublishAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
        },
      },
    ]);

    const count = await publishDueForms(new Date());

    expect(count).toBe(0);
    expect(prismaMock.formVersion.create).not.toHaveBeenCalled();
  });

  it("increments versionNumber from current DB version", async () => {
    const candidates = makeCandidates(1);
    prismaMock.form.findMany.mockResolvedValue(candidates);
    // Simulate the form is already at version 3 in the DB.
    prismaMock.form.findUnique.mockResolvedValue({ version: 3 });
    prismaMock.formVersion.create.mockResolvedValue({});
    prismaMock.form.update.mockResolvedValue({ status: "PUBLISHED" });

    await publishDueForms(new Date());

    const createArg = prismaMock.formVersion.create.mock.calls[0]?.[0] as
      | { data: { versionNumber: number } }
      | undefined;
    expect(createArg?.data.versionNumber).toBe(4);
  });
});
