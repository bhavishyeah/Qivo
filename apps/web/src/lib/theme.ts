// Per-form theme resolution + Google Fonts loading. Display-only concern shared
// by the public form, the editor's live preview, and the authenticated preview.
//
// FONT_ALLOW_LIST below mirrors the AUTHORITATIVE list in
// apps/api/src/modules/forms/form.schemas.ts — keep in sync: the API enum is
// authoritative; a font present here but not there is rejected with a 400, a
// font there but not here is never selectable.

import type { FormTheme } from "../types";

export const DEFAULT_ACCENT = "#2563eb";

export const FONT_ALLOW_LIST = [
  "Inter",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Open Sans",
  "Lora",
  "Playfair Display",
  "Source Sans 3",
] as const;

export type FontFamily = (typeof FONT_ALLOW_LIST)[number];

// Per-family Google Fonts CSS2 href + CSS fallback stack. The href is only ever
// built from an allow-list value (never arbitrary input), so there is no
// arbitrary-URL risk. The fallback stack renders sensibly if the CDN is blocked.
const FONT_MAP: Record<FontFamily, { href: string; stack: string }> = {
  Inter: {
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    stack: '"Inter", system-ui, sans-serif',
  },
  Roboto: {
    href: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap",
    stack: '"Roboto", system-ui, sans-serif',
  },
  Poppins: {
    href: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap",
    stack: '"Poppins", system-ui, sans-serif',
  },
  Montserrat: {
    href: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap",
    stack: '"Montserrat", system-ui, sans-serif',
  },
  "Open Sans": {
    href: "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap",
    stack: '"Open Sans", system-ui, sans-serif',
  },
  Lora: {
    href: "https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&display=swap",
    stack: '"Lora", Georgia, serif',
  },
  "Playfair Display": {
    href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap",
    stack: '"Playfair Display", Georgia, serif',
  },
  "Source Sans 3": {
    href: "https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap",
    stack: '"Source Sans 3", system-ui, sans-serif',
  },
};

function isAllowedFont(family: string): family is FontFamily {
  return (FONT_ALLOW_LIST as readonly string[]).includes(family);
}

export type ResolvedTheme = {
  accent?: string;
  background?: string;
  fontFamily?: string;
  coverImageUrl?: string;
};

/**
 * Resolve a stored theme against the (optional) workspace primary color.
 *
 * accent precedence: theme.accentColor -> primaryColor -> undefined.
 * It is NEVER defaulted to DEFAULT_ACCENT here — an undefined accent lets the
 * public form fall through to its existing CSS default so un-themed forms stay
 * byte-identical. Callers that render a custom button with no CSS default (the
 * previews) apply `resolved.accent ?? DEFAULT_ACCENT` themselves.
 *
 * Every other field is undefined when unset so today's defaults are untouched.
 * fontFamily resolves to the family's CSS fallback stack when set to an allowed
 * family; an unknown/stale stored value resolves to undefined (inherit).
 */
export function resolveTheme(
  theme?: FormTheme,
  primaryColor?: string | null,
): ResolvedTheme {
  const accent = theme?.accentColor ?? primaryColor ?? undefined;

  const fontFamily =
    theme?.fontFamily && isAllowedFont(theme.fontFamily)
      ? FONT_MAP[theme.fontFamily].stack
      : undefined;

  return {
    ...(accent ? { accent } : {}),
    ...(theme?.backgroundColor ? { background: theme.backgroundColor } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(theme?.coverImageUrl ? { coverImageUrl: theme.coverImageUrl } : {}),
  };
}

/**
 * Inject a deduped Google Fonts <link> into document.head for an allowed
 * family. No-op when family is undefined (default forms never hit the network),
 * unknown, or already injected.
 */
export function ensureFontLoaded(family?: string): void {
  if (!family || !isAllowedFont(family)) return;
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[data-qivo-font="${family}"]`)) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONT_MAP[family].href;
  link.setAttribute("data-qivo-font", family);
  document.head.appendChild(link);
}
