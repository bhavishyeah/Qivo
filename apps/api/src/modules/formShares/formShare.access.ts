import prisma from "../../db/prisma.js";

/**
 * Effective per-form access via shares. These helpers are the single place the
 * share-based access rule lives, so both the `forms` module and the
 * `formShares`/`invites` module can import them without a circular dependency.
 *
 * Every helper filters `status: "ACCEPTED"` — a PENDING invite grants nothing.
 * RESPONDER never grants any backend permission; it is excluded from
 * `hasEditorShare` and `hasResponseViewShare`.
 */

/**
 * Returns the highest effective capability a user has on a form via shares,
 * or null if no ACCEPTED share grants anything.
 */
export async function getAcceptedShareRole(
  formId: string,
  userId: string,
): Promise<"EDITOR" | "VIEWER" | "RESPONDER" | null> {
  const shares = await prisma.formShare.findMany({
    where: { formId, userId, status: "ACCEPTED" },
    select: { role: true },
  });

  if (shares.some((s) => s.role === "EDITOR")) return "EDITOR";
  if (shares.some((s) => s.role === "VIEWER")) return "VIEWER";
  if (shares.some((s) => s.role === "RESPONDER")) return "RESPONDER";
  return null;
}

/**
 * True if an ACCEPTED EDITOR share exists for (formId, userId).
 */
export async function hasEditorShare(
  formId: string,
  userId: string,
): Promise<boolean> {
  const share = await prisma.formShare.findFirst({
    where: { formId, userId, status: "ACCEPTED", role: "EDITOR" },
    select: { id: true },
  });
  return share !== null;
}

/**
 * True if an ACCEPTED EDITOR or VIEWER share exists for (formId, userId).
 */
export async function hasResponseViewShare(
  formId: string,
  userId: string,
): Promise<boolean> {
  const share = await prisma.formShare.findFirst({
    where: {
      formId,
      userId,
      status: "ACCEPTED",
      role: { in: ["EDITOR", "VIEWER"] },
    },
    select: { id: true },
  });
  return share !== null;
}
