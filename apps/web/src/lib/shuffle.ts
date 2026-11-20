import type { Question, QuestionOption, Section } from "../types";
import { isAnswerable } from "./questionKinds";

/**
 * Seeded, non-mutating shuffling helpers. The same seed always gives the same
 * order, so a respondent's order is stable across re-renders, validation errors
 * and resumed drafts, while different seeds give different orders.
 */

/** 32-bit string hash (FNV-1a) used to turn a session id into a PRNG seed. */
export function hashSeed(seed: string | number): number {
  const text = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: returns a function producing floats in [0, 1). */
export function createRng(seed: string | number): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle with a seeded PRNG. Returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: string | number): T[] {
  const out = items.slice();
  const rng = createRng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/**
 * Shuffle the answerable questions of one list. Non-answerable blocks (text,
 * image) keep their slot index; answerable questions are permuted among the
 * remaining slots. Fewer than two answerable questions: returned as is.
 */
export function shuffleQuestionList(
  questions: readonly Question[],
  seed: string | number,
): Question[] {
  const slots: number[] = [];
  questions.forEach((q, i) => {
    if (isAnswerable(q)) slots.push(i);
  });
  if (slots.length < 2) return questions.slice();
  const shuffled = seededShuffle(
    slots.map((i) => questions[i] as Question),
    seed,
  );
  const out = questions.slice();
  slots.forEach((slot, n) => {
    out[slot] = shuffled[n] as Question;
  });
  return out;
}

/**
 * Shuffle question order inside every section. Section order, section ids and
 * jump rules are untouched, and each section uses its own derived seed so one
 * section's order does not depend on another's size.
 */
export function shuffleWithinSections(
  sections: readonly Section[],
  seed: string | number,
): Section[] {
  return sections.map((section) => ({
    ...section,
    questions: shuffleQuestionList(section.questions, `${seed}:${section.id}`),
  }));
}

/**
 * Shuffle choice options. Options matching `isLast` (e.g. an "Other" entry that
 * is part of the list) always stay at the end in their original order.
 */
export function shuffleOptions<T>(
  options: readonly T[],
  seed: string | number,
  isLast?: (option: T) => boolean,
): T[] {
  const tail = isLast ? options.filter(isLast) : [];
  const head = isLast ? options.filter((o) => !isLast(o)) : options.slice();
  return [...seededShuffle(head, seed), ...tail];
}

/**
 * Options of a choice question in display order. With `shuffleOptions` on and a
 * seed, the order is randomised per respondent; the "Other" row is rendered
 * separately after this list, so it always stays last.
 */
export function displayOptions(
  question: Pick<Question, "id" | "type" | "options" | "settings">,
  seed?: string,
): QuestionOption[] {
  const options = question.options ?? [];
  const shuffleable =
    question.type === "SINGLE_CHOICE" ||
    question.type === "MULTIPLE_CHOICE" ||
    question.type === "DROPDOWN";
  if (!seed || !shuffleable || question.settings?.shuffleOptions !== true) return options;
  return shuffleOptions(options, `${seed}:${question.id}`);
}

const SESSION_KEY_PREFIX = "qivo:shuffle-seed:";

function randomId(): string {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** A fresh random seed (not persisted anywhere). */
export function newShuffleSeed(): string {
  return randomId();
}

/**
 * Per-respondent seed for a form, kept in localStorage (falling back to
 * sessionStorage, then memory) so the order survives reloads and draft resume.
 */
export function getShuffleSeed(formId: string): string {
  const key = `${SESSION_KEY_PREFIX}${formId}`;
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    try {
      const store = window[kind];
      const existing = store.getItem(key);
      if (existing) return existing;
      const created = randomId();
      store.setItem(key, created);
      return created;
    } catch {
      // Storage unavailable (private mode); try the next one.
    }
  }
  // No storage at all: keep the seed for the life of the page.
  const remembered = memorySeeds.get(key);
  if (remembered) return remembered;
  const created = randomId();
  memorySeeds.set(key, created);
  return created;
}

const memorySeeds = new Map<string, string>();
