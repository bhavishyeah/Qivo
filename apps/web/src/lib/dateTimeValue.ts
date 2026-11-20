// Conversion helpers for the themed date/time picker. The picker's value is the
// exact string a native <input type="datetime-local"> produces: local wall-clock
// "YYYY-MM-DDTHH:mm" with no timezone, or "" when empty. The editor's existing
// save code (toIsoInstant / toDatetimeLocal) keeps working unchanged.

export type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number; // 0-59
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Parse "YYYY-MM-DDTHH:mm"; null for empty or invalid (including 2026-02-31). */
export function parseLocalValue(value: string | null | undefined): LocalParts | null {
  const m = PATTERN.exec(value ?? "");
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (hour > 23 || minute > 59 || month < 1 || month > 12) return null;
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
  return { year, month, day, hour, minute };
}

/** Build "YYYY-MM-DDTHH:mm" from parts. */
export function formatLocalValue(p: LocalParts): string {
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Local Date (midnight) for the calendar grid. */
export function partsToDate(p: LocalParts): Date {
  return new Date(p.year, p.month - 1, p.day);
}

/** Local calendar day of a Date as parts, keeping the given time of day. */
export function dateToParts(d: Date, hour: number, minute: number): LocalParts {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour, minute };
}

export function to12Hour(hour24: number): { hour: number; period: "AM" | "PM" } {
  const period = hour24 >= 12 ? "PM" : "AM";
  const h = hour24 % 12;
  return { hour: h === 0 ? 12 : h, period };
}

export function to24Hour(hour12: number, period: "AM" | "PM"): number {
  const h = hour12 % 12;
  return period === "PM" ? h + 12 : h;
}

/** "21 Nov 2026, 2:30 PM"; "" for empty or invalid input. */
export function formatDisplay(value: string | null | undefined): string {
  const p = parseLocalValue(value);
  if (!p) return "";
  const { hour, period } = to12Hour(p.hour);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${hour}:${pad(p.minute)} ${period}`;
}

/** Current local time as a picker value, minutes only. */
export function nowLocalValue(now: Date = new Date()): string {
  return formatLocalValue(dateToParts(now, now.getHours(), now.getMinutes()));
}

/** Lexical order equals chronological order for this fixed-width format. */
export function clampToMin(value: string, min: string | undefined): string {
  if (!min || !parseLocalValue(min)) return value;
  return value < min ? min : value;
}

/** Move a minute value to the next/previous multiple of step, wrapping 0-59. */
export function stepMinute(minute: number, direction: 1 | -1, step = 5): number {
  const base = direction === 1 ? Math.floor(minute / step) * step + step : Math.ceil(minute / step) * step - step;
  return ((base % 60) + 60) % 60;
}

/** Step a number within [min, max], wrapping around. */
export function wrapStep(current: number, delta: number, min: number, max: number): number {
  const size = max - min + 1;
  return ((((current - min + delta) % size) + size) % size) + min;
}