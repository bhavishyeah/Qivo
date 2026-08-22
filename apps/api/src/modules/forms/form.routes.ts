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
  reorderQuestionsSchema,
  responseListQuerySchema,
  submitResponseSchema,
  updateFormSchema,
  updateQuestionSchema,
  updateFormSettingsSchema,
} from "./form.schemas.js";

import { TEMPLATES } from "./templates.js";

import {
  closeForm,
  createForm,
  createQuestion,
  deleteForm,
  deleteFormResponse,
  deleteQuestion,
  duplicateForm,
  getForm,
  getFormAnalytics,
  getFormResponse,
  getFormResponseCount,
  getPublicForm,
  listFormResponses,
  listFormVersions,
  listForms,
  listQuestions,
  publishForm,
  reorderQuestions,
  submitFormResponse,
  updateForm,
  updateQuestion,
  updateFormSettings,
} from "./form.service.js";

const formRouter: ExpressRouter = Router();

// List available templates (no auth required for browsing)
formRouter.get("/templates", (_req, res) => {
  res.json({
    success: true,
    data: {
      templates: TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        questionCount: t.questions.length,
      })),
    },
  });
});

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
          type: q.type as any,
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
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default formRouter;