/**
 * Platform admin allow-list.
 *
 * Qivo has no platform-wide admin role in the database (workspace roles only
 * cover one workspace), so cross-workspace moderation, such as reviewing form
 * reports, is limited to accounts whose email is listed in
 * `PLATFORM_ADMIN_EMAILS` (comma-separated, case-insensitive).
 *
 * FAILS CLOSED: unset/empty/no valid entries => nobody is a platform admin. The
 * env var is read at call time and its contents are never logged or returned.
 */
const EMAIL_SHAPE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export function parsePlatformAdminEmails(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email && EMAIL_SHAPE.test(email)) seen.add(email);
  }
  return [...seen];
}

export function getPlatformAdminEmails(
  raw: string | undefined | null = process.env.PLATFORM_ADMIN_EMAILS,
): string[] {
  return parsePlatformAdminEmails(raw);
}

export function isPlatformAdminEmail(
  email: string | undefined | null,
  raw: string | undefined | null = process.env.PLATFORM_ADMIN_EMAILS,
): boolean {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return parsePlatformAdminEmails(raw).includes(normalized);
}