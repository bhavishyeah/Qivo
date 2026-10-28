import { evaluateConditions } from "./conditions";
import { JUMP_TARGET_SUBMIT } from "../types";
import type { AnswerValue, Section } from "../types";

export { JUMP_TARGET_SUBMIT };

/**
 * A single navigation step: either move to the section at `index`, or submit
 * (end of form).
 */
export type JumpStep = { kind: "section"; index: number } | { kind: "submit" };

/**
 * Single step: given the index of the section just completed and the answers,
 * return the next section to show, or "submit", following the section's jump
 * rules. First matching rule wins. Falls through to the next document section
 * when no rule matches or a rule's target is malformed (unknown id, self, or
 * backward). This is PURE and used by both client navigation and the full
 * reached-sections replay.
 */
export function nextSectionAfter(
  sections: Section[],
  currentIndex: number,
  answers: Record<string, AnswerValue>,
): JumpStep {
  const section = sections[currentIndex];
  const rules = section?.jumpRules ?? [];

  for (const rule of rules) {
    // First matching rule wins. A rule is one condition.
    if (
      !evaluateConditions(
        [{ questionId: rule.questionId, operator: rule.operator, value: rule.value }],
        answers,
      )
    ) {
      continue;
    }
    if (rule.target === JUMP_TARGET_SUBMIT) return { kind: "submit" };
    const targetIndex = sections.findIndex((s) => s.id === rule.target);
    // Malformed-target guard: unknown id, self, or backward/equal target is
    // IGNORED (treated as non-matching) so a bad rule can never loop or strand.
    if (targetIndex > currentIndex) return { kind: "section", index: targetIndex };
    // else: fall through to the next rule, then to linear next.
  }

  // No rule matched (or all were malformed): linear fall-through.
  const next = currentIndex + 1;
  if (next >= sections.length) return { kind: "submit" };
  return { kind: "section", index: next };
}

/**
 * Full replay: walk from section 0 following nextSectionAfter until submit,
 * collecting every reached section id. Pure, terminating, loop-free — forward
 * targets mean the index strictly increases on every step.
 */
export function computeReachedSections(
  sections: Section[],
  answers: Record<string, AnswerValue>,
): Set<string> {
  const reached = new Set<string>();
  if (sections.length === 0) return reached;

  let index = 0;
  // Belt-and-suspenders stop against any future change that could revisit.
  const seenIndexes = new Set<number>();
  while (index >= 0 && index < sections.length) {
    if (seenIndexes.has(index)) break; // impossible with forward-only, but safe.
    seenIndexes.add(index);
    const section = sections[index];
    if (section) reached.add(section.id);

    const step = nextSectionAfter(sections, index, answers);
    if (step.kind === "submit") break;
    index = step.index;
  }
  return reached;
}
