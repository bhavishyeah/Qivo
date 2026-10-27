import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless HMAC-signed tokens that authorize a respondent to overwrite their
 * own just-submitted response within the same session. No DB column or
 * migration: the token carries the response id it authorizes and an absolute
 * expiry, and is signed with RESPONSE_EDIT_SECRET so it can't be forged.
 *
 * The server always re-checks the live form state + window before accepting an
 * edit (see editFormResponse), so a leaked/replayed token still can't bypass
 * the authoritative window check; the token is one of several guards, not the
 * sole one.
 *
 * Format: base64url(payloadJson) + "." + base64url(hmacSha256(payloadJson))
 *   payloadJson = JSON.stringify({ rid: <responseId>, exp: <unixSeconds> })
 */

type EditTokenPayload = {
  rid: string;
  exp: number;
};

// Read the secret lazily so tests can inject a known value via process.env
// before calling sign/verify, and so a changed env var is picked up.
function getSecret(): string {
  return (
    process.env.RESPONSE_EDIT_SECRET ??
    "dev-insecure-response-edit-secret-change-me"
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payloadJson: string): string {
  return createHmac("sha256", getSecret())
    .update(payloadJson)
    .digest("base64url");
}

export function signEditToken(
  responseId: string,
  expiresAt: Date,
): string {
  const payload: EditTokenPayload = {
    rid: responseId,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const payloadJson = JSON.stringify(payload);
  return `${base64url(payloadJson)}.${signPayload(payloadJson)}`;
}

/**
 * Verify a token's signature (constant-time) and parse its payload. Returns
 * null on any malformed input, bad signature, or JSON parse failure. Expiry is
 * NOT checked here — the caller re-checks the window against live form state,
 * which is the authoritative guard.
 */
export function verifyEditToken(
  token: string,
): { responseId: string; exp: number } | null {
  if (typeof token !== "string" || token.length === 0) return null;

  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0 || dotIndex === token.length - 1) return null;

  const encodedPayload = token.slice(0, dotIndex);
  const providedSig = token.slice(dotIndex + 1);

  let payloadJson: string;
  try {
    payloadJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedSig = signPayload(payloadJson);

  // Constant-time compare. timingSafeEqual throws on length mismatch, so guard
  // the lengths first (a length difference already means a bad signature).
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as EditTokenPayload).rid !== "string" ||
    typeof (payload as EditTokenPayload).exp !== "number"
  ) {
    return null;
  }

  const { rid, exp } = payload as EditTokenPayload;
  return { responseId: rid, exp };
}
