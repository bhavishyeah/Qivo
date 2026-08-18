import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";
import express, {
  type ErrorRequestHandler,
  type Express,
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import { z } from "zod";

import prisma from "./db/prisma.js";
import { csrfProtection } from "./middleware/csrf.js";
import authRouter from "./modules/auth/auth.routes.js";
import formRouter from "./modules/forms/form.routes.js";
import folderRouter from "./modules/folders/folder.routes.js";
import memberRouter from "./modules/members/member.routes.js";
import approvalRouter from "./modules/approvals/approval.routes.js";
import notificationRouter from "./modules/notifications/notification.routes.js";
import auditRouter from "./modules/audit/audit.routes.js";
import workspaceRouter from "./modules/workspaces/workspace.routes.js";

const app: Express = express();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message:
        "Too many requests. Please try again later.",
    },
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: {
      code: "AUTH_RATE_LIMITED",
      message: "Too many authentication attempts.",
    },
  },
});

app.use(helmet());
app.use(compression());

app.use(
  cors({
    origin: process.env.WEB_URL || "http://localhost:5173",
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());
app.use(morgan("dev"));

app.use("/api", apiLimiter);
app.use("/api/auth", authLimiter);
app.use("/api", csrfProtection([
  process.env.WEB_URL || "http://localhost:5173",
]));

app.use("/api/forms", formRouter);
app.use("/api/folders", folderRouter);
app.use("/api/members", memberRouter);
app.use("/api/approvals", approvalRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/audit", auditRouter);
app.use("/api/auth", authRouter);
app.use("/api/workspaces", workspaceRouter);

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      service: "qivo-api",
      status: "ok",
    },
  });
});

app.get("/api/db-health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      success: true,
      data: {
        database: "connected",
      },
    });
  } catch (error) {
    console.error(
      "Database health check failed:",
      error,
    );

    res.status(500).json({
      success: false,
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection failed.",
      },
    });
  }
});

const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  _next,
) => {
  console.error(error);

  if (error instanceof z.ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request data.",
        details: error.flatten(),
      },
    });
    return;
  }

  if (!(error instanceof Error)) {
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong.",
      },
    });
    return;
  }

  switch (error.name) {
    case "CONFLICT":
      res.status(409).json({
        success: false,
        error: {
          code: "EMAIL_ALREADY_EXISTS",
          message: error.message,
        },
      });
      return;

    case "UNAUTHORIZED":
      res.status(401).json({
        success: false,
        error: {
          code: "INVALID_CREDENTIALS",
          message: error.message,
        },
      });
      return;

    case "UNAUTHENTICATED":
      res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: error.message,
        },
      });
      return;

    case "WORKSPACE_NOT_FOUND":
      res.status(404).json({
        success: false,
        error: {
          code: "WORKSPACE_NOT_FOUND",
          message: error.message,
        },
      });
      return;

    case "FORM_NOT_FOUND":
      res.status(404).json({
        success: false,
        error: {
          code: "FORM_NOT_FOUND",
          message: error.message,
        },
      });
      return;

    case "FORBIDDEN":
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: error.message,
        },
      });
      return;

    case "QUESTION_NOT_FOUND":
      res.status(404).json({
        success: false,
        error: {
          code: "QUESTION_NOT_FOUND",
          message: error.message,
        },
      });
      return;

    case "INVALID_QUESTION_ORDER":
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_QUESTION_ORDER",
          message: error.message,
        },
      });
      return;

    case "FORM_NOT_READY":
      res.status(400).json({
        success: false,
        error: {
          code: "FORM_NOT_READY",
          message: error.message,
        },
      });
      return;

    case "FORM_SCHEMA_INVALID":
      res.status(400).json({
        success: false,
        error: {
          code: "FORM_SCHEMA_INVALID",
          message: error.message,
        },
      });
      return;

    case "PUBLIC_FORM_NOT_FOUND":
      res.status(404).json({
        success: false,
        error: {
          code: "PUBLIC_FORM_NOT_FOUND",
          message: error.message,
        },
      });
      return;

    case "INVALID_RESPONSE":
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_RESPONSE",
          message: error.message,
        },
      });
      return;

    case "EMAIL_REQUIRED":
      res.status(400).json({
        success: false,
        error: {
          code: "EMAIL_REQUIRED",
          message: error.message,
        },
      });
      return;

    case "DUPLICATE_RESPONSE":
      res.status(400).json({
        success: false,
        error: {
          code: "DUPLICATE_RESPONSE",
          message: error.message,
        },
      });
      return;

    case "RESPONSE_NOT_FOUND":
      res.status(404).json({
        success: false,
        error: {
          code: "RESPONSE_NOT_FOUND",
          message: error.message,
        },
      });
      return;

    case "FOLDER_NOT_FOUND":
      res.status(404).json({
        success: false,
        error: {
          code: "FOLDER_NOT_FOUND",
          message: error.message,
        },
      });
      return;

    case "INVALID_FOLDER_PARENT":
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_FOLDER_PARENT",
          message: error.message,
        },
      });
      return;

    case "USER_NOT_FOUND":
      res.status(404).json({
        success: false,
        error: {
          code: "USER_NOT_FOUND",
          message: error.message,
        },
      });
      return;

    case "MEMBER_NOT_FOUND":
      res.status(404).json({
        success: false,
        error: {
          code: "MEMBER_NOT_FOUND",
          message: error.message,
        },
      });
      return;

    case "INVALID_REVIEWER":
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_REVIEWER",
          message: error.message,
        },
      });
      return;

    case "INVALID_TOKEN":
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: error.message,
        },
      });
      return;

    default:
      res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Something went wrong.",
        },
      });
      return;
  }
};

app.use(errorHandler);

export default app;