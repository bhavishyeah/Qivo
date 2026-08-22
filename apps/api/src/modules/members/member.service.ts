import prisma from "../../db/prisma.js";
import { createNotification } from "../notifications/notification.service.js";

type WorkspaceRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

function forbiddenError(message: string) {
  const error = new Error(message);
  error.name = "FORBIDDEN";
  return error;
}

function notFoundError(message: string, name: string) {
  const error = new Error(message);
  error.name = name;
  return error;
}

/**
 * Check if the acting user can manage members (must be OWNER or ADMIN)
 */
async function requireManagerRole(workspaceId: string, userId: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });

  if (!membership) {
    throw notFoundError("Workspace not found.", "WORKSPACE_NOT_FOUND");
  }

  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    throw forbiddenError("You do not have permission to manage members.");
  }

  return membership;
}

export async function listMembers(workspaceId: string, userId: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });

  if (!membership) {
    throw notFoundError("Workspace not found.", "WORKSPACE_NOT_FOUND");
  }

  return prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
    orderBy: { joinedAt: "asc" },
  });
}

export async function inviteMember(
  workspaceId: string,
  actorId: string,
  input: { email: string; role: "ADMIN" | "EDITOR" | "VIEWER" },
) {
  await requireManagerRole(workspaceId, actorId);

  // Find user by email
  const targetUser = await prisma.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
  });

  if (!targetUser) {
    const error = new Error(
      "No account found with that email. They must sign up first.",
    );
    error.name = "USER_NOT_FOUND";
    throw error;
  }

  // Check if already a member
  const existing = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUser.id } },
  });

  if (existing) {
    const error = new Error("This user is already a member of this workspace.");
    error.name = "CONFLICT";
    throw error;
  }

  const member = await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId: targetUser.id,
      role: input.role,
    },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  // Send notification to the invited user
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });

  void createNotification({
    userId: targetUser.id,
    type: "MEMBER_INVITED",
    title: "Added to workspace",
    message: `${actor?.name ?? "Someone"} added you to "${workspace?.name ?? "a workspace"}" as ${input.role}.`,
    metadata: { workspaceId, actorId },
  });

  return member;
}

export async function updateMemberRole(
  workspaceId: string,
  memberId: string,
  actorId: string,
  newRole: "ADMIN" | "EDITOR" | "VIEWER",
) {
  const actorMembership = await requireManagerRole(workspaceId, actorId);

  const targetMember = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
  });

  if (!targetMember) {
    throw notFoundError("Member not found.", "MEMBER_NOT_FOUND");
  }

  // Cannot change owner's role
  if (targetMember.role === "OWNER") {
    throw forbiddenError("Cannot change the owner's role.");
  }

  // Only owner can promote to admin
  if (newRole === "ADMIN" && actorMembership.role !== "OWNER") {
    throw forbiddenError("Only the owner can assign the Admin role.");
  }

  return prisma.workspaceMember.update({
    where: { id: memberId },
    data: { role: newRole },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });
}

export async function removeMember(
  workspaceId: string,
  memberId: string,
  actorId: string,
) {
  const actorMembership = await requireManagerRole(workspaceId, actorId);

  const targetMember = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
  });

  if (!targetMember) {
    throw notFoundError("Member not found.", "MEMBER_NOT_FOUND");
  }

  // Cannot remove owner
  if (targetMember.role === "OWNER") {
    throw forbiddenError("Cannot remove the workspace owner.");
  }

  // Admin cannot remove another admin (only owner can)
  if (targetMember.role === "ADMIN" && actorMembership.role !== "OWNER") {
    throw forbiddenError("Only the owner can remove an admin.");
  }

  // Cannot remove yourself (use leave instead)
  if (targetMember.userId === actorId) {
    throw forbiddenError("You cannot remove yourself. Use leave workspace instead.");
  }

  return prisma.workspaceMember.delete({ where: { id: memberId } });
}

export async function leaveWorkspace(workspaceId: string, userId: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });

  if (!membership) {
    throw notFoundError("Workspace not found.", "WORKSPACE_NOT_FOUND");
  }

  if (membership.role === "OWNER") {
    throw forbiddenError(
      "The owner cannot leave the workspace. Transfer ownership first.",
    );
  }

  return prisma.workspaceMember.delete({ where: { id: membership.id } });
}
