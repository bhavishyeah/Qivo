import { describe, expect, it } from "vitest";
import {
  formatGridAnswer,
  isGridAnswerMissing,
  isValidScaleAnswer,
  isValidTime,
  parseGridConfig,
  validateGridAnswer,
  validateQuestionSettings,
} from "./questionTypes.js";
import { validateSubmission } from "./form.service.js";
import { createQuestionSchema, updateQuestionSchema } from "./form.schemas.js";

const gridSettings = {
  rows: [
    { value: "r1", label: "Food" },
    { value: "r2", label: "Service" },
  ],
  columns: [
    { value: "c1", label: "Poor" },
    { value: "c2", label: "Good" },
  ],
};

function schemaWith(questions: Array<Record<string, unknown>>) {
  return {
    version: 1,
    sections: [{ id: "s1", title: "S", questions }],
    settings: { collectEmail: false, allowMultipleResponses: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("settings validation", () => {
  it("accepts scales 0/1 to 2..10 and rejects others", () => {
    expect(validateQuestionSettings("LINEAR_SCALE", { min: 0, max: 10 })).toBeNull();
    expect(validateQuestionSettings("LINEAR_SCALE", { min: 1, max: 2 })).toBeNull();
    expect(validateQuestionSettings("LINEAR_SCALE", { min: 2, max: 5 })).not.toBeNull();
    expect(validateQuestionSettings("LINEAR_SCALE", { min: 1, max: 11 })).not.toBeNull();
  });
  it("accepts 3-10 star ratings", () => {
    expect(validateQuestionSettings("RATING", { min: 1, max: 5 })).toBeNull();
    expect(validateQuestionSettings("RATING", { min: 1, max: 11 })).not.toBeNull();
  });
  it("requires rows and columns for grids", () => {
    expect(validateQuestionSettings("CHECKBOX_GRID", gridSettings)).toBeNull();
    expect(validateQuestionSettings("CHECKBOX_GRID", { rows: [], columns: [] })).not.toBeNull();
    expect(
      validateQuestionSettings("MULTIPLE_CHOICE_GRID", {
        ...gridSettings,
        rows: [gridSettings.rows[0], gridSettings.rows[0]],
      }),
    ).not.toBeNull();
  });
  it("is enforced by the zod question schemas", () => {
    expect(
      createQuestionSchema.safeParse({ label: "Q", type: "MULTIPLE_CHOICE_GRID", settings: {} }).success,
    ).toBe(false);
    expect(
      createQuestionSchema.safeParse({ label: "Q", type: "MULTIPLE_CHOICE_GRID", settings: gridSettings }).success,
    ).toBe(true);
    expect(
      updateQuestionSchema.safeParse({ type: "LINEAR_SCALE", settings: { min: 1, max: 99 } }).success,
    ).toBe(false);
    expect(createQuestionSchema.safeParse({ label: "T", type: "TIME" }).success).toBe(true);
  });
  it("accepts imageWidth percentages only", () => {
    expect(updateQuestionSchema.safeParse({ imageWidth: 50 }).success).toBe(true);
    expect(updateQuestionSchema.safeParse({ imageWidth: null }).success).toBe(true);
    expect(updateQuestionSchema.safeParse({ imageWidth: 500 }).success).toBe(false);
    expect(updateQuestionSchema.safeParse({ imageAlign: "RIGHT" }).data).toEqual({ imageAlign: "RIGHT" });
  });
});

describe("answer helpers", () => {
  it("validates time as HH:MM", () => {
    expect(isValidTime("09:30")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("9:30")).toBe(false);
  });
  it("validates scale answers within bounds", () => {
    expect(isValidScaleAnswer("RATING", { min: 1, max: 5 }, 5)).toBe(true);
    expect(isValidScaleAnswer("RATING", { min: 1, max: 5 }, 6)).toBe(false);
    expect(isValidScaleAnswer("LINEAR_SCALE", { min: 0, max: 10 }, "0")).toBe(true);
    expect(isValidScaleAnswer("LINEAR_SCALE", { min: 1, max: 10 }, 2.5)).toBe(false);
  });
  it("validates grid answers", () => {
    const config = parseGridConfig(gridSettings)!;
    expect(validateGridAnswer("MULTIPLE_CHOICE_GRID", config, { r1: "c1" })).toBeNull();
    expect(validateGridAnswer("MULTIPLE_CHOICE_GRID", config, { r1: ["c1"] })).not.toBeNull();
    expect(validateGridAnswer("MULTIPLE_CHOICE_GRID", config, { rX: "c1" })).not.toBeNull();
    expect(validateGridAnswer("CHECKBOX_GRID", config, { r1: ["c1", "c2"] })).toBeNull();
    expect(validateGridAnswer("CHECKBOX_GRID", config, { r1: ["c1", "c1"] })).not.toBeNull();
    expect(validateGridAnswer("CHECKBOX_GRID", config, { r1: "c1" })).not.toBeNull();
  });
  it("applies require-one-per-row", () => {
    const loose = parseGridConfig(gridSettings);
    const strict = parseGridConfig({ ...gridSettings, requireEachRow: true });
    expect(isGridAnswerMissing(loose, { r1: "c1" })).toBe(false);
    expect(isGridAnswerMissing(strict, { r1: "c1" })).toBe(true);
    expect(isGridAnswerMissing(strict, { r1: "c1", r2: "c2" })).toBe(false);
    expect(isGridAnswerMissing(loose, {})).toBe(true);
  });
  it("formats grid answers with labels", () => {
    const config = parseGridConfig(gridSettings);
    expect(formatGridAnswer(config, { r1: ["c1", "c2"], r2: "c2" })).toBe("Food: Poor, Good; Service: Good");
  });
});

describe("validateSubmission with the new types", () => {
  it("rejects out-of-range ratings and bad times", () => {
    const schema = schemaWith([
      { id: "q1", label: "R", type: "RATING", required: false, settings: { min: 1, max: 5 } },
      { id: "q2", label: "T", type: "TIME", required: false },
    ]);
    expect(() => validateSubmission(schema, { q1: 5, q2: "10:15" })).not.toThrow();
    expect(() => validateSubmission(schema, { q1: 9 })).toThrow();
    expect(() => validateSubmission(schema, { q2: "25:00" })).toThrow();
  });
  it("enforces required grids and per-row requirement", () => {
    const schema = schemaWith([
      { id: "g", label: "G", type: "MULTIPLE_CHOICE_GRID", required: true, settings: { ...gridSettings, requireEachRow: true } },
    ]);
    expect(() => validateSubmission(schema, {})).toThrow(/required/);
    expect(() => validateSubmission(schema, { g: { r1: "c1" } })).toThrow(/required/);
    expect(() => validateSubmission(schema, { g: { r1: "c1", r2: "c2" } })).not.toThrow();
  });
});
