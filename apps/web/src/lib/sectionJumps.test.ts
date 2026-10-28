import { describe, it, expect } from "vitest";
import {
  JUMP_TARGET_SUBMIT,
  computeReachedSections,
  nextSectionAfter,
} from "./sectionJumps";
import type { Section, SectionJumpRule } from "../types";

// Minimal section builder. `questions` is irrelevant to the jump logic, so we
// keep it empty — only id and jumpRules matter here.
function section(
  id: string,
  jumpRules?: SectionJumpRule[],
): Section {
  return { id, title: id, questions: [], ...(jumpRules ? { jumpRules } : {}) };
}

describe("nextSectionAfter", () => {
  it("follows a forward jump when the rule matches", () => {
    const sections = [
      section("s0", [{ questionId: "q", operator: "equals", value: "x", target: "s2" }]),
      section("s1"),
      section("s2"),
    ];
    expect(nextSectionAfter(sections, 0, { q: "x" })).toEqual({ kind: "section", index: 2 });
  });

  it("first matching rule wins across multiple rules", () => {
    const sections = [
      section("s0", [
        { questionId: "q", operator: "equals", value: "a", target: "s1" },
        { questionId: "q", operator: "equals", value: "b", target: "s2" },
      ]),
      section("s1"),
      section("s2"),
    ];
    // Both would be false except the second; ensure the second fires.
    expect(nextSectionAfter(sections, 0, { q: "b" })).toEqual({ kind: "section", index: 2 });
    // When the first matches, it wins even though a later rule also matches.
    const sections2 = [
      section("s0", [
        { questionId: "q", operator: "not_empty", target: "s1" },
        { questionId: "q", operator: "not_empty", target: "s2" },
      ]),
      section("s1"),
      section("s2"),
    ];
    expect(nextSectionAfter(sections2, 0, { q: "anything" })).toEqual({ kind: "section", index: 1 });
  });

  it("falls through to the linear next section when no rule matches", () => {
    const sections = [
      section("s0", [{ questionId: "q", operator: "equals", value: "x", target: "s2" }]),
      section("s1"),
      section("s2"),
    ];
    expect(nextSectionAfter(sections, 0, { q: "other" })).toEqual({ kind: "section", index: 1 });
  });

  it("returns submit on the END/submit sentinel target", () => {
    const sections = [
      section("s0", [{ questionId: "q", operator: "equals", value: "x", target: JUMP_TARGET_SUBMIT }]),
      section("s1"),
    ];
    expect(nextSectionAfter(sections, 0, { q: "x" })).toEqual({ kind: "submit" });
  });

  it("returns submit when there is no next section", () => {
    const sections = [section("s0"), section("s1")];
    expect(nextSectionAfter(sections, 1, {})).toEqual({ kind: "submit" });
  });

  it("ignores a malformed target (unknown id) and falls through", () => {
    const sections = [
      section("s0", [{ questionId: "q", operator: "not_empty", target: "ghost" }]),
      section("s1"),
    ];
    expect(nextSectionAfter(sections, 0, { q: "set" })).toEqual({ kind: "section", index: 1 });
  });

  it("ignores a self target and falls through", () => {
    const sections = [
      section("s0", [{ questionId: "q", operator: "not_empty", target: "s0" }]),
      section("s1"),
    ];
    expect(nextSectionAfter(sections, 0, { q: "set" })).toEqual({ kind: "section", index: 1 });
  });

  it("ignores a backward target and falls through", () => {
    const sections = [
      section("s0"),
      section("s1", [{ questionId: "q", operator: "not_empty", target: "s0" }]),
      section("s2"),
    ];
    expect(nextSectionAfter(sections, 1, { q: "set" })).toEqual({ kind: "section", index: 2 });
  });

  // Operator semantics verbatim, including the contains asymmetry documented in
  // conditions.ts (array branch is case-SENSITIVE, scalar branch is not).
  it("encodes operator semantics verbatim", () => {
    const rule = (operator: SectionJumpRule["operator"], value?: string): SectionJumpRule => ({
      questionId: "q",
      operator,
      ...(value !== undefined ? { value } : {}),
      target: JUMP_TARGET_SUBMIT,
    });
    const s = (r: SectionJumpRule) => [section("s0", [r]), section("s1")];

    // contains: array answer ["Blue"] with value "blue" does NOT match (case-sensitive array branch).
    expect(nextSectionAfter(s(rule("contains", "blue")), 0, { q: ["Blue"] }))
      .toEqual({ kind: "section", index: 1 });
    // contains: scalar answer "Blue" with value "blue" DOES match (case-insensitive scalar branch).
    expect(nextSectionAfter(s(rule("contains", "blue")), 0, { q: "Blue" }))
      .toEqual({ kind: "submit" });
    // equals: array membership — ["a","b"] equals "a" → match.
    expect(nextSectionAfter(s(rule("equals", "a")), 0, { q: ["a", "b"] }))
      .toEqual({ kind: "submit" });
    // equals: scalar exact compare, case-sensitive — "A" equals "a" → no match.
    expect(nextSectionAfter(s(rule("equals", "a")), 0, { q: "A" }))
      .toEqual({ kind: "section", index: 1 });
  });
});

describe("computeReachedSections", () => {
  it("returns an empty set for an empty form", () => {
    expect(computeReachedSections([], {}).size).toBe(0);
  });

  it("reaches every section on a linear form", () => {
    const sections = [section("s0"), section("s1"), section("s2")];
    const reached = computeReachedSections(sections, {});
    expect([...reached].sort()).toEqual(["s0", "s1", "s2"]);
  });

  it("skips the middle section when a forward jump passes over it", () => {
    const sections = [
      section("s0", [{ questionId: "q", operator: "equals", value: "x", target: "s2" }]),
      section("s1"),
      section("s2"),
    ];
    const reached = computeReachedSections(sections, { q: "x" });
    expect(reached.has("s0")).toBe(true);
    expect(reached.has("s1")).toBe(false); // skipped — required questions here are not enforced.
    expect(reached.has("s2")).toBe(true);
  });

  it("stops at a submit-sentinel jump, leaving later sections unreached", () => {
    const sections = [
      section("s0", [{ questionId: "q", operator: "equals", value: "x", target: JUMP_TARGET_SUBMIT }]),
      section("s1"),
      section("s2"),
    ];
    const reached = computeReachedSections(sections, { q: "x" });
    expect([...reached]).toEqual(["s0"]);
  });

  it("terminates on a crafted would-be cycle (backward target is ignored)", () => {
    const sections = [
      section("s0", [{ questionId: "q", operator: "not_empty", target: "s1" }]),
      section("s1", [{ questionId: "q", operator: "not_empty", target: "s0" }]),
    ];
    const reached = computeReachedSections(sections, { q: "set" });
    // s0 → s1 (forward ok); s1 → s0 is backward, ignored → linear next = submit.
    expect([...reached].sort()).toEqual(["s0", "s1"]);
  });
});
