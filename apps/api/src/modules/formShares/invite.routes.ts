import { Router, type Router as ExpressRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth.js";
import { acceptInvite, getInviteByToken } from "./formShare.service.js";

const inviteRouter: ExpressRouter = Router();

// Public: preview an invite by token. GET is a safe method, so csrfProtection
// lets it through with no change; no requireAuth so the invitee can see what
// they're accepting before (or without) logging in.
inviteRouter.get("/:token", async (req, res, next) => {
  try {
    const token = req.params.token;
    if (typeof token !== "string") {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_TOKEN", message: "An invite token is required." },
      });
      return;
    }

    const invite = await getInviteByToken(token);

    res.json({ success: true, data: { invite } });
  } catch (error) {
    next(error);
  }
});

// Accept an invite. Bearer-authenticated (csrfProtection exempts Bearer).
inviteRouter.post(
  "/:token/accept",
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

      const token = req.params.token;
      if (typeof token !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_TOKEN", message: "An invite token is required." },
        });
        return;
      }

      const result = await acceptInvite(token, req.user);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

export default inviteRouter;
