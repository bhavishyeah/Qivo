import { randomBytes } from "node:crypto";

import prisma from "../../db/prisma.js";

export function createWorkspaceSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `${base || "workspace"}-${randomBytes(4).toString("hex")}`;
}

export async function createWorkspace(input: {
  name: string;
  ownerId: string;
}) {
  return prisma.workspace.create({
    data: {
      name: input.name.trim(),
      slug: createWorkspaceSlug(input.name),
      type: "TEAM",
      ownerId: input.ownerId,
      members: {
        create: {
          userId: input.ownerId,
          role: "OWNER",
        },
      },
    },
    include: {
      members: {
        where: {
          userId: input.ownerId,
        },
        select: {
          role: true,
        },
      },
    },
  });
}