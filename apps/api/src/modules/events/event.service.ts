import prisma from "../../db/prisma.js";

function forbiddenError(msg: string) {
  const e = new Error(msg); e.name = "FORBIDDEN"; return e;
}

function notFoundError(msg: string, name: string) {
  const e = new Error(msg); e.name = name; return e;
}

async function requireEditor(workspaceId: string, userId: string) {
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!m) throw notFoundError("Workspace not found.", "WORKSPACE_NOT_FOUND");
  if (m.role === "VIEWER") throw forbiddenError("You do not have permission.");
  return m;
}

export async function createEvent(input: {
  workspaceId: string;
  userId: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
}) {
  await requireEditor(input.workspaceId, input.userId);

  return prisma.event.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    },
  });
}

export async function listEvents(workspaceId: string, userId: string) {
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!m) throw notFoundError("Workspace not found.", "WORKSPACE_NOT_FOUND");

  return prisma.event.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { forms: { where: { deletedAt: null } } } },
    },
  });
}

export async function getEvent(eventId: string, userId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      forms: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          createdAt: true,
          _count: { select: { responses: true } },
        },
      },
    },
  });

  if (!event) throw notFoundError("Event not found.", "EVENT_NOT_FOUND");

  // Verify membership
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: event.workspaceId, userId } },
  });
  if (!m) throw notFoundError("Event not found.", "EVENT_NOT_FOUND");

  return event;
}

export async function updateEvent(
  eventId: string,
  userId: string,
  input: { name?: string; description?: string | null; startDate?: string | null; endDate?: string | null },
) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw notFoundError("Event not found.", "EVENT_NOT_FOUND");

  await requireEditor(event.workspaceId, userId);

  return prisma.event.update({
    where: { id: eventId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate ? new Date(input.startDate) : null } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate ? new Date(input.endDate) : null } : {}),
    },
  });
}

export async function deleteEvent(eventId: string, userId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw notFoundError("Event not found.", "EVENT_NOT_FOUND");

  await requireEditor(event.workspaceId, userId);

  // Remove forms from event (don't delete them)
  await prisma.form.updateMany({ where: { eventId }, data: { eventId: null } });

  return prisma.event.delete({ where: { id: eventId } });
}

export async function addFormToEvent(eventId: string, formId: string, userId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw notFoundError("Event not found.", "EVENT_NOT_FOUND");

  await requireEditor(event.workspaceId, userId);

  const form = await prisma.form.findFirst({
    where: { id: formId, workspaceId: event.workspaceId, deletedAt: null },
  });
  if (!form) throw notFoundError("Form not found.", "FORM_NOT_FOUND");

  return prisma.form.update({ where: { id: formId }, data: { eventId } });
}

export async function removeFormFromEvent(eventId: string, formId: string, userId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw notFoundError("Event not found.", "EVENT_NOT_FOUND");

  await requireEditor(event.workspaceId, userId);

  return prisma.form.update({ where: { id: formId }, data: { eventId: null } });
}
