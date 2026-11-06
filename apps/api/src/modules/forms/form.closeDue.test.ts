import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the notifyFormEvent mock so we can assert on calls.
const notifyFormEventMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  form: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  workspaceMember: { findMany: vi.fn() },
}));

vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));
vi.mock("../notifications/notification.service.js", () => ({
  notifyFormEvent: notifyFormEventMock,
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

const { closeDueForms } = await import("./form.service.js");

const PAST_DATE = new Date("2020-01-01T00:00:00.000Z").toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("closeDueForms — MEDIUM-9 in-app notification to managers", () => {
  it("calls notifyFormEvent with FORM_CLOSED for each form's OWNER/ADMIN members", async () => {
    const candidates = [
      {
        id: "form_1",
        workspaceId: "ws_1",
        title: "My Form",
        slug: "my-form",
        status: "PUBLISHED",
        schema: {
          version: 1,
          sections: [],
          settings: {
            collectEmail: false,
            allowMultipleResponses: true,
            scheduledCloseAt: PAST_DATE,
          },
        },
      },
    ];

    prismaMock.form.findMany
      // First call: candidates query (id + schema)
      .mockResolvedValueOnce(candidates)
      // Second call: webhook fire-and-forget — returns the form with slug/status
      .mockResolvedValueOnce(candidates)
      // Third call: notification fire-and-forget — returns form with id/title/workspaceId
      .mockResolvedValueOnce([
        { id: "form_1", title: "My Form", workspaceId: "ws_1" },
      ]);

    prismaMock.form.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.workspaceMember.findMany.mockResolvedValue([
      { userId: "owner_1" },
      { userId: "admin_2" },
    ]);
    notifyFormEventMock.mockResolvedValue(undefined);

    await closeDueForms(new Date());

    // Allow the fire-and-forget to complete.
    await vi.waitFor(() => {
      expect(notifyFormEventMock).toHaveBeenCalled();
    }, { timeout: 2000 });

    const call = notifyFormEventMock.mock.calls[0]?.[0] as
      | {
          type: string;
          actorId: string;
          targetUserIds: string[];
        }
      | undefined;

    expect(call?.type).toBe("FORM_CLOSED");
    expect(call?.actorId).toBe("system");
    expect(call?.targetUserIds).toContain("owner_1");
    expect(call?.targetUserIds).toContain("admin_2");
  });

  it("does not throw when there are no due forms", async () => {
    prismaMock.form.findMany.mockResolvedValue([]);
    prismaMock.form.updateMany.mockResolvedValue({ count: 0 });

    await expect(closeDueForms(new Date())).resolves.toBe(0);
    expect(notifyFormEventMock).not.toHaveBeenCalled();
  });
});
