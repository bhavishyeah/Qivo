import { describe, expect, it } from "vitest";
import { answerableQuestions, displayNumber, isAnswerable } from "./questionKinds";

const list = [
  { id: "a", type: "SHORT_TEXT" as const },
  { id: "t", type: "TEXT_BLOCK" as const },
  { id: "b", type: "RATING" as const },
  { id: "i", type: "IMAGE_BLOCK" as const },
  { id: "c", type: "YES_NO" as const },
];

describe("questionKinds", () => {
  it("flags blocks as non-answerable", () => {
    expect(isAnswerable({ type: "TEXT_BLOCK" })).toBe(false);
    expect(isAnswerable({ type: "IMAGE_BLOCK" })).toBe(false);
    expect(isAnswerable({ type: "SHORT_TEXT" })).toBe(true);
  });

  it("filters blocks out", () => {
    expect(answerableQuestions(list).map((q) => q.id)).toEqual(["a", "b", "c"]);
  });

  it("numbers only answerable questions", () => {
    expect(displayNumber(list, "a")).toBe(1);
    expect(displayNumber(list, "b")).toBe(2);
    expect(displayNumber(list, "c")).toBe(3);
    expect(displayNumber(list, "t")).toBeNull();
    expect(displayNumber(list, "i")).toBeNull();
    expect(displayNumber(list, "missing")).toBeNull();
  });
});
