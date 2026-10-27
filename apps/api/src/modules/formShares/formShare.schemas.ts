import { z } from "zod";

export const createShareSchema = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(["RESPONDER", "EDITOR", "VIEWER"]),
});
