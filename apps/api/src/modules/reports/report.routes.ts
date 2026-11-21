import {
  Router,
  type NextFunction,
  type Response,
  type Router as ExpressRouter,
} from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth.js";
import { isPlatformAdminEmail } from "../../services/platformAdmin.js";
import {
  createReportSchema,
  listReportsQuerySchema,
  updateReportSchema,
} from "./report.schemas.js";
import { listReports, submitReport, updateReportStatus } from "./report.service.js";

export const REPORTS_PER_IP_PER_HOUR = 5;

/**
 * POST /api/public/forms/:slug/report. No auth. CSRF-exempt through the
 * "/public/" path convention in middleware/csrf.ts. Each router instance owns
 * its limiter, so tests can build a fresh one.
 */
export function createPublicReportRouter(
  limitPerHour: number = REPORTS_PER_IP_PER_HOUR,
): ExpressRouter {
  const router: ExpressRouter = Router();
  const limiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: limitPerHour,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many reports from your network. Please try again later.",
      },
    },
  });

  router.post("/forms/:slug/report", limiter, async (req, res, next) => {
    try {
      const slug = req.params.slug;
      if (typeof slug !== "string" || !slug) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_FORM_SLUG", message: "A valid form slug is required." },
        });
        return;
      }
      const input = createReportSchema.parse(req.body);
      // Honeypot: bots fill the hidden field. Answer exactly like a success so
      // they learn nothing, and store nothing.
      if (input.website) {
        res.status(201).json({ success: true, data: { received: true } });
        return;
      }
      await submitReport(slug, input, {
        ip: req.ip ?? "unknown",
        userAgent: req.get("User-Agent"),
      });
      res.status(201).json({ success: true, data: { received: true } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function requirePlatformAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (!req.user || !isPlatformAdminEmail(req.user.email)) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Platform admin access is required." },
    });
    return;
  }
  next();
}

export const adminReportRouter: ExpressRouter = Router();

adminReportRouter.get(
  "/reports",
  requireAuth,
  requirePlatformAdmin,
  async (req, res, next) => {
    try {
      const query = listReportsQuerySchema.parse(req.query);
      const data = await listReports(query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

adminReportRouter.patch(
  "/reports/:id",
  requireAuth,
  requirePlatformAdmin,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = req.params.id;
      if (typeof id !== "string" || !id || !req.user) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_REPORT_ID", message: "A valid report ID is required." },
        });
        return;
      }
      const { status } = updateReportSchema.parse(req.body);
      const report = await updateReportStatus(id, status, req.user.id);
      res.json({ success: true, data: { report } });
    } catch (error) {
      if (error instanceof Error && error.name === "REPORT_NOT_FOUND") {
        res.status(404).json({
          success: false,
          error: { code: "REPORT_NOT_FOUND", message: error.message },
        });
        return;
      }
      next(error);
    }
  },
);