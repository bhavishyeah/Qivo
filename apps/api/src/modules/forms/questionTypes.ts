/**
 * Validation helpers for the structured question kinds: linear scale, rating,
 * time and the two grids. Pure functions so the zod schemas, the publish check
 * and answer validation all share the same rules.
 *
 * Mirrored (types only) in apps/web/src/lib/questionTypes.ts.
 */

export type GridOption = { value: string; label: string };
export type GridConfig = {
  rows: GridOption[];
  columns: GridOption[];
  requireEachRow: boolean;
};

export const GRID_TYPES: readonly string[] = [
  "MULTIPLE_CHOICE_GRID",
  "CHECKBOX_GRID",
];
export const MAX_GRID_ROWS = 50;
export const MAX_GRID_COLUMNS = 20;

export function isGridType(type: string): boolean {
  return GRID_TYPES.includes(type);
}

function parseOptionList(raw: unknown, max: number): GridOption[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max) return null;
  const out: GridOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const { value, label } = item as Record<string, unknown>;
    if (typeof value !== "string" || value.trim() === "" || value.length > 100) {
      return null;
    }
    if (typeof label !== "string" || label.trim() === "" || label.length > 200) {
      return null;
    }
    if (seen.has(value)) return null;
    seen.add(value);
    out.push({ value, label });
  }
  return out;
}

/** Returns the grid's rows/columns, or null when the settings are malformed. */
export function parseGridConfig(
  settings: Record<string, unknown> | undefined,
): GridConfig | null {
  if (!settings) return null;
  const rows = parseOptionList(settings["rows"], MAX_GRID_ROWS);
  const columns = parseOptionList(settings["columns"], MAX_GRID_COLUMNS);
  if (!rows || !columns) return null;
  return { rows, columns, requireEachRow: settings["requireEachRow"] === true };
}

/** Numeric bounds for LINEAR_SCALE / RATING with the same defaults the editor uses. */
export function scaleBounds(
  type: string,
  settings: Record<string, unknown> | undefined,
): { min: number; max: number } {
  const min = Number(settings?.["min"] ?? 1);
  const max = Number(settings?.["max"] ?? (type === "LINEAR_SCALE" ? 10 : 5));
  return { min, max };
}

/**
 * Check the settings a question of `type` needs. Returns a message, or null
 * when valid (or when the type has no structured settings).
 */
export function validateQuestionSettings(
  type: string,
  settings: Record<string, unknown> | undefined,
): string | null {
  if (type === "LINEAR_SCALE") {
    const { min, max } = scaleBounds(type, settings);
    if (!Number.isInteger(min) || (min !== 0 && min !== 1)) {
      return "A linear scale must start at 0 or 1.";
    }
    if (!Number.isInteger(max) || max < 2 || max > 10) {
      return "A linear scale must end between 2 and 10.";
    }
    for (const key of ["minLabel", "maxLabel"]) {
      const v = settings?.[key];
      if (v !== undefined && (typeof v !== "string" || v.length > 100)) {
        return "Scale labels must be text up to 100 characters.";
      }
    }
    return null;
  }
  if (type === "RATING") {
    const { min, max } = scaleBounds(type, settings);
    // The editor offers 3-10 stars starting at 1; legacy forms may carry a
    // 0 start or a 2-star range, so the server stays lenient on those.
    if (min !== 0 && min !== 1) return "A rating starts at 0 or 1.";
    if (!Number.isInteger(max) || max < 2 || max > 10) {
      return "A rating must have between 2 and 10 stars.";
    }
    return null;
  }
  if (isGridType(type)) {
    if (!parseGridConfig(settings)) {
      return "A grid needs at least one row and one column, each with a unique value and a label.";
    }
    return null;
  }
  return null;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isValidTime(value: unknown): boolean {
  return typeof value === "string" && TIME_RE.test(value);
}

export function isValidScaleAnswer(
  type: string,
  settings: Record<string, unknown> | undefined,
  value: unknown,
): boolean {
  const num = typeof value === "number" ? value : Number(value);
  if (typeof value === "string" && value.trim() === "") return false;
  if (!Number.isInteger(num)) return false;
  const { min, max } = scaleBounds(type, settings);
  return num >= min && num <= max;
}

/**
 * Validate a grid answer: a plain object keyed by row value. Multiple-choice
 * grids map a row to one column value, checkbox grids map it to a list of
 * distinct column values. Unknown rows/columns are rejected.
 */
export function validateGridAnswer(
  type: string,
  config: GridConfig,
  value: unknown,
): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "expected an answer for each row";
  }
  const rowValues = new Set(config.rows.map((r) => r.value));
  const columnValues = new Set(config.columns.map((c) => c.value));
  for (const [row, cell] of Object.entries(value as Record<string, unknown>)) {
    if (!rowValues.has(row)) return "answer refers to an unknown row";
    if (type === "MULTIPLE_CHOICE_GRID") {
      if (typeof cell !== "string" || !columnValues.has(cell)) {
        return "selection is not an available column";
      }
    } else {
      if (!Array.isArray(cell)) return "expected a list of columns per row";
      const seen = new Set<string>();
      for (const c of cell) {
        if (typeof c !== "string" || !columnValues.has(c) || seen.has(c)) {
          return "selection is not an available column";
        }
        seen.add(c);
      }
    }
  }
  return null;
}

function rowAnswered(cell: unknown): boolean {
  if (Array.isArray(cell)) return cell.length > 0;
  return typeof cell === "string" && cell !== "";
}

/**
 * True when a required grid has no usable answer. With `requireEachRow` every
 * row needs a response, otherwise one answered row is enough.
 */
export function isGridAnswerMissing(
  config: GridConfig | null,
  answer: unknown,
): boolean {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
    return true;
  }
  const map = answer as Record<string, unknown>;
  if (config?.requireEachRow) {
    return config.rows.some((r) => !rowAnswered(map[r.value]));
  }
  return !Object.values(map).some(rowAnswered);
}

/** Readable text for a grid answer, e.g. "Row: Col, Col; Row 2: Col". */
export function formatGridAnswer(
  config: GridConfig | null,
  answer: unknown,
): string {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
    return String(answer ?? "");
  }
  const rowLabel = (v: string) =>
    config?.rows.find((r) => r.value === v)?.label ?? v;
  const colLabel = (v: string) =>
    config?.columns.find((c) => c.value === v)?.label ?? v;
  return Object.entries(answer as Record<string, unknown>)
    .filter(([, cell]) => rowAnswered(cell))
    .map(([row, cell]) => {
      const cols = Array.isArray(cell) ? cell : [cell];
      return `${rowLabel(row)}: ${cols.map((c) => colLabel(String(c))).join(", ")}`;
    })
    .join("; ");
}
