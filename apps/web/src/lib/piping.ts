import type { AnswerValue, Question } from "../types";

/**
 * Matches a piping token `{{ questionId }}` and captures the trimmed id.
 * The id character class `[A-Za-z0-9_]+` mirrors `createQuestionId()` on the
 * API (ids of the form `question_<alnum>`), so malformed tokens (empty braces,
 * hyphens, stray single braces) simply do not match and are left verbatim.
 * Global flag so every token in a label is replaced.
 *
 * Note: this is a stateful `/g` regex — when calling `.test()`/`.exec()`
 * directly, reset `lastIndex` or prefer `String.prototype.match`.
 */
export const PIPING_TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const YES_NO_LABELS: Record<string, string> = { yes: "Yes", no: "No" };

/**
 * True when a value counts as "unanswered". This mirrors EXACTLY the emptiness
 * test used by `validateSection`/`validateAll` in PublicFormPage (and the API's
 * submit check), so "answered for piping" never disagrees with "answered for
 * validation".
 */
function isUnanswered(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) {
    return value.length === 0 || value.every((e) => !e.trim());
  }
  return false;
}

/**
 * Converts a referenced question's answer into display text, reusing the
 * conditions.ts value-handling style. For choice questions the option LABEL is
 * preferred over the raw stored value.
 */
function renderAnswerValue(question: Question, value: AnswerValue): string {
  if (Array.isArray(value)) {
    const entries = value.filter((e) => e.trim() !== "");
    if (question.type === "MULTIPLE_CHOICE") {
      const options = question.options ?? [];
      return entries
        .map((v) => options.find((o) => o.value === v)?.label ?? v)
        .join(", ");
    }
    // MULTI_ENTRY and any other string[] answer: join raw entries.
    return entries.join(", ");
  }

  if (typeof value === "string") {
    if (question.type === "SINGLE_CHOICE") {
      return question.options?.find((o) => o.value === value)?.label ?? value;
    }
    if (question.type === "YES_NO") {
      return YES_NO_LABELS[value] ?? value;
    }
    return value;
  }

  // number (NUMBER / RATING / LINEAR_SCALE) and any stray boolean.
  return String(value);
}

/**
 * Resolve piping tokens in a label string against the live answers map.
 *
 * A plain string renders as-is; a string[] renders joined with ", "; an
 * unanswered reference renders per the fallback rule. Mirrors conditions.ts
 * value handling.
 *
 * @param label      the raw label, possibly containing `{{questionId}}` tokens
 * @param questions  all questions in the form (flattened), used to look up the
 *                   referenced question's type / required flag / options
 * @param answers    the live answers map (same shape conditions.ts reads)
 */
export function resolvePipedLabel(
  label: string,
  questions: Question[],
  answers: Record<string, AnswerValue>,
): string {
  const byId = new Map<string, Question>();
  for (const q of questions) byId.set(q.id, q);

  return label.replace(PIPING_TOKEN_RE, (_match, id: string) => {
    const q = byId.get(id);
    // Unknown id (e.g. a deleted question): drop the token rather than leaking
    // a dangling reference to the respondent.
    if (!q) return "";

    const value = answers[id];

    if (isUnanswered(value)) {
      // Required but not yet answered -> inline guidance; optional -> blank.
      // The referenced label is inserted raw (not recursively resolved).
      return q.required ? `[answer "${q.label.trim()}" first]` : "";
    }

    return renderAnswerValue(q, value);
  });
}
