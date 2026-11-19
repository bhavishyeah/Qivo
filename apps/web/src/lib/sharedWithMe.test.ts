import { describe, expect, it } from "vitest";

import { parseSharedWithMe } from "./sharedWithMe";

const item = {
  shareId: "s1",
  role: "EDITOR",
  form: { id: "f1", title: "Event form", slug: "event-form-abc", status: "PUBLISHED" },
};

describe("parseSharedWithMe", () => {
  it("reads the list from the API's { shares: [...] } wrapper", () => {
    expect(parseSharedWithMe({ shares: [item] })).toEqual([item]);
  });

  it("returns an empty list for an empty wrapper", () => {
    expect(parseSharedWithMe({ shares: [] })).toEqual([]);
  });

  it("still accepts a bare array", () => {
    expect(parseSharedWithMe([item])).toEqual([item]);
  });

  it("never returns a non-array (regression: 'e.map is not a function')", () => {
    for (const bad of [null, undefined, {}, { shares: null }, { shares: "x" }, "oops", 42]) {
      const result = parseSharedWithMe(bad);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    }
  });
});
