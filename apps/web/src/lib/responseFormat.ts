import type { Question } from "../types";
import { formatOtherAnswer, isOtherAnswer } from "./otherOption";
import { formatGridAnswer, isGridType } from "./questionTypes";

/**
 * Text for one stored answer in the response table, CSV and XLSX exports.
 * "Other" choices read "Other: <text>"; arrays are comma separated.
 */
export function formatResponseValue(value: unknown, question?: Question): string {
  if (value === null || value === undefined) return "—";
  if (question && isGridType(question.type)) return formatGridAnswer(question, value);
  if (Array.isArray(value)) {
    return value.map((v) => (isOtherAnswer(v) ? formatOtherAnswer(v) : v)).join(", ");
  }
  if (isOtherAnswer(value)) return formatOtherAnswer(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
