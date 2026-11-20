import { describe, expect, it } from "vitest";
import { contrastRatio } from "./editorTheme";
import { accentTextOn, pageTextColors, publicFormVars } from "./publicFormTheme";

describe("pageTextColors", () => {
  const backgrounds = {
    white: "#ffffff",
    light: "#f4f7fb",
    cream: "#fef3c7",
    mid: "#6aa2dc",
    midDark: "#2e7d6b",
    worstCase: "#767676",
    dark: "#1e293b",
    black: "#000000",
  };

  for (const [name, bg] of Object.entries(backgrounds)) {
    it(`text and muted reach AA on the ${name} background (${bg})`, () => {
      const { text, muted } = pageTextColors(bg);
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(muted, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("uses dark text on light backgrounds and light text on dark ones", () => {
    expect(pageTextColors("#ffffff").text).not.toBe("#ffffff");
    expect(pageTextColors("#1e293b").text).toBe("#ffffff");
  });

  it("keeps muted visibly softer than text when there is room", () => {
    const { text, muted } = pageTextColors("#ffffff");
    expect(muted).not.toBe(text);
  });

  it("falls back to the default page background for missing or invalid input", () => {
    expect(pageTextColors(undefined)).toEqual(pageTextColors(null));
    expect(pageTextColors("not-a-colour")).toEqual(pageTextColors(undefined));
    const { text, muted } = pageTextColors(undefined);
    expect(contrastRatio(text, "#dbeafe")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, "#dbeafe")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("accentTextOn", () => {
  it("returns an accent shade readable on white", () => {
    for (const accent of ["#b2fd00", "#42005f", "#6aa2dc", "#2563eb"]) {
      expect(contrastRatio(accentTextOn(accent), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("publicFormVars", () => {
  it("includes the background only when the form sets one", () => {
    expect(publicFormVars({})["--qivo-form-bg"]).toBeUndefined();
    expect(publicFormVars({ background: "#6aa2dc" })["--qivo-form-bg"]).toBe("#6aa2dc");
  });

  it("derives page text variables from the background", () => {
    const v = publicFormVars({ background: "#6aa2dc", accent: "#42005f" });
    expect(contrastRatio(v["--pf-muted"]!, "#6aa2dc")).toBeGreaterThanOrEqual(4.5);
    expect(v["--pf-accent"]).toBe("#42005f");
    expect(v["--pf-accent-ink"]).toBe("#ffffff");
  });
});