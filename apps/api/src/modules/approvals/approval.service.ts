import prisma from "../../db/prisma.js";
import { notifyFormEvent } from "../notifications/notification.service.js";

function forbiddenError(message: string) {
  const error = new Error(message);
  error.name = "FORBIDDEN";
  return error;
}

function formNotFoundError() {
  const error = new Error("Form not found.");
  error.name = "FORM_NOT_FOUND";
  return error;
}

/**
 * Submit a form for review (change status to PENDING_REVIEW)
 */
export async function submitForReview(
  formId: string,
  userId: string,
  input: { reviewerId: string; message?: string },
) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: { members: { some: { userId, role: { not: "VIEWER" } } } },
    },
    include: { workspace: { include: { members: true } } },
  });

  if (!form) throw formNotFoundError();

  // Can only submit for review from DRAFT or CHANGES_REQUESTED
  if (form.status !== "DRAFT" && form.status !== "CHANGES_REQUESTED") {
    const error = new Error(
      "Only forms in DRAFT or CHANGES_REQUESTED status can be submitted for review.",
    );
    error.name = "FORM_NOT_READY";
    throw error;
  }

  // Verify reviewer is a member of the workspace with OWNER or ADMIN role
  const reviewerMembership = form.workspace.members.find(
    (m) => m.userId === input.reviewerId,
  );

  if (!reviewerMembership) {
    const error = new Error("Reviewer must be a member of this workspace.");
    error.name = "INVALID_REVIEWER";
    throw error;
  }

  if (
    reviewerMembership.role !== "OWNER" &&
    reviewerMembership.role !== "ADMIN"
  ) {
    const error = new Error("Reviewer must be an Owner or Admin.");
    error.name = "INVALID_REVIEWER";
    throw error;
  }

  // Cannot review your own form (optional rule)
  // We'll allow it for small teams

  return prisma.form.update({
    where: { id: formId },
    data: { status: "PENDING_REVIEW" },
  }).then(async (updatedForm) => {
    // Get actor name for notification
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    await notifyFormEvent({
      formId,
      formTitle: form.title,
      actorId: userId,
      actorName: actor?.name ?? "Someone",
      type: "FORM_SUBMITTED_FOR_REVIEW",
      targetUserIds: [input.reviewerId],
    });

    return updatedForm;
  });
}

/**
 * Review a form (approve, request changes, or reject)
 */
export async function reviewForm(
  formId: string,
  userId: string,
  input: { decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED"; comment?: string },
) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      status: "PENDING_REVIEW",
      workspace: {
        members: {
          some: { userId, role: { in: ["OWNER", "ADMIN"] } },
        },
      },
    },
  });

  if (!form) {
    throw formNotFoundError();
  }

  // Map decision to form status
  const statusMap: Record<string, string> = {
    APPROVED: "APPROVED",
    CHANGES_REQUESTED: "CHANGES_REQUESTED",
    REJECTED: "DRAFT", // Rejected goes back to draft
  };

  const newStatus = statusMap[input.decision] ?? "DRAFT";

  const updatedForm = await prisma.form.update({
    where: { id: formId },
    data: { status: newStatus as "APPROVED" | "CHANGES_REQUESTED" | "DRAFT" },
  });

  // Notify form owner
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const notificationType =
    input.decision === "APPROVED"
      ? "FORM_APPROVED"
      : input.decision === "CHANGES_REQUESTED"
        ? "FORM_CHANGES_REQUESTED"
        : "FORM_REJECTED";

  await notifyFormEvent({
    formId,
    formTitle: form.title,
    actorId: userId,
    actorName: actor?.name ?? "A reviewer",
    type: notificationType,
    targetUserIds: [form.ownerId],
  });

  return updatedForm;
}

/**
 * Get form review status (for displaying in UI)
 */
export async function getFormReviewStatus(formId: string, userId: string) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: { members: { some: { userId } } },
    },
    select: {
      id: true,
      status: true,
      title: true,
    },
  });

  if (!form) throw formNotFoundError();

  return form;
}
