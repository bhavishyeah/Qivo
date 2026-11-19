import { describe, expect, it } from "vitest";
import { computeToolbarTop, insertAfterId, moveItem, shouldCollapseOnPointerDown } from "./editorSelection";

describe("insertAfterId", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("inserts after the selected id", () => {
    expect(insertAfterId(list, { id: "x" }, "b").map((q) => q.id)).toEqual(["a", "b", "x", "c"]);
  });
  it("inserts after the last item", () => {
    expect(insertAfterId(list, { id: "x" }, "c").map((q) => q.id)).toEqual(["a", "b", "c", "x"]);
  });
  it("appends when nothing is selected or the id is unknown", () => {
    expect(insertAfterId(list, { id: "x" }, null).map((q) => q.id)).toEqual(["a", "b", "c", "x"]);
    expect(insertAfterId(list, { id: "x" }, "zzz").map((q) => q.id)).toEqual(["a", "b", "c", "x"]);
  });
  it("does not mutate the input", () => {
    insertAfterId(list, { id: "x" }, "a");
    expect(list).toHaveLength(3);
  });
});

function fakeTarget(matches: boolean, extra: Record<string, unknown> = {}) {
  return { closest: () => (matches ? {} : null), isConnected: true, ownerDocument: { documentElement: {} }, ...extra } as unknown as EventTarget;
}

describe("shouldCollapseOnPointerDown", () => {
  it("collapses on empty space", () => {
    expect(shouldCollapseOnPointerDown(fakeTarget(false))).toBe(true);
  });
  it("keeps open for protected areas", () => {
    expect(shouldCollapseOnPointerDown(fakeTarget(true))).toBe(false);
  });
  it("ignores null, detached nodes and the root element", () => {
    expect(shouldCollapseOnPointerDown(null)).toBe(false);
    expect(shouldCollapseOnPointerDown(fakeTarget(false, { isConnected: false }))).toBe(false);
    const root = {};
    const rootTarget = { closest: () => null, isConnected: true, ownerDocument: { documentElement: root } };
    Object.assign(rootTarget, {});
    (rootTarget.ownerDocument as { documentElement: unknown }).documentElement = rootTarget;
    expect(shouldCollapseOnPointerDown(rootTarget as unknown as EventTarget)).toBe(false);
  });
});

describe("computeToolbarTop", () => {
  const base = { anchorHeight: 100, canvasViewportTop: 300, canvasHeight: 2000, toolbarHeight: 100, stickyOffset: 80 };
  it("aligns with the anchor card", () => {
    expect(computeToolbarTop({ ...base, anchorTop: 400 })).toBe(400);
  });
  it("stays visible beside a tall card while scrolled", () => {
    // canvas scrolled 600px up: viewport top is canvas y=680; card spans 400..1400
    expect(computeToolbarTop({ ...base, anchorTop: 400, anchorHeight: 1000, canvasViewportTop: -600 })).toBe(680);
  });
  it("never passes the bottom of the card", () => {
    expect(computeToolbarTop({ ...base, anchorTop: 400, anchorHeight: 300, canvasViewportTop: -1000 })).toBe(600);
  });
  it("sticks to the viewport without an anchor", () => {
    expect(computeToolbarTop({ ...base, anchorTop: null, canvasViewportTop: -500 })).toBe(580);
    expect(computeToolbarTop({ ...base, anchorTop: null })).toBe(0);
  });
  it("clamps inside the canvas", () => {
    expect(computeToolbarTop({ ...base, anchorTop: 1990 })).toBe(1900);
  });
});

describe("moveItem", () => {
  const list = ["a", "b", "c", "d"];
  it("moves an item forward and backward", () => {
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("clamps the target index", () => {
    expect(moveItem(list, 1, -5)).toEqual(["b", "a", "c", "d"]);
    expect(moveItem(list, 1, 99)).toEqual(["a", "c", "d", "b"]);
  });
  it("returns an unchanged copy when from === to or from is out of range", () => {
    const same = moveItem(list, 2, 2);
    expect(same).toEqual(list);
    expect(same).not.toBe(list);
    expect(moveItem(list, 9, 0)).toEqual(list);
    expect(moveItem([], 0, 1)).toEqual([]);
  });
  it("does not mutate the input", () => {
    moveItem(list, 0, 3);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });
});