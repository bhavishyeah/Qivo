import { z } from "zod";

export const updateFormSettingsSchema = z.object({
  collectEmail: z.boolean(),
  allowMultipleResponses: z.boolean(),
  confirmationMessage: z.string().trim().max(1000),
  scheduledPublishAt: z.string().nullable().optional(),
  scheduledCloseAt: z.string().nullable().optional(),
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
  "LINEAR_SCALE",
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

export const responseListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

