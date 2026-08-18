import prisma from "../../db/prisma.js";

export async function logAction(input: {
  workspaceId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      ...(input.metadata !== undefined
        ? { metadata: input.metadata as any }
        : {}),
    },
  });
}

export async function listAuditLogs(
  workspaceId: string,
  userId: string,
  input: { limit: number; offset: number },
) {
  // Verify user is member of workspace
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });

  if (!membership) {
    const error = new Error("Workspace not found.");
    error.name = "WORKSPACE_NOT_FOUND";
    throw error;
  }

  // Only OWNER and ADMIN can see audit logs
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    const error = new Error("You do not have permission to view audit logs.");
    error.name = "FORBIDDEN";
    throw error;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: input.limit,
      skip: input.offset,
    }),
    prisma.auditLog.count({ where: { workspaceId } }),
  ]);

  return { logs, total };
}
