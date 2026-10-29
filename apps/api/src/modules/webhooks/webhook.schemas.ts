import { z } from "zod";

/**
 * Synchronous validation only. The URL is checked for shape + https scheme
 * here; the async SSRF/DNS check lives in the service (an async refinement
 * under the route's synchronous `.parse` would throw instead of yielding a
 * clean WEBHOOK_URL_INVALID).
 */
export const createWebhookSchema = z.object({
  url: z
    .string()
    .url("A valid URL is required.")
    .refine((value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, "Webhook URL must use https."),
  description: z.string().trim().max(200).optional(),
});

export const updateWebhookSchema = z.object({
  enabled: z.boolean(),
});

export const deliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
