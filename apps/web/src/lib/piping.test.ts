import { describe, it, expect } from "vitest";
import { resolvePipedLabel } from "./piping";
import type { AnswerValue, Question } from "../types";

function q(partial: Partial<Question> & { id: string }): Question {
  return {
    label: partial.id,
    type: "SHORT_TEXT",
    required: false,
    ...partial,
  };
}

function resolve(
  label: string,
  questions: Question[],
  answers: Record<string, AnswerValue>,
): string {
  return resolvePipedLabel(label, questions, answers);
}

describe("resolvePipedLabel", () => {
  it("resolves a single token to the referenced answer", () => {
    const questions = [q({ id: "question_a", label: "Captain" })];
    expect(resolve("Hi {{question_a}}", questions, { question_a: "Priya" })).toBe(
      "Hi Priya",
    );
  });

  it("tolerates whitespace inside the braces", () => {
    const questions = [q({ id: "question_a" })];
    expect(resolve("{{ question_a }}", questions, { question_a: "X" })).toBe("X");
  });

  it("resolves multiple tokens in one label", () => {
    const questions = [
      q({ id: "question_a" }),
      q({ id: "question_b" }),
    ];
    expect(
      resolve("{{question_a}} and {{question_b}}", questions, {
        question_a: "Alpha",
        question_b: "Beta",
      }),
    ).toBe("Alpha and Beta");
  });

  it("drops an unknown id to empty string", () => {
    expect(resolve("x {{question_missing}} y", [], {})).toBe("x  y");
  });

  it("passes malformed / partial braces through verbatim", () => {
    const questions = [q({ id: "question_a" })];
    const answers = { question_a: "A" };
    expect(resolve("{{", questions, answers)).toBe("{{");
    expect(resolve("{{}}", questions, answers)).toBe("{{}}");
    expect(resolve("{{ foo-bar }}", questions, answers)).toBe("{{ foo-bar }}");
  });

  it("required + unanswered renders the exact fallback copy", () => {
    const questions = [
      q({ id: "question_a", label: "Team captain name ", required: true }),
    ];
    expect(resolve("Confirm {{question_a}}", questions, {})).toBe(
      'Confirm [answer "Team captain name" first]',
    );
  });

  it("optional + unanswered renders blank", () => {
    const questions = [q({ id: "question_a", required: false })];
    expect(resolve("a{{question_a}}b", questions, {})).toBe("ab");
  });

  it("renders a plain string as-is", () => {
    const questions = [q({ id: "question_a", type: "LONG_TEXT" })];
    expect(resolve("{{question_a}}", questions, { question_a: "hello" })).toBe(
      "hello",
    );
  });

  it("stringifies a number answer", () => {
    const questions = [q({ id: "question_a", type: "NUMBER" })];
    expect(resolve("{{question_a}}", questions, { question_a: 42 })).toBe("42");
  });

  it("joins a MULTI_ENTRY string[] skipping blank entries", () => {
    const questions = [q({ id: "question_a", type: "MULTI_ENTRY" })];
    expect(
      resolve("{{question_a}}", questions, {
        question_a: ["Ann", "  ", "Bob"],
      }),
    ).toBe("Ann, Bob");
  });

  it("maps a SINGLE_CHOICE value to its option label", () => {
    const questions = [
      q({
        id: "question_a",
        type: "SINGLE_CHOICE",
        options: [
          { value: "option_1", label: "Red" },
          { value: "option_2", label: "Blue" },
        ],
      }),
    ];
    expect(resolve("{{question_a}}", questions, { question_a: "option_1" })).toBe(
      "Red",
    );
  });

  it("maps MULTIPLE_CHOICE values to labels joined", () => {
    const questions = [
      q({
        id: "question_a",
        type: "MULTIPLE_CHOICE",
        options: [
          { value: "option_1", label: "Red" },
          { value: "option_2", label: "Blue" },
        ],
      }),
    ];
    expect(
      resolve("{{question_a}}", questions, {
        question_a: ["option_1", "option_2"],
      }),
    ).toBe("Red, Blue");
  });

  it("maps YES_NO to Yes / No", () => {
    const questions = [q({ id: "question_a", type: "YES_NO" })];
    expect(resolve("{{question_a}}", questions, { question_a: "yes" })).toBe("Yes");
    expect(resolve("{{question_a}}", questions, { question_a: "no" })).toBe("No");
  });

  it("falls back to the raw value when a selected option was deleted", () => {
    const questions = [
      q({
        id: "question_a",
        type: "SINGLE_CHOICE",
        options: [{ value: "option_2", label: "Blue" }],
      }),
    ];
    expect(resolve("{{question_a}}", questions, { question_a: "option_1" })).toBe(
      "option_1",
    );
  });
});
