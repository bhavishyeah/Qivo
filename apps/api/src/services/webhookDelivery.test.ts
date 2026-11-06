import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock for sendWebhooksForResponse fan-out tests ─────────────────────────
// Must be declared before the module import so vi.mock hoisting works.
const prismaMock = vi.hoisted(() => ({
  webhook: { findMany: vi.fn() },
  webhookDelivery: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("../db/prisma.js", () => ({ default: prismaMock }));

import {
  computeSignature,
  backoffMs,
  MAX_ATTEMPTS,
  MAX_WEBHOOKS_PER_FORM,
  isDeliveryDue,
  classifyAddress,
  isBlockedHostname,
  buildResponseCreatedPayload,
  buildFormEventPayload,
  webhookAcceptsEvent,
  selectPinnedAddresses,
  assertSafeWebhookUrl,
  sendWebhooksForResponse,
} from "./webhookDelivery.js";

// Mock DNS resolution so SSRF tests never touch the network.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import { lookup } from "node:dns/promises";
const mockedLookup = vi.mocked(lookup);

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
      answersLabeled: {
        question_ab12cd34: "Alice",
        question_ef56gh78: ["red", "blue"],
      },
      questions: {
        question_ab12cd34: "Your name",
        question_ef56gh78: "Favourite colours",
      },
      optionLabels: {},
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
    expect(payload.answersLabeled).toEqual({ orphan: "value" });
    expect(payload.questions).toEqual({ known: "Known" });
    expect(payload.optionLabels).toEqual({});
  });

  it("keeps raw answers untouched while answersLabeled renders human labels", () => {
    const payload = buildResponseCreatedPayload({
      formId: "f",
      formTitle: "t",
      responseId: "r",
      submittedAt: new Date(0),
      answers: {
        q_single: "option_1787471217224",
        q_multi: ["option_1", "option_2"],
        q_yesno: "yes",
        q_text: "free text",
        q_num: 42,
        q_entries: ["one", "two"],
      },
      questions: [
        {
          id: "q_single",
          label: "Plan",
          type: "SINGLE_CHOICE",
          options: [{ value: "option_1787471217224", label: "Premium" }],
        },
        {
          id: "q_multi",
          label: "Toppings",
          type: "MULTIPLE_CHOICE",
          options: [
            { value: "option_1", label: "Cheese" },
            { value: "option_2", label: "Mushroom" },
          ],
        },
        { id: "q_yesno", label: "Subscribe?", type: "YES_NO" },
        { id: "q_text", label: "Notes", type: "SHORT_TEXT" },
        { id: "q_num", label: "Age", type: "NUMBER" },
        { id: "q_entries", label: "Guests", type: "MULTI_ENTRY" },
      ],
    });

    // Raw answers are preserved exactly (back-compat).
    expect(payload.answers).toEqual({
      q_single: "option_1787471217224",
      q_multi: ["option_1", "option_2"],
      q_yesno: "yes",
      q_text: "free text",
      q_num: 42,
      q_entries: ["one", "two"],
    });

    // Labeled rendering is readable.
    expect(payload.answersLabeled).toEqual({
      q_single: "Premium",
      q_multi: ["Cheese", "Mushroom"],
      q_yesno: "Yes",
      q_text: "free text",
      q_num: 42,
      q_entries: ["one", "two"],
    });

    // Option maps exposed for choice questions only.
    expect(payload.optionLabels).toEqual({
      q_single: { option_1787471217224: "Premium" },
      q_multi: { option_1: "Cheese", option_2: "Mushroom" },
    });
  });

  it("renders YES_NO boolean values and no-case", () => {
    const payload = buildResponseCreatedPayload({
      formId: "f",
      formTitle: "t",
      responseId: "r",
      submittedAt: new Date(0),
      answers: { q_yes: true, q_no: "no" },
      questions: [
        { id: "q_yes", label: "A", type: "YES_NO" },
        { id: "q_no", label: "B", type: "YES_NO" },
      ],
    });
    expect(payload.answersLabeled).toEqual({ q_yes: "Yes", q_no: "No" });
  });

  it("falls back to the raw value when a choice option is unknown or missing", () => {
    const payload = buildResponseCreatedPayload({
      formId: "f",
      formTitle: "t",
      responseId: "r",
      submittedAt: new Date(0),
      answers: {
        q_single: "option_gone",
        q_multi: ["known", "orphan"],
      },
      questions: [
        {
          id: "q_single",
          label: "Plan",
          type: "SINGLE_CHOICE",
          options: [{ value: "option_here", label: "Here" }],
        },
        {
          id: "q_multi",
          label: "Picks",
          type: "MULTIPLE_CHOICE",
          options: [{ value: "known", label: "Known" }],
        },
      ],
    });
    expect(payload.answersLabeled).toEqual({
      q_single: "option_gone",
      q_multi: ["Known", "orphan"],
    });
  });
});

describe("buildFormEventPayload", () => {
  it("produces the pinned {event,formId,formTitle,slug,status,at} shape", () => {
    const payload = buildFormEventPayload("form.published", {
      id: "form_1",
      title: "Customer Survey",
      slug: "customer-survey",
      status: "PUBLISHED",
    });
    expect(payload.event).toBe("form.published");
    expect(payload.formId).toBe("form_1");
    expect(payload.formTitle).toBe("Customer Survey");
    expect(payload.slug).toBe("customer-survey");
    expect(payload.status).toBe("PUBLISHED");
    expect(Object.keys(payload).sort()).toEqual(
      ["at", "event", "formId", "formTitle", "slug", "status"],
    );
  });

  it("stamps `at` as a parseable ISO-8601 string", () => {
    const payload = buildFormEventPayload("form.closed", {
      id: "f",
      title: "t",
      slug: "s",
      status: "CLOSED",
    });
    expect(typeof payload.at).toBe("string");
    expect(payload.at).toBe(new Date(payload.at).toISOString());
    expect(Number.isNaN(Date.parse(payload.at))).toBe(false);
  });
});

describe("webhookAcceptsEvent", () => {
  it("is false when a response-only webhook is tested for form.published", () => {
    expect(webhookAcceptsEvent(["response.created"], "form.published")).toBe(false);
  });

  it("is true when the subscribed list includes the event", () => {
    expect(webhookAcceptsEvent(["form.published"], "form.published")).toBe(true);
    expect(
      webhookAcceptsEvent(["response.created", "form.closed"], "form.closed"),
    ).toBe(true);
  });

  it("is false for null, undefined, or an empty list", () => {
    expect(webhookAcceptsEvent(null, "form.published")).toBe(false);
    expect(webhookAcceptsEvent(undefined, "form.published")).toBe(false);
    expect(webhookAcceptsEvent([], "form.published")).toBe(false);
  });
});

describe("selectPinnedAddresses (SSRF pinning)", () => {
  it("ok with all addresses when every address is public", () => {
    const addresses = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
    const result = selectPinnedAddresses(addresses);
    expect(result).toEqual({ ok: true, addresses });
  });

  it("ok:false when the list is empty", () => {
    expect(selectPinnedAddresses([])).toEqual({ ok: false });
  });

  it("ok:false when ANY address is private", () => {
    expect(
      selectPinnedAddresses([
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
    ).toEqual({ ok: false });
  });

  it("ok:false for loopback / link-local / metadata / unique-local", () => {
    expect(selectPinnedAddresses([{ address: "127.0.0.1", family: 4 }])).toEqual({ ok: false });
    expect(selectPinnedAddresses([{ address: "169.254.0.1", family: 4 }])).toEqual({ ok: false });
    expect(selectPinnedAddresses([{ address: "169.254.169.254", family: 4 }])).toEqual({ ok: false });
    expect(selectPinnedAddresses([{ address: "::1", family: 6 }])).toEqual({ ok: false });
    expect(selectPinnedAddresses([{ address: "fc00::1", family: 6 }])).toEqual({ ok: false });
  });

  it("ok:false for an IPv4-mapped private IPv6 address", () => {
    expect(selectPinnedAddresses([{ address: "::ffff:10.0.0.1", family: 6 }])).toEqual({ ok: false });
  });
});

describe("assertSafeWebhookUrl (mocked DNS)", () => {
  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it("allows a hostname resolving to a public IP", async () => {
    mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    await expect(assertSafeWebhookUrl("https://example.com/hook")).resolves.toBeUndefined();
  });

  it("rejects a hostname resolving to a private IP with WEBHOOK_URL_INVALID", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);
    await expect(assertSafeWebhookUrl("https://internal.example.com/hook")).rejects.toMatchObject({
      name: "WEBHOOK_URL_INVALID",
    });
  });

  it("rejects when ANY resolved address is private", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.1", family: 4 },
    ] as never);
    await expect(assertSafeWebhookUrl("https://mixed.example.com/hook")).rejects.toMatchObject({
      name: "WEBHOOK_URL_INVALID",
    });
  });
});

// ── HIGH-2: sendWebhooksForResponse MAX_WEBHOOKS_PER_FORM cap ─────────────────

describe("sendWebhooksForResponse — MAX_WEBHOOKS_PER_FORM cap (HIGH-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(`only creates delivery rows for the first ${MAX_WEBHOOKS_PER_FORM} webhooks when a form has more`, async () => {
    // Build 12 enabled webhooks that all subscribe to response.created.
    const webhooks = Array.from({ length: 12 }, (_, i) => ({
      id: `webhook_${i}`,
      formId: "form_1",
      url: `https://example.com/hook${i}`,
      secret: "sec",
      enabled: true,
      events: ["response.created"],
    }));

    prismaMock.webhook.findMany.mockResolvedValue(webhooks);
    // create returns a minimal delivery row so attemptDelivery (which is also
    // mocked-away by the prisma mock) does not error; we only count the calls.
    prismaMock.webhookDelivery.create.mockResolvedValue({ id: "del_x" });

    const payload = buildResponseCreatedPayload({
      formId: "form_1",
      formTitle: "Test Form",
      responseId: "resp_1",
      submittedAt: new Date(),
      answers: {},
      questions: [],
    });

    await sendWebhooksForResponse("form_1", payload);

    // Exactly MAX_WEBHOOKS_PER_FORM (10) delivery rows should be created.
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalledTimes(MAX_WEBHOOKS_PER_FORM);
  });

  it("creates all delivery rows when webhook count is at or below the cap", async () => {
    const webhooks = Array.from({ length: 5 }, (_, i) => ({
      id: `webhook_${i}`,
      formId: "form_1",
      url: `https://example.com/hook${i}`,
      secret: "sec",
      enabled: true,
      events: ["response.created"],
    }));

    prismaMock.webhook.findMany.mockResolvedValue(webhooks);
    prismaMock.webhookDelivery.create.mockResolvedValue({ id: "del_x" });

    const payload = buildResponseCreatedPayload({
      formId: "form_1",
      formTitle: "Test Form",
      responseId: "resp_2",
      submittedAt: new Date(),
      answers: {},
      questions: [],
    });

    await sendWebhooksForResponse("form_1", payload);

    expect(prismaMock.webhookDelivery.create).toHaveBeenCalledTimes(5);
  });
});
