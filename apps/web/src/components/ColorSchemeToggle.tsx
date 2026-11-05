// Light/dark toggle for the public respondent form and the editor preview
// (FEAT-001). A single button whose aria-pressed reflects dark-on, with a
// non-color sun/moon glyph (aria-hidden) plus visually-hidden label text so the
// control is distinguishable without relying on color alone.

import { useEffect, useState } from "react";
import {
  applyScheme,
  resolveInitialScheme,
  setStoredScheme,
  type ColorScheme,
} from "../lib/colorScheme";

export type ColorSchemeToggleProps = {
  /** Notified after each toggle with the newly-applied scheme. Optional. */
  onChange?: (scheme: ColorScheme) => void;
};

export default function ColorSchemeToggle({ onChange }: ColorSchemeToggleProps) {
  // Initialize from the attribute the inline index.html script already set, so
  // the first client render matches the pre-paint DOM (the inline script writes
  // the fully-resolved scheme before React mounts). Falls back to the resolved
  // scheme when the attribute is somehow absent, and to "light" for SSR/static
  // render (no document).
  const [scheme, setScheme] = useState<ColorScheme>(() => {
    if (typeof document === "undefined") return "light";
    const attr = document.documentElement.dataset.colorScheme;
    if (attr === "dark" || attr === "light") return attr;
    return resolveInitialScheme();
  });

  // Ensure the DOM attribute matches the resolved state (idempotent external
  // sync, not a React state update — the inline script normally wins, so this
  // is a defensive no-op in practice).
  useEffect(() => {
    applyScheme(scheme);
  }, [scheme]);

  const isDark = scheme === "dark";

  function toggle() {
    const next: ColorScheme = isDark ? "light" : "dark";
    setScheme(next);
    applyScheme(next);
    setStoredScheme(next);
    onChange?.(next);
  }

  return (
    <button
      type="button"
      className="color-scheme-toggle"
      aria-pressed={isDark}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
    >
      <span aria-hidden="true">{isDark ? "\u2600" : "\u263E"}</span>
      <span className="visually-hidden">
        {isDark ? "Switch to light mode" : "Switch to dark mode"}
      </span>
    </button>
  );
}
