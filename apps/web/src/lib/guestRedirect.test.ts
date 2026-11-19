import { describe, expect, it } from "vitest";
import { guestRedirectPath } from "./guestRedirect";

describe("guestRedirectPath", () => {
  it("lets logged-out visitors stay", () => {
    expect(guestRedirectPath(false, "")).toBeNull();
  });
  it("sends logged-in visitors to the dashboard", () => {
    expect(guestRedirectPath(true, "")).toBe("/dashboard");
  });
  it("keeps an invite token", () => {
    expect(guestRedirectPath(true, "?invite=a b")).toBe("/accept-invite?token=a%20b");
  });
});