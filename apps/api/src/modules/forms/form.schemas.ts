import { z } from "zod";

// Curated Google Fonts allow-list. This is the AUTHORITATIVE copy; it is
// enforced server-side via z.enum below (the only injection surface, since
// fontFamily flows into a stylesheet href). Mirror lives in
// apps/web/src/lib/theme.ts — keep in sync: the API enum is authoritative; a
// font present on the web but not here is rejected with a 400, a font here but
// not on the web is never selectable.
export const FONT_ALLOW_LIST = [
  "Inter",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Open Sans",
  "Lora",
  "Playfair Display",
  "Source Sans 3",
] as const;

const HEX_COLOR = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color");

// z.strictObject rejects unknown keys so a crafted PATCH can't smuggle extra
// JSON into stored settings.
const themeSchema = z
  .strictObject({
    coverImageUrl: z.string().trim().url().max(2000).optional(),
    accentColor: HEX_COLOR.optional(),
    backgroundColor: HEX_COLOR.optional(),
    fontFamily: z.enum(FONT_ALLOW_LIST).optional(),
  })
  .optional();

export const updateFormSettingsSchema = z.object({
  collectEmail: z.boolean(),
  allowMultipleResponses: z.boolean(),
  confirmationMessage: z.string().trim().max(1000),
  // ISO 8601 datetime strings. Validated so a bad value can't silently disable
  // scheduled publish/close (an Invalid Date makes the comparisons no-op).
  scheduledPublishAt: z.string().datetime().nullable().optional(),
  scheduledCloseAt: z.string().datetime().nullable().optional(),
  quizMode: z.boolean().optional(),
  showScore: z.boolean().optional(),
  responseNotification: z.enum(["off", "immediate", "daily"]).optional(),
  sendConfirmationEmail: z.boolean().optional(),
  theme: themeSchema,
  responseEditing: z.enum(["disabled", "timed", "until_close"]).optional(),
  responseEditMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  // Payment config. `amount` is PAISE (the web client converts rupees→paise
  // before sending). strictObject rejects smuggled keys. `amount` is required
  // and bounded, so a missing/out-of-bounds value is rejected in every case
  // including `enabled: true` — no cross-field refinement needed. The
  // enablement-dependent "payment required on submit" rule can't be expressed
  // here (Zod doesn't see stored settings) and lives in the service as
  // PAYMENT_REQUIRED.
  payment: z
    .strictObject({
      enabled: z.boolean(),
      amount: z.number().int().min(100).max(15_000_000),
      description: z.string().trim().max(300).optional(),
    })
    .optional(),
});

export type UpdateFormSettingsInput = z.infer<
  typeof updateFormSettingsSchema
>;

export const createFormSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
});

export const updateFormSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const saveAsTemplateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(100).optional(),
});

const questionTypeSchema = z.enum([
  "SHORT_TEXT",
  "LONG_TEXT",
  "EMAIL",
  "NUMBER",
  "DATE",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "RATING",
  "YES_NO",
  "PHONE",
  "URL",
  "FILE_UPLOAD",
  "SIGNATURE",
  "LINEAR_SCALE",
  "MULTI_ENTRY",
]);

const questionOptionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
});

export const createQuestionSchema = z.object({
  label: z.string().trim().min(1).max(500),
  description: z.string().trim().max(1000).optional(),
  type: questionTypeSchema,
  required: z.boolean().default(false),
  options: z.array(questionOptionSchema).max(100).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  sectionId: z.string().min(1).optional(),
});

export const createSectionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

const jumpRuleSchema = z.object({
  questionId: z.string().min(1),
  operator: z.enum(["equals", "not_equals", "contains", "not_empty"]),
  value: z.string().max(10_000).optional(),
  // A section id or the submit sentinel. Forward-only is NOT enforced here
  // (Zod can't see sibling sections); the service's replay guard and the editor
  // enforce it. Length-bounded to reject blobs.
  target: z.string().min(1).max(200),
});

export const updateSectionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  jumpRules: z.array(jumpRuleSchema).max(20).optional(),
});

export const updateQuestionSchema = z.object({
  label: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  type: questionTypeSchema.optional(),
  required: z.boolean().optional(),
  options: z.array(questionOptionSchema).max(100).nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  conditions: z.array(z.object({
    questionId: z.string().min(1),
    operator: z.enum(["equals", "not_equals", "contains", "not_empty"]),
    value: z.string().optional(),
  })).max(10).nullable().optional(),
});

export const reorderQuestionsSchema = z.object({
  questionIds: z.array(z.string().min(1)).min(1).max(200),
});
export const submitResponseSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  email: z.email().optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .optional(),
  // Present only when the form requires payment. All three ids/signature are
  // required when present; the service enforces presence (PAYMENT_REQUIRED)
  // when the form has payment enabled.
  payment: z
    .object({
      razorpayOrderId: z.string().min(1).max(200),
      razorpayPaymentId: z.string().min(1).max(200),
      razorpaySignature: z.string().min(1).max(500),
    })
    .optional(),
});

// Body for the pre-Checkout duplicate pre-check (POST /public/:slug/response-check).
// Boolean-only response; same email rule as submit.
export const responseCheckSchema = z.object({
  email: z.email(),
});

export type ResponseCheckInput = z.infer<typeof responseCheckSchema>;

export const editResponseSchema = submitResponseSchema.extend({
  editToken: z.string().min(1).max(2000),
});

export const responseListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

// Public "track" endpoint (POST /public/:slug/track) accepts ONLY a start
// event. The handler hardcodes the written value after this literal passes, so
// a crafted body like { event: "submission" } is rejected with a 400 and the
// endpoint can never inject an arbitrary analytics event. See design §1.
export const trackEventSchema = z.object({
  event: z.literal("start"),
});

export type TrackEventInput = z.infer<typeof trackEventSchema>;

// Query contract for GET /:formId/report. All params optional (bare endpoint ==
// today's behavior). `value` is bounded to match jumpRuleSchema's max(10_000).
// Two refinements (design §2): (a) from <= to when both present; (b) the
// cross-question filter is all-or-nothing on (questionId, operator), and value
// is required for every operator except not_empty.
export const reportQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    filterQuestionId: z.string().min(1).optional(),
    filterOperator: z
      .enum(["equals", "not_equals", "contains", "not_empty"])
      .optional(),
    filterValue: z.string().max(10_000).optional(),
  })
  .refine(
    (q) => !(q.from && q.to) || new Date(q.from) <= new Date(q.to),
    { message: "`from` must be on or before `to`.", path: ["from"] },
  )
  .refine(
    (q) => {
      const hasFilter = Boolean(q.filterQuestionId || q.filterOperator);
      if (!hasFilter) return true;
      if (!q.filterQuestionId || !q.filterOperator) return false;
      if (q.filterOperator !== "not_empty" && (q.filterValue ?? "") === "")
        return false;
      return true;
    },
    {
      message:
        "A cross-question filter needs a question, an operator, and (except for not_empty) a value.",
      path: ["filterQuestionId"],
    },
  );

export type ReportQueryInput = z.infer<typeof reportQuerySchema>;

