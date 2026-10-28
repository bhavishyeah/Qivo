import { describe, it, expect } from "vitest";
import {
  validateSubmission,
  nextSectionAfter,
  computeReachedSections,
  rebuildSchemaWithFreshIds,
  addCustomTemplatePrefix,
  stripCustomTemplatePrefix,
  isCustomTemplateId,
} from "./form.service.js";

// Minimal FormSchema builder for the shared answer-validation gate. We only
// exercise the three rules in validateSubmission: unknown-question rejection,
// visibility-aware required check (incl. MULTI_ENTRY empty-array), and the
// per-answer type check. No DB involved.
function schemaWith(questions: Array<Record<string, unknown>>) {
  return {
    version: 1,
    sections: [{ id: "s1", title: "Section", questions }],
    settings: { collectEmail: false, allowMultipleResponses: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("validateSubmission", () => {
  it("passes a valid payload", () => {
    const schema = schemaWith([
      { id: "q1", label: "Name", type: "SHORT_TEXT", required: true },
      { id: "q2", label: "Tags", type: "MULTI_ENTRY", required: false },
    ]);
    expect(() =>
      validateSubmission(schema, { q1: "Ada", q2: ["a", "b"] }),
    ).not.toThrow();
  });

  it("throws INVALID_RESPONSE for an unknown question id", () => {
    const schema = schemaWith([
      { id: "q1", label: "Name", type: "SHORT_TEXT", required: false },
    ]);
    try {
      validateSubmission(schema, { q1: "Ada", ghost: "x" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("INVALID_RESPONSE");
    }
  });

  it("throws INVALID_RESPONSE for a missing required answer", () => {
    const schema = schemaWith([
      { id: "q1", label: "Name", type: "SHORT_TEXT", required: true },
    ]);
    try {
      validateSubmission(schema, {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("INVALID_RESPONSE");
    }
  });

  it("throws INVALID_RESPONSE for a required MULTI_ENTRY with only blanks", () => {
    const schema = schemaWith([
      { id: "q1", label: "Tags", type: "MULTI_ENTRY", required: true },
    ]);
    try {
      validateSubmission(schema, { q1: ["", ""] });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("INVALID_RESPONSE");
    }
  });

  it("throws INVALID_RESPONSE for a type-mismatched answer", () => {
    const schema = schemaWith([
      { id: "q1", label: "Email", type: "EMAIL", required: false },
    ]);
    try {
      validateSubmission(schema, { q1: "not-an-email" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("INVALID_RESPONSE");
    }
  });

  // SIGNATURE mirrors FILE_UPLOAD: the answer is an https URL to the uploaded
  // signature PNG.
  it("passes a SIGNATURE answer that is a valid https URL", () => {
    const schema = schemaWith([
      { id: "q1", label: "Sign", type: "SIGNATURE", required: true },
    ]);
    expect(() =>
      validateSubmission(schema, {
        q1: "https://res.cloudinary.com/demo/image/upload/signature.png",
      }),
    ).not.toThrow();
  });

  it("throws INVALID_RESPONSE for a SIGNATURE answer that is not a URL", () => {
    const schema = schemaWith([
      { id: "q1", label: "Sign", type: "SIGNATURE", required: false },
    ]);
    try {
      validateSubmission(schema, { q1: "not-a-url" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("INVALID_RESPONSE");
    }
  });

  it("throws INVALID_RESPONSE for a required SIGNATURE with no answer", () => {
    const schema = schemaWith([
      { id: "q1", label: "Sign", type: "SIGNATURE", required: true },
    ]);
    try {
      validateSubmission(schema, {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("INVALID_RESPONSE");
    }
  });

  it("passes an optional SIGNATURE left blank", () => {
    const schema = schemaWith([
      { id: "q1", label: "Sign", type: "SIGNATURE", required: false },
    ]);
    expect(() => validateSubmission(schema, {})).not.toThrow();
  });
});

// ─── Section jump logic (reach-aware required check) ───────────────────────────

// Multi-section schema builder. Each section is { id, title, questions, jumpRules? }.
function schemaWithSections(
  sections: Array<Record<string, unknown>>,
) {
  return {
    version: 1,
    sections,
    settings: { collectEmail: false, allowMultipleResponses: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("validateSubmission — reach-aware required check", () => {
  it("does NOT enforce a required question in a SKIPPED section", () => {
    // s0 jumps to s2 when gate=yes, skipping s1 which has a required question.
    const schema = schemaWithSections([
      {
        id: "s0",
        title: "A",
        questions: [{ id: "gate", label: "Gate", type: "SHORT_TEXT", required: true }],
        jumpRules: [{ questionId: "gate", operator: "equals", value: "yes", target: "s2" }],
      },
      {
        id: "s1",
        title: "B",
        questions: [{ id: "mid", label: "Middle", type: "SHORT_TEXT", required: true }],
      },
      {
        id: "s2",
        title: "C",
        questions: [{ id: "end", label: "End", type: "SHORT_TEXT", required: true }],
      },
    ]);
    // s1.mid is unanswered but s1 is skipped, so submission is valid.
    expect(() =>
      validateSubmission(schema, { gate: "yes", end: "done" }),
    ).not.toThrow();
  });

  it("STILL enforces a required question in a REACHED section", () => {
    const schema = schemaWithSections([
      {
        id: "s0",
        title: "A",
        questions: [{ id: "gate", label: "Gate", type: "SHORT_TEXT", required: true }],
        jumpRules: [{ questionId: "gate", operator: "equals", value: "yes", target: "s2" }],
      },
      {
        id: "s1",
        title: "B",
        questions: [{ id: "mid", label: "Middle", type: "SHORT_TEXT", required: true }],
      },
      {
        id: "s2",
        title: "C",
        questions: [{ id: "end", label: "End", type: "SHORT_TEXT", required: true }],
      },
    ]);
    // gate != "yes" → no jump → s1 is reached → mid is required and missing.
    try {
      validateSubmission(schema, { gate: "no", end: "done" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("INVALID_RESPONSE");
    }
  });

  it("still composes per-question visibility within a reached section", () => {
    // mid is only visible when show=on; otherwise it is not enforced even though reached.
    const schema = schemaWithSections([
      {
        id: "s0",
        title: "A",
        questions: [{ id: "show", label: "Show", type: "SHORT_TEXT", required: false }],
      },
      {
        id: "s1",
        title: "B",
        questions: [
          {
            id: "mid",
            label: "Middle",
            type: "SHORT_TEXT",
            required: true,
            conditions: [{ questionId: "show", operator: "equals", value: "on" }],
          },
        ],
      },
    ]);
    // show != "on" → mid hidden → not enforced even though s1 is reached.
    expect(() => validateSubmission(schema, { show: "off" })).not.toThrow();
    // show == "on" → mid visible and required → missing → throws.
    try {
      validateSubmission(schema, { show: "on" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("INVALID_RESPONSE");
    }
  });

  it("still type-validates an answer supplied for a skipped-section question", () => {
    const schema = schemaWithSections([
      {
        id: "s0",
        title: "A",
        questions: [{ id: "gate", label: "Gate", type: "SHORT_TEXT", required: true }],
        jumpRules: [{ questionId: "gate", operator: "equals", value: "yes", target: "s2" }],
      },
      {
        id: "s1",
        title: "B",
        questions: [{ id: "mail", label: "Email", type: "EMAIL", required: true }],
      },
      {
        id: "s2",
        title: "C",
        questions: [{ id: "end", label: "End", type: "SHORT_TEXT", required: false }],
      },
    ]);
    // s1 is skipped, but a supplied malformed email answer is still rejected.
    try {
      validateSubmission(schema, { gate: "yes", mail: "not-an-email" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("INVALID_RESPONSE");
    }
  });

  it("still rejects an unknown question id regardless of reachability", () => {
    const schema = schemaWithSections([
      {
        id: "s0",
        title: "A",
        questions: [{ id: "gate", label: "Gate", type: "SHORT_TEXT", required: false }],
      },
    ]);
    try {
      validateSubmission(schema, { ghost: "x" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("INVALID_RESPONSE");
    }
  });
});

describe("server jump helpers", () => {
  const sections = [
    {
      id: "s0",
      title: "A",
      questions: [],
      jumpRules: [{ questionId: "q", operator: "equals" as const, value: "x", target: "s2" }],
    },
    { id: "s1", title: "B", questions: [] },
    { id: "s2", title: "C", questions: [] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any;

  it("nextSectionAfter follows a forward jump", () => {
    expect(nextSectionAfter(sections, 0, { q: "x" })).toEqual({ kind: "section", index: 2 });
  });

  it("nextSectionAfter falls through a malformed target", () => {
    const bad = [
      { id: "s0", title: "A", questions: [], jumpRules: [{ questionId: "q", operator: "not_empty" as const, target: "ghost" }] },
      { id: "s1", title: "B", questions: [] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    expect(nextSectionAfter(bad, 0, { q: "set" })).toEqual({ kind: "section", index: 1 });
  });

  it("computeReachedSections omits a skipped middle section", () => {
    const reached = computeReachedSections(sections, { q: "x" });
    expect(reached.has("s0")).toBe(true);
    expect(reached.has("s1")).toBe(false);
    expect(reached.has("s2")).toBe(true);
  });
});

// ─── Custom template id prefix helpers ────────────────────────────────────────

describe("custom template id prefix helpers", () => {
  it("adds and strips the custom: prefix (round-trip)", () => {
    const id = "clx123abc";
    const prefixed = addCustomTemplatePrefix(id);
    expect(prefixed).toBe("custom:clx123abc");
    expect(stripCustomTemplatePrefix(prefixed)).toBe(id);
  });

  it("stripCustomTemplatePrefix leaves an unprefixed id unchanged", () => {
    expect(stripCustomTemplatePrefix("student-feedback")).toBe("student-feedback");
  });

  it("isCustomTemplateId distinguishes custom from built-in ids", () => {
    expect(isCustomTemplateId("custom:clx123")).toBe(true);
    expect(isCustomTemplateId("student-feedback")).toBe(false);
  });
});

// ─── rebuildSchemaWithFreshIds (snapshot copy with id remapping) ──────────────

describe("rebuildSchemaWithFreshIds", () => {
  function snapshot() {
    return {
      version: 1,
      settings: { collectEmail: false, allowMultipleResponses: true },
      sections: [
        {
          id: "s0",
          title: "A",
          questions: [
            { id: "q_gate", label: "Gate", type: "SHORT_TEXT", required: true },
          ],
          jumpRules: [
            { questionId: "q_gate", operator: "equals", value: "yes", target: "s2" },
            { questionId: "q_gate", operator: "equals", value: "end", target: "__submit__" },
          ],
        },
        {
          id: "s1",
          title: "B",
          questions: [
            {
              id: "q_mid",
              label: "Middle",
              type: "SHORT_TEXT",
              required: false,
              conditions: [{ questionId: "q_gate", operator: "equals", value: "no" }],
            },
          ],
        },
        {
          id: "s2",
          title: "C",
          questions: [{ id: "q_end", label: "End", type: "SHORT_TEXT", required: false }],
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("assigns fresh, unique, prefixed ids to every section and question", () => {
    const rebuilt = rebuildSchemaWithFreshIds(snapshot());
    const sectionIds = rebuilt.sections.map((s) => s.id);
    const questionIds = rebuilt.sections.flatMap((s) =>
      s.questions.map((q) => q.id),
    );

    for (const id of sectionIds) expect(id.startsWith("section_")).toBe(true);
    for (const id of questionIds) expect(id.startsWith("question_")).toBe(true);

    const all = [...sectionIds, ...questionIds];
    expect(new Set(all).size).toBe(all.length); // all unique
    // None of the original ids survive.
    expect(all).not.toContain("s0");
    expect(all).not.toContain("q_gate");
  });

  it("remaps condition questionId references to the new ids", () => {
    const rebuilt = rebuildSchemaWithFreshIds(snapshot());
    const newGateId = rebuilt.sections[0]!.questions[0]!.id;
    const midCondition = rebuilt.sections[1]!.questions[0]!.conditions?.[0];
    expect(midCondition?.questionId).toBe(newGateId);
  });

  it("remaps jumpRules questionId and target, preserving the __submit__ sentinel", () => {
    const rebuilt = rebuildSchemaWithFreshIds(snapshot());
    const newGateId = rebuilt.sections[0]!.questions[0]!.id;
    const newS2Id = rebuilt.sections[2]!.id;
    const rules = rebuilt.sections[0]!.jumpRules ?? [];

    expect(rules).toHaveLength(2);
    expect(rules[0]!.questionId).toBe(newGateId);
    expect(rules[0]!.target).toBe(newS2Id);
    // __submit__ preserved verbatim.
    expect(rules[1]!.target).toBe("__submit__");
  });

  it("drops a jump rule whose target does not resolve", () => {
    const bad = {
      version: 1,
      settings: { collectEmail: false, allowMultipleResponses: true },
      sections: [
        {
          id: "s0",
          title: "A",
          questions: [{ id: "q", label: "Q", type: "SHORT_TEXT", required: false }],
          jumpRules: [{ questionId: "q", operator: "equals", value: "x", target: "ghost" }],
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const rebuilt = rebuildSchemaWithFreshIds(bad);
    expect(rebuilt.sections[0]!.jumpRules).toBeUndefined();
  });

  it("drops a condition whose referenced question does not resolve", () => {
    const bad = {
      version: 1,
      settings: { collectEmail: false, allowMultipleResponses: true },
      sections: [
        {
          id: "s0",
          title: "A",
          questions: [
            {
              id: "q",
              label: "Q",
              type: "SHORT_TEXT",
              required: false,
              conditions: [{ questionId: "ghost", operator: "equals", value: "x" }],
            },
          ],
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const rebuilt = rebuildSchemaWithFreshIds(bad);
    expect(rebuilt.sections[0]!.questions[0]!.conditions).toBeUndefined();
  });

  it("does not mutate the input snapshot", () => {
    const input = snapshot();
    rebuildSchemaWithFreshIds(input);
    expect(input.sections[0].id).toBe("s0");
    expect(input.sections[0].questions[0].id).toBe("q_gate");
  });
});
