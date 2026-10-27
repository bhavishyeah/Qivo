import { describe, it, expect } from "vitest";
import { validateSubmission } from "./form.service.js";

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
});
