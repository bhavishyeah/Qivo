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

export const updateSectionSchema = z.object({
  title: z.string().trim().min(1).max(200),
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
});

export const editResponseSchema = submitResponseSchema.extend({
  editToken: z.string().min(1).max(2000),
});

export const responseListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

