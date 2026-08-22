import type { AnswerValue, ConditionRule } from "../types";

/**
 * Evaluates whether a question should be visible based on its conditions.
 * If no conditions, question is always visible.
 * All conditions must pass (AND logic).
 */
export function evaluateConditions(
  conditions: ConditionRule[] | undefined,
  answers: Record<string, AnswerValue>,
): boolean {
  if (!conditions || conditions.length === 0) return true;

  return conditions.every((rule) => {
    const answer = answers[rule.questionId];

    switch (rule.operator) {
      case "equals":
        if (Array.isArray(answer)) {
          return answer.includes(rule.value ?? "");
        }
        return String(answer ?? "") === (rule.value ?? "");

      case "not_equals":
        if (Array.isArray(answer)) {
          return !answer.includes(rule.value ?? "");
        }
        return String(answer ?? "") !== (rule.value ?? "");

      case "contains":
        if (Array.isArray(answer)) {
          return answer.some((a) => a.includes(rule.value ?? ""));
        }
        return String(answer ?? "").toLowerCase().includes((rule.value ?? "").toLowerCase());

      case "not_empty":
        if (Array.isArray(answer)) return answer.length > 0;
        return answer !== undefined && answer !== null && answer !== "";

      default:
        return true;
    }
  });
}
