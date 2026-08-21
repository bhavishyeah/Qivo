import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100),
});