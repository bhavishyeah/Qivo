import { describe, expect, it } from "vitest";
import { displayOrder, groupSelectOptions, nextEnabledIndex, typeaheadIndex, type SelectOption } from "./selectNav";

const opts: SelectOption[] = [
  { value: "g1", label: "Apple", group: "Fruit" },
  { value: "plain", label: "Plain" },
  { value: "g2", label: "Avocado", group: "Fruit", disabled: true },
  { value: "g3", label: "Banana", group: "Fruit" },
  { value: "v1", label: "Carrot", group: "Veg" },
];

describe("selectNav", () => {
  it("puts ungrouped options first and keeps flat indexes", () => {
    const groups = groupSelectOptions(opts);
    expect(groups.map((g) => g.label)).toEqual([undefined, "Fruit", "Veg"]);
    expect(groups[1]!.items.map((i) => i.index)).toEqual([0, 2, 3]);
    expect(displayOrder(opts)).toEqual([1, 0, 2, 3, 4]);
  });

  it("walks the displayed order, skipping disabled options and wrapping", () => {
    expect(nextEnabledIndex(opts, -1, "ArrowDown")).toBe(1);
    expect(nextEnabledIndex(opts, 1, "ArrowDown")).toBe(0);
    expect(nextEnabledIndex(opts, 0, "ArrowDown")).toBe(3);
    expect(nextEnabledIndex(opts, 4, "ArrowDown")).toBe(1);
    expect(nextEnabledIndex(opts, 1, "ArrowUp")).toBe(4);
    expect(nextEnabledIndex(opts, 3, "ArrowUp")).toBe(0);
    expect(nextEnabledIndex(opts, 3, "Home")).toBe(1);
    expect(nextEnabledIndex(opts, 1, "End")).toBe(4);
    expect(nextEnabledIndex([{ value: "x", label: "X", disabled: true }], -1, "Home")).toBe(-1);
  });

  it("matches typeahead by prefix, skips disabled, and cycles repeated letters", () => {
    expect(typeaheadIndex(opts, "b", -1)).toBe(3);
    expect(typeaheadIndex(opts, "av", -1)).toBe(-1);
    expect(typeaheadIndex(opts, "ap", 3)).toBe(0);
    expect(typeaheadIndex(opts, "a", 0)).toBe(0);
    expect(typeaheadIndex(opts, "", 0)).toBe(-1);
  });
});
