import { Router, type Router as ExpressRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth.js";
import { createShareSchema } from "./formShare.schemas.js";
import {
  createShare,
  listShares,
  listSharedWithMe,
  revokeShare,
} from "./formShare.service.js";

const formShareRouter: ExpressRouter = Router();

// List forms shared with the authenticated user. Declared FIRST so this literal
// route resolves before formRouter's parameterized GET /:formId.
formShareRouter.get(
  "/shared-with-me",
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

      const shares = await listSharedWithMe(req.user.id);

      res.json({ success: true, data: { shares } });
    } catch (error) {
      next(error);
    }
  },
);

// Create (invite) a share on a form
formShareRouter.post(
  "/:formId/shares",
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

      const formId = req.params.formId;
      if (typeof formId !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_FORM_ID", message: "formId is required." },
        });
        return;
      }

      const input = createShareSchema.parse(req.body);

      const share = await createShare(formId, req.user.id, {
        email: input.email,
        role: input.role,
      });

      res.status(201).json({ success: true, data: { share } });
    } catch (error) {
      next(error);
    }
  },
);

// List shares on a form
formShareRouter.get(
  "/:formId/shares",
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

      const formId = req.params.formId;
      if (typeof formId !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_FORM_ID", message: "formId is required." },
        });
        return;
      }

      const shares = await listShares(formId, req.user.id);

      res.json({ success: true, data: { shares } });
    } catch (error) {
      next(error);
    }
  },
);

// Revoke a share
formShareRouter.delete(
  "/:formId/shares/:shareId",
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

      const formId = req.params.formId;
      const shareId = req.params.shareId;
      if (typeof formId !== "string" || typeof shareId !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_REQUEST", message: "formId and shareId are required." },
        });
        return;
      }

      const result = await revokeShare(formId, shareId, req.user.id);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

export default formShareRouter;
