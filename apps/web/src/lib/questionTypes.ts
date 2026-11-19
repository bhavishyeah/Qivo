// Helpers for the structured question kinds (linear scale, rating, time, grids).
// Mirrors apps/api/src/modules/forms/questionTypes.ts.
import type { AnswerValue, GridAnswer, Question, QuestionType } from "../types";

export const GRID_TYPES: readonly QuestionType[] = ["MULTIPLE_CHOICE_GRID", "CHECKBOX_GRID"];

export function isGridType(type: string): boolean {
  return (GRID_TYPES as readonly string[]).includes(type);
}

/** Question types in the type picker, grouped like Google Forms (dividers between groups). */
export const QUESTION_TYPE_GROUPS: readonly (readonly QuestionType[])[] = [
  ["SHORT_TEXT", "LONG_TEXT", "EMAIL", "PHONE", "URL", "NUMBER", "MULTI_ENTRY"],
  ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN", "YES_NO"],
  ["FILE_UPLOAD", "SIGNATURE"],
  ["LINEAR_SCALE", "RATING", "MULTIPLE_CHOICE_GRID", "CHECKBOX_GRID"],
  ["DATE", "TIME"],
];

/** Split `types` into the picker groups, keeping only offered types and dropping empty groups. */
export function groupQuestionTypes(types: readonly QuestionType[]): QuestionType[][] {
  const offered = new Set(types);
  const placed = new Set<QuestionType>();
  const groups = QUESTION_TYPE_GROUPS.map((group) =>
    group.filter((t) => {
      if (!offered.has(t)) return false;
      placed.add(t);
      return true;
    }),
  );
  const rest = types.filter((t) => !placed.has(t));
  if (rest.length > 0) groups.push(rest);
  return groups.filter((g) => g.length > 0).map((g) => [...g]);
}

export function defaultSettingsFor(type: QuestionType): Question["settings"] | undefined {
  switch (type) {
    case "LINEAR_SCALE":
      return { min: 1, max: 5 };
    case "RATING":
      return { min: 1, max: 5 };
    case "MULTIPLE_CHOICE_GRID":
    case "CHECKBOX_GRID":
      return {
        rows: [{ value: "row_1", label: "Row 1" }],
        columns: [
          { value: "col_1", label: "Column 1" },
          { value: "col_2", label: "Column 2" },
        ],
      };
    default:
      return undefined;
  }
}

function asGrid(value: AnswerValue | undefined): GridAnswer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as GridAnswer;
}

function rowAnswered(cell: string | string[] | undefined): boolean {
  return Array.isArray(cell) ? cell.length > 0 : typeof cell === "string" && cell !== "";
}

/** True when a required grid still lacks a response (per row when requireEachRow). */
export function isGridAnswerMissing(question: Question, value: AnswerValue | undefined): boolean {
  const grid = asGrid(value);
  if (!grid) return true;
  if (question.settings?.requireEachRow) {
    return (question.settings.rows ?? []).some((r) => !rowAnswered(grid[r.value]));
  }
  return !Object.values(grid).some(rowAnswered);
}

/** True when a required question has no usable answer (shared by the form and preview). */
export function isAnswerMissing(question: Question, answer: AnswerValue | undefined): boolean {
  if (isGridType(question.type)) return isGridAnswerMissing(question, answer);
  if (Array.isArray(answer)) return answer.length === 0 || answer.every((e) => !e.trim());
  return answer === undefined || answer === null || answer === "";
}

/** Readable text for a grid answer: "Row: Col, Col; Row 2: Col". */
export function formatGridAnswer(question: Pick<Question, "settings">, value: unknown): string {
  const grid = asGrid(value as AnswerValue);
  if (!grid) return value === undefined || value === null ? "" : String(value);
  const rowLabel = (v: string) => question.settings?.rows?.find((r) => r.value === v)?.label ?? v;
  const colLabel = (v: string) => question.settings?.columns?.find((c) => c.value === v)?.label ?? v;
  return Object.entries(grid)
    .filter(([, cell]) => rowAnswered(cell))
    .map(([row, cell]) => `${rowLabel(row)}: ${(Array.isArray(cell) ? cell : [cell]).map(colLabel).join(", ")}`)
    .join("; ");
}

/** Toggle or set one grid cell, returning a new answer (empty rows are dropped). */
export function setGridCell(
  type: QuestionType,
  current: AnswerValue | undefined,
  row: string,
  column: string,
  checked = true,
): GridAnswer {
  const next: GridAnswer = { ...(asGrid(current) ?? {}) };
  if (type === "MULTIPLE_CHOICE_GRID") {
    next[row] = column;
    return next;
  }
  const existing = Array.isArray(next[row]) ? (next[row] as string[]) : [];
  const updated = checked ? [...existing.filter((c) => c !== column), column] : existing.filter((c) => c !== column);
  if (updated.length === 0) delete next[row];
  else next[row] = updated;
  return next;
}

/** Numeric min/max for a scale or rating question, using the same defaults as the API. */
export function scaleRange(question: Pick<Question, "type" | "settings">): { min: number; max: number } {
  return {
    min: question.settings?.min ?? 1,
    max: question.settings?.max ?? (question.type === "LINEAR_SCALE" ? 10 : 5),
  };
}

/** Star values 1..max; legacy ratings stored with min 0 never render a "0 star". */
export function starValues(min: number, max: number): number[] {
  const first = Math.max(1, min);
  return Array.from({ length: Math.max(0, max - first + 1) }, (_, i) => first + i);
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
