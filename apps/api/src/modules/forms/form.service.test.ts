import { describe, it, expect } from "vitest";
import {
  validateSubmission,
  nextSectionAfter,
  computeReachedSections,
  rebuildSchemaWithFreshIds,
  addCustomTemplatePrefix,
  stripCustomTemplatePrefix,
  isCustomTemplateId,
  matchesAnswerFilter,
  isWithinRange,
  computeFunnel,
  selectCompletions,
  deriveSampled,
  computeAvgTime,
  computeSectionCompleteness,
  computePeakDay,
  isAllowedUploadUrl,
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

// ─── Rich-analytics pure helpers (FEAT-001) ───────────────────────────────────

describe("matchesAnswerFilter — array-aware operator semantics", () => {
  it("equals: scalar is string-equality", () => {
    expect(matchesAnswerFilter("blue", "equals", "blue")).toBe(true);
    expect(matchesAnswerFilter("blue", "equals", "red")).toBe(false);
    // numeric answers compare as their string form
    expect(matchesAnswerFilter(5, "equals", "5")).toBe(true);
  });

  it("equals: array is array-contains (NOT exact-set)", () => {
    expect(matchesAnswerFilter(["red", "blue"], "equals", "blue")).toBe(true);
    expect(matchesAnswerFilter(["red", "blue"], "equals", "green")).toBe(false);
  });

  it("not_equals: scalar and array are the negation of equals", () => {
    expect(matchesAnswerFilter("blue", "not_equals", "red")).toBe(true);
    expect(matchesAnswerFilter("blue", "not_equals", "blue")).toBe(false);
    expect(matchesAnswerFilter(["red", "blue"], "not_equals", "green")).toBe(true);
    expect(matchesAnswerFilter(["red", "blue"], "not_equals", "blue")).toBe(false);
  });

  it("contains: scalar is case-insensitive substring", () => {
    expect(matchesAnswerFilter("Hello World", "contains", "world")).toBe(true);
    expect(matchesAnswerFilter("Hello World", "contains", "xyz")).toBe(false);
  });

  it("contains: array is some-element substring (case-sensitive per source)", () => {
    expect(matchesAnswerFilter(["apple", "banana"], "contains", "ana")).toBe(true);
    expect(matchesAnswerFilter(["apple", "banana"], "contains", "cherry")).toBe(false);
  });

  it("not_empty: scalar non-empty / array length>0", () => {
    expect(matchesAnswerFilter("x", "not_empty", undefined)).toBe(true);
    expect(matchesAnswerFilter("", "not_empty", undefined)).toBe(false);
    expect(matchesAnswerFilter(null, "not_empty", undefined)).toBe(false);
    expect(matchesAnswerFilter(undefined, "not_empty", undefined)).toBe(false);
    expect(matchesAnswerFilter(["a"], "not_empty", undefined)).toBe(true);
    expect(matchesAnswerFilter([], "not_empty", undefined)).toBe(false);
  });
});

describe("isWithinRange — inclusive date predicate", () => {
  const from = new Date("2024-01-10T00:00:00.000Z");
  const to = new Date("2024-01-20T23:59:59.999Z");

  it("includes instants on or inside the bounds", () => {
    expect(isWithinRange(new Date("2024-01-10T00:00:00.000Z"), from, to)).toBe(true);
    expect(isWithinRange(new Date("2024-01-15T12:00:00.000Z"), from, to)).toBe(true);
    expect(isWithinRange(new Date("2024-01-20T23:59:59.999Z"), from, to)).toBe(true);
  });

  it("excludes instants outside the bounds", () => {
    expect(isWithinRange(new Date("2024-01-09T23:59:59.999Z"), from, to)).toBe(false);
    expect(isWithinRange(new Date("2024-01-21T00:00:00.000Z"), from, to)).toBe(false);
  });

  it("treats missing bounds as open-ended", () => {
    expect(isWithinRange(new Date("2000-01-01T00:00:00.000Z"))).toBe(true);
    expect(isWithinRange(new Date("2024-01-15T00:00:00.000Z"), from)).toBe(true);
    expect(isWithinRange(new Date("2024-01-05T00:00:00.000Z"), from)).toBe(false);
    expect(isWithinRange(new Date("2024-01-25T00:00:00.000Z"), undefined, to)).toBe(false);
  });
});

describe("computeFunnel — conversion math + filter suppression + clamp", () => {
  it("computes rounded percentages when no filter is active", () => {
    const f = computeFunnel(500, 310, 190, false);
    expect(f.views).toBe(500);
    expect(f.starts).toBe(310);
    expect(f.completions).toBe(190);
    expect(f.viewToStart).toBe(62); // 310/500
    expect(f.startToCompletion).toBe(61); // 190/310
    expect(f.viewToCompletion).toBe(38); // 190/500
    expect(f.filterAffectsCompletionsOnly).toBe(false);
  });

  it("suppresses ALL percentages when a cross-question filter is active", () => {
    const f = computeFunnel(500, 310, 42, true);
    expect(f.views).toBe(500);
    expect(f.starts).toBe(310);
    expect(f.completions).toBe(42);
    expect(f.viewToStart).toBeNull();
    expect(f.startToCompletion).toBeNull();
    expect(f.viewToCompletion).toBeNull();
    expect(f.filterAffectsCompletionsOnly).toBe(true);
  });

  it("returns null rates when a denominator is 0 (views=0)", () => {
    const f = computeFunnel(0, 0, 0, false);
    expect(f.viewToStart).toBeNull();
    expect(f.startToCompletion).toBeNull();
    expect(f.viewToCompletion).toBeNull();
  });

  it("reports true counts when starts>views (reload clamp is a UI concern)", () => {
    const f = computeFunnel(100, 140, 90, false);
    expect(f.starts).toBe(140);
    expect(f.viewToStart).toBe(140); // 140/100 == 140%, UI clamps the drawn width
  });
});

describe("selectCompletions — true range-scoped total vs sampled branch", () => {
  it("uses the true range-scoped total when NO filter is active (not capped)", () => {
    // 12,000 in-range responses, sample capped at 5000 — completions is the true total.
    expect(selectCompletions(12_000, 5000, false)).toBe(12_000);
  });

  it("uses the sampled count when a filter IS active", () => {
    expect(selectCompletions(12_000, 73, true)).toBe(73);
  });

  it("agrees with sampled count under the cap with no filter", () => {
    expect(selectCompletions(42, 42, false)).toBe(42);
  });
});

describe("deriveSampled — sampling disclosure flag", () => {
  const CAP = 5000;

  it("no filter: true only when the true range-scoped total exceeds the cap", () => {
    expect(deriveSampled(12_000, 5000, CAP, false)).toBe(true);
    expect(deriveSampled(5000, 5000, CAP, false)).toBe(false); // exactly at cap, not exceeded
    expect(deriveSampled(42, 42, CAP, false)).toBe(false);
  });

  it("filter active: true only when the in-memory sample saturated the cap", () => {
    expect(deriveSampled(12_000, CAP, CAP, true)).toBe(true); // pulled a full capped page
    expect(deriveSampled(12_000, 4999, CAP, true)).toBe(false);
    expect(deriveSampled(42, 42, CAP, true)).toBe(false);
  });
});

describe("computeAvgTime — median/mean/sampleSize with outlier rejection", () => {
  it("returns nulls and sampleSize 0 for an empty set", () => {
    expect(computeAvgTime([])).toEqual({
      medianSeconds: null,
      meanSeconds: null,
      sampleSize: 0,
    });
  });

  it("computes median (odd count) and mean", () => {
    const r = computeAvgTime([10, 30, 20]);
    expect(r.sampleSize).toBe(3);
    expect(r.medianSeconds).toBe(20);
    expect(r.meanSeconds).toBe(20);
  });

  it("averages the two middle values for an even count", () => {
    const r = computeAvgTime([10, 20, 30, 40]);
    expect(r.sampleSize).toBe(4);
    expect(r.medianSeconds).toBe(25); // (20+30)/2
    expect(r.meanSeconds).toBe(25);
  });

  it("rejects non-positive, non-finite, and >=24h outliers", () => {
    const r = computeAvgTime([0, -5, 100, 86_400, 90_000, "x", null, 200]);
    // only 100 and 200 survive
    expect(r.sampleSize).toBe(2);
    expect(r.medianSeconds).toBe(150);
    expect(r.meanSeconds).toBe(150);
  });
});

describe("computeSectionCompleteness — proxy math", () => {
  const sections = [
    { id: "s1", title: "One", questions: [{ id: "a" }, { id: "b" }] },
    { id: "s2", title: "Two", questions: [{ id: "c" }] },
  ];

  it("returns null for single-section forms", () => {
    expect(
      computeSectionCompleteness(
        [{ id: "s1", title: "One", questions: [{ id: "a" }] }],
        [{ a: "x" }],
      ),
    ).toBeNull();
  });

  it("counts a response as completing a section if >=1 question is answered", () => {
    const rows = [
      { a: "x", c: "y" }, // both sections
      { a: "", b: "z", c: "" }, // s1 only (b answered, c blank)
      { a: "", b: "" }, // neither
      { c: "k" }, // s2 only
    ];
    const result = computeSectionCompleteness(sections, rows);
    expect(result).not.toBeNull();
    // s1: rows 0,1 answered -> 2/4 = 50%; s2: rows 0,3 -> 2/4 = 50%
    expect(result![0]).toEqual({ sectionId: "s1", title: "One", percentage: 50 });
    expect(result![1]).toEqual({ sectionId: "s2", title: "Two", percentage: 50 });
  });

  it("yields 0% for every section when there are no responses", () => {
    const result = computeSectionCompleteness(sections, []);
    expect(result![0]!.percentage).toBe(0);
    expect(result![1]!.percentage).toBe(0);
  });
});

describe("computePeakDay", () => {
  it("picks the day with the most submissions", () => {
    const series = [
      { date: "2024-01-01", submissions: 3 },
      { date: "2024-01-02", submissions: 9 },
      { date: "2024-01-03", submissions: 1 },
    ];
    expect(computePeakDay(series)).toEqual({ date: "2024-01-02", count: 9 });
  });

  it("returns null when every day is zero or the series is empty", () => {
    expect(computePeakDay([])).toBeNull();
    expect(
      computePeakDay([
        { date: "2024-01-01", submissions: 0 },
        { date: "2024-01-02", submissions: 0 },
      ]),
    ).toBeNull();
  });
});

describe("FILE_UPLOAD / SIGNATURE url enforcement", () => {
  const OK =
    "https://res.cloudinary.com/demo/raw/upload/v1700000000/qivo/forms/f1/report.pdf";

  it("accepts a valid https res.cloudinary.com delivery URL (type allowed)", () => {
    expect(
      isAllowedUploadUrl(OK, { kind: "file", allowedTypes: ["application/pdf"] }),
    ).toBeNull();
  });

  it("rejects non-Cloudinary hosts, userinfo tricks, and http://", () => {
    const msg = "file must be uploaded to this form";
    // look-alike host (the classic regex-bypass) parses to a different hostname
    expect(
      isAllowedUploadUrl(
        "https://res.cloudinary.com.evil.com/demo/raw/upload/v1/qivo/forms/f1/x.pdf",
        { kind: "file", allowedTypes: [] },
      ),
    ).toBe(msg);
    expect(
      isAllowedUploadUrl("https://evil.com/x.pdf", { kind: "file", allowedTypes: [] }),
    ).toBe(msg);
    // userinfo trick: hostname is evil.com, not res.cloudinary.com
    expect(
      isAllowedUploadUrl(
        "https://res.cloudinary.com@evil.com/demo/raw/upload/v1/qivo/forms/f1/x.pdf",
        { kind: "file", allowedTypes: [] },
      ),
    ).toBe(msg);
    // plain http is rejected before the host even matters
    expect(
      isAllowedUploadUrl(
        "http://res.cloudinary.com/demo/raw/upload/v1/qivo/forms/f1/x.pdf",
        { kind: "file", allowedTypes: [] },
      ),
    ).toBe("expected a file URL");
  });

  it("rejects a known disallowed extension when allowedFileTypes is set", () => {
    expect(
      isAllowedUploadUrl(
        "https://res.cloudinary.com/demo/raw/upload/v1/qivo/forms/f1/malware.exe",
        { kind: "file", allowedTypes: ["application/pdf"] },
      ),
    ).toBe("file type not allowed");
    // a .pdf is disallowed when the allow-list is images-only
    expect(
      isAllowedUploadUrl(OK, { kind: "file", allowedTypes: ["image/*"] }),
    ).toBe("file type not allowed");
  });

  it("accepts an extensionless URL via fallback, but the host check still wins", () => {
    expect(
      isAllowedUploadUrl(
        "https://res.cloudinary.com/demo/raw/upload/v1/qivo/forms/f1/assetwithoutext",
        { kind: "file", allowedTypes: ["application/pdf"] },
      ),
    ).toBeNull();
    // same extensionless path on a bad host is still rejected
    expect(
      isAllowedUploadUrl(
        "https://evil.com/demo/raw/upload/v1/qivo/forms/f1/assetwithoutext",
        { kind: "file", allowedTypes: ["application/pdf"] },
      ),
    ).toBe("file must be uploaded to this form");
  });

  it("accepts SIGNATURE png/jpg and ignores allowedFileTypes", () => {
    // allowedTypes is deliberately a document type to prove it is ignored.
    expect(
      isAllowedUploadUrl(
        "https://res.cloudinary.com/demo/image/upload/v1/qivo/forms/f1/sig.png",
        { kind: "signature", allowedTypes: ["application/pdf"] },
      ),
    ).toBeNull();
    expect(
      isAllowedUploadUrl(
        "https://res.cloudinary.com/demo/image/upload/v1/qivo/forms/f1/sig.jpg",
        { kind: "signature", allowedTypes: ["application/pdf"] },
      ),
    ).toBeNull();
  });

  it("rejects a non-image SIGNATURE", () => {
    expect(
      isAllowedUploadUrl(
        "https://res.cloudinary.com/demo/raw/upload/v1/qivo/forms/f1/sig.pdf",
        { kind: "signature", allowedTypes: [] },
      ),
    ).toBe("signature must be an image");
  });
});
