import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the notifyFormEvent mock so we can assert on calls.
const notifyFormEventMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  form: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  formVersion: { create: vi.fn() },
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  workspaceMember: { findMany: vi.fn() },
}));

vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));
vi.mock("../notifications/notification.service.js", () => ({
  notifyFormEvent: notifyFormEventMock,
}));
vi.mock("../audit/audit.service.js", () => ({
  logAction: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../services/webhookDelivery.js", () => ({
  sendWebhooksForResponse: vi.fn(),
  buildResponseCreatedPayload: vi.fn(),
  sendFormEventWebhooks: vi.fn(() => Promise.resolve()),
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

const { publishForm } = await import("./form.service.js");
const webhooks = await import("../../services/webhookDelivery.js");

function closedForm(settings: Record<string, unknown> = {}) {
  return {
    id: "form_1",
    workspaceId: "ws_1",
    title: "My Form",
    slug: "my-form",
    status: "CLOSED",
    version: 3,
    description: null,
    schema: {
      version: 1,
      sections: [
        {
          id: "s1",
          title: "S",
          questions: [{ id: "q1", label: "Q", type: "SHORT_TEXT", required: false }],
        },
      ],
      settings: { collectEmail: false, allowMultipleResponses: true, ...settings },
    },
    workspace: { members: [{ role: "OWNER" }] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  notifyFormEventMock.mockResolvedValue(undefined);
  prismaMock.workspaceMember.findMany.mockResolvedValue([]);
  prismaMock.user.findUnique.mockResolvedValue({ name: "Owner" });
});

describe("publishForm reopening a CLOSED form", () => {
  it("moves CLOSED to PUBLISHED, snapshots a new version and fires form.published", async () => {
    prismaMock.form.findFirst.mockResolvedValue(closedForm());
    const tx = {
      form: {
        findUnique: vi.fn().mockResolvedValue({ version: 3 }),
        update: vi.fn().mockResolvedValue({ id: "form_1", title: "My Form", slug: "my-form", status: "PUBLISHED" }),
      },
      formVersion: { create: vi.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    const result = await publishForm("form_1", "user_1");
    expect(result.status).toBe("PUBLISHED");
    expect(tx.formVersion.create).toHaveBeenCalledTimes(1);
    expect(tx.form.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PUBLISHED", version: 4 } }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(webhooks.sendFormEventWebhooks).toHaveBeenCalledWith(expect.anything(), "form.published");
  });

  it("refuses to reopen when the scheduled close date has already passed", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      closedForm({ scheduledCloseAt: "2020-01-01T00:00:00.000Z" }),
    );
    await expect(publishForm("form_1", "user_1")).rejects.toMatchObject({ name: "FORM_NOT_READY" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a viewer", async () => {
    const f = closedForm();
    f.workspace.members = [{ role: "VIEWER" }];
    prismaMock.form.findFirst.mockResolvedValue(f);
    await expect(publishForm("form_1", "user_1")).rejects.toBeDefined();
  });
});
