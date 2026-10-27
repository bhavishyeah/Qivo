import { describe, expect, it } from "vitest";
import { FONT_ALLOW_LIST, updateFormSettingsSchema } from "./form.schemas.js";

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
