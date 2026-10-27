import { randomBytes } from "node:crypto";

import prisma from "../../db/prisma.js";
import { createNotification } from "../notifications/notification.service.js";
import {
  sendFormShareExistingUserEmail,
  sendFormShareInviteEmail,
} from "../../services/email.js";
import { hasEditorShare } from "./formShare.access.js";

type FormShareRole = "RESPONDER" | "EDITOR" | "VIEWER";

function forbiddenError(message: string) {
  const error = new Error(message);
  error.name = "FORBIDDEN";
  return error;
}

function formNotFoundError(message = "Form not found.") {
  const error = new Error(message);
  error.name = "FORM_NOT_FOUND";
  return error;
}

function shareNotFoundError(message = "Share not found.") {
  const error = new Error(message);
  error.name = "SHARE_NOT_FOUND";
  return error;
}

function invalidTokenError(message: string) {
  const error = new Error(message);
  error.name = "INVALID_TOKEN";
  return error;
}

const roleLabels: Record<FormShareRole, string> = {
  EDITOR: "editor",
  VIEWER: "viewer",
  RESPONDER: "responder",
};

const userSelect = {
  select: { id: true, name: true, email: true, avatarUrl: true },
} as const;

/**
 * Only a form editor may manage shares. A form editor is a non-VIEWER workspace
 * member OR someone with an ACCEPTED EDITOR share. Implemented here (not via
 * `form.service.ts`) to avoid a `forms` <-> `formShares` circular import.
 */
async function requireFormEditor(formId: string, userId: string) {
  const member = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: { members: { some: { userId, role: { not: "VIEWER" } } } },
    },
    select: { id: true },
  });
  if (member) return;
  if (await hasEditorShare(formId, userId)) return;
  throw forbiddenError(
    "You do not have permission to manage sharing for this form.",
  );
}

export async function listShares(formId: string, actorId: string) {
  await requireFormEditor(formId, actorId);

  return prisma.formShare.findMany({
    where: { formId },
    orderBy: { createdAt: "asc" },
    include: { user: userSelect },
  });
}

export async function createShare(
  formId: string,
  actorId: string,
  input: { email: string; role: FormShareRole },
) {
  await requireFormEditor(formId, actorId);

  const email = input.email.trim().toLowerCase();
  const role = input.role;

  const form = await prisma.form.findFirst({
    where: { id: formId, deletedAt: null },
    select: { id: true, title: true, slug: true },
  });
  if (!form) {
    throw formNotFoundError();
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { name: true },
  });
  const inviterName = actor?.name ?? "Someone";
  const formTitle = form.title;

  const targetUser = await prisma.user.findUnique({ where: { email } });

  const existing = await prisma.formShare.findUnique({
    where: { formId_email: { formId, email } },
  });

  let share;
  if (!existing) {
    // First invite for this (form, email).
    share = await prisma.formShare.create({
      data: {
        formId,
        email,
        role,
        invitedById: actorId,
        token: randomBytes(32).toString("hex"),
        ...(targetUser
          ? { userId: targetUser.id, status: "ACCEPTED", acceptedAt: new Date() }
          : { status: "PENDING" }),
      },
      include: { user: userSelect },
    });
  } else {
    // Re-invite of an existing (form, email) row. `token` is OMITTED so an
    // outstanding invite link keeps working. Link + accept only when the row is
    // still PENDING AND the user now has an account.
    share = await prisma.formShare.update({
      where: { id: existing.id },
      data: {
        role,
        ...(existing.status === "PENDING" && targetUser
          ? { userId: targetUser.id, status: "ACCEPTED", acceptedAt: new Date() }
          : {}),
      },
      include: { user: userSelect },
    });
  }

  // Side effects — strictly fire-and-forget, never crash the request.
  if (targetUser) {
    const roleLabel = roleLabels[role];
    const title = "Form shared with you";
    const message = `${inviterName} gave you ${roleLabel} access to "${formTitle}".`;
    void createNotification({
      userId: targetUser.id,
      type: "FORM_SHARED",
      title,
      message,
      metadata: { formId, role, actorId },
    }).catch(console.error);
    void sendFormShareExistingUserEmail(email, {
      inviterName,
      formTitle,
      role,
      slug: form.slug,
      formId,
    }).catch(console.error);
  } else {
    void sendFormShareInviteEmail(email, {
      inviterName,
      formTitle,
      role,
      token: share.token,
    }).catch(console.error);
  }

  return share;
}

export async function revokeShare(
  formId: string,
  shareId: string,
  actorId: string,
) {
  await requireFormEditor(formId, actorId);

  const share = await prisma.formShare.findFirst({
    where: { id: shareId, formId },
    select: { id: true },
  });
  if (!share) {
    throw shareNotFoundError();
  }

  await prisma.formShare.delete({ where: { id: shareId } });

  return { message: "Share revoked." };
}

export async function getInviteByToken(token: string) {
  const share = await prisma.formShare.findUnique({
    where: { token },
    include: {
      form: { select: { id: true, title: true, slug: true } },
      invitedBy: { select: { name: true } },
    },
  });

  if (!share) {
    throw invalidTokenError("This invite link is invalid or has expired.");
  }

  // Minimal public projection — do NOT leak email, userId, schema, or internals.
  return {
    formTitle: share.form.title,
    role: share.role,
    inviterName: share.invitedBy.name,
    status: share.status,
  };
}

export async function acceptInvite(
  token: string,
  user: { id: string; name: string; email: string },
) {
  const share = await prisma.formShare.findUnique({
    where: { token },
    include: { form: { select: { id: true, slug: true, title: true } } },
  });

  if (!share) {
    throw invalidTokenError("This invite link is invalid or has expired.");
  }

  if (share.status === "ACCEPTED") {
    if (share.userId === user.id) {
      // Idempotent success for the same user.
      return { formId: share.formId, slug: share.form.slug, role: share.role };
    }
    throw invalidTokenError("This invite has already been used.");
  }

  // Email-match security check: the capability is tied to the intended recipient.
  if (user.email.toLowerCase() !== share.email) {
    throw forbiddenError(
      "This invite was sent to a different email address.",
    );
  }

  await prisma.formShare.update({
    where: { id: share.id },
    data: { userId: user.id, status: "ACCEPTED", acceptedAt: new Date() },
  });

  return { formId: share.formId, slug: share.form.slug, role: share.role };
}

export async function listSharedWithMe(userId: string) {
  const shares = await prisma.formShare.findMany({
    where: { userId, status: "ACCEPTED" },
    include: {
      form: { select: { id: true, title: true, slug: true, status: true } },
    },
    orderBy: { acceptedAt: "desc" },
  });

  return shares.map((share) => ({
    shareId: share.id,
    role: share.role,
    form: {
      id: share.form.id,
      title: share.form.title,
      slug: share.form.slug,
      status: share.form.status,
    },
  }));
}
