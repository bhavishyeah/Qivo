import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Chips } from "./Chips";

// Count rendered chip pills by the shared indigo background color — the empty
// "—" placeholder has no such style, so matches are exactly the chip spans.
function countChips(html: string): number {
  return html.split("background:#eef2ff").length - 1;
}

describe("Chips", () => {
  it("renders one chip per item", () => {
    const html = renderToStaticMarkup(<Chips items={["Red", "Green", "Blue"]} />);
    expect(countChips(html)).toBe(3);
    expect(html).toContain("Red");
    expect(html).toContain("Green");
    expect(html).toContain("Blue");
  });

  it("renders an em dash for an empty array", () => {
    const html = renderToStaticMarkup(<Chips items={[]} />);
    expect(countChips(html)).toBe(0);
    expect(html).toContain("—");
  });

  it("wraps long entries instead of overflowing", () => {
    const html = renderToStaticMarkup(
      <Chips items={["a-very-long-single-token-without-spaces-to-wrap"]} />,
    );
    expect(html).toContain("overflow-wrap:anywhere");
  });

  it("coerces non-string members via the caller's mapping", () => {
    // Callers pass `value.map((v) => String(v).trim()).filter(Boolean)`, so
    // Chips itself always receives strings; verify such coerced input renders.
    const items = [42, true, "ok"].map((v) => String(v));
    const html = renderToStaticMarkup(<Chips items={items} />);
    expect(countChips(html)).toBe(3);
    expect(html).toContain("42");
    expect(html).toContain("true");
    expect(html).toContain("ok");
  });
});
