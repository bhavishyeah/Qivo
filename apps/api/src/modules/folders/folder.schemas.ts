import { z } from "zod";

export const createFolderSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  parentId: z.string().min(1).optional(),
});

export const updateFolderSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  parentId: z.string().min(1).nullable().optional(),
});

export const moveFormToFolderSchema = z.object({
  folderId: z.string().min(1).nullable(),
});

export const duplicateFormSchema = z.object({
  formId: z.string().min(1),
});
