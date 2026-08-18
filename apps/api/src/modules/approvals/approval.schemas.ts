import { z } from "zod";

export const submitForReviewSchema = z.object({
  reviewerId: z.string().min(1),
  message: z.string().trim().max(2000).optional(),
});

export const reviewDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
  comment: z.string().trim().max(2000).optional(),
});
