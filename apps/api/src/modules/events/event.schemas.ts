import { z } from "zod";

export const createEventSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const updateEventSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const addFormToEventSchema = z.object({
  formId: z.string().min(1),
});
