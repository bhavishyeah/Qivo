import { describe, expect, it } from "vitest";

import {
  isValidEmail,
  isValidPhone,
  isValidUrl,
  isValidNumber,
  isValidDate,
  validateQuestionFormat,
} from "./validation";
import type { Question } from "../types";

function q(type: Question["type"], extra: Partial<Question> = {}): Question {
  return {
    id: "q1",
    label: "Q",
    type,
    required: false,
    ...extra,
  } as Question;
}

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("name@example.com")).toBe(true);
    expect(isValidEmail("  first.last+tag@sub.example.co.in  ")).toBe(true);
  });
  it("rejects garbage and TLD-less domains", () => {
    expect(isValidEmail("rewrwe")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail(".a@b.com")).toBe(false);
  });
});

describe("isValidPhone — identical to the server rule", () => {
  it("accepts international formats", () => {
    expect(isValidPhone("+91 98765 43210")).toBe(true);
    expect(isValidPhone("(555) 123-4567")).toBe(true);
    expect(isValidPhone("1234567")).toBe(true);
  });
  it("rejects garbage and out-of-range digit counts", () => {
    expect(isValidPhone("rewrwe")).toBe(false);
    expect(isValidPhone("123456")).toBe(false);
    expect(isValidPhone("1".repeat(16))).toBe(false);
  });
});

describe("isValidUrl / isValidNumber / isValidDate", () => {
  it("url", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
    expect(isValidUrl("not a url")).toBe(false);
  });
  it("number", () => {
    expect(isValidNumber(42)).toBe(true);
    expect(isValidNumber("3.14")).toBe(true);
    expect(isValidNumber("abc")).toBe(false);
  });
  it("date", () => {
    expect(isValidDate("2024-01-15")).toBe(true);
    expect(isValidDate("nope")).toBe(false);
  });
});

describe("validateQuestionFormat — per type", () => {
  it("EMAIL: valid passes, invalid fails, empty-optional ok", () => {
    expect(validateQuestionFormat(q("EMAIL"), "a@b.com")).toBeNull();
    expect(validateQuestionFormat(q("EMAIL"), "rewrwe")).toMatch(/valid email/i);
    expect(validateQuestionFormat(q("EMAIL"), "")).toBeNull();
  });
  it("URL", () => {
    expect(validateQuestionFormat(q("URL"), "https://x.com")).toBeNull();
    expect(validateQuestionFormat(q("URL"), "nope")).toMatch(/web address/i);
    expect(validateQuestionFormat(q("URL"), "")).toBeNull();
  });
  it("PHONE", () => {
    expect(validateQuestionFormat(q("PHONE"), "+91 98765 43210")).toBeNull();
    expect(validateQuestionFormat(q("PHONE"), "rewrwe")).toMatch(/phone/i);
    expect(validateQuestionFormat(q("PHONE"), "")).toBeNull();
  });
  it("NUMBER / RATING / LINEAR_SCALE", () => {
    expect(validateQuestionFormat(q("NUMBER"), 10)).toBeNull();
    expect(validateQuestionFormat(q("NUMBER"), "abc")).toMatch(/number/i);
    expect(validateQuestionFormat(q("RATING"), 3)).toBeNull();
    expect(validateQuestionFormat(q("LINEAR_SCALE"), 5)).toBeNull();
  });
  it("DATE", () => {
    expect(validateQuestionFormat(q("DATE"), "2024-01-15")).toBeNull();
    expect(validateQuestionFormat(q("DATE"), "nope")).toMatch(/date/i);
  });
  it("MULTI_ENTRY: flags a blank among real entries, allows all-filled", () => {
    expect(validateQuestionFormat(q("MULTI_ENTRY"), ["a", "b"])).toBeNull();
    expect(validateQuestionFormat(q("MULTI_ENTRY"), ["a", ""])).toMatch(/empty entries/i);
    expect(validateQuestionFormat(q("MULTI_ENTRY"), ["", ""])).toBeNull();
  });
  it("SHORT_TEXT / choice types have no format error", () => {
    expect(validateQuestionFormat(q("SHORT_TEXT"), "anything")).toBeNull();
    expect(validateQuestionFormat(q("SINGLE_CHOICE"), "opt")).toBeNull();
  });
});
