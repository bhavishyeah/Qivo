// Static-markup tests for display-only blocks and question images.
import "./__a11yStub";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangeEvent } from "react";
import { QuestionField } from "./PublicFormPage";
import type { Question } from "../types";

const noop = () => {};
const noopInput: (
  id: string,
  e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
) => void = () => {};

function render(question: Question): string {
  return renderToStaticMarkup(
    <QuestionField
      question={question}
      value={undefined}
      slug="demo"
      allQuestions={[question]}
      answers={{}}
      onChange={noop}
      onInputChange={noopInput}
      onBlur={noop}
    />,
  );
}

const IMG = "https://res.cloudinary.com/demo/image/upload/v1/a.png";

describe("PublicFormPage blocks and images", () => {
  it("renders a TEXT_BLOCK as heading + paragraph with no input or required mark", () => {
    const html = render({
      id: "t1",
      label: "About you",
      description: "Line one\nLine two",
      type: "TEXT_BLOCK",
      required: true,
    });
    expect(html).toContain("<h3");
    expect(html).toContain("About you");
    expect(html).toContain("Line one");
    expect(html).toContain("pre-wrap");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("required-mark");
  });

  it("renders an IMAGE_BLOCK image with its caption", () => {
    const html = render({
      id: "i1",
      label: "Image",
      type: "IMAGE_BLOCK",
      required: false,
      imageUrl: IMG,
      imageAlign: "CENTER",
      imageCaption: "Campus map",
    });
    expect(html).toContain(`<img src="${IMG}"`);
    expect(html).toContain("<figcaption");
    expect(html).toContain("Campus map");
    expect(html).not.toContain("<input");
  });

  it("renders the image of a normal question above its input", () => {
    const html = render({
      id: "q1",
      label: "Which building?",
      type: "SHORT_TEXT",
      required: false,
      imageUrl: IMG,
      imageCaption: "Pic",
    });
    expect(html).toContain(`<img src="${IMG}"`);
    expect(html).toContain('alt="Pic"');
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<input"));
  });
});
