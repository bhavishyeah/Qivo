// Question kinds that only display content (a heading/text or an image) and
// never collect an answer. Mirrors apps/api/src/modules/forms/questionKinds.ts.
import type { Question } from "../types";

const NON_ANSWERABLE_TYPES: readonly string[] = ["TEXT_BLOCK", "IMAGE_BLOCK"];

export function isAnswerable(q: { type: string }): boolean {
  return !NON_ANSWERABLE_TYPES.includes(q.type);
}

export function answerableQuestions<T extends { type: string }>(list: T[]): T[] {
  return list.filter(isAnswerable);
}

/**
 * 1-based number of a question among the answerable questions of `list`, or
 * null for blocks and unknown ids.
 */
export function displayNumber(
  list: Pick<Question, "id" | "type">[],
  id: string,
): number | null {
  let n = 0;
  for (const q of list) {
    if (!isAnswerable(q)) {
      if (q.id === id) return null;
      continue;
    }
    n += 1;
    if (q.id === id) return n;
  }
  return null;
}
