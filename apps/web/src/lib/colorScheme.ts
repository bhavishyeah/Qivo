// Public-form color scheme (light/dark) resolution + persistence (FEAT-001).
//
// Dark mode is driven solely by a single data-color-scheme attribute on
// document.documentElement plus the centralized CSS variables in App.css. This
// module owns reading/writing the persisted manual choice and resolving the
// effective initial scheme (stored choice > OS prefers-color-scheme > light).
//
// Every function is DOM-guarded (typeof document/localStorage/window checks) so
// it stays unit-testable in the web suite's plain `node` test environment,
// mirroring apps/web/src/lib/theme.ts.

export type ColorScheme = "light" | "dark";

/** localStorage key holding the respondent's manual light/dark override. */
export const COLOR_SCHEME_KEY = "qivo-color-scheme";

/**
 * Read the persisted manual choice, or null when nothing valid is stored.
 * Guarded against environments without localStorage and against storage access
 * throwing (private mode / disabled cookies).
 */
export function getStoredScheme(): ColorScheme | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(COLOR_SCHEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** Persist the manual choice. No-op (never throws) when storage is unavailable. */
export function setStoredScheme(scheme: ColorScheme): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(COLOR_SCHEME_KEY, scheme);
  } catch {
    // Ignore write failures (quota, private mode) — the UI still reflects the
    // in-memory toggle for this session.
  }
}

/**
 * Resolve the effective initial scheme: a stored manual choice wins; otherwise
 * fall back to the OS preference via matchMedia; otherwise light.
 */
export function resolveInitialScheme(): ColorScheme {
  const stored = getStoredScheme();
  if (stored) return stored;
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

/**
 * Apply a scheme by setting document.documentElement.dataset.colorScheme, which
 * flips the centralized CSS variables. No-op when there is no document.
 */
export function applyScheme(scheme: ColorScheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.colorScheme = scheme;
}
