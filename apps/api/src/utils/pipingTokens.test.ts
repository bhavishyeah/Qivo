import { describe, expect, it } from "vitest";

import { stripPipingTokens } from "./pipingTokens.js";

describe("stripPipingTokens", () => {
  it("resolves a token to the referenced question's label in brackets", () => {
    const labels = new Map([["q_team", "Team name"]]);
    expect(stripPipingTokens("Welcome {{q_team}}!", labels)).toBe(
      "Welcome [Team name]!",
    );
  });

  it("resolves from a plain object map too", () => {
    expect(stripPipingTokens("Hi {{q_name}}", { q_name: "Full name" })).toBe(
      "Hi [Full name]",
    );
  });

  it("falls back to [answer] for an unknown token", () => {
    const labels = new Map([["q_team", "Team name"]]);
    expect(stripPipingTokens("Hello {{q_missing}}", labels)).toBe(
      "Hello [answer]",
    );
  });

  it("falls back to [answer] when no map is provided", () => {
    expect(stripPipingTokens("Rate {{q_item}}")).toBe("Rate [answer]");
  });

  it("handles multiple tokens in one label", () => {
    const labels = new Map([
      ["q_team", "Team name"],
      ["q_city", "City"],
    ]);
    expect(
      stripPipingTokens("{{q_team}} in {{q_city}} ({{q_unknown}})", labels),
    ).toBe("[Team name] in [City] ([answer])");
  });

  it("leaves a label without tokens unchanged", () => {
    expect(stripPipingTokens("Plain label", new Map())).toBe("Plain label");
  });

  it("tolerates surrounding whitespace inside the braces", () => {
    expect(stripPipingTokens("Hi {{  q_name  }}", { q_name: "Name" })).toBe(
      "Hi [Name]",
    );
  });
});
