import { describe, expect, it } from "vitest";
import {
  FONT_ALLOW_LIST,
  updateFormSettingsSchema,
  saveDraftSchema,
  loadDraftQuerySchema,
  deleteDraftBodySchema,
  emailDraftSchema,
} from "./form.schemas.js";

const baseSettings = {
  collectEmail: false,
  allowMultipleResponses: true,
  confirmationMessage: "",
};

describe("updateFormSettingsSchema theme", () => {
  it("accepts a valid theme", () => {
    const result = updateFormSettingsSchema.safeParse({
      ...baseSettings,
      theme: {
        coverImageUrl: "https://example.com/cover.png",
        accentColor: "#2563eb",
        backgroundColor: "#fff",
        fontFamily: "Inter",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty theme object", () => {
    const result = updateFormSettingsSchema.safeParse({
      ...baseSettings,
      theme: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts settings with no theme key", () => {
    const result = updateFormSettingsSchema.safeParse(baseSettings);
    expect(result.success).toBe(true);
  });

  it("rejects a bad hex color", () => {
    const result = updateFormSettingsSchema.safeParse({
      ...baseSettings,
      theme: { accentColor: "blue" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-allow-list font", () => {
    const result = updateFormSettingsSchema.safeParse({
      ...baseSettings,
      theme: { fontFamily: "Comic Sans MS" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL cover image", () => {
    const result = updateFormSettingsSchema.safeParse({
      ...baseSettings,
      theme: { coverImageUrl: "not-a-url" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys in the theme object", () => {
    const result = updateFormSettingsSchema.safeParse({
      ...baseSettings,
      theme: { evil: "payload" },
    });
    expect(result.success).toBe(false);
  });
});

describe("updateFormSettingsSchema allowPartialSave", () => {
  it("accepts allowPartialSave as an optional boolean", () => {
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        allowPartialSave: true,
      }).success,
    ).toBe(true);
    // Omitting it is still valid (optional).
    expect(updateFormSettingsSchema.safeParse(baseSettings).success).toBe(true);
  });

  it("rejects a non-boolean allowPartialSave", () => {
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        allowPartialSave: "yes",
      }).success,
    ).toBe(false);
  });
});

describe("updateFormSettingsSchema capacity", () => {
  it("accepts a valid capacity block (enabled + limit)", () => {
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        capacity: { enabled: true, limit: 120 },
      }).success,
    ).toBe(true);
  });

  it("accepts the lower bound (limit 1) and upper bound (1,000,000)", () => {
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        capacity: { enabled: true, limit: 1 },
      }).success,
    ).toBe(true);
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        capacity: { enabled: false, limit: 1_000_000 },
      }).success,
    ).toBe(true);
  });

  it("accepts settings with no capacity key (optional)", () => {
    expect(updateFormSettingsSchema.safeParse(baseSettings).success).toBe(true);
  });

  it("rejects a non-integer limit", () => {
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        capacity: { enabled: true, limit: 12.5 },
      }).success,
    ).toBe(false);
  });

  it("rejects a zero or negative limit", () => {
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        capacity: { enabled: true, limit: 0 },
      }).success,
    ).toBe(false);
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        capacity: { enabled: true, limit: -5 },
      }).success,
    ).toBe(false);
  });

  it("rejects a limit above 1,000,000", () => {
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        capacity: { enabled: true, limit: 1_000_001 },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-boolean enabled", () => {
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        capacity: { enabled: "yes", limit: 10 },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys in the capacity object", () => {
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        capacity: { enabled: true, limit: 10, evil: "payload" },
      }).success,
    ).toBe(false);
  });

  it("rejects a capacity object missing limit", () => {
    expect(
      updateFormSettingsSchema.safeParse({
        ...baseSettings,
        capacity: { enabled: true },
      }).success,
    ).toBe(false);
  });
});

describe("saveDraftSchema", () => {
  it("accepts a minimal body (answers only)", () => {
    expect(saveDraftSchema.safeParse({ answers: {} }).success).toBe(true);
  });

  it("accepts answers + email + currentSection + token", () => {
    expect(
      saveDraftSchema.safeParse({
        answers: { q1: "a" },
        email: "a@example.com",
        currentSection: 2,
        token: "abc",
      }).success,
    ).toBe(true);
  });

  it("rejects answers serialized over the ~500 KB cap with a 400-shaped error", () => {
    const big = "x".repeat(520_000);
    const result = saveDraftSchema.safeParse({ answers: { blob: big } });
    expect(result.success).toBe(false);
  });

  it("rejects a negative currentSection", () => {
    expect(
      saveDraftSchema.safeParse({ answers: {}, currentSection: -1 }).success,
    ).toBe(false);
  });
});

describe("loadDraftQuerySchema / deleteDraftBodySchema / emailDraftSchema", () => {
  it("loadDraftQuerySchema requires a token", () => {
    expect(loadDraftQuerySchema.safeParse({ token: "t" }).success).toBe(true);
    expect(loadDraftQuerySchema.safeParse({}).success).toBe(false);
  });

  it("deleteDraftBodySchema requires a token", () => {
    expect(deleteDraftBodySchema.safeParse({ token: "t" }).success).toBe(true);
    expect(deleteDraftBodySchema.safeParse({}).success).toBe(false);
  });

  it("emailDraftSchema requires a token and a valid email", () => {
    expect(
      emailDraftSchema.safeParse({ token: "t", email: "a@example.com" }).success,
    ).toBe(true);
    expect(
      emailDraftSchema.safeParse({ token: "t", email: "nope" }).success,
    ).toBe(false);
  });
});

describe("FONT_ALLOW_LIST", () => {
  it("contains exactly the eight expected families", () => {
    expect([...FONT_ALLOW_LIST]).toEqual([
      "Inter",
      "Roboto",
      "Poppins",
      "Montserrat",
      "Open Sans",
      "Lora",
      "Playfair Display",
      "Source Sans 3",
    ]);
  });
});
