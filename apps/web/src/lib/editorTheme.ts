/**
 * Pure helpers that turn the live Appearance state into CSS custom properties
 * for the Builder canvas (no DOM access). Empty/invalid input yields {} so
 * un-themed forms keep today's look.
 */
import { resolveTheme } from "./theme";

const DARK_SURFACE = "#1e293b";
const WHITE = "#ffffff";
const DARK_TEXT = "#0f172a";

/** "#abc" -> "#aabbcc", "#AABBCC" -> "#aabbcc"; null for anything else. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

function toRgb(hex: string): [number, number, number] {
  const n = normalizeHex(hex) ?? "#000000";
  return [
    parseInt(n.slice(1, 3), 16),
    parseInt(n.slice(3, 5), 16),
    parseInt(n.slice(5, 7), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** WCAG relative luminance (0..1). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or slate-900, whichever reads better on `bg`. */
export function readableTextOn(bg: string): string {
  return contrastRatio(bg, WHITE) >= contrastRatio(bg, DARK_TEXT) ? WHITE : DARK_TEXT;
}

/** Linear mix: t=0 -> hexA, t=1 -> hexB. */
export function mix(hexA: string, hexB: string, t: number): string {
  const a = toRgb(hexA);
  const b = toRgb(hexB);
  const k = Math.max(0, Math.min(1, t));
  return toHex([
    a[0] * (1 - k) + b[0] * k,
    a[1] * (1 - k) + b[1] * k,
    a[2] * (1 - k) + b[2] * k,
  ]);
}

/** Lighten toward white until contrast against the dark surface is >= 3:1. */
export function liftForDark(accent: string, surface: string = DARK_SURFACE): string {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(accent, WHITE, t);
    if (contrastRatio(c, surface) >= 3) return c;
  }
  return WHITE;
}

export function buildEditorThemeVars(input: {
  accent?: string;
  background?: string;
  fontFamily?: string;
}): Record<string, string> {
  const vars: Record<string, string> = {};
  const accent = normalizeHex(input.accent);
  if (accent) {
    vars["--editor-accent"] = accent;
    vars["--editor-accent-contrast"] = readableTextOn(accent);
    vars["--editor-accent-soft"] = mix(accent, WHITE, 0.88);
    vars["--editor-accent-dark"] = liftForDark(accent);
  }
  const background = normalizeHex(input.background);
  if (background) vars["--editor-bg"] = background;
  const font = input.fontFamily
    ? resolveTheme({ fontFamily: input.fontFamily }).fontFamily
    : undefined;
  if (font) vars["--editor-font"] = font;
  return vars;
}
