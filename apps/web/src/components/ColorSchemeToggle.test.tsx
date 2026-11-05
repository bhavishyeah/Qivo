import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ColorSchemeToggle from "./ColorSchemeToggle";

// The toggle seeds its initial render state from
// document.documentElement.dataset.colorScheme. renderToStaticMarkup never runs
// effects, so a stubbed document lets us assert both rendered states. No jsdom
// in this suite (plain node env), so stub the single field the component reads.

function setDocScheme(scheme?: "light" | "dark") {
  (globalThis as { document?: unknown }).document = {
    documentElement: { dataset: scheme ? { colorScheme: scheme } : {} },
  };
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("ColorSchemeToggle", () => {
  it("renders the light state (aria-pressed false, offers dark)", () => {
    setDocScheme("light");
    const html = renderToStaticMarkup(<ColorSchemeToggle />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Switch to dark mode"');
    expect(html).toContain("Switch to dark mode");
  });

  it("renders the dark state (aria-pressed true, offers light)", () => {
    setDocScheme("dark");
    const html = renderToStaticMarkup(<ColorSchemeToggle />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Switch to light mode"');
    expect(html).toContain("Switch to light mode");
  });

  it("defaults to light when no scheme attribute is set", () => {
    setDocScheme(undefined);
    const html = renderToStaticMarkup(<ColorSchemeToggle />);
    expect(html).toContain('aria-pressed="false"');
  });
});
