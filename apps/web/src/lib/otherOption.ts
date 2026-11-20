import type { AnswerValue, Question } from "../types";

/**
 * The "Other" choice of SINGLE_CHOICE / MULTIPLE_CHOICE questions. An Other
 * answer is the plain string `__other__:<typed text>`, so single choice stays a
 * string and multiple choice stays a string[]. Mirror of
 * apps/api/src/modules/forms/otherOption.ts; keep both in sync.
 */
export const OTHER_PREFIX = "__other__:";
export const MAX_OTHER_LEN = 200;

export function isOtherAnswer(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(OTHER_PREFIX);
}

/** Text typed for Other, trimmed. */
export function otherText(value: string): string {
  return value.slice(OTHER_PREFIX.length).trim();
}

/** Stored form of an Other answer. Text is kept as typed so spaces survive typing. */
export function makeOtherAnswer(text: string): string {
  return `${OTHER_PREFIX}${text}`;
}

/** Readable form, e.g. "Other: Radio". */
export function formatOtherAnswer(value: string): string {
  return `Other: ${otherText(value)}`;
}

export function questionAllowsOther(
  question: Pick<Question, "type" | "settings">,
): boolean {
  return (
    (question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE") &&
    question.settings?.allowOther === true
  );
}

/** The Other entry of a choice answer, or null when Other is not selected. */
export function findOtherAnswer(value: AnswerValue | undefined): string | null {
  if (isOtherAnswer(value)) return value;
  if (Array.isArray(value)) return value.find(isOtherAnswer) ?? null;
  return null;
}

/** Message when Other is selected but nothing was typed; null otherwise. */
export function otherAnswerProblem(value: AnswerValue | undefined): string | null {
  const other = findOtherAnswer(value);
  if (other !== null && otherText(other) === "") {
    return "Type your answer for Other.";
  }
  return null;
}

/**
 * Replace Other answers with their trimmed form before submitting, so the
 * server sees `__other__:text` with no stray whitespace.
 */
export function normalizeOtherAnswers(
  answers: Record<string, AnswerValue>,
): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const [id, value] of Object.entries(answers)) {
    if (isOtherAnswer(value)) {
      out[id] = makeOtherAnswer(otherText(value));
    } else if (Array.isArray(value) && value.some(isOtherAnswer)) {
      out[id] = value.map((v) =>
        isOtherAnswer(v) ? makeOtherAnswer(otherText(v)) : v,
      );
    } else {
      out[id] = value;
    }
  }
  return out;
}
