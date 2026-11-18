/**
 * Razorpay payments allow-list.
 *
 * Qivo uses ONE set of Razorpay keys (the platform owner's account), so online
 * payments are only permitted for workspaces whose OWNER account email is listed
 * in `PAYMENTS_ALLOWED_OWNER_EMAILS` (comma-separated, case-insensitive).
 *
 * FAILS CLOSED: unset/empty/no valid entries => nobody is allowed. The env var is
 * read at call time (never at module load). The list contents are never logged
 * or returned to any client; only booleans leave this module.
 */

// Deliberately loose shape check; rejects junk like "foo", "a@", "@b", "a b@c.d".
const EMAIL_SHAPE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** Parse the raw env value into a de-duplicated list of lowercase valid emails. */
export function parseAllowedOwnerEmails(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email && EMAIL_SHAPE.test(email)) seen.add(email);
  }
  return [...seen];
}

/** True when the allow-list has at least one valid email. Boolean only. */
export function isAllowListConfigured(
  raw: string | undefined | null = process.env.PAYMENTS_ALLOWED_OWNER_EMAILS,
): boolean {
  return parseAllowedOwnerEmails(raw).length > 0;
}

/** True only when `email` is non-empty and present in the allow-list. */
export function isPaymentsAllowedForOwnerEmail(
  email: string | undefined | null,
  raw: string | undefined | null = process.env.PAYMENTS_ALLOWED_OWNER_EMAILS,
): boolean {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return parseAllowedOwnerEmails(raw).includes(normalized);
}
