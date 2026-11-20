import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// vitest does not return CSS through ?raw, so read the files directly.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const appCss = read("../App.css");
const aliasesCss = read("./legacy-aliases.css");
const freezeCss = read("./public-form-freeze.css");
const tokensCss = read("./tokens.css");

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
}
const names = (body: string) => [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);

describe("token files", () => {
  it("defines every dark token in the light block too", () => {
    const light = new Set(names(block(tokensCss, ":root")));
    for (const n of names(block(tokensCss, '[data-color-scheme="dark"]'))) expect(light.has(n), n).toBe(true);
  });

  it("keeps the old public-form variables out of App.css", () => {
    expect(appCss).not.toMatch(/--qivo-[a-z0-9-]+\s*:/);
    expect(appCss).not.toMatch(/^:root\s*\{/m);
  });

  it("freezes the old public-form values on :root and the dark selector", () => {
    expect(freezeCss).toContain("--qivo-primary: #2563eb;");
    expect(freezeCss).toContain("--qivo-page-bg: #f4f7fb;");
    expect(freezeCss).toContain("--qivo-page-bg: #0f172a;");
  });

  it("scopes legacy aliases to .app-root", () => {
    const selectors = [...aliasesCss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s).toMatch(/\.app-root$/);
  });
});
