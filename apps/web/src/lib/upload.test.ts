import "../pages/__a11yStub";
import { describe, expect, it } from "vitest";
import { MAX_EDITOR_IMAGE_BYTES, validateImageFile } from "./upload";

describe("validateImageFile", () => {
  it("accepts png, jpeg, gif and webp up to 5 MB", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(validateImageFile({ type, size: 1000 })).toBeNull();
    }
    expect(validateImageFile({ type: "image/png", size: MAX_EDITOR_IMAGE_BYTES })).toBeNull();
  });

  it("rejects other types", () => {
    expect(validateImageFile({ type: "image/svg+xml", size: 10 })).not.toBeNull();
    expect(validateImageFile({ type: "application/pdf", size: 10 })).not.toBeNull();
    expect(validateImageFile({ type: "", size: 10 })).not.toBeNull();
  });

  it("rejects files over 5 MB", () => {
    expect(
      validateImageFile({ type: "image/png", size: MAX_EDITOR_IMAGE_BYTES + 1 }),
    ).not.toBeNull();
  });
});
