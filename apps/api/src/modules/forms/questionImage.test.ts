import { afterEach, describe, expect, it } from "vitest";
import { validateQuestionImageUrl } from "./questionImage.js";

const base = "https://res.cloudinary.com/demo/image/upload/v1/qivo/forms/f1/pic";

describe("validateQuestionImageUrl", () => {
  const original = process.env.CLOUDINARY_CLOUD_NAME;
  afterEach(() => {
    if (original === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = original;
  });

  it.each(["jpg", "png", "webp", "gif", "jpeg"])("accepts .%s", (ext) => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    expect(validateQuestionImageUrl(`${base}.${ext}`)).toBeNull();
  });

  it("accepts an extensionless image upload", () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    expect(validateQuestionImageUrl(base)).toBeNull();
  });

  it("rejects http", () => {
    expect(validateQuestionImageUrl(base.replace("https", "http") + ".jpg")).not.toBeNull();
  });

  it("rejects other hosts", () => {
    expect(
      validateQuestionImageUrl("https://evil.example.com/demo/image/upload/a.jpg"),
    ).not.toBeNull();
    expect(
      validateQuestionImageUrl("https://res.cloudinary.com.evil.com/demo/image/upload/a.jpg"),
    ).not.toBeNull();
  });

  it("rejects svg, pdf and raw uploads", () => {
    expect(validateQuestionImageUrl(`${base}.svg`)).not.toBeNull();
    expect(validateQuestionImageUrl(`${base}.pdf`)).not.toBeNull();
    expect(
      validateQuestionImageUrl("https://res.cloudinary.com/demo/raw/upload/v1/a.jpg"),
    ).not.toBeNull();
  });

  it("rejects garbage", () => {
    expect(validateQuestionImageUrl("not a url")).not.toBeNull();
  });

  it("enforces the configured cloud name", () => {
    process.env.CLOUDINARY_CLOUD_NAME = "mine";
    expect(validateQuestionImageUrl(`${base}.jpg`)).not.toBeNull();
    expect(
      validateQuestionImageUrl("https://res.cloudinary.com/mine/image/upload/a.jpg"),
    ).toBeNull();
  });
});
