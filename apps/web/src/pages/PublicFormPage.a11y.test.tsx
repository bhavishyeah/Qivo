// Accessibility smoke tests for the public respondent form's QuestionField.
//
// IMPORTANT: these automated string assertions DO NOT equal WCAG conformance.
// They only confirm that specific ARIA/label wiring is emitted in the markup.
// Real accessibility verification still requires manual testing with a screen
// reader / assistive technology and expert review — these checks cannot catch
// focus-order problems, announcement quality, contrast in context, or whether
// the experience is actually usable without a mouse.
//
// Pattern mirrors src/components/Chips.test.tsx: render with
// renderToStaticMarkup (node env, no jsdom) and assert on the HTML string.

// Must be first: installs the localStorage stub before the page module graph
// (which imports src/lib/api.ts, reading localStorage at import time) loads.
import "./__a11yStub";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangeEvent } from "react";
import { QuestionField } from "./PublicFormPage";
import type { AnswerValue, Question } from "../types";

const noop = () => {};
const noopInput: (
  id: string,
  e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
) => void = () => {};

function renderField(
  question: Question,
  opts: { value?: AnswerValue; error?: string } = {},
): string {
  return renderToStaticMarkup(
    <QuestionField
      question={question}
      value={opts.value}
      slug="demo"
      allQuestions={[question]}
      answers={opts.value !== undefined ? { [question.id]: opts.value } : {}}
      onChange={noop}
      onInputChange={noopInput}
      error={opts.error}
      onBlur={noop}
    />,
  );
}

describe("PublicFormPage QuestionField accessibility", () => {
  it("links a text question's label to its input via htmlFor/id", () => {
    const q: Question = {
      id: "q1",
      label: "Full name",
      type: "SHORT_TEXT",
      required: false,
    };
    const html = renderField(q);
    expect(html).toContain('for="question-q1"');
    expect(html).toContain('id="question-q1"');
  });

  it("wires aria-invalid + aria-describedby to the role=alert error on an errored field", () => {
    const q: Question = {
      id: "q2",
      label: "Website",
      type: "URL",
      required: false,
    };
    const html = renderField(q, { value: "not-a-url", error: "Enter a valid URL." });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="question-q2-error"');
    expect(html).toContain('id="question-q2-error"');
    expect(html).toContain('role="alert"');
  });

  it("renders SINGLE_CHOICE as a radiogroup named by its legend", () => {
    const q: Question = {
      id: "q3",
      label: "Pick one",
      type: "SINGLE_CHOICE",
      required: false,
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    const html = renderField(q);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-labelledby="question-q3-legend"');
    expect(html).toContain('id="question-q3-legend"');
  });

  it("renders MULTIPLE_CHOICE as a group named by its legend", () => {
    const q: Question = {
      id: "q4",
      label: "Pick many",
      type: "MULTIPLE_CHOICE",
      required: false,
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    const html = renderField(q);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-labelledby="question-q4-legend"');
  });

  it("gives MULTI_ENTRY an 'Add another entry' button and numbered remove labels", () => {
    const q: Question = {
      id: "q5",
      label: "List items",
      type: "MULTI_ENTRY",
      required: false,
    };
    // Two entries so a remove button exists; the second removes "entry 2".
    const html = renderField(q, { value: ["one", "two"] });
    expect(html).toContain('aria-label="Add another entry"');
    expect(html).toContain('aria-label="Remove entry 2"');
  });

  it("exposes aria-required and a non-color required text on a required control", () => {
    const q: Question = {
      id: "q6",
      label: "Required field",
      type: "SHORT_TEXT",
      required: true,
    };
    const html = renderField(q);
    expect(html).toContain('aria-required="true"');
    expect(html).toContain("(required)");
    // The red glyph must be hidden from assistive tech so the signal is text.
    expect(html).toContain('aria-hidden="true"');
  });
});
