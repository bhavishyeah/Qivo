import { describe, expect, it } from "vitest";
import { computeMenuPosition, nextMenuIndex, type Rect } from "./menuNav";

function rect(left: number, top: number, width = 32, height = 32): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

describe("nextMenuIndex", () => {
  it("wraps ArrowDown and ArrowUp", () => {
    expect(nextMenuIndex(2, "ArrowDown", 3)).toBe(0);
    expect(nextMenuIndex(0, "ArrowUp", 3)).toBe(2);
    expect(nextMenuIndex(0, "ArrowDown", 3)).toBe(1);
    expect(nextMenuIndex(2, "ArrowUp", 3)).toBe(1);
  });

  it("starts at the ends from no focus", () => {
    expect(nextMenuIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextMenuIndex(-1, "ArrowUp", 3)).toBe(2);
  });

  it("handles Home, End and empty menus", () => {
    expect(nextMenuIndex(1, "Home", 4)).toBe(0);
    expect(nextMenuIndex(1, "End", 4)).toBe(3);
    expect(nextMenuIndex(0, "ArrowDown", 0)).toBe(-1);
  });
});

describe("computeMenuPosition", () => {
  const viewport = { width: 400, height: 600 };
  const menu = { width: 180, height: 200 };

  it("opens below, left aligned to the trigger", () => {
    expect(computeMenuPosition(rect(50, 100), menu, viewport)).toEqual({ top: 136, left: 50, placement: "below" });
  });

  it("flips above when it would overflow the bottom", () => {
    const pos = computeMenuPosition(rect(50, 500), menu, viewport);
    expect(pos.placement).toBe("above");
    expect(pos.top).toBe(500 - 4 - 200);
  });

  it("aligns to the trigger's right edge when it would overflow right", () => {
    const pos = computeMenuPosition(rect(360, 100), menu, viewport);
    expect(pos.left).toBe(392 - 180);
  });

  it("clamps to the 8px viewport margin", () => {
    const pos = computeMenuPosition(rect(-20, 100), menu, viewport);
    expect(pos.left).toBe(8);
    const tall = computeMenuPosition(rect(50, 10), { width: 180, height: 700 }, viewport);
    expect(tall.top).toBe(8);
  });
});
