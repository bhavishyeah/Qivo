import { describe, it, expect } from "vitest";

import {
  computeSignature,
  backoffMs,
  MAX_ATTEMPTS,
  isDeliveryDue,
  classifyAddress,
  isBlockedHostname,
  buildResponseCreatedPayload,
} from "./webhookDelivery.js";

describe("computeSignature", () => {
  it("matches a known HMAC-SHA256 fixture (AC7)", () => {
    // Known vector: HMAC-SHA256("test-webhook-secret", '{"event":"response.created"}')
    const secret = "test-webhook-secret";
    const body = '{"event":"response.created"}';
    expect(computeSignature(secret, body)).toBe(
      "sha256=a38430fbb8134ec0cfea8a89e79c46ad4e14f4d81640d2eca655edb206dd62ba",
    );
  });

  it("is prefixed with sha256= and deterministic", () => {
    const a = computeSignature("s", "body");
    const b = computeSignature("s", "body");
    expect(a).toBe(b);
    expect(a.startsWith("sha256=")).toBe(true);
  });

  it("changes when the secret changes", () => {
    expect(computeSignature("s1", "body")).not.toBe(computeSignature("s2", "body"));
  });
});

describe("backoffMs", () => {
  it("returns the pinned schedule for attempts 1..6 (AC12)", () => {
    expect(backoffMs(1)).toBe(60_000); // 1m
    expect(backoffMs(2)).toBe(300_000); // 5m
    expect(backoffMs(3)).toBe(1_800_000); // 30m
    expect(backoffMs(4)).toBe(7_200_000); // 2h
    expect(backoffMs(5)).toBe(21_600_000); // 6h
    expect(backoffMs(6)).toBe(21_600_000); // clamped to last
  });

  it("clamps out-of-range inputs", () => {
    expect(backoffMs(0)).toBe(60_000);
    expect(backoffMs(-5)).toBe(60_000);
    expect(backoffMs(99)).toBe(21_600_000);
  });

  it("MAX_ATTEMPTS is 6", () => {
    expect(MAX_ATTEMPTS).toBe(6);
  });
});

describe("isDeliveryDue", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");
  const past = new Date(now.getTime() - 1000);
  const future = new Date(now.getTime() + 1000);

  it("is due when failed, attempts left, and nextAttemptAt has passed", () => {
    expect(isDeliveryDue({ status: "failed", attempts: 1, nextAttemptAt: past }, now)).toBe(true);
  });

  it("is not due when nextAttemptAt is in the future", () => {
    expect(isDeliveryDue({ status: "failed", attempts: 1, nextAttemptAt: future }, now)).toBe(false);
  });

  it("is not due when status is not failed", () => {
    expect(isDeliveryDue({ status: "pending", attempts: 0, nextAttemptAt: past }, now)).toBe(false);
    expect(isDeliveryDue({ status: "delivered", attempts: 1, nextAttemptAt: past }, now)).toBe(false);
    expect(isDeliveryDue({ status: "exhausted", attempts: 6, nextAttemptAt: past }, now)).toBe(false);
  });

  it("is not due when attempts have reached MAX_ATTEMPTS", () => {
    expect(isDeliveryDue({ status: "failed", attempts: 6, nextAttemptAt: past }, now)).toBe(false);
  });

  it("is not due when nextAttemptAt is null", () => {
    expect(isDeliveryDue({ status: "failed", attempts: 1, nextAttemptAt: null }, now)).toBe(false);
  });
});

describe("classifyAddress / isBlockedHostname (SSRF, AC1/AC12)", () => {
  it("allows public IPv4 addresses", () => {
    expect(classifyAddress("93.184.216.34")).toBe("public");
    expect(classifyAddress("8.8.8.8")).toBe("public");
  });

  it("blocks loopback", () => {
    expect(classifyAddress("127.0.0.1")).toBe("blocked");
    expect(classifyAddress("127.1.2.3")).toBe("blocked");
    expect(classifyAddress("::1")).toBe("blocked");
  });

  it("blocks private ranges", () => {
    expect(classifyAddress("10.0.0.1")).toBe("blocked");
    expect(classifyAddress("192.168.1.1")).toBe("blocked");
    expect(classifyAddress("172.16.0.1")).toBe("blocked");
    expect(classifyAddress("172.31.255.255")).toBe("blocked");
  });

  it("allows public addresses adjacent to the private 172.16/12 block", () => {
    expect(classifyAddress("172.15.0.1")).toBe("public");
    expect(classifyAddress("172.32.0.1")).toBe("public");
  });

  it("blocks link-local incl. the cloud metadata address", () => {
    expect(classifyAddress("169.254.169.254")).toBe("blocked");
    expect(classifyAddress("169.254.0.1")).toBe("blocked");
    expect(classifyAddress("fe80::1")).toBe("blocked");
  });

  it("blocks unspecified and unique-local IPv6", () => {
    expect(classifyAddress("0.0.0.0")).toBe("blocked");
    expect(classifyAddress("::")).toBe("blocked");
    expect(classifyAddress("fc00::1")).toBe("blocked");
    expect(classifyAddress("fd12:3456::1")).toBe("blocked");
  });

  it("allows a public IPv6 address", () => {
    expect(classifyAddress("2606:4700:4700::1111")).toBe("public");
  });

  it("blocks non-IP strings", () => {
    expect(classifyAddress("not-an-ip")).toBe("blocked");
  });

  it("blocks internal hostnames", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("LOCALHOST")).toBe(true);
    expect(isBlockedHostname("myhost.local")).toBe(true);
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("api.example.com")).toBe(false);
  });
});

describe("buildResponseCreatedPayload (AC8)", () => {
  it("produces the pinned id-keyed shape with a label map", () => {
    const submittedAt = new Date("2026-09-29T12:34:56.000Z");
    const payload = buildResponseCreatedPayload({
      formId: "form_1",
      formTitle: "Customer Survey",
      responseId: "resp_1",
      submittedAt,
      answers: {
        question_ab12cd34: "Alice",
        question_ef56gh78: ["red", "blue"],
      },
      questions: [
        { id: "question_ab12cd34", label: "Your name" },
        { id: "question_ef56gh78", label: "Favourite colours" },
      ],
    });

    expect(payload).toEqual({
      event: "response.created",
      formId: "form_1",
      formTitle: "Customer Survey",
      responseId: "resp_1",
      submittedAt: "2026-09-29T12:34:56.000Z",
      answers: {
        question_ab12cd34: "Alice",
        question_ef56gh78: ["red", "blue"],
      },
      questions: {
        question_ab12cd34: "Your name",
        question_ef56gh78: "Favourite colours",
      },
    });
  });

  it("passes through answers with no matching question and omits them from the label map", () => {
    const payload = buildResponseCreatedPayload({
      formId: "f",
      formTitle: "t",
      responseId: "r",
      submittedAt: new Date(0),
      answers: { orphan: "value" },
      questions: [{ id: "known", label: "Known" }],
    });
    expect(payload.answers).toEqual({ orphan: "value" });
    expect(payload.questions).toEqual({ known: "Known" });
  });
});
