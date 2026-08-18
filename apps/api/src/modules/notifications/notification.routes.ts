import { Router, type Router as ExpressRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth.js";
import {
  getUnreadCount,
  listNotifications,
  markAllAsRead,
  markAsRead,
} from "./notification.service.js";

const notificationRouter: ExpressRouter = Router();

// List notifications
notificationRouter.get(
  "/",
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

      const limit = Math.min(Number(req.query.limit) || 30, 100);
      const unreadOnly = req.query.unreadOnly === "true";

      const notifications = await listNotifications(req.user.id, {
        limit,
        unreadOnly,
      });

      res.json({ success: true, data: { notifications } });
    } catch (error) {
      next(error);
    }
  },
);

// Get unread count
notificationRouter.get(
  "/unread-count",
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

      const count = await getUnreadCount(req.user.id);

      res.json({ success: true, data: { count } });
    } catch (error) {
      next(error);
    }
  },
);

// Mark one as read
notificationRouter.patch(
  "/:notificationId/read",
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

      const notificationId = req.params.notificationId;
      if (typeof notificationId !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_ID", message: "A valid notification ID is required." },
        });
        return;
      }

      const notification = await markAsRead(notificationId, req.user.id);

      res.json({ success: true, data: { notification } });
    } catch (error) {
      next(error);
    }
  },
);

// Mark all as read
notificationRouter.post(
  "/mark-all-read",
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

      await markAllAsRead(req.user.id);

      res.json({ success: true, data: { message: "All notifications marked as read." } });
    } catch (error) {
      next(error);
    }
  },
);

export default notificationRouter;
