import { describe, expect, it } from "vitest";
import { z } from "zod";

import { zodErrorMessage } from "./zodMessage.js";
import { submitResponseSchema } from "../modules/forms/form.schemas.js";
import { createWebhookSchema } from "../modules/webhooks/webhook.schemas.js";

function messageFor(schema: z.ZodType, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected parse failure");
  return zodErrorMessage(result.error);
}

describe("zodErrorMessage", () => {
  it("maps a bad respondent email to a friendly sentence", () => {
    expect(messageFor(submitResponseSchema, { answers: {}, email: "rewrwe" })).toBe(
      "Please enter a valid email address.",
    );
  });

  it("passes custom webhook messages through unchanged", () => {
    expect(messageFor(createWebhookSchema, { url: "http://example.com/hook" })).toBe(
      "Webhook URL must use https.",
    );
    expect(messageFor(createWebhookSchema, { url: "not a url" })).toBe(
      "A valid URL is required.",
    );
  });

  it("prefixes Zod default messages with a friendly field name", () => {
    const message = messageFor(submitResponseSchema, { email: "a@b.co" });
    expect(message.startsWith("Answers: ")).toBe(true);
  });

  it("falls back to a generic message when there are no issues", () => {
    expect(zodErrorMessage(new z.ZodError([]))).toBe("Invalid request data.");
  });
});
