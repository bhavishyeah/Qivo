import { Router, type Router as ExpressRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth.js";
import { inviteMemberSchema, updateMemberRoleSchema } from "./member.schemas.js";
import {
  inviteMember,
  leaveWorkspace,
  listMembers,
  removeMember,
  updateMemberRole,
} from "./member.service.js";

const memberRouter: ExpressRouter = Router();

// List members of a workspace
memberRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
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

    const members = await listMembers(workspaceId, req.user.id);

    res.json({
      success: true,
      data: {
        members: members.map((m) => ({
          id: m.id,
          role: m.role,
          joinedAt: m.joinedAt,
          user: m.user,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Invite member by email
memberRouter.post(
  "/invite",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication is required.",
          },
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

      const input = inviteMemberSchema.parse(req.body);

      const member = await inviteMember(workspaceId, req.user.id, {
        email: input.email,
        role: input.role,
      });

      res.status(201).json({
        success: true,
        data: {
          member: {
            id: member.id,
            role: member.role,
            joinedAt: member.joinedAt,
            user: member.user,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Update member role
memberRouter.patch(
  "/:memberId/role",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication is required.",
          },
        });
        return;
      }

      const workspaceId = req.query.workspaceId;
      const memberId = req.params.memberId;

      if (typeof workspaceId !== "string" || typeof memberId !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "workspaceId and memberId are required.",
          },
        });
        return;
      }

      const input = updateMemberRoleSchema.parse(req.body);

      const member = await updateMemberRole(
        workspaceId,
        memberId,
        req.user.id,
        input.role,
      );

      res.json({
        success: true,
        data: {
          member: {
            id: member.id,
            role: member.role,
            joinedAt: member.joinedAt,
            user: member.user,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Remove member
memberRouter.delete(
  "/:memberId",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication is required.",
          },
        });
        return;
      }

      const workspaceId = req.query.workspaceId;
      const memberId = req.params.memberId;

      if (typeof workspaceId !== "string" || typeof memberId !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "workspaceId and memberId are required.",
          },
        });
        return;
      }

      await removeMember(workspaceId, memberId, req.user.id);

      res.json({ success: true, data: { message: "Member removed." } });
    } catch (error) {
      next(error);
    }
  },
);

// Leave workspace
memberRouter.post(
  "/leave",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication is required.",
          },
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

      await leaveWorkspace(workspaceId, req.user.id);

      res.json({ success: true, data: { message: "You have left the workspace." } });
    } catch (error) {
      next(error);
    }
  },
);

export default memberRouter;
