import { z } from "zod";

export const inviteMemberSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
});
