import { z } from "zod";

export const REPORT_REASONS = ["SCAM", "SPAM", "IMPERSONATION", "OTHER"] as const;
export const REPORT_STATUSES = ["OPEN", "REVIEWED", "DISMISSED"] as const;
export const MAX_REPORT_DETAILS = 500;

// Empty strings from the form become "not provided".
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const createReportSchema = z.object({
  reason: z.enum(REPORT_REASONS, { message: "Choose a reason for your report." }),
  details: optionalText(MAX_REPORT_DETAILS, "Details"),
  reporterEmail: z
    .string()
    .trim()
    .max(254, "Email address is too long.")
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.email("Enter a valid email address.").optional()),
  // Honeypot: real users never see or fill this field.
  website: z.string().max(200).optional(),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

export const listReportsQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateReportSchema = z.object({
  status: z.enum(REPORT_STATUSES, { message: "Choose a valid status." }),
});