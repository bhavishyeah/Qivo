import { Router, type Router as ExpressRouter } from "express";

import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/auth.js";
import prisma from "../../db/prisma.js";
import { createWorkspaceSchema } from "./workspace.schemas.js";
import { createWorkspace } from "./workspace.service.js";

const workspaceRouter: ExpressRouter = Router();

workspaceRouter.get(
  "/",
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

      const memberships = await prisma.workspaceMember.findMany({
        where: {
          userId: req.user.id,
        },
        include: {
          workspace: true,
        },
        orderBy: {
          joinedAt: "asc",
        },
      });

      res.json({
        success: true,
        data: {
          workspaces: memberships.map(({ role, workspace }) => ({
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
            type: workspace.type,
            role,
            createdAt: workspace.createdAt,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

workspaceRouter.post(
  "/",
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

      const input = createWorkspaceSchema.parse(req.body);

      const workspace = await createWorkspace({
        name: input.name,
        ownerId: req.user.id,
      });

      res.status(201).json({
        success: true,
        data: {
          workspace: {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
            type: workspace.type,
            role: "OWNER",
            createdAt: workspace.createdAt,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

workspaceRouter.get(
  "/:workspaceId",
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

      const workspaceId = req.params.workspaceId;

      if (typeof workspaceId !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_WORKSPACE_ID",
            message: "A valid workspace ID is required.",
          },
        });
        return;
      }

      const membership = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: req.user.id,
          },
        },
        include: {
          workspace: true,
        },
      });

      if (!membership) {
        res.status(404).json({
          success: false,
          error: {
            code: "WORKSPACE_NOT_FOUND",
            message: "Workspace not found.",
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          workspace: {
            id: membership.workspace.id,
            name: membership.workspace.name,
            slug: membership.workspace.slug,
            type: membership.workspace.type,
            role: membership.role,
            createdAt: membership.workspace.createdAt,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default workspaceRouter;