import { describe, expect, it } from "vitest";
import { FOLDER_TONES, folderTone } from "./folderTone";

describe("folderTone", () => {
  it("is stable for the same id", () => {
    expect(folderTone("abc-123")).toBe(folderTone("abc-123"));
  });

  it("always returns one of the six tones", () => {
    for (const id of ["", "a", "folder-1", "cmx9k2l0000"]) {
      expect(FOLDER_TONES).toContain(folderTone(id));
    }
  });
});
