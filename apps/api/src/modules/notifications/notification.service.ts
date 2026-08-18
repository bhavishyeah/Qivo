import prisma from "../../db/prisma.js";

type NotificationType =
  | "FORM_SUBMITTED_FOR_REVIEW"
  | "FORM_APPROVED"
  | "FORM_CHANGES_REQUESTED"
  | "FORM_REJECTED"
  | "FORM_PUBLISHED"
  | "MEMBER_INVITED"
  | "MEMBER_REMOVED"
  | "RESPONSE_MILESTONE";

export async function createNotification(input: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      ...(input.metadata !== undefined
        ? { metadata: input.metadata as any }
        : {}),
    },
  });
}

export async function listNotifications(
  userId: string,
  input: { limit: number; unreadOnly?: boolean },
) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(input.unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.limit,
  });
}

export async function getUnreadCount(userId: string) {
  return prisma.notification.count({
    where: { userId, read: false },
  });
}

export async function markAsRead(notificationId: string, userId: string) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!notification) {
    const error = new Error("Notification not found.");
    error.name = "NOTIFICATION_NOT_FOUND";
    throw error;
  }

  return prisma.notification.update({
    where: { id: notificationId },
    data: { read: true },
  });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

// Helper to notify relevant users about form events
export async function notifyFormEvent(input: {
  formId: string;
  formTitle: string;
  actorId: string;
  actorName: string;
  type: NotificationType;
  targetUserIds: string[];
}) {
  const messages: Record<NotificationType, string> = {
    FORM_SUBMITTED_FOR_REVIEW: `${input.actorName} submitted "${input.formTitle}" for your review.`,
    FORM_APPROVED: `"${input.formTitle}" has been approved.`,
    FORM_CHANGES_REQUESTED: `Changes requested on "${input.formTitle}".`,
    FORM_REJECTED: `"${input.formTitle}" was rejected.`,
    FORM_PUBLISHED: `"${input.formTitle}" has been published.`,
    MEMBER_INVITED: `${input.actorName} added you to the workspace.`,
    MEMBER_REMOVED: `You were removed from the workspace.`,
    RESPONSE_MILESTONE: `"${input.formTitle}" reached a response milestone.`,
  };

  const titles: Record<NotificationType, string> = {
    FORM_SUBMITTED_FOR_REVIEW: "Review requested",
    FORM_APPROVED: "Form approved",
    FORM_CHANGES_REQUESTED: "Changes requested",
    FORM_REJECTED: "Form rejected",
    FORM_PUBLISHED: "Form published",
    MEMBER_INVITED: "Team invitation",
    MEMBER_REMOVED: "Removed from team",
    RESPONSE_MILESTONE: "Response milestone",
  };

  // Don't notify the actor themselves
  const recipients = input.targetUserIds.filter((id) => id !== input.actorId);

  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: input.type,
      title: titles[input.type],
      message: messages[input.type],
      metadata: { formId: input.formId, actorId: input.actorId },
    })),
  });
}
