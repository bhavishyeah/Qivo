import { randomBytes } from "node:crypto";

import prisma from "../../db/prisma.js";
import { getEditableForm } from "../forms/form.service.js";
import {
  assertSafeWebhookUrl,
  MAX_WEBHOOKS_PER_FORM,
} from "../../services/webhookDelivery.js";

/**
 * Editor-gated webhook management. Every function authorizes via
 * getEditableForm (workspace members whose role is not VIEWER, plus per-form
 * EDITOR shares) so a VIEWER/non-member gets FORM_NOT_FOUND. A webhook/delivery
 * lookup that doesn't match the form throws WEBHOOK_NOT_FOUND.
 */

type WebhookDto = {
  id: string;
  formId: string;
  url: string;
  description: string | null;
  enabled: boolean;
  secret: string;
  createdAt: Date;
};

type WebhookDeliveryDto = {
  id: string;
  event: string;
  status: string;
  attempts: number;
  lastResponseStatus: number | null;
  lastError: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
};

function webhookNotFoundError(message = "Webhook not found."): Error {
  const error = new Error(message);
  error.name = "WEBHOOK_NOT_FOUND";
  return error;
}

function webhookUrlInvalidError(message: string): Error {
  const error = new Error(message);
  error.name = "WEBHOOK_URL_INVALID";
  return error;
}

function toWebhookDto(w: {
  id: string;
  formId: string;
  url: string;
  description: string | null;
  enabled: boolean;
  secret: string;
  createdAt: Date;
}): WebhookDto {
  return {
    id: w.id,
    formId: w.formId,
    url: w.url,
    description: w.description,
    enabled: w.enabled,
    secret: w.secret,
    createdAt: w.createdAt,
  };
}

/** Load a webhook, asserting it belongs to the form. */
async function getWebhookForForm(formId: string, webhookId: string) {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook || webhook.formId !== formId) {
    throw webhookNotFoundError();
  }
  return webhook;
}

export async function listWebhooks(formId: string, userId: string): Promise<WebhookDto[]> {
  await getEditableForm(formId, userId);
  const webhooks = await prisma.webhook.findMany({
    where: { formId },
    orderBy: { createdAt: "asc" },
  });
  return webhooks.map(toWebhookDto);
}

export async function createWebhook(
  formId: string,
  userId: string,
  input: { url: string; description?: string | undefined },
): Promise<WebhookDto> {
  await getEditableForm(formId, userId);

  // 1) Count check first — an over-cap create does not pay for a DNS lookup.
  const count = await prisma.webhook.count({ where: { formId } });
  if (count >= MAX_WEBHOOKS_PER_FORM) {
    throw webhookUrlInvalidError(
      `A form can have at most ${MAX_WEBHOOKS_PER_FORM} webhooks.`,
    );
  }

  // 2) SSRF check (async DNS lookup + address classification).
  await assertSafeWebhookUrl(input.url);

  const secret = randomBytes(32).toString("hex");
  const webhook = await prisma.webhook.create({
    data: {
      formId,
      url: input.url,
      secret,
      description: input.description ?? null,
      createdById: userId,
    },
  });
  return toWebhookDto(webhook);
}

export async function updateWebhook(
  formId: string,
  webhookId: string,
  userId: string,
  input: { enabled: boolean },
): Promise<WebhookDto> {
  await getEditableForm(formId, userId);
  await getWebhookForForm(formId, webhookId);
  const updated = await prisma.webhook.update({
    where: { id: webhookId },
    data: { enabled: input.enabled },
  });
  return toWebhookDto(updated);
}

export async function regenerateSecret(
  formId: string,
  webhookId: string,
  userId: string,
): Promise<WebhookDto> {
  await getEditableForm(formId, userId);
  await getWebhookForForm(formId, webhookId);
  const secret = randomBytes(32).toString("hex");
  const updated = await prisma.webhook.update({
    where: { id: webhookId },
    data: { secret },
  });
  return toWebhookDto(updated);
}

export async function deleteWebhook(
  formId: string,
  webhookId: string,
  userId: string,
): Promise<void> {
  await getEditableForm(formId, userId);
  await getWebhookForForm(formId, webhookId);
  await prisma.webhook.delete({ where: { id: webhookId } });
}

export async function listDeliveries(
  formId: string,
  webhookId: string,
  userId: string,
  input: { limit: number },
): Promise<WebhookDeliveryDto[]> {
  await getEditableForm(formId, userId);
  await getWebhookForForm(formId, webhookId);
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { webhookId },
    orderBy: { createdAt: "desc" },
    take: input.limit,
  });
  return deliveries.map((d) => ({
    id: d.id,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    lastResponseStatus: d.lastResponseStatus,
    lastError: d.lastError,
    createdAt: d.createdAt,
    deliveredAt: d.deliveredAt,
  }));
}
