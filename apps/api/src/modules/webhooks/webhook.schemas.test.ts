import { describe, it, expect } from "vitest";

import { createWebhookSchema, updateWebhookSchema } from "./webhook.schemas.js";

describe("createWebhookSchema events", () => {
  it("rejects an unknown event name", () => {
    const result = createWebhookSchema.safeParse({
      url: "https://example.com/hook",
      events: ["response.created", "form.deleted"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid events array", () => {
    const result = createWebhookSchema.safeParse({
      url: "https://example.com/hook",
      events: ["response.created", "form.published", "form.closed"],
    });
    expect(result.success).toBe(true);
  });

  it("allows events to be omitted (optional)", () => {
    const result = createWebhookSchema.safeParse({
      url: "https://example.com/hook",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty events array", () => {
    const result = createWebhookSchema.safeParse({
      url: "https://example.com/hook",
      events: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("updateWebhookSchema events", () => {
  it("accepts enabled with an optional valid events array", () => {
    const result = updateWebhookSchema.safeParse({
      enabled: true,
      events: ["form.published"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown event name", () => {
    const result = updateWebhookSchema.safeParse({
      enabled: false,
      events: ["nope"],
    });
    expect(result.success).toBe(false);
  });
});
