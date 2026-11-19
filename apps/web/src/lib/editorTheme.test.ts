import { describe, expect, it } from "vitest";
import {
  buildEditorThemeVars,
  contrastRatio,
  liftForDark,
  mix,
  normalizeHex,
  readableTextOn,
} from "./editorTheme";

describe("editorTheme", () => {
  it("normalizes hex", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("#ABCDEF")).toBe("#abcdef");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });

  it("computes contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("picks readable text", () => {
    expect(readableTextOn("#2563eb")).toBe("#ffffff");
    expect(readableTextOn("#facc15")).toBe("#0f172a");
    expect(readableTextOn("#ffffff")).toBe("#0f172a");
    expect(readableTextOn("#000000")).toBe("#ffffff");
  });

  it("mixes colors", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#102030", "#ffffff", 0)).toBe("#102030");
  });

  it("lifts dark accents to 3:1 against the dark surface", () => {
    const lifted = liftForDark("#1e1b4b");
    expect(contrastRatio(lifted, "#1e293b")).toBeGreaterThanOrEqual(3);
    expect(liftForDark("#93c5fd")).toBe("#93c5fd");
  });

  it("builds vars", () => {
    const v = buildEditorThemeVars({ accent: "#0af", background: "#f0f0f0", fontFamily: "Inter" });
    expect(v["--editor-accent"]).toBe("#00aaff");
    expect(v["--editor-accent-contrast"]).toBeTruthy();
    expect(v["--editor-accent-soft"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(v["--editor-accent-dark"]!, "#1e293b")).toBeGreaterThanOrEqual(3);
    expect(v["--editor-bg"]).toBe("#f0f0f0");
    expect(v["--editor-font"]).toContain("Inter");
  });

  it("returns {} for empty or invalid input", () => {
    expect(buildEditorThemeVars({})).toEqual({});
    expect(buildEditorThemeVars({ accent: "", background: "", fontFamily: "" })).toEqual({});
    expect(buildEditorThemeVars({ accent: "nope", background: "#zzz", fontFamily: "Comic Sans" })).toEqual({});
  });
});
