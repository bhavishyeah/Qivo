import { describe, expect, it } from "vitest";
import {
  NON_ANSWERABLE_TYPES,
  answerableQuestions,
  isAnswerableQuestion,
} from "./questionKinds.js";

describe("questionKinds", () => {
  it("lists the display-only types", () => {
    expect(NON_ANSWERABLE_TYPES).toEqual(["TEXT_BLOCK", "IMAGE_BLOCK"]);
  });

  it("treats blocks as non-answerable and everything else as answerable", () => {
    expect(isAnswerableQuestion({ type: "TEXT_BLOCK" })).toBe(false);
    expect(isAnswerableQuestion({ type: "IMAGE_BLOCK" })).toBe(false);
    expect(isAnswerableQuestion({ type: "SHORT_TEXT" })).toBe(true);
  });

  it("filters blocks out of a list", () => {
    const list = [
      { id: "a", type: "SHORT_TEXT" },
      { id: "b", type: "TEXT_BLOCK" },
      { id: "c", type: "IMAGE_BLOCK" },
      { id: "d", type: "RATING" },
    ];
    expect(answerableQuestions(list).map((q) => q.id)).toEqual(["a", "d"]);
  });
});
