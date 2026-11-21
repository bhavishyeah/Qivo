const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formats a scheduled close time for display, in the viewer's local time zone,
 * e.g. "Closes on 21 Nov 2026, 2:30 PM IST". Past times read "Closed on ...".
 * Returns "" when no (or an unparseable) close time is set.
 */
export function formatCloseLabel(
  closeAt: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (closeAt === null || closeAt === undefined || closeAt === "") return "";
  const when = closeAt instanceof Date ? closeAt : new Date(closeAt);
  if (Number.isNaN(when.getTime())) return "";
  const date = `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(when);
  return `${when <= now ? "Closed" : "Closes"} on ${date}, ${time}`;
}
