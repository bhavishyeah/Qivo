import { describe, it, expect } from "vitest";
import { clampResumeSection } from "./resumeSection";
import { JUMP_TARGET_SUBMIT } from "./sectionJumps";
import type { Section, SectionJumpRule } from "../types";

function section(id: string, jumpRules?: SectionJumpRule[]): Section {
  return { id, title: id, questions: [], ...(jumpRules ? { jumpRules } : {}) };
}

describe("clampResumeSection", () => {
  it("treats a null saved section as the start (history [0], target 0)", () => {
    const sections = [section("s0"), section("s1"), section("s2")];
    expect(clampResumeSection(sections, {}, null)).toEqual({
      history: [0],
      targetIndex: 0,
    });
  });

  it("treats undefined the same as null", () => {
    const sections = [section("s0"), section("s1")];
    expect(clampResumeSection(sections, {}, undefined)).toEqual({
      history: [0],
      targetIndex: 0,
    });
  });

  it("replays a linear path and lands exactly on the saved section", () => {
    const sections = [section("s0"), section("s1"), section("s2")];
    expect(clampResumeSection(sections, {}, 2)).toEqual({
      history: [0, 1, 2],
      targetIndex: 2,
    });
  });

  it("clamps a saved section beyond the last index to the last section", () => {
    const sections = [section("s0"), section("s1")];
    expect(clampResumeSection(sections, {}, 99)).toEqual({
      history: [0, 1],
      targetIndex: 1,
    });
  });

  it("honors a forward jump when replaying: history skips the hidden section", () => {
    const sections = [
      section("s0", [
        { questionId: "q", operator: "equals", value: "x", target: "s2" },
      ]),
      section("s1"),
      section("s2"),
    ];
    // Saved section 2, but the answers route s0 -> s2 directly (s1 skipped).
    expect(clampResumeSection(sections, { q: "x" }, 2)).toEqual({
      history: [0, 2],
      targetIndex: 2,
    });
  });

  it("lands on the furthest reachable section <= saved when the path submits early", () => {
    const sections = [
      section("s0", [
        { questionId: "q", operator: "equals", value: "x", target: JUMP_TARGET_SUBMIT },
      ]),
      section("s1"),
      section("s2"),
    ];
    // Answers make s0 jump straight to submit; saved section 2 is unreachable,
    // so we stay on s0 (the furthest reachable index <= 2).
    expect(clampResumeSection(sections, { q: "x" }, 2)).toEqual({
      history: [0],
      targetIndex: 0,
    });
  });

  it("handles an empty section list without crashing", () => {
    expect(clampResumeSection([], {}, 5)).toEqual({
      history: [0],
      targetIndex: 0,
    });
  });

  it("clamps a negative saved section to 0", () => {
    const sections = [section("s0"), section("s1")];
    expect(clampResumeSection(sections, {}, -3)).toEqual({
      history: [0],
      targetIndex: 0,
    });
  });
});
