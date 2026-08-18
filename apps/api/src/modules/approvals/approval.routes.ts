import { Router, type Router as ExpressRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth.js";
import { submitForReviewSchema, reviewDecisionSchema } from "./approval.schemas.js";
import { submitForReview, reviewForm } from "./approval.service.js";

const approvalRouter: ExpressRouter = Router();

// Submit form for review
approvalRouter.post(
  "/:formId/submit-for-review",
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
          error: { code: "INVALID_FORM_ID", message: "A valid form ID is required." },
        });
        return;
      }

      const input = submitForReviewSchema.parse(req.body);

      const form = await submitForReview(formId, req.user.id, {
        reviewerId: input.reviewerId,
        ...(input.message !== undefined ? { message: input.message } : {}),
      });

      res.json({ success: true, data: { form } });
    } catch (error) {
      next(error);
    }
  },
);

// Review a form (approve / request changes / reject)
approvalRouter.post(
  "/:formId/review",
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
          error: { code: "INVALID_FORM_ID", message: "A valid form ID is required." },
        });
        return;
      }

      const input = reviewDecisionSchema.parse(req.body);

      const form = await reviewForm(formId, req.user.id, {
        decision: input.decision,
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      });

      res.json({ success: true, data: { form } });
    } catch (error) {
      next(error);
    }
  },
);

export default approvalRouter;
