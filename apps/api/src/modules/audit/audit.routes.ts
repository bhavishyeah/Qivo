import { Router, type Router as ExpressRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth.js";
import { listAuditLogs } from "./audit.service.js";

const auditRouter: ExpressRouter = Router();

auditRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
      });
      return;
    }

    const workspaceId = req.query.workspaceId;
    if (typeof workspaceId !== "string") {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_WORKSPACE_ID",
          message: "workspaceId query parameter is required.",
        },
      });
      return;
    }

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const result = await listAuditLogs(workspaceId, req.user.id, { limit, offset });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default auditRouter;
