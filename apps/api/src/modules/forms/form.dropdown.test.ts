import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  form: { findFirst: vi.fn() },
  formResponse: { findMany: vi.fn(), count: vi.fn() },
  formAnalytics: { count: vi.fn() },
  $queryRaw: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));
vi.mock("../notifications/notification.service.js", () => ({
  notifyFormEvent: vi.fn(),
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
vi.mock("../../services/cloudinary.js", () => ({ signUpload: vi.fn() }));
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

const { validateSubmission, getFormReport } = await import("./form.service.js");
const { createQuestionSchema } = await import("./form.schemas.js");

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function schemaWith(required: boolean) {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        title: "S",
        questions: [{ id: "q1", label: "Pick", type: "DROPDOWN", required, options }],
      },
    ],
    settings: { collectEmail: false, allowMultipleResponses: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("DROPDOWN answers", () => {
  it("accepts a listed option", () => {
    expect(() => validateSubmission(schemaWith(true), { q1: "a" })).not.toThrow();
  });

  it("rejects a value that is not an option", () => {
    expect(() => validateSubmission(schemaWith(false), { q1: "zzz" })).toThrow(
      /not an available option/,
    );
  });

  it("rejects an array answer", () => {
    expect(() => validateSubmission(schemaWith(false), { q1: ["a"] })).toThrow();
  });

  it("rejects an empty answer when required and allows it when optional", () => {
    expect(() => validateSubmission(schemaWith(true), { q1: "" })).toThrow(/required/);
    expect(() => validateSubmission(schemaWith(false), {})).not.toThrow();
  });

  it("is an accepted question type in the create schema", () => {
    const parsed = createQuestionSchema.safeParse({
      label: "Pick",
      type: "DROPDOWN",
      required: false,
      options,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("DROPDOWN analytics", () => {
  it("counts answers per option like a single choice", async () => {
    prismaMock.form.findFirst.mockResolvedValue({
      id: "form_1",
      schema: schemaWith(false),
    });
    prismaMock.formResponse.findMany.mockResolvedValue(
      ["a", "a", "b"].map((v) => ({
        answers: { q1: v },
        submittedAt: new Date(),
        metadata: null,
      })),
    );
    prismaMock.formResponse.count.mockResolvedValue(3);
    prismaMock.formAnalytics.count.mockResolvedValue(0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report: any = await getFormReport("form_1", "user_1");
    const q = report.questions.find((x: { questionId: string }) => x.questionId === "q1");
    expect(q.kind).toBe("choice");
    expect(q.options).toEqual([
      { name: "a", count: 2, percentage: 67 },
      { name: "b", count: 1, percentage: 33 },
    ]);
  });
});
