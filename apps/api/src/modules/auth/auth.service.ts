import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

import prisma from "../../db/prisma.js";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../../services/email.js";

const SESSION_DAYS = 30;

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

function createSessionExpiry(): Date {
  return new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  );
}
export async function logout(sessionId: string) {
  await prisma.session.deleteMany({
    where: {
      id: sessionId,
    },
  });
}

export async function signup(input: {
  name: string;
  email: string;
  password: string;
}) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    const error = new Error(
      "An account with this email already exists.",
    );
    error.name = "CONFLICT";
    throw error;
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const sessionToken = randomBytes(32).toString("hex");

  const result = await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: {
        name,
        email,
        passwordHash,
      },
    });

    const workspace = await transaction.workspace.create({
      data: {
        name: `${name}'s Workspace`,
        slug: createSlug(name),
        ownerId: user.id,
        type: "PERSONAL",
        members: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });

    await transaction.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(sessionToken),
        expiresAt: createSessionExpiry(),
      },
    });

    return {
      user,
      workspace,
    };
  });

  return {
    sessionToken,
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
    },
    workspace: {
      id: result.workspace.id,
      name: result.workspace.name,
      slug: result.workspace.slug,
    },
  };
}

export async function login(input: {
  email: string;
  password: string;
}) {
  const email = input.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    const error = new Error("Invalid email or password.");
    error.name = "UNAUTHORIZED";
    throw error;
  }

  const passwordMatches = await bcrypt.compare(
    input.password,
    user.passwordHash,
  );

  if (!passwordMatches) {
    const error = new Error("Invalid email or password.");
    error.name = "UNAUTHORIZED";
    throw error;
  }

  const sessionToken = randomBytes(32).toString("hex");

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: createSessionExpiry(),
    },
  });

  const workspace = await prisma.workspace.findFirst({
    where: {
      ownerId: user.id,
      type: "PERSONAL",
    },
  });

  return {
    sessionToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        }
      : null,
  };
}

const RESET_TOKEN_HOURS = 1;
const VERIFY_TOKEN_HOURS = 24;

export async function forgotPassword(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  // Always return success to prevent email enumeration
  if (!user) return { sent: true };

  const resetToken = randomBytes(32).toString("hex");
  const resetTokenExpiry = new Date(
    Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000,
  );

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken: hashToken(resetToken),
      resetTokenExpiry,
    },
  });

  // Send password reset email
  void sendPasswordResetEmail(user.email, resetToken);

  return { sent: true };
}

export async function resetPassword(input: {
  token: string;
  newPassword: string;
}) {
  const tokenHash = hashToken(input.token);

  const user = await prisma.user.findFirst({
    where: {
      resetToken: tokenHash,
      resetTokenExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    const error = new Error("Invalid or expired reset token.");
    error.name = "INVALID_TOKEN";
    throw error;
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetToken: null,
      resetTokenExpiry: null,
    },
  });

  // Invalidate all existing sessions for security
  await prisma.session.deleteMany({
    where: { userId: user.id },
  });

  return { success: true };
}

export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    const error = new Error("User not found.");
    error.name = "USER_NOT_FOUND";
    throw error;
  }

  const passwordMatches = await bcrypt.compare(
    input.currentPassword,
    user.passwordHash,
  );

  if (!passwordMatches) {
    const error = new Error("Current password is incorrect.");
    error.name = "UNAUTHORIZED";
    throw error;
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 12);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  return { success: true };
}

export async function requestEmailVerification(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    const error = new Error("User not found.");
    error.name = "USER_NOT_FOUND";
    throw error;
  }

  if (user.emailVerified) {
    return { alreadyVerified: true };
  }

  const verifyToken = randomBytes(32).toString("hex");
  const verifyTokenExpiry = new Date(
    Date.now() + VERIFY_TOKEN_HOURS * 60 * 60 * 1000,
  );

  await prisma.user.update({
    where: { id: userId },
    data: {
      verifyToken: hashToken(verifyToken),
      verifyTokenExpiry,
    },
  });

  // Send verification email
  void sendVerificationEmail(user.email, verifyToken);

  return { sent: true };
}

export async function verifyEmail(token: string) {
  const tokenHash = hashToken(token);

  const user = await prisma.user.findFirst({
    where: {
      verifyToken: tokenHash,
      verifyTokenExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    const error = new Error("Invalid or expired verification token.");
    error.name = "INVALID_TOKEN";
    throw error;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      verifyToken: null,
      verifyTokenExpiry: null,
    },
  });

  return { verified: true };
}
