import { describe, expect, it } from "vitest";
import type { Question } from "../types";
import {
  formatGridAnswer,
  groupQuestionTypes,
  isAnswerMissing,
  isGridAnswerMissing,
  setGridCell,
} from "./questionTypes";
import { imageLayout } from "../components/QuestionImage";
import { validateQuestionFormat } from "./validation";
import { resolvePipedLabel } from "./piping";

const grid = (type: Question["type"], extra: object = {}): Question => ({
  id: "g",
  label: "Grid",
  type,
  required: true,
  settings: {
    rows: [{ value: "r1", label: "Food" }, { value: "r2", label: "Service" }],
    columns: [{ value: "c1", label: "Poor" }, { value: "c2", label: "Good" }],
    ...extra,
  },
});

describe("grid helpers", () => {
  it("sets one column per row for multiple choice grids", () => {
    const a = setGridCell("MULTIPLE_CHOICE_GRID", undefined, "r1", "c1");
    expect(setGridCell("MULTIPLE_CHOICE_GRID", a, "r1", "c2")).toEqual({ r1: "c2" });
  });
  it("toggles columns for checkbox grids and drops empty rows", () => {
    let a = setGridCell("CHECKBOX_GRID", undefined, "r1", "c1", true);
    a = setGridCell("CHECKBOX_GRID", a, "r1", "c2", true);
    expect(a).toEqual({ r1: ["c1", "c2"] });
    a = setGridCell("CHECKBOX_GRID", a, "r1", "c1", false);
    a = setGridCell("CHECKBOX_GRID", a, "r1", "c2", false);
    expect(a).toEqual({});
  });
  it("requires each row only when asked", () => {
    expect(isGridAnswerMissing(grid("MULTIPLE_CHOICE_GRID"), { r1: "c1" })).toBe(false);
    const strict = grid("MULTIPLE_CHOICE_GRID", { requireEachRow: true });
    expect(isGridAnswerMissing(strict, { r1: "c1" })).toBe(true);
    expect(isGridAnswerMissing(strict, { r1: "c1", r2: "c2" })).toBe(false);
    expect(isAnswerMissing(strict, undefined)).toBe(true);
  });
  it("formats answers with labels", () => {
    expect(formatGridAnswer(grid("CHECKBOX_GRID"), { r1: ["c1", "c2"] })).toBe("Food: Poor, Good");
  });
  it("is used by piping and has no format error", () => {
    const q = grid("MULTIPLE_CHOICE_GRID");
    expect(resolvePipedLabel("x {{g}}", [q], { g: { r2: "c2" } })).toBe("x Service: Good");
    expect(validateQuestionFormat(q, { r1: "c1" })).toBeNull();
  });
});

describe("question type groups", () => {
  it("groups like Google Forms and keeps unknown types", () => {
    const groups = groupQuestionTypes(["TIME", "SHORT_TEXT", "RATING", "SINGLE_CHOICE"]);
    expect(groups).toEqual([["SHORT_TEXT"], ["SINGLE_CHOICE"], ["RATING"], ["TIME"]]);
  });
});

describe("time validation", () => {
  it("accepts HH:MM only", () => {
    const q: Question = { id: "t", label: "T", type: "TIME", required: false };
    expect(validateQuestionFormat(q, "09:30")).toBeNull();
    expect(validateQuestionFormat(q, "9:3")).not.toBeNull();
  });
});

describe("imageLayout", () => {
  it("aligns the figure box left, center and right", () => {
    expect(imageLayout("LEFT", undefined).figure.alignItems).toBe("flex-start");
    expect(imageLayout("CENTER", undefined).figure.alignItems).toBe("center");
    expect(imageLayout("RIGHT", undefined).figure.alignItems).toBe("flex-end");
    expect(imageLayout(undefined, undefined).figure.alignItems).toBe("flex-start");
  });
  it("applies a percent width only below 100", () => {
    expect(imageLayout("LEFT", 50).box.width).toBe("50%");
    expect(imageLayout("LEFT", 100).box.width).toBeUndefined();
    expect(imageLayout("LEFT", undefined).box.width).toBeUndefined();
  });
  it("aligns the caption text with the image", () => {
    expect(imageLayout("RIGHT", 25).box.textAlign).toBe("right");
  });
});
