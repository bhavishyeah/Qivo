// Readable colours for the public respondent form, derived from the form's own
// Appearance theme. Text that sits directly on the page background (title,
// description, seats left, footer) gets a text and a muted colour that both
// reach WCAG AA (>= 4.5:1) against that background. Text inside the white card
// keeps dark text; its muted shade is fixed in CSS (also >= 4.5:1 on white).

import { contrastRatio, mix, normalizeHex, readableTextOn } from "./editorTheme";
import { DEFAULT_ACCENT, type ResolvedTheme } from "./theme";

export const AA = 4.5;
/** Darkest stop of the default (un-themed) page gradient. */
export const DEFAULT_PAGE_BG = "#dbeafe";

export type PageTextColors = { text: string; muted: string };

function strongestText(bg: string): string {
  const candidate = readableTextOn(bg);
  if (contrastRatio(candidate, bg) >= AA) return candidate;
  // Mid-tone backgrounds: slate-900 / white can both fall just under 4.5:1.
  const extreme = contrastRatio("#000000", bg) >= contrastRatio("#ffffff", bg) ? "#000000" : "#ffffff";
  return extreme;
}

/** Text + muted text colours that reach AA against `background`. */
export function pageTextColors(background?: string | null): PageTextColors {
  const bg = normalizeHex(background) ?? DEFAULT_PAGE_BG;
  const text = strongestText(bg);
  // Soften toward the background as far as AA allows, but never past ~30%.
  for (let t = 0.3; t > 0; t -= 0.02) {
    const muted = mix(text, bg, t);
    if (contrastRatio(muted, bg) >= AA) return { text, muted };
  }
  return { text, muted: text };
}

/** Darken `accent` toward black until it reads (>= 4.5:1) on `surface`. */
export function accentTextOn(accent: string, surface = "#ffffff"): string {
  const base = normalizeHex(accent) ?? DEFAULT_ACCENT;
  for (let t = 0; t <= 1; t += 0.05) {
    const c = mix(base, "#000000", t);
    if (contrastRatio(c, surface) >= AA) return c;
  }
  return "#000000";
}

/**
 * CSS custom properties for the public form root. Includes the page background
 * (--qivo-form-bg) when the form sets one.
 */
export function publicFormVars(resolved: ResolvedTheme): Record<string, string> {
  const { text, muted } = pageTextColors(resolved.background);
  const accent = normalizeHex(resolved.accent) ?? DEFAULT_ACCENT;
  return {
    ...(resolved.background ? { "--qivo-form-bg": resolved.background } : {}),
    "--pf-text": text,
    "--pf-muted": muted,
    "--pf-accent": accent,
    "--pf-accent-ink": readableTextOn(accent),
    "--pf-accent-text": accentTextOn(accent),
  };
}