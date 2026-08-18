import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/auth.js";
import { getClearCookieOptions, getSessionCookieOptions } from "../../config/cookie.js";
import {
  changePassword,
  forgotPassword,
  login,
  logout,
  requestEmailVerification,
  resetPassword,
  signup,
  verifyEmail,
} from "./auth.service.js";
const authRouter: ExpressRouter = Router();

const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

authRouter.post(
  "/logout",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (req.sessionId) {
        await logout(req.sessionId);
      }

      res.clearCookie("qivo_session", getClearCookieOptions());

      res.json({
        success: true,
        data: {
          message: "Logged out successfully.",
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post("/signup", async (req, res, next) => {
  try {
    const input = signupSchema.parse(req.body);
    const result = await signup(input);

    res.cookie("qivo_session", result.sessionToken, getSessionCookieOptions());

    res.status(201).json({
      success: true,
      data: {
        user: result.user,
        workspace: result.workspace,
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await login(input);

    res.cookie("qivo_session", result.sessionToken, getSessionCookieOptions());

    res.json({
      success: true,
      data: {
        user: result.user,
        workspace: result.workspace,
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get(
  "/me",
  requireAuth,
  (req: AuthenticatedRequest, res) => {
    res.json({
      success: true,
      data: {
        user: req.user,
        sessionId: req.sessionId,
      },
    });
  },
);

// Forgot password
authRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const input = z.object({ email: z.string().trim().email() }).parse(req.body);
    await forgotPassword(input.email);

    // Always return success to prevent email enumeration
    res.json({
      success: true,
      data: { message: "If an account exists, a reset link has been sent." },
    });
  } catch (error) {
    next(error);
  }
});

// Reset password with token
authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const input = z
      .object({
        token: z.string().min(1),
        newPassword: z.string().min(8).max(128),
      })
      .parse(req.body);

    await resetPassword(input);

    res.json({
      success: true,
      data: { message: "Password has been reset. Please log in." },
    });
  } catch (error) {
    next(error);
  }
});

// Change password (authenticated)
authRouter.post(
  "/change-password",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
        });
        return;
      }

      const input = z
        .object({
          currentPassword: z.string().min(1),
          newPassword: z.string().min(8).max(128),
        })
        .parse(req.body);

      await changePassword(req.user.id, input);

      res.json({
        success: true,
        data: { message: "Password changed successfully." },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Request email verification
authRouter.post(
  "/request-verification",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
        });
        return;
      }

      const result = await requestEmailVerification(req.user.id);

      res.json({
        success: true,
        data: result.alreadyVerified
          ? { message: "Email is already verified." }
          : { message: "Verification email sent." },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Verify email with token
authRouter.post("/verify-email", async (req, res, next) => {
  try {
    const input = z.object({ token: z.string().min(1) }).parse(req.body);

    await verifyEmail(input.token);

    res.json({
      success: true,
      data: { message: "Email verified successfully." },
    });
  } catch (error) {
    next(error);
  }
});

export default authRouter;