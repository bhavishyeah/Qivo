// Pure derivations for the public form's response-capacity ("seats left") UI.
// Extracted so the precedence rules and the seats-left copy can be unit tested
// without rendering the whole page (same discipline as lib/validation.ts and
// lib/sectionJumps.ts).

import type { PublicForm } from "../types";

/**
 * True when the form is past its scheduled close time. A scheduled-closed form
 * takes precedence over the fully-booked state (the submit-time FORM_CLOSED is
 * the authoritative gate for that), so the fully-booked card is suppressed when
 * this is true.
 */
export function isScheduleClosed(
  settings: { scheduledCloseAt?: string | null } | undefined,
  now: Date = new Date(),
): boolean {
  const closeAt = settings?.scheduledCloseAt;
  if (!closeAt) return false;
  const when = new Date(closeAt);
  if (Number.isNaN(when.getTime())) return false;
  return when <= now;
}

/**
 * Whether the public form should render the fully-booked card INSTEAD of the
 * fillable form. True when capacity is enabled and 0 seats remain at load, OR a
 * submit raced the form to full (submitFullFlag) — but never when the form is
 * past its scheduled close (that state wins; see isScheduleClosed).
 */
export function isFullyBooked(
  capacity: PublicForm["capacity"],
  submitFullFlag: boolean,
  scheduleClosed: boolean,
): boolean {
  if (scheduleClosed) return false;
  if (submitFullFlag) return true;
  if (capacity?.enabled !== true) return false;
  return (capacity.seatsLeft ?? 0) <= 0;
}

/**
 * Whether the seats-left counter ("X of N seats left") should be shown: only
 * when capacity is on and at least one seat remains (0 seats is handled by the
 * fully-booked card, so the counter never shows "0 of N").
 */
export function shouldShowSeatsCounter(
  capacity: PublicForm["capacity"],
): boolean {
  return capacity?.enabled === true && (capacity.seatsLeft ?? 0) > 0;
}

/** The counter copy, e.g. "42 of 120 seats left". */
export function seatsLeftLabel(
  capacity: NonNullable<PublicForm["capacity"]>,
): string {
  return `${capacity.seatsLeft ?? 0} of ${capacity.limit ?? 0} seats left`;
}
