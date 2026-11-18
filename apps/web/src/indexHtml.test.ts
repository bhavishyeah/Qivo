import { describe, expect, it } from "vitest";

import indexHtml from "../index.html?raw";
import colorSchemeScript from "../public/color-scheme.js?raw";
import { COLOR_SCHEME_KEY } from "./lib/colorScheme";

// The production CSP (apps/web/vercel.json + nginx.conf) has no 'unsafe-inline'
// and no script hashes/nonces, so ANY inline <script> in index.html is blocked
// by the browser. These tests guard against reintroducing one.
describe("index.html vs. the CSP", () => {
  it("has no inline <script> blocks (every script tag has a src)", () => {
    const scriptTags = indexHtml.match(/<script\b[^>]*>/gi) ?? [];
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const tag of scriptTags) {
      expect(tag).toMatch(/\bsrc\s*=/i);
    }
  });

  it("loads the colour-scheme script synchronously from the head", () => {
    const head = indexHtml.slice(0, indexHtml.indexOf("</head>"));
    expect(head).toMatch(/<script src="\/color-scheme\.js"><\/script>/);
  });
});

describe("public/color-scheme.js", () => {
  it("uses the same storage key as src/lib/colorScheme.ts", () => {
    expect(colorSchemeScript).toContain(`"${COLOR_SCHEME_KEY}"`);
  });

  it("sets the data-color-scheme attribute on <html>", () => {
    expect(colorSchemeScript).toContain("documentElement.dataset.colorScheme");
  });
});
