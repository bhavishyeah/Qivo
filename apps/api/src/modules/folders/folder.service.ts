import prisma from "../../db/prisma.js";

function forbiddenError(message: string) {
  const error = new Error(message);
  error.name = "FORBIDDEN";
  return error;
}

function folderNotFoundError() {
  const error = new Error("Folder not found.");
  error.name = "FOLDER_NOT_FOUND";
  return error;
}

async function getMembership(workspaceId: string, userId: string) {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
}

export async function createFolder(input: {
  workspaceId: string;
  userId: string;
  name: string;
  parentId?: string;
}) {
  const membership = await getMembership(input.workspaceId, input.userId);

  if (!membership) {
    const error = new Error("Workspace not found.");
    error.name = "WORKSPACE_NOT_FOUND";
    throw error;
  }

  if (membership.role === "VIEWER") {
    throw forbiddenError("You do not have permission to create folders.");
  }

  // Validate parentId belongs to same workspace
  if (input.parentId) {
    const parent = await prisma.folder.findFirst({
      where: { id: input.parentId, workspaceId: input.workspaceId },
    });
    if (!parent) {
      throw folderNotFoundError();
    }
  }

  return prisma.folder.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      parentId: input.parentId ?? null,
    },
  });
}

export async function listFolders(workspaceId: string, userId: string) {
  const membership = await getMembership(workspaceId, userId);

  if (!membership) {
    const error = new Error("Workspace not found.");
    error.name = "WORKSPACE_NOT_FOUND";
    throw error;
  }

  return prisma.folder.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { forms: { where: { deletedAt: null } } } },
    },
  });
}

export async function updateFolder(
  folderId: string,
  userId: string,
  input: { name?: string; parentId?: string | null },
) {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
  });

  if (!folder) throw folderNotFoundError();

  const membership = await getMembership(folder.workspaceId, userId);
  if (!membership || membership.role === "VIEWER") {
    throw forbiddenError("You do not have permission to edit this folder.");
  }

  // Prevent setting folder as its own parent
  if (input.parentId === folderId) {
    const error = new Error("A folder cannot be its own parent.");
    error.name = "INVALID_FOLDER_PARENT";
    throw error;
  }

  return prisma.folder.update({
    where: { id: folderId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    },
  });
}

export async function deleteFolder(folderId: string, userId: string) {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
  });

  if (!folder) throw folderNotFoundError();

  const membership = await getMembership(folder.workspaceId, userId);
  if (!membership || membership.role === "VIEWER") {
    throw forbiddenError("You do not have permission to delete this folder.");
  }

  // Move child forms to root (null folderId)
  await prisma.form.updateMany({
    where: { folderId },
    data: { folderId: null },
  });

  // Move child folders to parent
  await prisma.folder.updateMany({
    where: { parentId: folderId },
    data: { parentId: folder.parentId },
  });

  return prisma.folder.delete({ where: { id: folderId } });
}

export async function moveFormToFolder(
  formId: string,
  userId: string,
  folderId: string | null,
) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: { members: { some: { userId, role: { not: "VIEWER" } } } },
    },
  });

  if (!form) {
    const error = new Error("Form not found.");
    error.name = "FORM_NOT_FOUND";
    throw error;
  }

  // Validate folder belongs to same workspace
  if (folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, workspaceId: form.workspaceId },
    });
    if (!folder) throw folderNotFoundError();
  }

  return prisma.form.update({
    where: { id: formId },
    data: { folderId },
  });
}
