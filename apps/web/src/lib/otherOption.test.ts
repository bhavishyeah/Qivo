import { describe, expect, it } from "vitest";
import {
  findOtherAnswer,
  formatOtherAnswer,
  isOtherAnswer,
  makeOtherAnswer,
  normalizeOtherAnswers,
  otherAnswerProblem,
  otherText,
  questionAllowsOther,
} from "./otherOption";
import { evaluateConditions } from "./conditions";
import { resolvePipedLabel } from "./piping";
import { isAnswerMissing } from "./questionTypes";
import { validateQuestionFormat } from "./validation";
import type { Question } from "../types";

const single: Question = {
  id: "q1",
  label: "Pick",
  type: "SINGLE_CHOICE",
  required: true,
  options: [{ value: "a", label: "Alpha" }],
  settings: { allowOther: true },
};

describe("otherOption", () => {
  it("builds, detects and formats Other answers", () => {
    const stored = makeOtherAnswer(" Radio ");
    expect(isOtherAnswer(stored)).toBe(true);
    expect(isOtherAnswer("a")).toBe(false);
    expect(otherText(stored)).toBe("Radio");
    expect(formatOtherAnswer(stored)).toBe("Other: Radio");
  });

  it("flags an empty Other and finds it inside arrays", () => {
    expect(otherAnswerProblem("__other__:  ")).toMatch(/Other/);
    expect(otherAnswerProblem(["a", "__other__:"])).toMatch(/Other/);
    expect(otherAnswerProblem(["a", "__other__:x"])).toBeNull();
    expect(otherAnswerProblem("a")).toBeNull();
    expect(findOtherAnswer(["a", "__other__:x"])).toBe("__other__:x");
  });

  it("only allows Other on single and multiple choice", () => {
    expect(questionAllowsOther(single)).toBe(true);
    expect(questionAllowsOther({ ...single, type: "DROPDOWN" })).toBe(false);
    expect(questionAllowsOther({ ...single, settings: {} })).toBe(false);
  });

  it("trims Other answers before submit and leaves others alone", () => {
    expect(
      normalizeOtherAnswers({ a: "__other__: hi ", b: ["x", "__other__: yo "], c: "plain" }),
    ).toEqual({ a: "__other__:hi", b: ["x", "__other__:yo"], c: "plain" });
  });

  it("validates format: empty Other is an error", () => {
    expect(validateQuestionFormat(single, "__other__:")).toMatch(/Other/);
    expect(validateQuestionFormat(single, "__other__:ok")).toBeNull();
  });

  it("is not equal to any listed option in conditions", () => {
    const rule = [{ questionId: "q1", operator: "equals" as const, value: "a" }];
    expect(evaluateConditions(rule, { q1: "__other__:a" })).toBe(false);
    const not = [{ questionId: "q1", operator: "not_equals" as const, value: "a" }];
    expect(evaluateConditions(not, { q1: "__other__:a" })).toBe(true);
  });

  it("pipes the typed text", () => {
    expect(resolvePipedLabel("You chose {{q1}}", [single], { q1: "__other__:Radio" })).toBe(
      "You chose Radio",
    );
  });

  it("counts an empty Other as unanswered for required checks", () => {
    expect(isAnswerMissing(single, "__other__:  ")).toBe(true);
    expect(isAnswerMissing(single, "__other__:x")).toBe(false);
  });
});
