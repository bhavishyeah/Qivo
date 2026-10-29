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

export type ResponseCreatedPayload = {
  event: string;
  formId: string;
  formTitle: string;
  responseId: string;
  submittedAt: string;
  answers: Record<string, unknown>;
  questions: Record<string, string>;
};

/**
 * Build the pinned `response.created` payload. `answers` is the stored
 * FormResponse.answers (raw, as submitted). `questions` is reduced to an
 * id→label map from the in-scope schema questions local.
 */
export function buildResponseCreatedPayload(args: {
  formId: string;
  formTitle: string;
  responseId: string;
  submittedAt: Date;
  answers: Record<string, unknown>;
  questions: Array<{ id: string; label: string }>;
}): ResponseCreatedPayload {
  const questions: Record<string, string> = {};
  for (const q of args.questions) {
    questions[q.id] = q.label;
  }

  return {
    event: EVENT_RESPONSE_CREATED,
    formId: args.formId,
    formTitle: args.formTitle,
    responseId: args.responseId,
    submittedAt: args.submittedAt.toISOString(),
    answers: args.answers,
    questions,
  };
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

/**
 * Validate a webhook target URL for SSRF safety: https-only, hostname not an
 * obvious internal name, and every resolved address public. Throws a
 * WEBHOOK_URL_INVALID error on any violation. Async because it resolves DNS.
 *
 * Note (v1, documented): this and the subsequent fetch() perform independent
 * DNS resolutions, so this does NOT defend against an active DNS-rebinding
 * attacker. It is one layer alongside https-only, redirect:"manual", and the
 * request timeout.
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

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw webhookUrlInvalidError("Webhook URL host could not be resolved.");
  }

  if (addresses.length === 0) {
    throw webhookUrlInvalidError("Webhook URL host could not be resolved.");
  }

  for (const { address } of addresses) {
    if (classifyAddress(address) === "blocked") {
      throw webhookUrlInvalidError("Webhook URL resolves to a disallowed address.");
    }
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
      // Re-check SSRF at send time (narrows the window; not a rebinding guarantee).
      await assertSafeWebhookUrl(webhook.url);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        const res = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Qivo-Event": delivery.event,
            "X-Qivo-Timestamp": String(Math.floor(Date.now() / 1000)),
            "X-Qivo-Signature": computeSignature(webhook.secret, raw),
            "User-Agent": "Qivo-Webhooks/1",
          },
          body: raw,
          signal: controller.signal,
          redirect: "manual",
        });
        // Classify on status code only — the response body is never read.
        responseStatus = res.status;
        if (res.ok) {
          ok = true;
        } else {
          lastError = `HTTP ${res.status}`;
        }
      } finally {
        clearTimeout(timer);
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
    const webhooks = await prisma.webhook.findMany({
      where: { formId, enabled: true },
    });
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
