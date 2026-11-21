import { createHmac } from "node:crypto";
import prisma from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { getPlatformAdminEmails } from "../../services/platformAdmin.js";
import { notifyFormEvent } from "../notifications/notification.service.js";
import type { CreateReportInput } from "./report.schemas.js";

/** OPEN scam reports from distinct reporters that flag a form. */
export const FLAG_THRESHOLD = 3;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_USER_AGENT = 255;

/**
 * Keyed hash of the reporter IP. The raw IP is never stored or logged. Uses a
 * dedicated secret when set, else the response-edit secret.
 */
export function hashIp(ip: string): string {
  const secret = process.env.REPORT_IP_SECRET || env.RESPONSE_EDIT_SECRET;
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export async function submitReport(
  slug: string,
  input: CreateReportInput,
  meta: { ip: string; userAgent: string | undefined },
): Promise<{ recorded: boolean }> {
  const form = await prisma.form.findFirst({
    where: { slug, deletedAt: null, status: "PUBLISHED" },
    select: { id: true, title: true, ownerId: true, flaggedAt: true },
  });
  if (!form) {
    const error = new Error("Published form not found.");
    error.name = "PUBLIC_FORM_NOT_FOUND";
    throw error;
  }

  const ipHash = hashIp(meta.ip);

  // One report per IP per form per day. The caller sees the same success
  // response either way, so the dedupe is not an oracle.
  const existing = await prisma.formReport.findFirst({
    where: {
      formId: form.id,
      ipHash,
      createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (existing) return { recorded: false };

  await prisma.formReport.create({
    data: {
      formId: form.id,
      reason: input.reason,
      ...(input.details ? { details: input.details } : {}),
      ...(input.reporterEmail ? { reporterEmail: input.reporterEmail } : {}),
      ipHash,
      ...(meta.userAgent
        ? { userAgent: meta.userAgent.slice(0, MAX_USER_AGENT) }
        : {}),
    },
  });

  if (input.reason === "SCAM" && !form.flaggedAt) {
    await flagIfThresholdReached(form).catch((err) =>
      console.error("form report flagging failed:", err),
    );
  }
  return { recorded: true };
}

async function flagIfThresholdReached(form: {
  id: string;
  title: string;
  ownerId: string;
}) {
  const distinct = await prisma.formReport.findMany({
    where: { formId: form.id, status: "OPEN", reason: "SCAM" },
    distinct: ["ipHash"],
    select: { ipHash: true },
  });
  if (distinct.length < FLAG_THRESHOLD) return;

  // Conditional update so only one concurrent request notifies.
  const flagged = await prisma.form.updateMany({
    where: { id: form.id, flaggedAt: null },
    data: { flaggedAt: new Date() },
  });
  if (flagged.count === 0) return;

  const adminEmails = getPlatformAdminEmails();
  const admins = adminEmails.length
    ? await prisma.user.findMany({
        where: { email: { in: adminEmails } },
        select: { id: true },
      })
    : [];
  const targetUserIds = [...new Set([form.ownerId, ...admins.map((a) => a.id)])];
  await notifyFormEvent({
    formId: form.id,
    formTitle: form.title,
    actorId: "system",
    actorName: "Qivo",
    type: "FORM_REPORTED",
    targetUserIds,
  });
}

export async function listReports(input: {
  status?: "OPEN" | "REVIEWED" | "DISMISSED" | undefined;
  page: number;
  pageSize: number;
}) {
  const where = input.status ? { status: input.status } : {};
  const [total, rows] = await Promise.all([
    prisma.formReport.count({ where }),
    prisma.formReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        reason: true,
        details: true,
        reporterEmail: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        form: {
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            flaggedAt: true,
            owner: { select: { email: true } },
          },
        },
      },
    }),
  ]);

  const formIds = [...new Set(rows.map((r) => r.form.id))];
  const counts = formIds.length
    ? await prisma.formReport.groupBy({
        by: ["formId"],
        where: { formId: { in: formIds } },
        _count: { _all: true },
      })
    : [];
  const countByForm = new Map(counts.map((c) => [c.formId, c._count._all]));

  return {
    total,
    page: input.page,
    pageSize: input.pageSize,
    reports: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      details: r.details,
      reporterEmail: r.reporterEmail,
      status: r.status,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      reportCount: countByForm.get(r.form.id) ?? 1,
      form: {
        id: r.form.id,
        title: r.form.title,
        slug: r.form.slug,
        status: r.form.status,
        flaggedAt: r.form.flaggedAt,
        ownerEmail: r.form.owner.email,
      },
    })),
  };
}

export async function updateReportStatus(
  id: string,
  status: "OPEN" | "REVIEWED" | "DISMISSED",
  reviewerId: string,
) {
  const existing = await prisma.formReport.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    const error = new Error("Report not found.");
    error.name = "REPORT_NOT_FOUND";
    throw error;
  }
  return prisma.formReport.update({
    where: { id },
    data:
      status === "OPEN"
        ? { status, reviewedAt: null, reviewedById: null }
        : { status, reviewedAt: new Date(), reviewedById: reviewerId },
    select: { id: true, status: true, reviewedAt: true },
  });
}