import { OAuth2Client } from "google-auth-library";
import { createHash, randomBytes } from "node:crypto";
import prisma from "../../db/prisma.js";
import { NO_PASSWORD_SENTINEL } from "./auth.service.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "workspace"}-${randomBytes(4).toString("hex")}`;
}

const SESSION_DAYS = 30;

function createSessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Verify Google ID token and sign in / sign up the user.
 * Returns session token + user info.
 */
export async function googleSignIn(idToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    const error = new Error("Google login is not configured.");
    error.name = "GOOGLE_NOT_CONFIGURED";
    throw error;
  }

  const client = new OAuth2Client(clientId);

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch {
    const error = new Error("Invalid Google token.");
    error.name = "UNAUTHORIZED";
    throw error;
  }

  if (!payload || !payload.email) {
    const error = new Error("Unable to read Google account info.");
    error.name = "UNAUTHORIZED";
    throw error;
  }

  // Only trust Google identities where Google itself has verified the email.
  // Without this, someone could sign in as any account whose email they know
  // by presenting a token for an unverified Google address — and we'd silently
  // merge into an existing password-based account (account takeover).
  if (payload.email_verified !== true) {
    const error = new Error("Your Google email address is not verified.");
    error.name = "UNAUTHORIZED";
    throw error;
  }

  const email = payload.email.toLowerCase();
  const name = payload.name ?? email.split("@")[0] ?? "User";

  // Check if user exists
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Create new user (sign up via Google)
    user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name,
          email,
          // Sentinel marking "no password set" (passwordHash is NOT NULL in the
          // schema). It is not a valid bcrypt hash, so bcrypt.compare always
          // returns false and the password-login path rejects these accounts.
          passwordHash: NO_PASSWORD_SENTINEL,
          emailVerified: true, // Google verified the email (checked above)
          avatarUrl: payload.picture ?? null,
        },
      });

      // Create personal workspace
      await tx.workspace.create({
        data: {
          name: `${name}'s Workspace`,
          slug: createSlug(name),
          ownerId: newUser.id,
          type: "PERSONAL",
          members: {
            create: { userId: newUser.id, role: "OWNER" },
          },
        },
      });

      return newUser;
    });
  } else {
    // Update avatar if not set
    if (!user.avatarUrl && payload.picture) {
      await prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl: payload.picture },
      });
    }
    // Mark email as verified if it wasn't
    if (!user.emailVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
    }
  }

  // Create session
  const sessionToken = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: createSessionExpiry(),
    },
  });

  const workspace = await prisma.workspace.findFirst({
    where: { ownerId: user.id, type: "PERSONAL" },
  });

  return {
    sessionToken,
    user: { id: user.id, name: user.name, email: user.email },
    workspace: workspace
      ? { id: workspace.id, name: workspace.name, slug: workspace.slug }
      : null,
  };
}
