import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

export const updateWorkspaceBrandingSchema = z.object({
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});