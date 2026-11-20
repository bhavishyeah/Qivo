import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { contrastRatio } from "../lib/editorTheme";

// vitest does not return CSS through ?raw, so read the file directly.
const tokensCss = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

// WCAG 2.x contrast over the token pairs the chrome actually uses for text and
// component boundaries, read straight from tokens.css so the test cannot drift
// from the shipped values.

function blockBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing block ${selector}`);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
}

function parseTokens(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const light = parseTokens(blockBody(tokensCss, ":root"));
const dark = { ...light, ...parseTokens(blockBody(tokensCss, '[data-color-scheme="dark"]')) };

type Scheme = "light" | "dark" | "both";
type Pair = { fg: string; bg: string; min: number; scheme: Scheme; note?: string };

const TEXT = 4.5;
const UI = 3;

const SURFACES = ["--color-bg", "--color-surface", "--color-surface-sunken"];

const PAIRS: Pair[] = [
  // Body, muted, subtle and link text on every page surface, both themes.
  ...SURFACES.flatMap((bg) =>
    ["--color-text", "--color-text-muted", "--color-text-subtle", "--color-link"].map(
      (fg): Pair => ({ fg, bg, min: TEXT, scheme: "both" }),
    ),
  ),
  { fg: "--color-text", bg: "--color-surface-raised", min: TEXT, scheme: "both" },
  { fg: "--color-text-muted", bg: "--color-surface-raised", min: TEXT, scheme: "both" },
  { fg: "--color-text-subtle", bg: "--color-surface-raised", min: TEXT, scheme: "both" },
  { fg: "--color-link", bg: "--color-surface-raised", min: TEXT, scheme: "both" },
  // Buttons
  { fg: "--color-on-primary", bg: "--color-primary", min: TEXT, scheme: "both" },
  { fg: "--color-on-primary", bg: "--color-primary-hover", min: TEXT, scheme: "both" },
  { fg: "--color-on-primary", bg: "--color-primary-active", min: TEXT, scheme: "both" },
  { fg: "--color-on-danger", bg: "--color-danger", min: TEXT, scheme: "both" },
  { fg: "--color-on-danger", bg: "--color-danger-hover", min: TEXT, scheme: "both" },
  { fg: "--color-on-accent", bg: "--color-accent", min: TEXT, scheme: "both" },
  // Selected and hover rows
  { fg: "--color-text", bg: "--color-selected", min: TEXT, scheme: "both" },
  { fg: "--color-text-muted", bg: "--color-selected", min: TEXT, scheme: "both" },
  { fg: "--color-text-subtle", bg: "--color-selected", min: TEXT, scheme: "both" },
  { fg: "--color-link", bg: "--color-selected", min: TEXT, scheme: "both" },
  { fg: "--color-text", bg: "--color-hover", min: TEXT, scheme: "both" },
  { fg: "--color-text-muted", bg: "--color-hover", min: TEXT, scheme: "both" },
  { fg: "--color-text-subtle", bg: "--color-hover", min: TEXT, scheme: "dark" },
  // Tinted areas
  { fg: "--color-text", bg: "--color-tint", min: TEXT, scheme: "both" },
  { fg: "--color-text-muted", bg: "--color-tint", min: TEXT, scheme: "both" },
  { fg: "--color-text-subtle", bg: "--color-tint", min: TEXT, scheme: "both" },
  { fg: "--color-link", bg: "--color-tint", min: TEXT, scheme: "both" },
  // Inputs
  { fg: "--color-text", bg: "--color-input-bg", min: TEXT, scheme: "both" },
  { fg: "--color-text-subtle", bg: "--color-input-bg", min: TEXT, scheme: "both" },
  // Feedback text on its own tint and on the surface
  { fg: "--color-success-text", bg: "--color-success-tint", min: TEXT, scheme: "both" },
  { fg: "--color-warning-text", bg: "--color-warning-tint", min: TEXT, scheme: "both" },
  { fg: "--color-danger-text", bg: "--color-danger-tint", min: TEXT, scheme: "both" },
  { fg: "--color-success-text", bg: "--color-surface", min: TEXT, scheme: "both" },
  { fg: "--color-danger-text", bg: "--color-surface", min: TEXT, scheme: "both" },
  { fg: "--color-danger-text", bg: "--color-surface-raised", min: TEXT, scheme: "both" },
  // Badges and chips
  ...["draft", "pending", "published", "closed", "archived"].map(
    (s): Pair => ({ fg: `--status-${s}-fg`, bg: `--status-${s}-bg`, min: TEXT, scheme: "both" }),
  ),
  { fg: "--status-tag-fg", bg: "--status-tag-bg", min: TEXT, scheme: "both" },
  // Component boundaries and markers (3:1)
  ...SURFACES.map((bg): Pair => ({ fg: "--color-border-strong", bg, min: UI, scheme: "both" })),
  { fg: "--color-border-strong", bg: "--color-surface-raised", min: UI, scheme: "dark" },
  { fg: "--color-focus", bg: "--color-surface", min: UI, scheme: "both" },
  { fg: "--color-focus", bg: "--color-bg", min: UI, scheme: "both" },
  { fg: "--color-focus", bg: "--color-surface-raised", min: UI, scheme: "dark" },
  { fg: "--color-nav-indicator", bg: "--color-surface", min: UI, scheme: "both" },
  { fg: "--color-primary", bg: "--color-surface", min: UI, scheme: "both" },
  { fg: "--color-primary", bg: "--color-bg", min: UI, scheme: "both" },
  // Chart series against the surface they are drawn on
  ...[1, 2, 3, 4, 5, 6].map((n): Pair => ({ fg: `--chart-${n}`, bg: "--color-surface", min: UI, scheme: "both" })),
  // Folder swatches
  ...["indigo", "olive", "stone", "berry", "orchid", "moss"].map(
    (n): Pair => ({ fg: `--folder-${n}`, bg: "--color-surface", min: UI, scheme: "both" }),
  ),
];

function check(scheme: "light" | "dark") {
  const tokens = scheme === "light" ? light : dark;
  const failures: string[] = [];
  for (const p of PAIRS) {
    if (p.scheme !== "both" && p.scheme !== scheme) continue;
    const fg = tokens[p.fg];
    const bg = tokens[p.bg];
    if (!fg || !bg) {
      failures.push(`${p.fg} on ${p.bg}: token is not a literal hex in tokens.css`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    if (ratio < p.min) failures.push(`${p.fg} ${fg} on ${p.bg} ${bg}: ${ratio.toFixed(2)} < ${p.min}`);
  }
  return failures;
}

describe("token contrast (WCAG 2.x)", () => {
  it("light theme pairs meet their minimum", () => {
    expect(check("light")).toEqual([]);
  });

  it("dark theme pairs meet their minimum", () => {
    expect(check("dark")).toEqual([]);
  });

  it("hover and selected rows stay distinguishable from their surfaces", () => {
    expect(contrastRatio(dark["--color-hover"], dark["--color-surface-raised"])).toBeGreaterThanOrEqual(1.15);
    expect(contrastRatio(dark["--color-hover"], dark["--color-surface"])).toBeGreaterThanOrEqual(1.15);
    expect(contrastRatio(dark["--color-selected"], dark["--color-hover"])).toBeGreaterThanOrEqual(1.15);
    expect(contrastRatio(light["--color-hover"], light["--color-surface"])).toBeGreaterThanOrEqual(1.08);
  });

  it("brand-on-brand pairs used on Indigo, Cream and Berry areas pass", () => {
    const brand = (n: string) => light[`--brand-${n}`];
    const pairs: Array<[string, string, number]> = [
      [brand("lime"), brand("indigo"), TEXT],
      [brand("cream"), brand("indigo"), TEXT],
      ["#ffffff", brand("indigo"), TEXT],
      ["#d9c9e3", brand("indigo"), TEXT],
      [brand("indigo"), brand("lime"), TEXT],
      [brand("olive"), brand("cream"), TEXT],
      [brand("indigo"), brand("cream"), TEXT],
      [brand("stone"), brand("cream"), TEXT],
      [brand("cream"), brand("berry"), TEXT],
      [brand("lime"), brand("berry"), TEXT],
    ];
    for (const [fg, bg, min] of pairs) {
      expect(contrastRatio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it("keeps the forbidden light-theme text colours forbidden", () => {
    for (const bg of ["--color-bg", "--color-surface"]) {
      expect(contrastRatio(light["--brand-lime"], light[bg])).toBeLessThan(UI);
      expect(contrastRatio(light["--brand-moss"], light[bg])).toBeLessThan(UI);
    }
    // Orchid is only for large decorative glyphs on white, never small text.
    expect(contrastRatio(light["--brand-orchid"], light["--color-surface"])).toBeLessThan(TEXT);
  });
});
