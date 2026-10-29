import {
  Router,
  type Router as ExpressRouter,
} from "express";

import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/auth.js";

import {
  createFormSchema,
  createQuestionSchema,
  createSectionSchema,
  updateSectionSchema,
  reorderQuestionsSchema,
  responseListQuerySchema,
  submitResponseSchema,
  editResponseSchema,
  updateFormSchema,
  updateQuestionSchema,
  updateFormSettingsSchema,
  saveAsTemplateSchema,
  reportQuerySchema,
  trackEventSchema,
  responseCheckSchema,
} from "./form.schemas.js";

import { TEMPLATES } from "./templates.js";

import {
  createWebhookSchema,
  updateWebhookSchema,
  deliveriesQuerySchema,
} from "../webhooks/webhook.schemas.js";

import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  regenerateSecret,
  deleteWebhook,
  listDeliveries,
} from "../webhooks/webhook.service.js";

import {
  closeForm,
  createForm,
  createQuestion,
  createSection,
  updateSection,
  deleteSection,
  deleteForm,
  deleteFormResponse,
  deleteQuestion,
  duplicateForm,
  getForm,
  getFormAnalytics,
  getFormResponse,
  getFormResponseCount,
  getFormReport,
  recordFormStart,
  getPublicForm,
  getUploadSignatureForForm,
  getWorkspaceStats,
  getFormVersion,
  restoreFormVersion,
  listFormResponses,
  listFormVersions,
  listForms,
  listQuestions,
  publishForm,
  reorderQuestions,
  submitFormResponse,
  editFormResponse,
  updateForm,
  updateQuestion,
  updateFormSettings,
  saveFormAsTemplate,
  listTemplatesForWorkspace,
  createFormFromCustomTemplate,
  deleteTemplate,
  isCustomTemplateId,
  stripCustomTemplatePrefix,
  createPaymentOrder,
  checkAlreadyResponded,
  handleRazorpayWebhook,
} from "./form.service.js";

const formRouter: ExpressRouter = Router();

// List available templates for a workspace: built-ins + the workspace's custom
// templates. Requires auth + a workspaceId. Kept FIRST (before GET /:formId) so
// the literal `templates` segment is never captured by the :formId param.
formRouter.get(
  "/templates",
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

      const workspaceId = req.query.workspaceId;
      if (typeof workspaceId !== "string" || workspaceId.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_WORKSPACE_ID", message: "A valid workspace ID is required." },
        });
        return;
      }

      const templates = await listTemplatesForWorkspace(workspaceId, req.user.id);

      res.json({ success: true, data: { templates } });
    } catch (error) {
      next(error);
    }
  },
);

// Delete a custom template. Registered BEFORE DELETE /:formId / GET /:formId so
// the literal `templates` segment isn't captured by the :formId param.
formRouter.delete(
  "/templates/:id",
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

      const id = req.params.id;
      if (typeof id !== "string" || id.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_TEMPLATE", message: "A valid template ID is required." },
        });
        return;
      }

      await deleteTemplate(id, req.user.id);

      res.json({ success: true, data: { message: "Template deleted." } });
    } catch (error) {
      next(error);
    }
  },
);

// Aggregate stats for a workspace's admin dashboard (single request, no N+1).
formRouter.get(
  "/workspace-stats",
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

      const workspaceId = req.query.workspaceId;
      if (typeof workspaceId !== "string" || workspaceId.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_WORKSPACE_ID", message: "A valid workspace ID is required." },
        });
        return;
      }

      const stats = await getWorkspaceStats(workspaceId, req.user.id);
      res.json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  },
);

// Create form from template
formRouter.post(
  "/from-template",
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

      const input = createFormSchema.parse(req.body);
      const templateId = req.body.templateId;

      if (typeof templateId !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_TEMPLATE", message: "templateId is required." },
        });
        return;
      }

      // Custom (workspace) template: create from the stored snapshot with fresh
      // ids. Authorization + workspace-scoped lookup live in the service.
      if (isCustomTemplateId(templateId)) {
        const form = await createFormFromCustomTemplate({
          templateId: stripCustomTemplatePrefix(templateId),
          workspaceId: input.workspaceId,
          ownerId: req.user.id,
          title: input.title,
          ...(input.description !== undefined ? { description: input.description } : {}),
        });

        res.status(201).json({
          success: true,
          data: { form },
        });
        return;
      }

      const template = TEMPLATES.find((t) => t.id === templateId);
      if (!template) {
        res.status(404).json({
          success: false,
          error: { code: "TEMPLATE_NOT_FOUND", message: "Template not found." },
        });
        return;
      }

      // Create the form
      const form = await createForm({
        workspaceId: input.workspaceId,
        ownerId: req.user.id,
        title: input.title,
        ...(input.description !== undefined ? { description: input.description } : {}),
      });

      // Add questions from template
      for (const q of template.questions) {
        await createQuestion(form.id, req.user.id, {
          label: q.label,
          type: q.type,
          required: q.required,
          ...(q.options ? { options: q.options } : {}),
          ...(q.settings ? { settings: q.settings } : {}),
        });
      }

      // Re-fetch the form to get updated schema
      const updatedForm = await getForm(form.id, req.user.id);

      res.status(201).json({
        success: true,
        data: { form: updatedForm },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.post(
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

      const input = createFormSchema.parse(req.body);

      const form = await createForm({
        workspaceId: input.workspaceId,
        ownerId: req.user.id,
        title: input.title,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      });

      res.status(201).json({
        success: true,
        data: { form },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.get(
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

      const workspaceId = req.query.workspaceId;

      if (typeof workspaceId !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_WORKSPACE_ID",
            message:
              "workspaceId query parameter is required.",
          },
        });
        return;
      }

      const forms = await listForms(
        workspaceId,
        req.user.id,
      );

      res.json({
        success: true,
        data: { forms },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.get(
  "/:formId/questions",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const questions = await listQuestions(
        formId,
        req.user.id,
      );

      res.json({
        success: true,
        data: { questions },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.post(
  "/:formId/questions",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const input = createQuestionSchema.parse(req.body);

      const result = await createQuestion(
        formId,
        req.user.id,
        {
          label: input.label,
          type: input.type,
          required: input.required,
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.options !== undefined
            ? { options: input.options }
            : {}),
          ...(input.settings !== undefined
            ? { settings: input.settings }
            : {}),
          ...(input.sectionId !== undefined
            ? { sectionId: input.sectionId }
            : {}),
        },
      );

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ─── Sections ───────────────────────────────────────────────────────────────

formRouter.post(
  "/:formId/sections",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const formId = req.params.formId;
      if (typeof formId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_FORM_ID", message: "A valid form ID is required." } });
        return;
      }
      const input = createSectionSchema.parse(req.body);
      const result = await createSection(formId, req.user.id, {
        ...(input.title !== undefined ? { title: input.title } : {}),
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.patch(
  "/:formId/sections/:sectionId",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const { formId, sectionId } = req.params;
      if (typeof formId !== "string" || typeof sectionId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_FORM_ID", message: "Valid form and section IDs are required." } });
        return;
      }
      const input = updateSectionSchema.parse(req.body);
      const form = await updateSection(formId, sectionId, req.user.id, {
        title: input.title,
        ...(input.jumpRules !== undefined ? { jumpRules: input.jumpRules } : {}),
      });
      res.json({ success: true, data: { form } });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.delete(
  "/:formId/sections/:sectionId",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const { formId, sectionId } = req.params;
      if (typeof formId !== "string" || typeof sectionId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_FORM_ID", message: "Valid form and section IDs are required." } });
        return;
      }
      const form = await deleteSection(formId, sectionId, req.user.id);
      res.json({ success: true, data: { form } });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.post(
  "/:formId/questions/reorder",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const input = reorderQuestionsSchema.parse(req.body);

      const form = await reorderQuestions(
        formId,
        req.user.id,
        input.questionIds,
      );

      res.json({
        success: true,
        data: { form },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.patch(
  "/:formId/questions/:questionId",
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

      const { formId, questionId } = req.params;

      if (
        typeof formId !== "string" ||
        typeof questionId !== "string"
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_QUESTION_ID",
            message:
              "Valid form and question IDs are required.",
          },
        });
        return;
      }

      const input = updateQuestionSchema.parse(req.body);

      const question = await updateQuestion(
        formId,
        questionId,
        req.user.id,
        {
          ...(input.label !== undefined
            ? { label: input.label }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.type !== undefined
            ? { type: input.type }
            : {}),
          ...(input.required !== undefined
            ? { required: input.required }
            : {}),
          ...(input.options !== undefined
            ? { options: input.options }
            : {}),
          ...(input.settings !== undefined
            ? { settings: input.settings }
            : {}),
          ...(input.conditions !== undefined
            ? { conditions: input.conditions }
            : {}),
        },
      );

      res.json({
        success: true,
        data: question,
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.delete(
  "/:formId/questions/:questionId",
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

      const { formId, questionId } = req.params;

      if (
        typeof formId !== "string" ||
        typeof questionId !== "string"
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_QUESTION_ID",
            message:
              "Valid form and question IDs are required.",
          },
        });
        return;
      }

      await deleteQuestion(
        formId,
        questionId,
        req.user.id,
      );

      res.json({
        success: true,
        data: {
          message: "Question deleted.",
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.post(
  "/:formId/publish",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const form = await publishForm(
        formId,
        req.user.id,
      );

      res.json({
        success: true,
        data: { form },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.post(
  "/:formId/close",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const form = await closeForm(formId, req.user.id);

      res.json({
        success: true,
        data: { form },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.post(
  "/:formId/duplicate",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const form = await duplicateForm(formId, req.user.id);

      res.status(201).json({
        success: true,
        data: { form },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Save a SNAPSHOT of the form's current schema as a workspace-scoped custom
// template. The `save-as-template` suffix doesn't collide with other :formId
// routes, so position is unconstrained; kept next to duplicate for cohesion.
formRouter.post(
  "/:formId/save-as-template",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const input = saveAsTemplateSchema.parse(req.body);

      const template = await saveFormAsTemplate(formId, req.user.id, {
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
      });

      res.status(201).json({
        success: true,
        data: { template },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.get(
  "/:formId/versions",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const versions = await listFormVersions(formId, req.user.id);

      res.json({
        success: true,
        data: { versions },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Preview a single version snapshot (full schema)
formRouter.get(
  "/:formId/versions/:versionNumber",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const { formId, versionNumber } = req.params;
      const parsedVersion = Number(versionNumber);
      if (typeof formId !== "string" || !Number.isInteger(parsedVersion)) {
        res.status(400).json({ success: false, error: { code: "INVALID_FORM_ID", message: "Valid form ID and version number are required." } });
        return;
      }
      const version = await getFormVersion(formId, parsedVersion, req.user.id);
      res.json({ success: true, data: { version } });
    } catch (error) {
      next(error);
    }
  },
);

// Restore a version snapshot onto the form as a new DRAFT
formRouter.post(
  "/:formId/versions/:versionNumber/restore",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const { formId, versionNumber } = req.params;
      const parsedVersion = Number(versionNumber);
      if (typeof formId !== "string" || !Number.isInteger(parsedVersion)) {
        res.status(400).json({ success: false, error: { code: "INVALID_FORM_ID", message: "Valid form ID and version number are required." } });
        return;
      }
      const form = await restoreFormVersion(formId, parsedVersion, req.user.id);
      res.json({ success: true, data: { form } });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.get(
  "/:formId/responses",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const input = responseListQuerySchema.parse(
        req.query,
      );

      const result = await listFormResponses(
        formId,
        req.user.id,
        {
          limit: input.limit,
          ...(input.cursor !== undefined
            ? { cursor: input.cursor }
            : {}),
        },
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.get(
  "/:formId/responses/:responseId",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const { formId, responseId } = req.params;
      if (typeof formId !== "string" || typeof responseId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_RESPONSE_ID", message: "Valid form and response IDs are required." } });
        return;
      }
      const response = await getFormResponse(formId, responseId, req.user.id);
      res.json({ success: true, data: { response } });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.delete(
  "/:formId/responses/:responseId",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const { formId, responseId } = req.params;
      if (typeof formId !== "string" || typeof responseId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_RESPONSE_ID", message: "Valid form and response IDs are required." } });
        return;
      }
      await deleteFormResponse(formId, responseId, req.user.id);
      res.json({ success: true, data: { message: "Response deleted." } });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.get(
  "/:formId/responses-count",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const formId = req.params.formId;
      if (typeof formId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_FORM_ID", message: "A valid form ID is required." } });
        return;
      }
      const count = await getFormResponseCount(formId, req.user.id);
      res.json({ success: true, data: { count } });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.get(
  "/:formId/analytics",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const formId = req.params.formId;
      if (typeof formId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_FORM_ID", message: "A valid form ID is required." } });
        return;
      }
      const analytics = await getFormAnalytics(formId, req.user.id);
      res.json({ success: true, data: analytics });
    } catch (error) {
      next(error);
    }
  },
);

// Server-side aggregated report (per-question breakdowns + analytics) so the
// client no longer fetches every response to aggregate in the browser.
formRouter.get(
  "/:formId/report",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const formId = req.params.formId;
      if (typeof formId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_FORM_ID", message: "A valid form ID is required." } });
        return;
      }

      const q = reportQuerySchema.parse(req.query);

      // Normalize `to` to end-of-UTC-day so inclusivity is a server guarantee:
      // a bookmarked/midnight/date-only `to` still includes that whole day
      // (design §2.1). `from` is used as-is.
      let toDate: Date | undefined;
      if (q.to) {
        toDate = new Date(q.to);
        toDate.setUTCHours(23, 59, 59, 999);
      }

      // Assemble the filter only when all required parts are present (Zod's
      // all-or-nothing refine already guarantees this when any part is set).
      const filter =
        q.filterQuestionId && q.filterOperator
          ? {
              questionId: q.filterQuestionId,
              operator: q.filterOperator,
              ...(q.filterValue !== undefined ? { value: q.filterValue } : {}),
            }
          : undefined;

      const report = await getFormReport(formId, req.user.id, {
        ...(q.from ? { from: new Date(q.from) } : {}),
        ...(toDate ? { to: toDate } : {}),
        ...(filter ? { filter } : {}),
      });
      res.json({ success: true, data: report });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.get(
  "/:formId",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const form = await getForm(
        formId,
        req.user.id,
      );

      res.json({
        success: true,
        data: { form },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.patch(
  "/:formId/settings",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const input = updateFormSettingsSchema.parse(
        req.body,
      );

      const form = await updateFormSettings(
        formId,
        req.user.id,
        input,
      );

      res.json({
        success: true,
        data: { form },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.patch(
  "/:formId",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      const input = updateFormSchema.parse(req.body);

      const form = await updateForm(
        formId,
        req.user.id,
        {
          ...(input.title !== undefined
            ? { title: input.title }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
        },
      );

      res.json({
        success: true,
        data: { form },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.delete(
  "/:formId",
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
          error: {
            code: "INVALID_FORM_ID",
            message: "A valid form ID is required.",
          },
        });
        return;
      }

      await deleteForm(
        formId,
        req.user.id,
      );

      res.json({
        success: true,
        data: {
          message: "Form moved to archive.",
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.get(
  "/public/:slug",
  async (req, res, next) => {
    try {
      const slug = req.params.slug;

      if (typeof slug !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_FORM_SLUG",
            message: "A valid form slug is required.",
          },
        });
        return;
      }

      const form = await getPublicForm(slug);

      res.json({
        success: true,
        data: { form },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Short-lived Cloudinary signature for direct browser file uploads on a public
// form. Public (respondents are anonymous) but scoped to a published form and
// covered by the public rate limiter.
formRouter.post(
  "/public/:slug/upload-signature",
  async (req, res, next) => {
    try {
      const slug = req.params.slug;
      if (typeof slug !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_FORM_SLUG", message: "A valid form slug is required." },
        });
        return;
      }
      const signature = await getUploadSignatureForForm(slug);
      // Never cache signatures (they are short-lived + per-request) and stop
      // any proxy/edge from caching this path's responses.
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.json({ success: true, data: signature });
    } catch (error) {
      next(error);
    }
  },
);

// Public start-event tracker. CSRF-exempt via the /public/ path convention and
// covered by publicFormLimiter. trackEventSchema accepts only event:"start",
// and recordFormStart hardcodes the written value, so this endpoint can never
// inject an arbitrary analytics event.
formRouter.post(
  "/public/:slug/track",
  async (req, res, next) => {
    try {
      const slug = req.params.slug;

      if (typeof slug !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_FORM_SLUG",
            message: "A valid form slug is required.",
          },
        });
        return;
      }

      trackEventSchema.parse(req.body);
      await recordFormStart(slug);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

// Create a Razorpay order for a payment-enabled form. Takes NO body: the amount
// is computed server-side from stored settings (never trusted from the client).
formRouter.post(
  "/public/:slug/payment/order",
  async (req, res, next) => {
    try {
      const slug = req.params.slug;
      if (typeof slug !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_FORM_SLUG", message: "A valid form slug is required." },
        });
        return;
      }
      const data = await createPaymentOrder(slug);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

// Pre-Checkout duplicate pre-check. Boolean-only; no response data leaked.
formRouter.post(
  "/public/:slug/response-check",
  async (req, res, next) => {
    try {
      const slug = req.params.slug;
      if (typeof slug !== "string") {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_FORM_SLUG", message: "A valid form slug is required." },
        });
        return;
      }
      const input = responseCheckSchema.parse(req.body);
      const data = await checkAlreadyResponded(slug, input.email);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

// Razorpay webhook (reconciliation). CSRF-exempt via /public/. Reads the raw
// body (captured by the global express.json verify hook) + the signature
// header. The handler throws WEBHOOK_SIGNATURE_INVALID for a bad/absent
// signature (mapped to 400 here); every other error is logged and 200'd so
// Razorpay stops retrying against a transient issue.
formRouter.post(
  "/public/razorpay/webhook",
  async (req, res) => {
    try {
      const signature = req.get("x-razorpay-signature") ?? "";
      await handleRazorpayWebhook(req.rawBody, signature, req.body);
      res.status(200).json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.name === "WEBHOOK_SIGNATURE_INVALID") {
        res.status(400).json({
          success: false,
          error: {
            code: "WEBHOOK_SIGNATURE_INVALID",
            message: "Invalid signature.",
          },
        });
        return;
      }
      console.error("[razorpay] webhook handling failed:", err);
      res.status(200).json({ success: true });
    }
  },
);

formRouter.post(
  "/public/:slug/responses",
  async (req, res, next) => {
    try {
      const slug = req.params.slug;

      if (typeof slug !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_FORM_SLUG",
            message: "A valid form slug is required.",
          },
        });
        return;
      }

      const input = submitResponseSchema.parse(req.body);

      const response = await submitFormResponse(
  slug,
  {
    answers: input.answers,
    ...(input.email !== undefined
      ? { email: input.email }
      : {}),
    ...(input.metadata !== undefined
      ? { metadata: input.metadata }
      : {}),
    ...(input.payment !== undefined
      ? { payment: input.payment }
      : {}),
  },
);

      res.status(201).json({
        success: true,
        data: {
          response: {
            id: response.id,
            submittedAt: response.submittedAt,
          },
          ...(response.quizScore ? { quizScore: response.quizScore } : {}),
          ...(response.editToken ? { editToken: response.editToken } : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.post(
  "/public/:slug/responses/:responseId/edit",
  async (req, res, next) => {
    try {
      const slug = req.params.slug;
      const responseId = req.params.responseId;

      if (typeof slug !== "string" || typeof responseId !== "string") {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_FORM_SLUG",
            message: "A valid form slug and response id are required.",
          },
        });
        return;
      }

      const input = editResponseSchema.parse(req.body);

      // The token is read from the validated body ONLY — never from a query
      // string or header — so it stays out of access/proxy logs and Referer.
      const result = await editFormResponse(
        slug,
        responseId,
        {
          answers: input.answers,
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        },
        input.editToken,
      );

      res.json({
        success: true,
        data: {
          response: {
            id: result.id,
            submittedAt: result.submittedAt,
          },
          ...(result.quizScore ? { quizScore: result.quizScore } : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ─── Webhooks ─────────────────────────────────────────────────────────────
// Registered AFTER the existing /:formId/... sub-resource routes. All webhook
// paths are parameterized under :formId (no new literal root segment), so they
// neither shadow nor are shadowed by the existing literal routes. Every handler
// authorizes editor-only via getEditableForm inside the service (a VIEWER gets
// FORM_NOT_FOUND → 404, same as the other editor sub-resources).

formRouter.get(
  "/:formId/webhooks",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const formId = req.params.formId;
      if (typeof formId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_FORM_ID", message: "A valid form ID is required." } });
        return;
      }
      const webhooks = await listWebhooks(formId, req.user.id);
      res.json({ success: true, data: { webhooks } });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.post(
  "/:formId/webhooks",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const formId = req.params.formId;
      if (typeof formId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_FORM_ID", message: "A valid form ID is required." } });
        return;
      }
      const input = createWebhookSchema.parse(req.body);
      const webhook = await createWebhook(formId, req.user.id, {
        url: input.url,
        ...(input.description !== undefined ? { description: input.description } : {}),
      });
      res.status(201).json({ success: true, data: { webhook } });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.patch(
  "/:formId/webhooks/:webhookId",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const { formId, webhookId } = req.params;
      if (typeof formId !== "string" || typeof webhookId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_WEBHOOK_ID", message: "Valid form and webhook IDs are required." } });
        return;
      }
      const input = updateWebhookSchema.parse(req.body);
      const webhook = await updateWebhook(formId, webhookId, req.user.id, { enabled: input.enabled });
      res.json({ success: true, data: { webhook } });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.post(
  "/:formId/webhooks/:webhookId/regenerate-secret",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const { formId, webhookId } = req.params;
      if (typeof formId !== "string" || typeof webhookId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_WEBHOOK_ID", message: "Valid form and webhook IDs are required." } });
        return;
      }
      const webhook = await regenerateSecret(formId, webhookId, req.user.id);
      res.json({ success: true, data: { webhook } });
    } catch (error) {
      next(error);
    }
  },
);

formRouter.delete(
  "/:formId/webhooks/:webhookId",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const { formId, webhookId } = req.params;
      if (typeof formId !== "string" || typeof webhookId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_WEBHOOK_ID", message: "Valid form and webhook IDs are required." } });
        return;
      }
      await deleteWebhook(formId, webhookId, req.user.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

formRouter.get(
  "/:formId/webhooks/:webhookId/deliveries",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      const { formId, webhookId } = req.params;
      if (typeof formId !== "string" || typeof webhookId !== "string") {
        res.status(400).json({ success: false, error: { code: "INVALID_WEBHOOK_ID", message: "Valid form and webhook IDs are required." } });
        return;
      }
      const query = deliveriesQuerySchema.parse(req.query);
      const deliveries = await listDeliveries(formId, webhookId, req.user.id, { limit: query.limit });
      res.json({ success: true, data: { deliveries } });
    } catch (error) {
      next(error);
    }
  },
);

export default formRouter;