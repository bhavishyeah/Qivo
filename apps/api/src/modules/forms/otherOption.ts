/**
 * The "Other" choice for SINGLE_CHOICE / MULTIPLE_CHOICE questions.
 *
 * Storage decision (see .agents/tasks/qivo-next/design-notes.md): an "Other"
 * answer is stored as the plain string `__other__:<typed text>`. A string keeps
 * every existing answer shape (string for single choice, string[] for multiple
 * choice) so older consumers never crash; they just show the prefixed text.
 *
 * Mirrored in apps/web/src/lib/otherOption.ts. Keep both in sync.
 */
export const OTHER_PREFIX = "__other__:";
export const MAX_OTHER_LEN = 200;

export function isOtherAnswer(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(OTHER_PREFIX);
}

export function otherText(value: string): string {
  return value.slice(OTHER_PREFIX.length).trim();
}

export function makeOtherAnswer(text: string): string {
  return `${OTHER_PREFIX}${text.trim()}`;
}

/** Readable form of an Other answer, e.g. "Other: Radio". */
export function formatOtherAnswer(value: string): string {
  return `Other: ${otherText(value)}`;
}

/** Problem with an Other entry, or null when it is acceptable. */
export function validateOtherAnswer(
  value: string,
  allowOther: boolean,
): string | null {
  if (!allowOther) return "selection is not an available option";
  const text = otherText(value);
  if (text === "") return "enter a value for Other";
  if (text.length > MAX_OTHER_LEN) return "Other answer is too long";
  return null;
}

export function questionAllowsOther(question: {
  type: string;
  settings?: Record<string, unknown> | undefined;
}): boolean {
  return (
    (question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE") &&
    question.settings?.["allowOther"] === true
  );
}
