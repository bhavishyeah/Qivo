import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

// Inject a known secret BEFORE importing the module under test so getSecret()
// reads a stable, deterministic value for the HMAC.
process.env.RESPONSE_EDIT_SECRET = "test-secret-for-edit-token";

const { signEditToken, verifyEditToken } = await import("./responseEditToken.js");

describe("responseEditToken", () => {
  const responseId = "resp_abc123";
  const expiresAt = new Date("2030-01-01T00:00:00.000Z");

  it("round-trips a signed token", () => {
    const token = signEditToken(responseId, expiresAt);
    const result = verifyEditToken(token);
    expect(result).not.toBeNull();
    expect(result?.responseId).toBe(responseId);
    expect(result?.exp).toBe(Math.floor(expiresAt.getTime() / 1000));
  });

  it("returns null for a tampered payload", () => {
    const token = signEditToken(responseId, expiresAt);
    const [, sig] = token.split(".");
    // Forge a different payload but keep the original (now-mismatched) signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ rid: "resp_evil", exp: 9999999999 }),
    ).toString("base64url");
    expect(verifyEditToken(`${forgedPayload}.${sig}`)).toBeNull();
  });

  it("returns null for a bad signature", () => {
    const token = signEditToken(responseId, expiresAt);
    const [payload] = token.split(".");
    const badSig = Buffer.from("not-the-real-signature").toString("base64url");
    expect(verifyEditToken(`${payload}.${badSig}`)).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(verifyEditToken("garbage")).toBeNull();
    expect(verifyEditToken("")).toBeNull();
    expect(verifyEditToken("!!!.!!!")).toBeNull();
  });

  it("returns null for a truncated token", () => {
    const token = signEditToken(responseId, expiresAt);
    expect(verifyEditToken(token.slice(0, token.length - 5))).toBeNull();
  });

  it("returns null for a token with no '.' separator", () => {
    const token = signEditToken(responseId, expiresAt);
    expect(verifyEditToken(token.replace(".", ""))).toBeNull();
  });

  it("does not check expiry (returns a past-dated token's payload)", () => {
    const past = new Date("2000-01-01T00:00:00.000Z");
    const token = signEditToken(responseId, past);
    const result = verifyEditToken(token);
    expect(result?.responseId).toBe(responseId);
    expect(result?.exp).toBe(Math.floor(past.getTime() / 1000));
  });

  it("uses constant-time timingSafeEqual for the signature compare", () => {
    // Guard against a regression to === / == comparison: assert the source
    // imports and calls timingSafeEqual from node:crypto.
    const src = readFileSync(
      new URL("./responseEditToken.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("timingSafeEqual");
    expect(src).toMatch(/from "node:crypto"/);
  });
});
