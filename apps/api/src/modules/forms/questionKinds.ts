/**
 * Question kinds that display content only (heading/text or an image) and never
 * collect an answer. They live in the same JSON list as real questions but are
 * skipped by validation, publishing, reports and exports.
 */
export const NON_ANSWERABLE_TYPES: readonly string[] = [
  "TEXT_BLOCK",
  "IMAGE_BLOCK",
];

export function isAnswerableQuestion(q: { type: string }): boolean {
  return !NON_ANSWERABLE_TYPES.includes(q.type);
}

export function answerableQuestions<T extends { type: string }>(
  list: T[],
): T[] {
  return list.filter(isAnswerableQuestion);
}
