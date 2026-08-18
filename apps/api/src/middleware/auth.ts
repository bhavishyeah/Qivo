import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import prisma from "../db/prisma.js";

export type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    name: string;
    email: string;
  };
  sessionId?: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = req.cookies?.qivo_session;

    if (!token) {
      res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required.",
        },
      });
      return;
    }

    const session = await prisma.session.findUnique({
      where: {
        tokenHash: hashToken(token),
      },
      include: {
        user: true,
      },
    });

    if (!session || session.expiresAt <= new Date()) {
      res.status(401).json({
        success: false,
        error: {
          code: "SESSION_INVALID",
          message: "Your session is invalid or expired.",
        },
      });
      return;
    }

    req.user = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    };

    req.sessionId = session.id;

    next();
  } catch (error) {
    next(error);
  }
}