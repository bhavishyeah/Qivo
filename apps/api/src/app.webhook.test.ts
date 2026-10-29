import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import request from "supertest";

// Set the webhook secret BEFORE importing the app so the handler is "configured"
// and actually verifies signatures (rather than the unconfigured 200 no-op).
process.env.RAZORPAY_KEY_ID = "rzp_test_keyid";
process.env.RAZORPAY_KEY_SECRET = "test_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";

const { default: app } = await import("./app.js");

const WEBHOOK_PATH = "/api/forms/public/razorpay/webhook";
const SECRET = "test_webhook_secret";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

// An event that passes signature verification but resolves no order id, so the
// handler returns (200) BEFORE touching the database — keeping this a pure
// raw-body/signature mechanism test with no test Postgres required.
const NO_ORDER_EVENT = JSON.stringify({ event: "payment.captured", payload: {} });

describe("Razorpay webhook — raw-body capture & signature (AC-13)", () => {
  it("captures the exact unparsed bytes (rawBody === sent bytes)", async () => {
    // The handler verifies true only when the HMAC is computed over the exact
    // bytes we sent, so a correct signature over the raw string proves the
    // exact unparsed bytes reached the handler (ahead of express.json's
    // re-serialization).
    const body = NO_ORDER_EVENT;
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(body))
      .send(body);
    // 200 => signature verified against the exact raw bytes.
    expect(res.status).toBe(200);
  });

  it("returns 200 for a correctly-signed body", async () => {
    const body = NO_ORDER_EVENT;
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it("returns 400 WEBHOOK_SIGNATURE_INVALID for a byte-mutated body", async () => {
    const body = NO_ORDER_EVENT;
    const sigForOriginal = sign(body);
    const mutated = `${body} `; // one extra byte → signature no longer matches
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sigForOriginal)
      .send(mutated);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
  });

  it("returns 400 (fail-closed) for an empty/absent body, never a 200 ack", async () => {
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "deadbeef")
      .send("");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
  });

  it("returns 400 for a valid JSON body with a wrong signature", async () => {
    const body = NO_ORDER_EVENT;
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "0".repeat(64))
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
  });
});
