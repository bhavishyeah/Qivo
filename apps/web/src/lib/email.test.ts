import { describe, expect, it } from "vitest";

import { isValidEmail } from "./email";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("name@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.example.co.in")).toBe(true);
  });

  it("trims surrounding whitespace before checking", () => {
    expect(isValidEmail("  name@example.com  ")).toBe(true);
  });

  it("rejects a domain without a dot or TLD", () => {
    expect(isValidEmail("name@gmail")).toBe(false);
    expect(isValidEmail("name@localhost")).toBe(false);
  });

  it("rejects missing parts and stray characters", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("name")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("name@.com")).toBe(false);
    expect(isValidEmail("na me@example.com")).toBe(false);
  });

  it("rejects leading and consecutive dots in the local part", () => {
    expect(isValidEmail(".name@example.com")).toBe(false);
    expect(isValidEmail("na..me@example.com")).toBe(false);
  });
});
