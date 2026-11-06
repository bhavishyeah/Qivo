import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock DB and side-effect services so no real network/DB call happens.
const prismaMock = vi.hoisted(() => ({
  form: { findFirst: vi.fn() },
  formResponse: { findFirst: vi.fn(), delete: vi.fn() },
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

// Also mock the formShares access module — this is what we are testing.
const hasEditorShareMock = vi.hoisted(() => vi.fn());
vi.mock("../formShares/formShare.access.js", () => ({
  hasEditorShare: hasEditorShareMock,
  hasResponseViewShare: vi.fn(),
}));

const { deleteFormResponse } = await import("./form.service.js");

// Shared fixtures
const FORM_ID = "form_abc";
const RESPONSE_ID = "resp_xyz";
const USER_ID = "user_123";

const formRow = {
  id: FORM_ID,
  workspaceId: "ws_1",
  title: "Test",
  deletedAt: null,
  schema: {
    version: 1,
    sections: [],
    settings: { collectEmail: false, allowMultipleResponses: true },
  },
};

const responseRow = { id: RESPONSE_ID, formId: FORM_ID };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("deleteFormResponse — HIGH-3 per-form EDITOR share fallback", () => {
  it("allows deletion when the user is a workspace NON-VIEWER member", async () => {
    prismaMock.form.findFirst.mockResolvedValueOnce(formRow);
    prismaMock.formResponse.findFirst.mockResolvedValue(responseRow);
    prismaMock.formResponse.delete.mockResolvedValue(responseRow);

    await expect(deleteFormResponse(FORM_ID, RESPONSE_ID, USER_ID)).resolves.toBeDefined();
    expect(prismaMock.formResponse.delete).toHaveBeenCalledWith({ where: { id: RESPONSE_ID } });
  });

  it("allows deletion when user has a per-form EDITOR share (no workspace membership)", async () => {
    // First findFirst (workspace lookup) returns null — user is not a member.
    prismaMock.form.findFirst
      .mockResolvedValueOnce(null) // workspace non-viewer check
      .mockResolvedValueOnce(formRow) // plain form load after share confirmed
      .mockResolvedValueOnce(null); // viewer-disambiguation check (not reached here)
    hasEditorShareMock.mockResolvedValue(true);
    prismaMock.formResponse.findFirst.mockResolvedValue(responseRow);
    prismaMock.formResponse.delete.mockResolvedValue(responseRow);

    await expect(deleteFormResponse(FORM_ID, RESPONSE_ID, USER_ID)).resolves.toBeDefined();
    expect(hasEditorShareMock).toHaveBeenCalledWith(FORM_ID, USER_ID);
    expect(prismaMock.formResponse.delete).toHaveBeenCalledWith({ where: { id: RESPONSE_ID } });
  });

  it("throws FORM_NOT_FOUND when user has no workspace membership and no editor share", async () => {
    prismaMock.form.findFirst
      .mockResolvedValueOnce(null) // workspace non-viewer check
      .mockResolvedValueOnce(null); // viewer-disambiguation check
    hasEditorShareMock.mockResolvedValue(false);

    await expect(deleteFormResponse(FORM_ID, RESPONSE_ID, USER_ID)).rejects.toMatchObject({
      name: "FORM_NOT_FOUND",
    });
    expect(prismaMock.formResponse.delete).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when the user is a VIEWER workspace member", async () => {
    // Workspace non-viewer query: returns null (VIEWER is excluded by query).
    // hasEditorShare: false (no per-form share either).
    // Viewer-disambiguation: returns a row (they ARE a member, just a viewer).
    prismaMock.form.findFirst
      .mockResolvedValueOnce(null) // workspace non-viewer check → null
      .mockResolvedValueOnce({ id: FORM_ID }); // viewer-disambiguation → found (they're a VIEWER)
    hasEditorShareMock.mockResolvedValue(false);

    await expect(deleteFormResponse(FORM_ID, RESPONSE_ID, USER_ID)).rejects.toMatchObject({
      name: "FORBIDDEN",
    });
    expect(prismaMock.formResponse.delete).not.toHaveBeenCalled();
  });
});
