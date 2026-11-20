import { describe, expect, it } from "vitest";
import { formatResponseValue } from "./responseFormat";

describe("formatResponseValue", () => {
  it("shows an Other answer as 'Other: text' for CSV and XLSX cells", () => {
    expect(formatResponseValue("__other__:Radio")).toBe("Other: Radio");
    expect(formatResponseValue(["a", "__other__:TV"])).toBe("a, Other: TV");
  });

  it("leaves other values as before", () => {
    expect(formatResponseValue(null)).toBe("—");
    expect(formatResponseValue(["a", "b"])).toBe("a, b");
    expect(formatResponseValue("plain")).toBe("plain");
    expect(formatResponseValue(4)).toBe("4");
  });
});
