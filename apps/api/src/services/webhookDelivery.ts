/**
 * Webhook delivery service.
 *
 * Outbound HTTP delivery of `response.created` events to per-form webhook
 * endpoints, HMAC-signed, with DB-backed retry state. There is no queue and no
 * new infrastructure: the immediate send runs as a fire-and-forget side effect
 * of submitFormResponse, and retries are driven by the existing server.ts sweep
 * timer calling deliverDueWebhooks().
 *
 * Pure, exported helpers (computeSignature, backoffMs, buildResponseCreatedPayload,
 * isDeliveryDue, classifyAddress, isBlockedHostname) are unit-tested without a DB
 * or network. The impure workers (attemptDelivery, sendWebhooksForResponse,
 * deliverDueWebhooks) own all the IO and never throw to their callers.
 */

import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import prisma from "../db/prisma.js";
import { WebhookDeliveryStatus } from "../generated/prisma/client.js";

// ── Constants (module-level; no new env vars) ────────────────────────────────

/** Attempt 1 is the immediate send; attempts 2..6 are retries. */
export const MAX_ATTEMPTS = 6;
/** Delay (ms) from now until the next attempt, indexed by the just-failed attempt. */
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]; // 1m, 5m, 30m, 2h, 6h
/** Per-request timeout for a single delivery attempt. */
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Max deliveries processed per sweep tick. */
export const WEBHOOK_SWEEP_BATCH = 50;
/** Hard cap on webhooks per form (bounds immediate-send fan-out). */
export const MAX_WEBHOOKS_PER_FORM = 10;

const EVENT_RESPONSE_CREATED = "response.created";

/**
 * All event names a webhook can subscribe to. Readonly tuple so the Zod schema
 * (z.enum) and the TS union stay in lockstep with this single source of truth.
 */
export const WEBHOOK_EVENTS = [
  "response.created",
  "form.published",
  "form.closed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// ── Signing (pure) ───────────────────────────────────────────────────────────

/**
 * Compute the X-Qivo-Signature header value for a raw body:
 * `sha256=<hex>` where hex = HMAC-SHA256(secret, rawBodyBytes).
 */
export function computeSignature(secret: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

// ── Backoff (pure) ─────────────────────────────────────────────────────────

/**
 * Backoff delay in ms. `attempts` is the count AFTER the just-failed attempt
 * (1-based). Clamps to [1, BACKOFF_MS.length].
 */
export function backoffMs(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[i]!;
}

// ── Payload (pure) ─────────────────────────────────────────────────────────

/** Minimal shape of a choice option as stored on a question. */
export type PayloadQuestionOption = { value: string; label: string };

/**
 * Minimal question shape the payload builder needs. `type` and `options` are
 * optional so existing callers that only pass `{ id, label }` keep compiling;
 * when they are present the builder can render human-readable choice labels.
 */
export type PayloadQuestion = {
  id: string;
  label: string;
  type?: string;
  options?: PayloadQuestionOption[];
};

export type ResponseCreatedPayload = {
  event: string;
  formId: string;
  formTitle: string;
  responseId: string;
  submittedAt: string;
  answers: Record<string, unknown>;
  /** Human-readable rendering of each answer, keyed by questionId (back-compat add). */
  answersLabeled: Record<string, unknown>;
  questions: Record<string, string>;
  /** Per-question option value→label map so receivers can resolve either way. */
  optionLabels: Record<string, Record<string, string>>;
};

/**
 * Render a single stored answer value into a human-readable form using the
 * question's type + options. Choice option values map to their labels; YES_NO
 * renders "Yes"/"No"; everything else (text, number, date, MULTI_ENTRY,
 * file/signature URLs) passes through unchanged. An unknown/missing option
 * value falls back to the raw value — this never throws.
 */
function renderAnswerLabel(
  question: PayloadQuestion | undefined,
  raw: unknown,
): unknown {
  if (!question) return raw;

  const options = question.options ?? [];
  const labelFor = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    const match = options.find((o) => o.value === value);
    return match ? match.label : value;
  };

  switch (question.type) {
    case "SINGLE_CHOICE":
      return labelFor(raw);
    case "MULTIPLE_CHOICE":
      // Stored as an array of option values; map each to its label.
      if (Array.isArray(raw)) return raw.map((v) => labelFor(v));
      return labelFor(raw);
    case "YES_NO":
      if (raw === "yes" || raw === true) return "Yes";
      if (raw === "no" || raw === false) return "No";
      return raw;
    default:
      // Text/number/date/MULTI_ENTRY/FILE_UPLOAD/SIGNATURE: pass through.
      return raw;
  }
}

/**
 * Build the pinned `response.created` payload. `answers` is the stored
 * FormResponse.answers (raw, as submitted) and is preserved verbatim for
 * back-compatibility. `questions` is reduced to an id→label map from the
 * in-scope schema questions local.
 *
 * Two readability fields are ADDED (no existing field is renamed/removed):
 *  - `answersLabeled`: the same id→answer map but with choice option values
 *    rendered to their human labels and YES_NO rendered "Yes"/"No".
 *  - `optionLabels`: per-question value→label map for choice questions, so a
 *    receiver can resolve raw `answers` on its own if it prefers.
 */
export function buildResponseCreatedPayload(args: {
  formId: string;
  formTitle: string;
  responseId: string;
  submittedAt: Date;
  answers: Record<string, unknown>;
  questions: PayloadQuestion[];
}): ResponseCreatedPayload {
  const questions: Record<string, string> = {};
  const optionLabels: Record<string, Record<string, string>> = {};
  const byId = new Map<string, PayloadQuestion>();
  for (const q of args.questions) {
    questions[q.id] = q.label;
    byId.set(q.id, q);
    if (q.options && q.options.length > 0) {
      const map: Record<string, string> = {};
      for (const o of q.options) map[o.value] = o.label;
      optionLabels[q.id] = map;
    }
  }

  const answersLabeled: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(args.answers)) {
    answersLabeled[id] = renderAnswerLabel(byId.get(id), raw);
  }

  return {
    event: EVENT_RESPONSE_CREATED,
    formId: args.formId,
    formTitle: args.formTitle,
    responseId: args.responseId,
    submittedAt: args.submittedAt.toISOString(),
    answers: args.answers,
    answersLabeled,
    questions,
    optionLabels,
  };
}

// ── Form-event payload + subscription predicate (pure) ───────────────────────

/** Pinned payload shape for the form-lifecycle events (published/closed). */
export type FormEventPayload = {
  event: WebhookEvent;
  formId: string;
  formTitle: string;
  slug: string;
  status: string;
  at: string;
};

/**
 * Build the pinned payload for a form-lifecycle event. `at` is the emit time as
 * an ISO-8601 string.
 */
export function buildFormEventPayload(
  event: WebhookEvent,
  form: { id: string; title: string; slug: string; status: string },
): FormEventPayload {
  return {
    event,
    formId: form.id,
    formTitle: form.title,
    slug: form.slug,
    status: form.status,
    at: new Date().toISOString(),
  };
}

/**
 * Whether a webhook's subscribed `events` list opts into `event`. A missing or
 * non-array list (e.g. a legacy row read before backfill) subscribes to
 * nothing here; the DB default guarantees real rows carry response.created.
 */
export function webhookAcceptsEvent(
  events: string[] | null | undefined,
  event: string,
): boolean {
  return Array.isArray(events) && events.includes(event);
}

// ── Due-selection predicate (pure) ───────────────────────────────────────────

/**
 * A delivery is due for retry when it failed, has attempts left, and its
 * nextAttemptAt has passed.
 */
export function isDeliveryDue(
  d: { status: WebhookDeliveryStatus | string; attempts: number; nextAttemptAt: Date | null },
  now: Date,
): boolean {
  return (
    d.status === "failed" &&
    d.attempts < MAX_ATTEMPTS &&
    d.nextAttemptAt != null &&
    d.nextAttemptAt.getTime() <= now.getTime()
  );
}

// ── SSRF host classification (pure) + URL guard (async DNS) ───────────────────

/**
 * Classify a literal IP address as "public" or "blocked". Blocks loopback,
 * private, link-local (incl. the cloud metadata 169.254.169.254), unspecified,
 * and unique-local IPv6 ranges.
 */
export function classifyAddress(ip: string): "public" | "blocked" {
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return "blocked";
    }
    const [a, b] = parts as [number, number, number, number];
    // 0.0.0.0/8 unspecified / "this network"
    if (a === 0) return "blocked";
    // 10.0.0.0/8 private
    if (a === 10) return "blocked";
    // 127.0.0.0/8 loopback
    if (a === 127) return "blocked";
    // 169.254.0.0/16 link-local (incl. metadata 169.254.169.254)
    if (a === 169 && b === 254) return "blocked";
    // 172.16.0.0/12 private
    if (a === 172 && b >= 16 && b <= 31) return "blocked";
    // 192.168.0.0/16 private
    if (a === 192 && b === 168) return "blocked";
    return "public";
  }

  if (kind === 6) {
    const normalized = ip.toLowerCase().split("%")[0]!; // strip zone id
    // Unspecified ::
    if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return "blocked";
    // Loopback ::1
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return "blocked";
    // IPv4-mapped ::ffff:a.b.c.d — classify the embedded v4 address
    const mapped = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return classifyAddress(mapped[1]!);
    // Link-local fe80::/10
    if (normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
        normalized.startsWith("fea") || normalized.startsWith("feb")) {
      return "blocked";
    }
    // Unique-local fc00::/7 (fc.. and fd..)
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return "blocked";
    return "public";
  }

  // Not a valid IP literal.
  return "blocked";
}

/**
 * Block hostnames that are obviously internal regardless of DNS: `localhost`
 * and any `*.local` name.
 */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost") return true;
  if (h === "local" || h.endsWith(".local")) return true;
  return false;
}

function webhookUrlInvalidError(message: string): Error {
  const error = new Error(message);
  error.name = "WEBHOOK_URL_INVALID";
  return error;
}

/** A resolved DNS address paired with its IP family (4 or 6). */
export type ResolvedAddress = { address: string; family: number };

export type SelectPinnedResult =
  | { ok: true; addresses: ResolvedAddress[] }
  | { ok: false };

/**
 * Pure SSRF gate over a resolved address set. Returns ok:false if the list is
 * empty or ANY address classifies as "blocked" (via classifyAddress); only an
 * all-public list yields ok:true with every address preserved. This is the one
 * source of truth both create-time validation and send-time pinning share.
 */
export function selectPinnedAddresses(
  resolved: ResolvedAddress[],
): SelectPinnedResult {
  if (resolved.length === 0) return { ok: false };
  for (const { address } of resolved) {
    if (classifyAddress(address) === "blocked") return { ok: false };
  }
  return { ok: true, addresses: resolved };
}

/**
 * Resolve `host` to the validated public address(es) to pin a connection to.
 * A literal IP is classified directly and returned (or throws when blocked);
 * otherwise DNS is resolved with {all:true}, run through selectPinnedAddresses,
 * and the whole set is returned only when every address is public. Throws a
 * WEBHOOK_URL_INVALID error (same message style as assertSafeWebhookUrl) on any
 * blocked/empty result.
 */
export async function resolveAndPinHost(host: string): Promise<ResolvedAddress[]> {
  const literal = isIP(host);
  if (literal) {
    if (classifyAddress(host) === "blocked") {
      throw webhookUrlInvalidError("Webhook URL resolves to a disallowed address.");
    }
    return [{ address: host, family: literal }];
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw webhookUrlInvalidError("Webhook URL host could not be resolved.");
  }

  if (addresses.length === 0) {
    throw webhookUrlInvalidError("Webhook URL host could not be resolved.");
  }

  const selected = selectPinnedAddresses(addresses);
  if (!selected.ok) {
    throw webhookUrlInvalidError("Webhook URL resolves to a disallowed address.");
  }
  return selected.addresses;
}

/**
 * Validate a webhook target URL for SSRF safety: https-only, hostname not an
 * obvious internal name, and every resolved address public. Throws a
 * WEBHOOK_URL_INVALID error on any violation. Async because it resolves DNS.
 *
 * Create-time validation. The send path (attemptDelivery) additionally pins the
 * connection to a freshly-validated public IP via resolveAndPinHost, closing
 * the DNS-rebinding window that a separate validate-then-connect flow leaves
 * open.
 */
export async function assertSafeWebhookUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw webhookUrlInvalidError("Webhook URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw webhookUrlInvalidError("Webhook URL must use https.");
  }

  const host = parsed.hostname;
  if (isBlockedHostname(host)) {
    throw webhookUrlInvalidError("Webhook URL host is not allowed.");
  }

  // If the host is a literal IP, classify it directly; otherwise resolve it.
  if (isIP(host)) {
    if (classifyAddress(host) === "blocked") {
      throw webhookUrlInvalidError("Webhook URL resolves to a disallowed address.");
    }
    return;
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw webhookUrlInvalidError("Webhook URL host could not be resolved.");
  }

  if (addresses.length === 0) {
    throw webhookUrlInvalidError("Webhook URL host could not be resolved.");
  }

  if (!selectPinnedAddresses(addresses).ok) {
    throw webhookUrlInvalidError("Webhook URL resolves to a disallowed address.");
  }
}

// ── Impure delivery workers ──────────────────────────────────────────────────

/**
 * Concise delivery log line. Never logs the secret or the full URL (a URL may
 * carry query-string tokens); logs only host when a URL is relevant.
 */
function logDelivery(fields: {
  deliveryId: string;
  webhookId: string;
  status: string;
  responseStatus?: number | null;
  lastError?: string | null;
}): void {
  const parts = [
    `deliveryId=${fields.deliveryId}`,
    `webhookId=${fields.webhookId}`,
    `status=${fields.status}`,
  ];
  if (fields.responseStatus != null) parts.push(`responseStatus=${fields.responseStatus}`);
  if (fields.lastError) parts.push(`lastError=${fields.lastError}`);
  console.log(`[webhook] ${parts.join(" ")}`);
}

/**
 * POST `body` to the parsed webhook URL over node:https, pinning the connection
 * to a pre-validated public IP via a custom `lookup` so an attacker cannot
 * rebind DNS between validation and connect. TLS is verified normally against
 * the original hostname: rejectUnauthorized stays true and servername defaults
 * to parsed.hostname (neither is overridden). https.request does NOT follow
 * redirects, so a 3xx surfaces as a non-2xx status, matching redirect:"manual".
 * The body is never read (res.resume()). Resolves with the response status
 * code; rejects with an AbortError-named error on the WEBHOOK_TIMEOUT_MS
 * timeout, or the underlying socket error otherwise.
 */
function sendPinnedRequest(args: {
  parsed: URL;
  pinned: ResolvedAddress[];
  headers: Record<string, string>;
  body: string;
}): Promise<number> {
  const { parsed, pinned, headers, body } = args;
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    // Custom lookup returns ONLY the pinned validated IP(s). Supports both the
    // single-address callback form and the {all:true} array form Node may use.
    const pinnedLookup = (
      _hostname: string,
      options: unknown,
      cb: (
        err: NodeJS.ErrnoException | null,
        address: string | Array<{ address: string; family: number }>,
        family?: number,
      ) => void,
    ): void => {
      const wantsAll =
        typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
      if (wantsAll) {
        cb(null, pinned.map((a) => ({ address: a.address, family: a.family })));
      } else {
        const first = pinned[0]!;
        cb(null, first.address, first.family);
      }
    };

    const req = httpsRequest(
      {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers,
        // Pin the connection; TLS still validates against the hostname.
        lookup: pinnedLookup as never,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume(); // drain + discard; never parse the body
        res.on("end", () => finish(() => resolve(status)));
        res.on("error", (err) => finish(() => reject(err)));
      },
    );

    req.setTimeout(WEBHOOK_TIMEOUT_MS, () => {
      const timeoutError = new Error("Webhook request timed out.");
      timeoutError.name = "AbortError";
      req.destroy(timeoutError);
    });

    req.on("error", (err) => finish(() => reject(err)));
    req.write(body);
    req.end();
  });
}

/**
 * Attempt a single delivery for a `pending` or `failed` delivery row. Loads the
 * delivery + its webhook, re-validates the URL, POSTs the stored signed body
 * under a hard timeout, and applies the status machine. Never throws.
 */
export async function attemptDelivery(deliveryId: string): Promise<void> {
  try {
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });
    if (!delivery || !delivery.webhook) return;

    const webhook = delivery.webhook;
    const now = new Date();

    // A webhook disabled after a delivery was queued should not keep retrying.
    if (!webhook.enabled) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.exhausted,
          nextAttemptAt: null,
          lastError: "webhook disabled".slice(0, 500),
        },
      });
      logDelivery({
        deliveryId: delivery.id,
        webhookId: webhook.id,
        status: "exhausted",
        lastError: "webhook disabled",
      });
      return;
    }

    const raw = JSON.stringify(delivery.payload);

    // Terminal outcome of this attempt.
    let ok = false;
    let responseStatus: number | null = null;
    let lastError: string | null = null;

    try {
      // Re-validate and resolve the target to a pinned public IP at send time.
      const parsed = new URL(webhook.url);
      if (parsed.protocol !== "https:") {
        throw webhookUrlInvalidError("Webhook URL must use https.");
      }
      if (isBlockedHostname(parsed.hostname)) {
        throw webhookUrlInvalidError("Webhook URL host is not allowed.");
      }
      const pinned = await resolveAndPinHost(parsed.hostname);

      // Classify on status code only — the response body is never read.
      responseStatus = await sendPinnedRequest({
        parsed,
        pinned,
        headers: {
          "Content-Type": "application/json",
          "X-Qivo-Event": delivery.event,
          "X-Qivo-Timestamp": String(Math.floor(Date.now() / 1000)),
          "X-Qivo-Signature": computeSignature(webhook.secret, raw),
          "User-Agent": "Qivo-Webhooks/1",
        },
        body: raw,
      });
      if (responseStatus >= 200 && responseStatus < 300) {
        ok = true;
      } else {
        lastError = `HTTP ${responseStatus}`;
      }
    } catch (err) {
      if (err instanceof Error && err.name === "WEBHOOK_URL_INVALID") {
        lastError = "blocked url";
      } else if (err instanceof Error && err.name === "AbortError") {
        lastError = "timeout";
      } else if (err instanceof Error) {
        lastError = `network error: ${err.message}`;
      } else {
        lastError = "network error";
      }
    }

    const attempts = delivery.attempts + 1;

    if (ok) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.delivered,
          attempts,
          lastResponseStatus: responseStatus,
          lastError: null,
          nextAttemptAt: null,
          deliveredAt: now,
        },
      });
      logDelivery({
        deliveryId: delivery.id,
        webhookId: webhook.id,
        status: "delivered",
        responseStatus,
      });
      return;
    }

    const exhausted = attempts >= MAX_ATTEMPTS;
    const status = exhausted ? WebhookDeliveryStatus.exhausted : WebhookDeliveryStatus.failed;
    const nextAttemptAt = exhausted ? null : new Date(now.getTime() + backoffMs(attempts));

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status,
        attempts,
        lastResponseStatus: responseStatus,
        lastError: lastError ? lastError.slice(0, 500) : null,
        nextAttemptAt,
      },
    });
    logDelivery({
      deliveryId: delivery.id,
      webhookId: webhook.id,
      status: exhausted ? "exhausted" : "failed",
      responseStatus,
      lastError,
    });
  } catch (err) {
    // attemptDelivery must never throw to its callers.
    console.error("[webhook] attemptDelivery failed:", err);
  }
}

/**
 * For each enabled webhook on the form, create a pending delivery row with the
 * payload snapshot and run the first attempt immediately. Fan-out is bounded by
 * MAX_WEBHOOKS_PER_FORM. Never throws to the caller (it runs inside the submit
 * path's fire-and-forget wrapper).
 */
export async function sendWebhooksForResponse(
  formId: string,
  payload: ResponseCreatedPayload,
): Promise<void> {
  try {
    const webhooks = (
      await prisma.webhook.findMany({
        where: { formId, enabled: true },
      })
    )
      .filter((w) => webhookAcceptsEvent(w.events, payload.event))
      .slice(0, MAX_WEBHOOKS_PER_FORM);
    if (webhooks.length === 0) return;

    const deliveryIds: string[] = [];
    for (const webhook of webhooks) {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          event: payload.event,
          status: WebhookDeliveryStatus.pending,
          attempts: 0,
          payload: payload as unknown as object,
        },
      });
      deliveryIds.push(delivery.id);
    }

    await Promise.allSettled(deliveryIds.map((id) => attemptDelivery(id)));
  } catch (err) {
    console.error("[webhook] sendWebhooksForResponse failed:", err);
  }
}

/**
 * Immediate fan-out for a form-lifecycle event (form.published/form.closed).
 * Loads the form's enabled webhooks, keeps only those subscribed to `event`,
 * bounds fan-out by MAX_WEBHOOKS_PER_FORM, creates a pending delivery per row
 * with the pinned FormEventPayload, and runs the first attempt immediately.
 * Mirrors sendWebhooksForResponse and never throws to its caller.
 */
export async function sendFormEventWebhooks(
  form: { id: string; title: string; slug: string; status: string },
  event: WebhookEvent,
): Promise<void> {
  try {
    const webhooks = (
      await prisma.webhook.findMany({
        where: { formId: form.id, enabled: true },
      })
    )
      .filter((w) => webhookAcceptsEvent(w.events, event))
      .slice(0, MAX_WEBHOOKS_PER_FORM);
    if (webhooks.length === 0) return;

    const payload = buildFormEventPayload(event, form);

    const deliveryIds: string[] = [];
    for (const webhook of webhooks) {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          event,
          status: WebhookDeliveryStatus.pending,
          attempts: 0,
          payload: payload as unknown as object,
        },
      });
      deliveryIds.push(delivery.id);
    }

    await Promise.allSettled(deliveryIds.map((id) => attemptDelivery(id)));
  } catch (err) {
    console.error("[webhook] sendFormEventWebhooks failed:", err);
  }
}

/**
 * Sweep step: retry all due (failed + past nextAttemptAt + attempts left)
 * deliveries, bounded to WEBHOOK_SWEEP_BATCH per tick. Returns the count
 * processed for the [scheduler] log line.
 */
export async function deliverDueWebhooks(now: Date = new Date()): Promise<number> {
  const due = await prisma.webhookDelivery.findMany({
    where: {
      status: WebhookDeliveryStatus.failed,
      attempts: { lt: MAX_ATTEMPTS },
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: WEBHOOK_SWEEP_BATCH,
  });

  await Promise.allSettled(due.map((d) => attemptDelivery(d.id)));
  return due.length;
}
