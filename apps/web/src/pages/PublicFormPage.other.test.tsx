// Must be first: installs the localStorage stub before the page module graph loads.
import "./__a11yStub";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangeEvent } from "react";
import { QuestionField } from "./PublicFormPage";
import { evaluateConditions } from "../lib/conditions";
import type { AnswerValue, Question } from "../types";

const noop = () => {};
const noopInput: (id: string, e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void = () => {};

const options = ["a", "b", "c", "d", "e", "f"].map((v) => ({ value: v, label: `Option ${v}` }));

function render(question: Question, value?: AnswerValue, shuffleSeed?: string): string {
  return renderToStaticMarkup(
    <QuestionField
      question={question}
      value={value}
      slug="demo"
      allQuestions={[question]}
      answers={value !== undefined ? { [question.id]: value } : {}}
      shuffleSeed={shuffleSeed}
      onChange={noop}
      onInputChange={noopInput}
    />,
  );
}

const single: Question = {
  id: "q1",
  label: "Pick",
  type: "SINGLE_CHOICE",
  required: false,
  options,
  settings: { allowOther: true },
};

describe("Other choice in the public form", () => {
  it("renders a last 'Other:' radio with a disabled, labelled text input when not selected", () => {
    const html = render(single);
    expect(html).toContain("Other:");
    expect(html).toContain('type="radio"');
    expect(html).toContain('aria-label="Other, please specify"');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain("disabled");
    expect(html.lastIndexOf("Other:")).toBeGreaterThan(html.lastIndexOf("Option f"));
  });

  it("enables and requires the text input once Other is selected", () => {
    const html = render(single, "__other__:Radio");
    expect(html).toContain('value="Radio"');
    expect(html).toContain("required");
    expect(html).not.toMatch(/class="choice-other-input"[^>]*disabled/);
  });

  it("uses a checkbox for multiple choice and keeps other selections", () => {
    const html = render({ ...single, type: "MULTIPLE_CHOICE" }, ["a", "__other__:TV"]);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('value="TV"');
  });

  it("does not render Other without the setting or on a dropdown", () => {
    expect(render({ ...single, settings: {} })).not.toContain("Other:");
    expect(render({ ...single, type: "DROPDOWN" })).not.toContain("Other:");
  });
});

describe("shuffled options in the public form", () => {
  const shuffled: Question = { ...single, settings: { allowOther: true, shuffleOptions: true } };
  const order = (html: string) => [...html.matchAll(/Option ([a-f])/g)].map((m) => m[1]).join("");

  it("is stable for a seed and keeps Other last", () => {
    const first = render(shuffled, undefined, "seed-1");
    expect(order(render(shuffled, undefined, "seed-1"))).toBe(order(first));
    expect(first.lastIndexOf("Other:")).toBeGreaterThan(first.lastIndexOf("Option "));
  });

  it("varies by seed and keeps editor order without a seed", () => {
    const orders = new Set(["s1", "s2", "s3", "s4", "s5"].map((s) => order(render(shuffled, undefined, s))));
    expect(orders.size).toBeGreaterThan(1);
    expect(order(render(shuffled))).toBe("abcdef");
  });
});

describe("conditions with a controlling question that appears later", () => {
  it("stays hidden until the controlling question is answered, without throwing", () => {
    const rule = [{ questionId: "later", operator: "equals" as const, value: "yes" }];
    expect(evaluateConditions(rule, {})).toBe(false);
    expect(evaluateConditions(rule, { later: "yes" })).toBe(true);
    const notEmpty = [{ questionId: "later", operator: "not_empty" as const }];
    expect(evaluateConditions(notEmpty, {})).toBe(false);
  });
});
