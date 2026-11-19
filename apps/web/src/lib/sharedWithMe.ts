import type { SharedWithMeItem } from "../types";

/**
 * Normalise the `GET /api/forms/shared-with-me` payload into a list.
 *
 * The API wraps the list: `{ success: true, data: { shares: [...] } }`, and
 * `api.get` returns the `data` part, so the page receives `{ shares: [...] }`.
 * A bare array is also accepted, and anything else becomes an empty list, so a
 * future change to the response shape can't crash the page with
 * "x.map is not a function".
 */
export function parseSharedWithMe(data: unknown): SharedWithMeItem[] {
  if (Array.isArray(data)) return data as SharedWithMeItem[];
  if (data && typeof data === "object") {
    const shares = (data as { shares?: unknown }).shares;
    if (Array.isArray(shares)) return shares as SharedWithMeItem[];
  }
  return [];
}
