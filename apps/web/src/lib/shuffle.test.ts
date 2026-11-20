import { describe, expect, it } from "vitest";
import type { Question, Section } from "../types";
import {
  createRng,
  displayOptions,
  getShuffleSeed,
  newShuffleSeed,
  seededShuffle,
  shuffleOptions,
  shuffleQuestionList,
  shuffleWithinSections,
} from "./shuffle";
import { evaluateConditions } from "./conditions";

const nums = Array.from({ length: 20 }, (_, i) => i);

function q(id: string, type: Question["type"] = "SHORT_TEXT"): Question {
  return { id, label: id, type, required: false };
}

function cond(id: string, controller: string, value: string): Question {
  return { ...q(id), conditions: [{ questionId: controller, operator: "equals", value }] };
}

function flat(sections: Section[]): Question[] {
  return sections.flatMap((s) => s.questions);
}

/** Find a seed that puts `child` above `controller` in a one-section form. */
function seedWithChildFirst(questions: Question[], childId: string, controllerId: string): string {
  for (let i = 0; i < 500; i += 1) {
    const ids = shuffleQuestionList(questions, `s${i}:sec`).map((x) => x.id);
    if (ids.indexOf(childId) < ids.indexOf(controllerId)) return `s${i}`;
  }
  throw new Error("no seed found");
}

describe("shuffled forms with conditions", () => {
  const controller: Question = {
    ...q("ctrl", "SINGLE_CHOICE"),
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  };
  const child = cond("child", "ctrl", "yes");
  const section: Section = {
    id: "sec",
    title: "S",
    questions: [controller, child, q("x1"), q("x2")],
  } as Section;

  it("keeps a conditional above its controller hidden until answered, then shows it", () => {
    const seed = seedWithChildFirst(section.questions, "child", "ctrl");
    const [shuffled] = shuffleWithinSections([section], seed);
    const ids = (shuffled as Section).questions.map((x) => x.id);
    expect(ids.indexOf("child")).toBeLessThan(ids.indexOf("ctrl"));
    const visible = (answers: Record<string, string>) =>
      (shuffled as Section).questions.filter((x) => evaluateConditions(x.conditions, answers)).map((x) => x.id);
    expect(() => visible({})).not.toThrow();
    expect(visible({})).not.toContain("child");
    expect(visible({ ctrl: "no" })).not.toContain("child");
    expect(visible({ ctrl: "yes" })).toContain("child");
  });

  it("evaluates conditions from the answers map, not from position", () => {
    const answers = { ctrl: "yes" };
    for (let i = 0; i < 20; i += 1) {
      const shuffled = flat(shuffleWithinSections([section], `seed-${i}`));
      const shown = shuffled.filter((x) => evaluateConditions(x.conditions, answers)).map((x) => x.id);
      expect(shown.sort()).toEqual(["child", "ctrl", "x1", "x2"]);
      const hidden = shuffled.filter((x) => evaluateConditions(x.conditions, {})).map((x) => x.id);
      expect(hidden).not.toContain("child");
    }
  });

  it("gives the same order when a resumed draft supplies the same seed", () => {
    const original = "draft-seed-1";
    const first = shuffleWithinSections([section], original).map((s) => s.questions.map((x) => x.id));
    // Another device: different local seed, but the draft seed is used.
    const localSeed = "other-device";
    const draftSeed: string | null = original;
    const resumedSeed = draftSeed ?? localSeed;
    expect(shuffleWithinSections([section], localSeed).map((s) => s.questions.map((x) => x.id))).not.toEqual(first);
    const second = shuffleWithinSections([section], resumedSeed).map((s) => s.questions.map((x) => x.id));
    expect(second).toEqual(first);
    const opts = displayOptions({ ...controller, settings: { shuffleOptions: true } }, original).map((o) => o.value);
    expect(displayOptions({ ...controller, settings: { shuffleOptions: true } }, resumedSeed).map((o) => o.value)).toEqual(opts);
  });
});

describe("seededShuffle", () => {
  it("is deterministic for the same seed", () => {
    expect(seededShuffle(nums, "abc")).toEqual(seededShuffle(nums, "abc"));
  });

  it("differs for different seeds", () => {
    expect(seededShuffle(nums, "abc")).not.toEqual(seededShuffle(nums, "abd"));
  });

  it("keeps every item exactly once", () => {
    expect([...seededShuffle(nums, 7)].sort((a, b) => a - b)).toEqual(nums);
  });

  it("does not mutate its input", () => {
    const input = [...nums];
    const frozen = Object.freeze([...nums]);
    seededShuffle(input, "x");
    seededShuffle(frozen, "x");
    expect(input).toEqual(nums);
  });

  it("handles empty and single item lists", () => {
    expect(seededShuffle([], "x")).toEqual([]);
    expect(seededShuffle(["a"], "x")).toEqual(["a"]);
  });

  it("actually reorders for a typical seed", () => {
    expect(seededShuffle(nums, "session-1")).not.toEqual(nums);
  });
});

describe("createRng", () => {
  it("returns floats in [0, 1) and repeats per seed", () => {
    const a = createRng("s");
    const b = createRng("s");
    for (let i = 0; i < 50; i += 1) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(v).toBe(b());
    }
  });
});

describe("shuffleQuestionList", () => {
  const list = [
    q("t1", "TEXT_BLOCK"),
    q("a"),
    q("b"),
    q("i1", "IMAGE_BLOCK"),
    q("c"),
    q("d"),
    q("e"),
    q("t2", "TEXT_BLOCK"),
  ];

  it("keeps blocks anchored to their slot index", () => {
    for (const seed of ["1", "2", "3", "4", "5"]) {
      const out = shuffleQuestionList(list, seed);
      expect(out.map((x) => x.id)[0]).toBe("t1");
      expect(out[3]?.id).toBe("i1");
      expect(out[7]?.id).toBe("t2");
      expect(out.map((x) => x.id).sort()).toEqual(list.map((x) => x.id).sort());
    }
  });

  it("is stable per seed and varies across seeds", () => {
    const ids = (seed: string) => shuffleQuestionList(list, seed).map((x) => x.id).join();
    expect(ids("s")).toBe(ids("s"));
    const variants = new Set(["1", "2", "3", "4", "5", "6"].map(ids));
    expect(variants.size).toBeGreaterThan(1);
  });

  it("does not shuffle fewer than two answerable questions", () => {
    const one = [q("t", "TEXT_BLOCK"), q("a"), q("i", "IMAGE_BLOCK")];
    expect(shuffleQuestionList(one, "x").map((x) => x.id)).toEqual(["t", "a", "i"]);
  });

  it("does not mutate the input", () => {
    const before = list.map((x) => x.id);
    shuffleQuestionList(list, "x");
    expect(list.map((x) => x.id)).toEqual(before);
  });
});

describe("shuffleWithinSections", () => {
  const sections: Section[] = [
    { id: "s1", title: "One", questions: [q("a"), q("b"), q("c"), q("d"), q("e")] },
    { id: "s2", title: "Two", questions: [q("f"), q("g"), q("h"), q("i")] },
    { id: "s3", title: "Three", questions: [q("only")] },
  ];

  it("keeps section order, ids and membership", () => {
    const out = shuffleWithinSections(sections, "seed");
    expect(out.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(out.map((s) => s.questions.map((x) => x.id).sort())).toEqual(
      sections.map((s) => s.questions.map((x) => x.id).sort()),
    );
  });

  it("never moves a question to another section", () => {
    const out = shuffleWithinSections(sections, "seed");
    expect(out[1]?.questions.every((x) => ["f", "g", "h", "i"].includes(x.id))).toBe(true);
  });

  it("keeps jump rules", () => {
    const withRules: Section[] = [
      {
        ...(sections[0] as Section),
        jumpRules: [{ questionId: "a", operator: "equals", value: "x", target: "s2" }],
      },
    ];
    expect(shuffleWithinSections(withRules, "k")[0]?.jumpRules).toEqual(withRules[0]?.jumpRules);
  });

  it("is deterministic per seed and does not mutate input", () => {
    const snapshot = JSON.stringify(sections);
    const first = shuffleWithinSections(sections, "seed");
    expect(shuffleWithinSections(sections, "seed")).toEqual(first);
    expect(JSON.stringify(sections)).toBe(snapshot);
  });

  it("gives different orders for different seeds", () => {
    const orders = new Set(
      ["a", "b", "c", "d", "e", "f"].map((s) =>
        shuffleWithinSections(sections, s)[0]?.questions.map((x) => x.id).join(),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("shuffleOptions", () => {
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
    { value: "c", label: "C" },
    { value: "d", label: "D" },
    { value: "other", label: "Other" },
  ];
  const isOther = (o: { value: string }) => o.value === "other";

  it("keeps Other last for every seed", () => {
    for (const seed of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      const out = shuffleOptions(options, seed, isOther);
      expect(out[out.length - 1]?.value).toBe("other");
      expect(out.map((o) => o.value).sort()).toEqual(options.map((o) => o.value).sort());
    }
  });

  it("is deterministic and varies by seed", () => {
    const order = (seed: string) => shuffleOptions(options, seed, isOther).map((o) => o.value).join();
    expect(order("x")).toBe(order("x"));
    expect(new Set(["1", "2", "3", "4", "5", "6"].map(order)).size).toBeGreaterThan(1);
  });

  it("does not mutate input and works without a tail predicate", () => {
    const copy = options.map((o) => o.value);
    shuffleOptions(options, "x", isOther);
    shuffleOptions(options, "x");
    expect(options.map((o) => o.value)).toEqual(copy);
  });
});

describe("displayOptions", () => {
  const options = ["a", "b", "c", "d", "e", "f"].map((v) => ({ value: v, label: v }));
  const base = { id: "q1", type: "SINGLE_CHOICE" as const, options };

  it("keeps the editor order unless shuffleOptions is on", () => {
    expect(displayOptions({ ...base, settings: {} }, "seed")).toEqual(options);
    expect(displayOptions({ ...base, settings: { shuffleOptions: true } })).toEqual(options);
  });

  it("shuffles per seed for choice and dropdown questions only", () => {
    const on = { ...base, settings: { shuffleOptions: true } };
    expect(displayOptions(on, "s1")).toEqual(displayOptions(on, "s1"));
    const orders = new Set(["s1", "s2", "s3", "s4", "s5"].map((s) => displayOptions(on, s).map((o) => o.value).join()));
    expect(orders.size).toBeGreaterThan(1);
    expect(displayOptions({ ...on, type: "DROPDOWN" as const }, "s1")).toHaveLength(6);
    expect(displayOptions({ ...on, type: "SHORT_TEXT" as const }, "s1")).toEqual(options);
  });
});

describe("newShuffleSeed", () => {
  it("returns a fresh non-persisted seed each call", () => {
    const a = newShuffleSeed();
    expect(a).not.toBe(newShuffleSeed());
    expect(getShuffleSeed("preview:x")).not.toBe(a);
  });
});

describe("getShuffleSeed", () => {
  it("returns the same seed for a form on repeat calls and differs per form", () => {
    const a = getShuffleSeed("form-a");
    expect(getShuffleSeed("form-a")).toBe(a);
    expect(getShuffleSeed("form-b")).not.toBe(a);
  });
});
