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

const { validateSubmission, getFormReport, computeQuizScore, rebuildSchemaWithFreshIds } =
  await import("./form.service.js");
const { updateFormSettingsSchema, updateQuestionSchema } = await import("./form.schemas.js");
const { makeOtherAnswer, isOtherAnswer, otherText } = await import("./otherOption.js");
const { validateQuestionSettings } = await import("./questionTypes.js");

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function schemaWith(
  type: string,
  required: boolean,
  settings: Record<string, unknown> = { allowOther: true },
) {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        title: "S",
        questions: [{ id: "q1", label: "Pick", type, required, options, settings }],
      },
    ],
    settings: { collectEmail: false, allowMultipleResponses: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("otherOption helpers", () => {
  it("round-trips typed text", () => {
    const stored = makeOtherAnswer("  Radio ");
    expect(isOtherAnswer(stored)).toBe(true);
    expect(otherText(stored)).toBe("Radio");
    expect(isOtherAnswer("a")).toBe(false);
  });
});

describe("SINGLE_CHOICE with allowOther", () => {
  const schema = (required = false) => schemaWith("SINGLE_CHOICE", required);

  it("accepts a typed Other answer", () => {
    expect(() => validateSubmission(schema(), { q1: makeOtherAnswer("Radio") })).not.toThrow();
  });

  it("accepts a listed option", () => {
    expect(() => validateSubmission(schema(), { q1: "a" })).not.toThrow();
  });

  it("rejects Other with empty text", () => {
    expect(() => validateSubmission(schema(), { q1: "__other__:   " })).toThrow(/Other/);
    expect(() => validateSubmission(schema(), { q1: "__other__:" })).toThrow(/Other/);
  });

  it("rejects Other text over 200 characters", () => {
    expect(() =>
      validateSubmission(schema(), { q1: makeOtherAnswer("x".repeat(201)) }),
    ).toThrow(/too long/);
  });

  it("still rejects an arbitrary non-Other string", () => {
    expect(() => validateSubmission(schema(), { q1: "zzz" })).toThrow(/not an available option/);
  });

  it("honours required", () => {
    expect(() => validateSubmission(schema(true), {})).toThrow(/required/);
    expect(() => validateSubmission(schema(true), { q1: makeOtherAnswer("x") })).not.toThrow();
  });

  it("rejects Other when the question does not allow it", () => {
    const off = schemaWith("SINGLE_CHOICE", false, {});
    expect(() => validateSubmission(off, { q1: makeOtherAnswer("x") })).toThrow(
      /not an available option/,
    );
  });
});

describe("MULTIPLE_CHOICE with allowOther", () => {
  const schema = () => schemaWith("MULTIPLE_CHOICE", false);

  it("accepts options plus one Other", () => {
    expect(() =>
      validateSubmission(schema(), { q1: ["a", makeOtherAnswer("Radio")] }),
    ).not.toThrow();
  });

  it("rejects two Other entries", () => {
    expect(() =>
      validateSubmission(schema(), { q1: [makeOtherAnswer("x"), makeOtherAnswer("y")] }),
    ).toThrow(/only one Other/);
  });

  it("rejects an unknown non-Other value and an empty Other", () => {
    expect(() => validateSubmission(schema(), { q1: ["a", "zzz"] })).toThrow(
      /not an available option/,
    );
    expect(() => validateSubmission(schema(), { q1: ["a", "__other__:"] })).toThrow(/Other/);
  });
});

describe("DROPDOWN never accepts Other", () => {
  it("rejects an Other answer", () => {
    expect(() =>
      validateSubmission(schemaWith("DROPDOWN", false), { q1: makeOtherAnswer("x") }),
    ).toThrow(/not an available option/);
  });

  it("rejects allowOther in question settings", () => {
    expect(validateQuestionSettings("DROPDOWN", { allowOther: true })).toMatch(/dropdown/i);
    expect(validateQuestionSettings("SINGLE_CHOICE", { allowOther: "yes" })).toMatch(/allowOther/);
    expect(validateQuestionSettings("SINGLE_CHOICE", { allowOther: true, shuffleOptions: true })).toBeNull();
    expect(validateQuestionSettings("DROPDOWN", { shuffleOptions: 1 })).toMatch(/shuffleOptions/);
  });
});

describe("quiz scoring", () => {
  it("never scores an Other answer as correct", () => {
    const schema = schemaWith("SINGLE_CHOICE", false, { allowOther: true, correctAnswer: "a" });
    schema.settings.quizMode = true;
    expect(computeQuizScore(schema, { q1: "a" })).toMatchObject({ earned: 1 });
    expect(computeQuizScore(schema, { q1: makeOtherAnswer("a") })).toMatchObject({ earned: 0 });
  });
});

describe("conditions", () => {
  it("treats Other as not equal to any listed option", () => {
    const schema = {
      version: 1,
      sections: [
        {
          id: "s1",
          title: "S",
          questions: [
            { id: "q1", label: "Pick", type: "SINGLE_CHOICE", required: false, options, settings: { allowOther: true } },
            {
              id: "q2",
              label: "Why A",
              type: "SHORT_TEXT",
              required: true,
              conditions: [{ questionId: "q1", operator: "equals", value: "a" }],
            },
          ],
        },
      ],
      settings: { collectEmail: false, allowMultipleResponses: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    // q2 is only required when q1 === "a"; with Other it is hidden, so not required.
    expect(() => validateSubmission(schema, { q1: makeOtherAnswer("Radio") })).not.toThrow();
    expect(() => validateSubmission(schema, { q1: "a" })).toThrow(/required/);
  });
});

describe("Other analytics", () => {
  it("counts Other as its own bucket and lists the typed text", async () => {
    prismaMock.form.findFirst.mockResolvedValue({
      id: "form_1",
      schema: schemaWith("MULTIPLE_CHOICE", false),
    });
    prismaMock.formResponse.findMany.mockResolvedValue(
      [["a"], [makeOtherAnswer("Radio")], ["a", makeOtherAnswer("TV")]].map((v) => ({
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
    expect(q.options).toEqual([
      { name: "a", count: 2, percentage: 67 },
      { name: "Other", count: 2, percentage: 67, isOther: true },
    ]);
    expect(q.otherAnswers).toEqual(["Radio", "TV"]);
  });
});

describe("settings persistence", () => {
  it("accepts shuffleQuestions in form settings", () => {
    const parsed = updateFormSettingsSchema.safeParse({
      collectEmail: false,
      allowMultipleResponses: true,
      confirmationMessage: "",
      shuffleQuestions: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.shuffleQuestions).toBe(true);
    expect(
      updateFormSettingsSchema.safeParse({
        collectEmail: false,
        allowMultipleResponses: true,
        confirmationMessage: "",
        shuffleQuestions: "yes",
      }).success,
    ).toBe(false);
  });

  it("accepts allowOther and shuffleOptions on a choice question", () => {
    const ok = updateQuestionSchema.safeParse({
      type: "SINGLE_CHOICE",
      settings: { allowOther: true, shuffleOptions: true },
    });
    expect(ok.success).toBe(true);
    const bad = updateQuestionSchema.safeParse({
      type: "DROPDOWN",
      settings: { allowOther: true },
    });
    expect(bad.success).toBe(false);
  });

  it("keeps question and form settings when a form is copied with fresh ids", () => {
    const schema = schemaWith("SINGLE_CHOICE", false, { allowOther: true, shuffleOptions: true });
    schema.settings.shuffleQuestions = true;
    const copy = rebuildSchemaWithFreshIds(schema);
    expect(copy.settings.shuffleQuestions).toBe(true);
    expect(copy.sections[0]?.questions[0]?.settings).toEqual({
      allowOther: true,
      shuffleOptions: true,
    });
  });
});
