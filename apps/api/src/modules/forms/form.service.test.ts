import { describe, it, expect } from "vitest";
import {
  validateSubmission,
  nextSectionAfter,
  computeReachedSections,
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
