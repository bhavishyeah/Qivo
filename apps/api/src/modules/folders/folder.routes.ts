import { Router, type Router as ExpressRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth.js";
import {
  createFolderSchema,
  updateFolderSchema,
  moveFormToFolderSchema,
} from "./folder.schemas.js";
import {
  createFolder,
  deleteFolder,
  listFolders,
  moveFormToFolder,
  updateFolder,
} from "./folder.service.js";

const folderRouter: ExpressRouter = Router();

// List folders for a workspace
folderRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
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

    const folders = await listFolders(workspaceId, req.user.id);

    res.json({ success: true, data: { folders } });
  } catch (error) {
    next(error);
  }
});

// Create folder
folderRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
      });
      return;
    }

    const input = createFolderSchema.parse(req.body);

    const folder = await createFolder({
      workspaceId: input.workspaceId,
      userId: req.user.id,
      name: input.name,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    });

    res.status(201).json({ success: true, data: { folder } });
  } catch (error) {
    next(error);
  }
});

// Update folder
folderRouter.patch(
  "/:folderId",
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

      const folderId = req.params.folderId;
      if (typeof folderId !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_FOLDER_ID", message: "A valid folder ID is required." },
        });
        return;
      }

      const input = updateFolderSchema.parse(req.body);

      const folder = await updateFolder(folderId, req.user.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      });

      res.json({ success: true, data: { folder } });
    } catch (error) {
      next(error);
    }
  },
);

// Delete folder
folderRouter.delete(
  "/:folderId",
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

      const folderId = req.params.folderId;
      if (typeof folderId !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_FOLDER_ID", message: "A valid folder ID is required." },
        });
        return;
      }

      await deleteFolder(folderId, req.user.id);

      res.json({ success: true, data: { message: "Folder deleted." } });
    } catch (error) {
      next(error);
    }
  },
);

// Move form into folder
folderRouter.patch(
  "/move-form/:formId",
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

      const formId = req.params.formId;
      if (typeof formId !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_FORM_ID", message: "A valid form ID is required." },
        });
        return;
      }

      const input = moveFormToFolderSchema.parse(req.body);

      const form = await moveFormToFolder(formId, req.user.id, input.folderId);

      res.json({ success: true, data: { form } });
    } catch (error) {
      next(error);
    }
  },
);

export default folderRouter;
