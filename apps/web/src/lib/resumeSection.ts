import { nextSectionAfter } from "./sectionJumps";
import type { AnswerValue, Section } from "../types";

/**
 * Compute the section to land on when resuming a saved draft, plus the history
 * stack that reproduces the navigation path to it.
 *
 * A saved `currentSection` index cannot be trusted blindly: the restored answers
 * might route the respondent down a different branch than when they saved (skip
 * logic/jump rules), or the form could have fewer sections than when the draft
 * was created. So we replay the real navigation from section 0 using the same
 * pure `nextSectionAfter` the live form uses, and stop at the furthest reachable
 * section whose index is `<= target`.
 *
 * - A null/undefined saved section is treated as 0 (start) — history `[0]`.
 * - The returned `history` is the visited-index stack (so Back still works and
 *   skip logic stays consistent), and `targetIndex` is its last element.
 */
export function clampResumeSection(
  sections: Section[],
  answers: Record<string, AnswerValue>,
  savedSection: number | null | undefined,
): { history: number[]; targetIndex: number } {
  // No sections at all → degenerate single-step history at 0.
  if (sections.length === 0) {
    return { history: [0], targetIndex: 0 };
  }

  // Raw target: null/undefined → 0; otherwise clamp into [0, lastIndex].
  const lastIndex = sections.length - 1;
  const rawTarget = savedSection ?? 0;
  const target = Math.max(0, Math.min(rawTarget, lastIndex));

  // Replay forward from 0, building the visited-index stack, stopping once we
  // reach the target (or can no longer advance — submit / out of range). The
  // final pushed index is the furthest reachable section <= target.
  const history: number[] = [0];
  let index = 0;
  const seen = new Set<number>([0]);

  while (index < target) {
    const step = nextSectionAfter(sections, index, answers);
    if (step.kind === "submit") break;
    const next = step.index;
    // Forward-only guarantee from nextSectionAfter; guard against a revisit.
    if (next <= index || next > target || seen.has(next)) break;
    history.push(next);
    seen.add(next);
    index = next;
  }

  return { history, targetIndex: index };
}
