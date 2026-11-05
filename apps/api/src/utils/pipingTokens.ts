/**
 * Display-only neutralization of answer-piping tokens for contexts that do NOT
 * live-resolve them (confirmation/notification emails, exports, reports).
 *
 * A question's stored label may embed `{{questionId}}` piping tokens. On the
 * live form those resolve to the referenced answer, but anywhere the raw stored
 * label is rendered outside that flow the token would leak as `{{question_abc}}`.
 * This helper strips each token to a readable placeholder: the referenced
 * question's own label in brackets when resolvable from the form schema
 * (e.g. `{{q_team}}` -> `[Team name]`), otherwise a generic `[answer]`. The
 * stored label is never mutated — callers pass the raw label and use the result
 * for display only.
 *
 * Mirrors the token grammar of apps/web/src/lib/piping.ts (`question_<alnum>`),
 * so a token the web resolver would recognize is the same one neutralized here.
 */

/** Matches a piping token `{{ questionId }}` and captures the trimmed id. */
const PIPING_TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Neutral placeholder used when the referenced question label is unavailable. */
const GENERIC_PLACEHOLDER = "[answer]";

/**
 * Replace every `{{id}}` token in `label` with a readable placeholder. When
 * `labelsById` resolves the referenced id to a non-empty label, the token
 * becomes `[that label]`; otherwise it becomes `[answer]`. A label with no
 * tokens is returned unchanged. Never throws.
 */
export function stripPipingTokens(
  label: string,
  labelsById?: Map<string, string> | Record<string, string>,
): string {
  if (typeof label !== "string" || label.indexOf("{{") === -1) return label;

  const lookup = (id: string): string | undefined => {
    if (!labelsById) return undefined;
    if (labelsById instanceof Map) return labelsById.get(id);
    return labelsById[id];
  };

  return label.replace(PIPING_TOKEN_RE, (_match, id: string) => {
    const referenced = lookup(id);
    const trimmed = typeof referenced === "string" ? referenced.trim() : "";
    return trimmed ? `[${trimmed}]` : GENERIC_PLACEHOLDER;
  });
}
