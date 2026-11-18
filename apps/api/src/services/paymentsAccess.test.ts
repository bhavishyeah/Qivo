import { afterEach, describe, expect, it } from "vitest";

import {
  isAllowListConfigured,
  isPaymentsAllowedForOwnerEmail,
  parseAllowedOwnerEmails,
} from "./paymentsAccess.js";

describe("parseAllowedOwnerEmails", () => {
  it("returns nobody for unset/empty/blank", () => {
    expect(parseAllowedOwnerEmails(undefined)).toEqual([]);
    expect(parseAllowedOwnerEmails(null)).toEqual([]);
    expect(parseAllowedOwnerEmails("")).toEqual([]);
    expect(parseAllowedOwnerEmails("  , ,, ")).toEqual([]);
  });
  it("trims and lowercases", () => {
    expect(parseAllowedOwnerEmails("  Me@Example.COM ")).toEqual(["me@example.com"]);
  });
  it("handles multiple emails and de-duplicates", () => {
    expect(parseAllowedOwnerEmails("a@x.com, B@y.org,a@X.com")).toEqual([
      "a@x.com",
      "b@y.org",
    ]);
  });
  it("ignores junk entries", () => {
    expect(parseAllowedOwnerEmails("junk, @x.com, a@, a b@x.com, ok@x.com")).toEqual([
      "ok@x.com",
    ]);
  });
});

describe("isPaymentsAllowedForOwnerEmail", () => {
  it("is case-insensitive and trims the candidate", () => {
    expect(isPaymentsAllowedForOwnerEmail(" ME@example.com ", "me@example.com")).toBe(true);
  });
  it("denies others and empty/missing candidates", () => {
    expect(isPaymentsAllowedForOwnerEmail("other@example.com", "me@example.com")).toBe(false);
    expect(isPaymentsAllowedForOwnerEmail("", "me@example.com")).toBe(false);
    expect(isPaymentsAllowedForOwnerEmail(null, "me@example.com")).toBe(false);
    expect(isPaymentsAllowedForOwnerEmail(undefined, "me@example.com")).toBe(false);
  });
  it("fails closed when the list is empty", () => {
    expect(isPaymentsAllowedForOwnerEmail("me@example.com", "")).toBe(false);
    expect(isPaymentsAllowedForOwnerEmail("me@example.com", "junk")).toBe(false);
  });
});

describe("env-backed defaults (read at call time)", () => {
  const original = process.env.PAYMENTS_ALLOWED_OWNER_EMAILS;
  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENTS_ALLOWED_OWNER_EMAILS;
    else process.env.PAYMENTS_ALLOWED_OWNER_EMAILS = original;
  });

  it("unset => nobody allowed, allow-list not configured", () => {
    delete process.env.PAYMENTS_ALLOWED_OWNER_EMAILS;
    expect(isPaymentsAllowedForOwnerEmail("me@example.com")).toBe(false);
    expect(isAllowListConfigured()).toBe(false);
  });
  it("picks up changes to the env var", () => {
    process.env.PAYMENTS_ALLOWED_OWNER_EMAILS = "Me@Example.com";
    expect(isPaymentsAllowedForOwnerEmail("me@example.com")).toBe(true);
    expect(isAllowListConfigured()).toBe(true);
  });
});
