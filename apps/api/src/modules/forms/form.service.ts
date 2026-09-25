import { randomBytes } from "node:crypto";

import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../db/prisma.js";
import { logAction } from "../audit/audit.service.js";
import { notifyFormEvent } from "../notifications/notification.service.js";
import type {
  UpdateFormSettingsInput,
} from "./form.schemas.js";

type QuestionType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "EMAIL"
  | "NUMBER"
  | "DATE"
  | "SINGLE_CHOICE"
  | "MULTIPLE_CHOICE"
  | "RATING"
  | "YES_NO"
  | "PHONE"
  | "URL"
  | "FILE_UPLOAD"
  | "LINEAR_SCALE";

type FormQuestionOption = {
  value: string;
  label: string;
};

type FormQuestion = {
  id: string;
  label: string;
  description?: string | null;
  type: QuestionType;
  required: boolean;
  options?: FormQuestionOption[];
  settings?: Record<string, unknown>;
  conditions?: Array<{ questionId: string; operator: string; value?: string | undefined }>;
};

type FormSection = {
  id: string;
  title: string;
  questions: FormQuestion[];
};

type FormSchema = {
  version: number;
  sections: FormSection[];
  settings: {
    collectEmail: boolean;
    allowMultipleResponses: boolean;
    scheduledPublishAt?: string | null;
    scheduledCloseAt?: string | null;
    quizMode?: boolean;
    showScore?: boolean;
  };
  confirmationMessage?: string;
};

function toPrismaJson(
  value: FormSchema,
): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value),
  ) as Prisma.InputJsonValue;
}

function getFormSchema(value: unknown): FormSchema {
  const candidate = value as Partial<FormSchema> | null;

  return {
    version: candidate?.version ?? 1,
    sections: candidate?.sections ?? [],
    settings: {
      collectEmail:
        candidate?.settings?.collectEmail ?? false,
      allowMultipleResponses:
        candidate?.settings?.allowMultipleResponses ?? true,
      ...(candidate?.settings?.scheduledPublishAt !== undefined
        ? { scheduledPublishAt: candidate.settings.scheduledPublishAt }
        : {}),
      ...(candidate?.settings?.scheduledCloseAt !== undefined
        ? { scheduledCloseAt: candidate.settings.scheduledCloseAt }
        : {}),
      ...(candidate?.settings?.quizMode !== undefined
        ? { quizMode: candidate.settings.quizMode }
        : {}),
      ...(candidate?.settings?.showScore !== undefined
        ? { showScore: candidate.settings.showScore }
        : {}),
    },
    ...(candidate?.confirmationMessage !== undefined
      ? {
          confirmationMessage:
            candidate.confirmationMessage,
        }
      : {}),
  };
}

function createQuestionId(): string {
  return `question_${randomBytes(8).toString("hex")}`;
}

function createSectionId(): string {
  return `section_${randomBytes(8).toString("hex")}`;
}

function createFormSlug(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `${
    base || "form"
  }-${randomBytes(5).toString("hex")}`;
}

function formNotFoundError(
  message = "Form not found.",
) {
  const error = new Error(message);
  error.name = "FORM_NOT_FOUND";
  return error;
}

function forbiddenError(message: string) {
  const error = new Error(message);
  error.name = "FORBIDDEN";
  return error;
}

function questionNotFoundError() {
  const error = new Error("Question not found.");
  error.name = "QUESTION_NOT_FOUND";
  return error;
}

async function getMembership(
  workspaceId: string,
  userId: string,
) {
  return prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
  });
}

async function getEditableForm(
  formId: string,
  userId: string,
) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: {
        members: {
          some: {
            userId,
            role: {
              not: "VIEWER",
            },
          },
        },
      },
    },
  });

  if (!form) {
    throw formNotFoundError(
      "Form not found or not editable.",
    );
  }

  return form;
}

export async function createForm(input: {
  workspaceId: string;
  ownerId: string;
  title: string;
  description?: string | undefined;
}) {
  const membership = await getMembership(
    input.workspaceId,
    input.ownerId,
  );

  if (!membership) {
    const error = new Error("Workspace not found.");
    error.name = "WORKSPACE_NOT_FOUND";
    throw error;
  }

  if (membership.role === "VIEWER") {
    throw forbiddenError(
      "You do not have permission to create forms.",
    );
  }

  const form = await prisma.form.create({
    data: {
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      title: input.title.trim(),
      description:
        input.description?.trim() || null,
      slug: createFormSlug(input.title),
      status: "DRAFT",
      schema: {
        version: 1,
        sections: [],
        settings: {
          collectEmail: false,
          allowMultipleResponses: true,
        },
      },
    },
  });

  void logAction({
    workspaceId: input.workspaceId,
    userId: input.ownerId,
    action: "FORM_CREATED",
    entityType: "form",
    entityId: form.id,
    metadata: { title: form.title },
  }).catch((err) => console.error("logAction FORM_CREATED failed:", err));

  return form;
}

export async function listForms(
  workspaceId: string,
  userId: string,
) {
  const membership = await getMembership(
    workspaceId,
    userId,
  );

  if (!membership) {
    const error = new Error("Workspace not found.");
    error.name = "WORKSPACE_NOT_FOUND";
    throw error;
  }

  return prisma.form.findMany({
    where: {
      workspaceId,
      deletedAt: null,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

/**
 * Aggregate stats for a workspace's admin dashboard, computed server-side in a
 * handful of queries instead of one HTTP request per form (former N+1).
 */
export async function getWorkspaceStats(
  workspaceId: string,
  userId: string,
) {
  const membership = await getMembership(workspaceId, userId);

  if (!membership) {
    const error = new Error("Workspace not found.");
    error.name = "WORKSPACE_NOT_FOUND";
    throw error;
  }

  // Forms grouped by status (one query), member count, and recent forms.
  const [statusGroups, totalMembers, recentForms] = await Promise.all([
    prisma.form.groupBy({
      by: ["status"],
      where: { workspaceId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.workspaceMember.count({ where: { workspaceId } }),
    prisma.form.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, status: true, createdAt: true },
    }),
  ]);

  const countByStatus = new Map(
    statusGroups.map((g) => [g.status, g._count._all]),
  );
  const publishedForms = countByStatus.get("PUBLISHED") ?? 0;
  const draftForms = countByStatus.get("DRAFT") ?? 0;
  const totalForms = statusGroups.reduce((sum, g) => sum + g._count._all, 0);

  // Total responses across all non-deleted forms in the workspace — a single
  // count with a relational filter, not one count per form.
  const totalResponses = await prisma.formResponse.count({
    where: { form: { workspaceId, deletedAt: null } },
  });

  return {
    totalForms,
    publishedForms,
    draftForms,
    totalMembers,
    totalResponses,
    recentForms,
  };
}

export async function getForm(
  formId: string,
  userId: string,
) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: {
        members: {
          some: {
            userId,
          },
        },
      },
    },
  });

  if (!form) {
    throw formNotFoundError();
  }

  return form;
}

/**
 * Load a form for reading its RESPONSES/analytics. Submitted responses contain
 * respondent emails and answers, so a plain workspace membership is not enough
 * — VIEWERs must not see response data. Requires EDITOR/ADMIN/OWNER.
 */
async function getFormForResponseAccess(
  formId: string,
  userId: string,
) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: {
        members: {
          some: { userId, role: { not: "VIEWER" } },
        },
      },
    },
  });

  if (!form) {
    // Distinguish "not a member at all" (404) from "member but not allowed" (403).
    const isMember = await prisma.form.findFirst({
      where: {
        id: formId,
        deletedAt: null,
        workspace: { members: { some: { userId } } },
      },
      select: { id: true },
    });
    if (isMember) {
      throw forbiddenError("You do not have permission to view responses for this form.");
    }
    throw formNotFoundError();
  }

  return form;
}

export async function updateForm(
  formId: string,
  userId: string,
  input: {
    title?: string | undefined;
    description?: string | null | undefined;
  },
) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: {
        members: {
          some: {
            userId,
          },
        },
      },
    },
    include: {
      workspace: {
        include: {
          members: {
            where: {
              userId,
            },
          },
        },
      },
    },
  });

  if (!form) {
    throw formNotFoundError();
  }

  const membership = form.workspace.members[0];

  if (
    !membership ||
    membership.role === "VIEWER"
  ) {
    throw forbiddenError(
      "You do not have permission to edit this form.",
    );
  }

  return prisma.form.update({
    where: {
      id: formId,
    },
    data: {
      ...(input.title !== undefined
        ? {
            title: input.title.trim(),
          }
        : {}),
      ...(input.description !== undefined
        ? {
            description:
              input.description?.trim() || null,
          }
        : {}),
    },
  });
}

export async function updateFormSettings(
  formId: string,
  userId: string,
  input: UpdateFormSettingsInput,
) {
  const form = await getEditableForm(
    formId,
    userId,
  );

  const schema = getFormSchema(form.schema);

  const updatedSchema: FormSchema = {
    ...schema,
    settings: {
      ...schema.settings,
      ...(input.collectEmail !== undefined
        ? {
            collectEmail:
              input.collectEmail,
          }
        : {}),
      ...(input.allowMultipleResponses !==
      undefined
        ? {
            allowMultipleResponses:
              input.allowMultipleResponses,
          }
        : {}),
      ...(input.scheduledPublishAt !== undefined
        ? { scheduledPublishAt: input.scheduledPublishAt }
        : {}),
      ...(input.scheduledCloseAt !== undefined
        ? { scheduledCloseAt: input.scheduledCloseAt }
        : {}),
      ...(input.quizMode !== undefined
        ? { quizMode: input.quizMode }
        : {}),
      ...(input.showScore !== undefined
        ? { showScore: input.showScore }
        : {}),
    },
    ...(input.confirmationMessage !== undefined
      ? {
          confirmationMessage:
            input.confirmationMessage.trim(),
        }
      : {}),
  };

  return prisma.form.update({
    where: {
      id: formId,
    },
    data: {
      schema: toPrismaJson(updatedSchema),
    },
  });
}

export async function deleteForm(
  formId: string,
  userId: string,
) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: {
        members: {
          some: {
            userId,
          },
        },
      },
    },
    include: {
      workspace: {
        include: {
          members: {
            where: {
              userId,
            },
          },
        },
      },
    },
  });

  if (!form) {
    throw formNotFoundError();
  }

  const membership = form.workspace.members[0];

  if (
    !membership ||
    membership.role === "VIEWER"
  ) {
    throw forbiddenError(
      "You do not have permission to delete this form.",
    );
  }

  return prisma.form.update({
    where: {
      id: formId,
    },
    data: {
      deletedAt: new Date(),
      status: "ARCHIVED",
    },
  });
}

export async function listQuestions(
  formId: string,
  userId: string,
) {
  const form = await getForm(
    formId,
    userId,
  );

  const schema = getFormSchema(form.schema);

  return schema.sections.flatMap((section) =>
    section.questions.map((question, index) => ({
      ...question,
      sectionId: section.id,
      position: index,
    })),
  );
}

export async function createQuestion(
  formId: string,
  userId: string,
  input: {
    label: string;
    description?: string | undefined;
    type: QuestionType;
    required: boolean;
    options?:
      | FormQuestionOption[]
      | undefined;
    settings?:
      | Record<string, unknown>
      | undefined;
    sectionId?: string | undefined;
  },
) {
  const form = await getEditableForm(
    formId,
    userId,
  );

  const schema = getFormSchema(form.schema);

  if (schema.sections.length === 0) {
    schema.sections.push({
      id: createSectionId(),
      title: "Default section",
      questions: [],
    });
  }

  // Target the requested section, else the last section (so a question added
  // right after creating a new section lands in it), else the first.
  const targetSection = input.sectionId
    ? schema.sections.find((s) => s.id === input.sectionId)
    : schema.sections[schema.sections.length - 1];

  if (!targetSection) {
    const error = new Error(
      "Form has no section.",
    );
    error.name = "FORM_SCHEMA_INVALID";
    throw error;
  }

  const question: FormQuestion = {
    id: createQuestionId(),
    label: input.label.trim(),
    description:
      input.description?.trim() ?? null,
    type: input.type,
    required: input.required,
    ...(input.options !== undefined
      ? {
          options: input.options,
        }
      : {}),
    ...(input.settings !== undefined
      ? {
          settings: input.settings,
        }
      : {}),
  };

  targetSection.questions.push(question);

  const updatedForm = await prisma.form.update({
    where: {
      id: formId,
    },
    data: {
      schema: toPrismaJson(schema),
    },
  });

  return {
    form: updatedForm,
    question,
  };
}

export async function createSection(
  formId: string,
  userId: string,
  input: { title?: string | undefined },
) {
  const form = await getEditableForm(formId, userId);
  const schema = getFormSchema(form.schema);

  const section = {
    id: createSectionId(),
    title: input.title?.trim() || `Section ${schema.sections.length + 1}`,
    questions: [] as FormQuestion[],
  };
  schema.sections.push(section);

  const updatedForm = await prisma.form.update({
    where: { id: formId },
    data: { schema: toPrismaJson(schema) },
  });

  return { form: updatedForm, section };
}

export async function updateSection(
  formId: string,
  sectionId: string,
  userId: string,
  input: { title: string },
) {
  const form = await getEditableForm(formId, userId);
  const schema = getFormSchema(form.schema);

  const section = schema.sections.find((s) => s.id === sectionId);
  if (!section) {
    const error = new Error("Section not found.");
    error.name = "QUESTION_NOT_FOUND";
    throw error;
  }
  section.title = input.title.trim();

  return prisma.form.update({
    where: { id: formId },
    data: { schema: toPrismaJson(schema) },
  });
}

export async function deleteSection(
  formId: string,
  sectionId: string,
  userId: string,
) {
  const form = await getEditableForm(formId, userId);
  const schema = getFormSchema(form.schema);

  if (schema.sections.length <= 1) {
    const error = new Error("A form must keep at least one section.");
    error.name = "FORM_SCHEMA_INVALID";
    throw error;
  }

  const index = schema.sections.findIndex((s) => s.id === sectionId);
  if (index === -1) {
    const error = new Error("Section not found.");
    error.name = "QUESTION_NOT_FOUND";
    throw error;
  }

  // Move the removed section's questions into the previous (or next) section
  // rather than deleting them along with the section.
  const [removed] = schema.sections.splice(index, 1);
  const fallback = schema.sections[Math.max(0, index - 1)];
  if (removed && fallback) {
    fallback.questions.push(...removed.questions);
  }

  return prisma.form.update({
    where: { id: formId },
    data: { schema: toPrismaJson(schema) },
  });
}

export async function updateQuestion(
  formId: string,
  questionId: string,
  userId: string,
  input: {
    label?: string | undefined;
    description?:
      | string
      | null
      | undefined;
    type?: QuestionType | undefined;
    required?: boolean | undefined;
    options?:
      | FormQuestionOption[]
      | null
      | undefined;
    settings?:
      | Record<string, unknown>
      | undefined;
    conditions?:
      | Array<{ questionId: string; operator: string; value?: string | undefined }>
      | null
      | undefined;
  },
) {
  const form = await getEditableForm(
    formId,
    userId,
  );

  const schema = getFormSchema(form.schema);

  let found = false;

  for (const section of schema.sections) {
    const question = section.questions.find(
      (item) => item.id === questionId,
    );

    if (!question) {
      continue;
    }

    found = true;

    if (input.label !== undefined) {
      question.label = input.label.trim();
    }

    if (input.description !== undefined) {
      question.description =
        input.description?.trim() ?? null;
    }

    if (input.type !== undefined) {
      question.type = input.type;
    }

    if (input.required !== undefined) {
      question.required = input.required;
    }

    if (input.options !== undefined) {
      if (input.options === null) {
        delete question.options;
      } else {
        question.options = input.options;
      }
    }

    if (input.settings !== undefined) {
      question.settings = input.settings;
    }

    if (input.conditions !== undefined) {
      if (input.conditions === null) {
        delete question.conditions;
      } else {
        question.conditions = input.conditions;
      }
    }

    break;
  }

  if (!found) {
    throw questionNotFoundError();
  }

  const updatedForm = await prisma.form.update({
    where: {
      id: formId,
    },
    data: {
      schema: toPrismaJson(schema),
    },
  });

  const updatedQuestion = schema.sections
    .flatMap((section) => section.questions)
    .find(
      (question) => question.id === questionId,
    );

  return {
    form: updatedForm,
    question: updatedQuestion,
  };
}

export async function deleteQuestion(
  formId: string,
  questionId: string,
  userId: string,
) {
  const form = await getEditableForm(
    formId,
    userId,
  );

  const schema = getFormSchema(form.schema);

  let found = false;

  for (const section of schema.sections) {
    const originalLength =
      section.questions.length;

    section.questions = section.questions.filter(
      (question) => question.id !== questionId,
    );

    if (
      section.questions.length !==
      originalLength
    ) {
      found = true;
    }
  }

  if (!found) {
    throw questionNotFoundError();
  }

  return prisma.form.update({
    where: {
      id: formId,
    },
    data: {
      schema: toPrismaJson(schema),
    },
  });
}

export async function reorderQuestions(
  formId: string,
  userId: string,
  questionIds: string[],
) {
  const form = await getEditableForm(
    formId,
    userId,
  );

  const schema = getFormSchema(form.schema);

  // Map every question (across ALL sections) to the section it belongs to, so
  // reordering works for multi-section forms instead of only sections[0].
  const questionsById = new Map<string, FormQuestion>();
  for (const section of schema.sections) {
    for (const question of section.questions) {
      questionsById.set(question.id, question);
    }
  }

  const totalQuestions = questionsById.size;

  if (
    questionIds.length !== totalQuestions ||
    new Set(questionIds).size !== questionIds.length ||
    questionIds.some((id) => !questionsById.has(id))
  ) {
    const error = new Error(
      "questionIds must contain every question exactly once.",
    );
    error.name = "INVALID_QUESTION_ORDER";
    throw error;
  }

  // The desired global order comes from questionIds. Within each section, keep
  // that section's questions but reorder them by their index in questionIds.
  const globalOrder = new Map(questionIds.map((id, index) => [id, index]));
  for (const section of schema.sections) {
    section.questions.sort(
      (a, b) => (globalOrder.get(a.id) ?? 0) - (globalOrder.get(b.id) ?? 0),
    );
  }

  return prisma.form.update({
    where: {
      id: formId,
    },
    data: {
      schema: toPrismaJson(schema),
    },
  });
}

export async function publishForm(
  formId: string,
  userId: string,
) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: {
        members: {
          some: {
            userId,
          },
        },
      },
    },
    include: {
      workspace: {
        include: {
          members: {
            where: {
              userId,
            },
          },
        },
      },
    },
  });

  if (!form) {
    throw formNotFoundError();
  }

  const membership = form.workspace.members[0];

  if (
    !membership ||
    membership.role === "VIEWER"
  ) {
    throw forbiddenError(
      "You do not have permission to publish this form.",
    );
  }

  const schema = getFormSchema(form.schema);

  const questions = schema.sections.flatMap(
    (section) => section.questions,
  );

  if (questions.length === 0) {
    const error = new Error(
      "A form must contain at least one question before publishing.",
    );
    error.name = "FORM_NOT_READY";
    throw error;
  }

  // Snapshot the version and flip status to PUBLISHED atomically, so we can
  // never end up with an orphaned version row and a still-DRAFT form. The
  // version number is re-read inside the transaction to shrink the race window
  // between concurrent publishes.
  const { updatedForm, newVersion } = await prisma.$transaction(async (tx) => {
    const current = await tx.form.findUnique({
      where: { id: formId },
      select: { version: true },
    });
    const nextVersion = (current?.version ?? form.version) + 1;

    await tx.formVersion.create({
      data: {
        formId: form.id,
        versionNumber: nextVersion,
        schema: toPrismaJson(schema),
        title: form.title,
        description: form.description,
        createdBy: userId,
        publishedAt: new Date(),
      },
    });

    const updated = await tx.form.update({
      where: { id: formId },
      data: {
        status: "PUBLISHED",
        version: nextVersion,
      },
    });

    return { updatedForm: updated, newVersion: nextVersion };
  });

  void logAction({
    workspaceId: form.workspaceId,
    userId,
    action: "FORM_PUBLISHED",
    entityType: "form",
    entityId: form.id,
    metadata: { title: form.title, version: newVersion },
  }).catch((err) => console.error("logAction FORM_PUBLISHED failed:", err));

  // Notify workspace owners/admins that a form went live (the FORM_PUBLISHED
  // notification type existed but was never emitted). notifyFormEvent filters
  // out the actor, so the publisher won't notify themselves.
  void (async () => {
    const managers = await prisma.workspaceMember.findMany({
      where: {
        workspaceId: form.workspaceId,
        role: { in: ["OWNER", "ADMIN"] },
      },
      select: { userId: true },
    });
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    await notifyFormEvent({
      formId: form.id,
      formTitle: form.title,
      actorId: userId,
      actorName: actor?.name ?? "Someone",
      type: "FORM_PUBLISHED",
      targetUserIds: managers.map((m) => m.userId),
    });
  })().catch((err) => console.error("FORM_PUBLISHED notification failed:", err));

  return updatedForm;
}

export async function getPublicForm(
  slug: string,
) {
  // Match a published form, OR a not-yet-published one whose scheduled publish
  // time may have arrived (we confirm in JS since the time lives in the JSON
  // schema). This lazily enforces scheduledPublishAt without a cron job.
  let form = await prisma.form.findFirst({
    where: {
      slug,
      deletedAt: null,
      status: { in: ["PUBLISHED", "DRAFT", "APPROVED", "CHANGES_REQUESTED"] },
    },
    include: {
      workspace: {
        select: {
          name: true,
          logoUrl: true,
          primaryColor: true,
        },
      },
    },
  });

  if (form && form.status !== "PUBLISHED") {
    // Not published yet — only serve it if a scheduled publish time has passed.
    const scheduledAt = getFormSchema(form.schema).settings.scheduledPublishAt;
    const due = scheduledAt ? new Date(scheduledAt) <= new Date() : false;
    if (due) {
      // Publish it now (lazily) so it becomes and stays publicly available.
      await prisma.form.update({
        where: { id: form.id },
        data: { status: "PUBLISHED" },
      });
      form = { ...form, status: "PUBLISHED" };
    } else {
      form = null;
    }
  }

  if (!form) {
    const error = new Error(
      "Published form not found.",
    );
    error.name = "PUBLIC_FORM_NOT_FOUND";
    throw error;
  }

  // Track view (fire-and-forget; never let analytics failure break form load)
  void prisma.formAnalytics
    .create({ data: { formId: form.id, event: "view" } })
    .catch((err) => console.error("formAnalytics view tracking failed:", err));

  const schema = getFormSchema(form.schema);

  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    description: form.description,
    branding: {
      workspaceName: form.workspace.name,
      logoUrl: form.workspace.logoUrl,
      primaryColor: form.workspace.primaryColor,
    },
    schema: {
      version: schema.version,
      sections: schema.sections,
      settings: schema.settings,
      ...(schema.confirmationMessage !==
      undefined
        ? {
            confirmationMessage:
              schema.confirmationMessage,
          }
        : {}),
    },
  };
}

export async function submitFormResponse(
  slug: string,
  input: {
    answers: Record<string, unknown>;
    email?: string | undefined;
    metadata?:
      | Record<string, unknown>
      | undefined;
  },
  respondentId?: string,
) {
  const form = await prisma.form.findFirst({
    where: {
      slug,
      status: "PUBLISHED",
      deletedAt: null,
    },
  });

  if (!form) {
    const error = new Error(
      "Published form not found.",
    );
    error.name = "PUBLIC_FORM_NOT_FOUND";
    throw error;
  }

  const schema = getFormSchema(form.schema);

  // Check if form has been closed by schedule
  if (schema.settings.scheduledCloseAt) {
    const closeDate = new Date(schema.settings.scheduledCloseAt);
    if (closeDate <= new Date()) {
      const error = new Error("This form is no longer accepting responses.");
      error.name = "FORM_CLOSED";
      throw error;
    }
  }

  if (schema.settings.collectEmail) {
    if (!input.email?.trim()) {
      const error = new Error(
        "Email address is required.",
      );
      error.name = "EMAIL_REQUIRED";
      throw error;
    }
  }

  const questions = schema.sections.flatMap(
    (section) => section.questions,
  );

  const questionIds = new Set(
    questions.map((question) => question.id),
  );

  const answerIds = Object.keys(input.answers);

  const unknownQuestionId = answerIds.find(
    (questionId) =>
      !questionIds.has(questionId),
  );

  if (unknownQuestionId) {
    const error = new Error(
      `Unknown question ID: ${unknownQuestionId}`,
    );
    error.name = "INVALID_RESPONSE";
    throw error;
  }

  const missingRequiredQuestion =
    questions.find(
      (question) =>
        question.required &&
        (input.answers[question.id] ===
          undefined ||
          input.answers[question.id] === null ||
          input.answers[question.id] === ""),
    );

  if (missingRequiredQuestion) {
    const error = new Error(
      `Answer required for question: ${missingRequiredQuestion.label}`,
    );
    error.name = "INVALID_RESPONSE";
    throw error;
  }

const normalizedEmail = input.email
  ?.trim()
  .toLowerCase();

if (schema.settings.collectEmail) {
  if (!normalizedEmail) {
    const error = new Error(
      "Email address is required.",
    );
    error.name = "EMAIL_REQUIRED";
    throw error;
  }
}

if (
  !schema.settings.allowMultipleResponses &&
  normalizedEmail
) {
  // Fast pre-check against the indexed respondentEmail column for a friendly
  // error. The DB unique index (formId, respondentEmail) is the airtight guard
  // that also covers the concurrent-submission race (handled on create below).
  const existingResponse = await prisma.formResponse.findFirst({
    where: {
      formId: form.id,
      respondentEmail: normalizedEmail,
    },
    select: { id: true },
  });

  if (existingResponse) {
    const error = new Error(
      "You have already submitted a response.",
    );
    error.name = "DUPLICATE_RESPONSE";
    throw error;
  }
}

const responseMetadata: Record<
  string,
  unknown
> = {
  ...(input.metadata ?? {}),
  ...(normalizedEmail
    ? {
        email: normalizedEmail,
      }
    : {}),
};

// For single-response forms, set respondentEmail so the DB unique index
// (formId, respondentEmail) enforces one-per-email even under a race. Leave it
// null for multi-response/anonymous forms (NULLs don't collide in Postgres).
const respondentEmail =
  !schema.settings.allowMultipleResponses && normalizedEmail
    ? normalizedEmail
    : null;

let response;
try {
  response = await prisma.formResponse.create({
    data: {
      formId: form.id,
      ...(respondentId !== undefined ? { respondentId } : {}),
      respondentEmail,
      answers: input.answers as Prisma.InputJsonValue,
      metadata: responseMetadata as Prisma.InputJsonValue,
    },
  });
} catch (err) {
  // Unique violation on (formId, respondentEmail) → duplicate submission that
  // slipped past the pre-check due to a concurrent request.
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const error = new Error("You have already submitted a response.");
    error.name = "DUPLICATE_RESPONSE";
    throw error;
  }
  throw err;
}

// Track submission analytics + milestone notification (fire-and-forget, but
// with a .catch so a failure can't surface as an unhandled rejection).
void (async () => {
  await prisma.formAnalytics.create({ data: { formId: form.id, event: "submission" } });

  const MILESTONES = [10, 50, 100, 250, 500, 1000];
  const count = await prisma.formResponse.count({ where: { formId: form.id } });
  if (MILESTONES.includes(count)) {
    await notifyFormEvent({
      formId: form.id,
      formTitle: form.title,
      actorId: form.ownerId,
      actorName: "Qivo",
      type: "RESPONSE_MILESTONE",
      targetUserIds: [form.ownerId],
    });
  }
})().catch((err) => console.error("submission analytics/milestone failed:", err));

// Calculate quiz score if quiz mode is enabled
let quizScore: { earned: number; total: number; percentage: number } | null = null;
if (schema.settings.quizMode) {
  const questions = schema.sections.flatMap((s) => s.questions);
  let earned = 0;
  let total = 0;
  for (const q of questions) {
    if (q.settings?.correctAnswer !== undefined) {
      const points = (q.settings as any)?.points ?? 1;
      total += points;
      const userAnswer = String(input.answers[q.id] ?? "");
      if (userAnswer === q.settings.correctAnswer) {
        earned += points;
      }
    }
  }
  quizScore = { earned, total, percentage: total > 0 ? Math.round((earned / total) * 100) : 0 };
}

return { ...response, quizScore };
}

export async function listFormResponses(
  formId: string,
  userId: string,
  input: {
    limit: number;
    cursor?: string;
  },
) {
  const form = await getFormForResponseAccess(
    formId,
    userId,
  );

  const pageSize = input.limit + 1;

  const responses =
    await prisma.formResponse.findMany({
      where: {
        formId: form.id,
      },
      // id is a stable tiebreaker so cursor paging can't skip/repeat rows
      // that share the same submittedAt timestamp.
      orderBy: [
        { submittedAt: "desc" },
        { id: "desc" },
      ],
      take: pageSize,
      ...(input.cursor !== undefined
        ? {
            cursor: {
              id: input.cursor,
            },
            skip: 1,
          }
        : {}),
    });

  const hasMore =
    responses.length > input.limit;

  const items = hasMore
    ? responses.slice(0, input.limit)
    : responses;

  const nextCursor = hasMore
    ? items[items.length - 1]?.id ?? null
    : null;

  return {
    responses: items,
    nextCursor,
  };
}

export async function getFormResponse(
  formId: string,
  responseId: string,
  userId: string,
) {
  const form = await getFormForResponseAccess(
    formId,
    userId,
  );

  const response =
    await prisma.formResponse.findFirst({
      where: {
        id: responseId,
        formId: form.id,
      },
    });

  if (!response) {
    const error = new Error(
      "Response not found.",
    );
    error.name = "RESPONSE_NOT_FOUND";
    throw error;
  }

  return response;
}

export async function duplicateForm(
  formId: string,
  userId: string,
) {
  // Duplicating creates a new form the caller will own, so require edit rights
  // (a VIEWER must not be able to fork a form and become its owner).
  const form = await getEditableForm(formId, userId);

  const schema = getFormSchema(form.schema);

  return prisma.form.create({
    data: {
      workspaceId: form.workspaceId,
      ownerId: userId,
      title: `${form.title} (copy)`,
      description: form.description,
      slug: createFormSlug(form.title),
      status: "DRAFT",
      folderId: form.folderId,
      schema: toPrismaJson(schema),
    },
  });
}

export async function closeForm(
  formId: string,
  userId: string,
) {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      status: "PUBLISHED",
      workspace: {
        members: {
          some: { userId, role: { not: "VIEWER" } },
        },
      },
    },
  });

  if (!form) {
    throw formNotFoundError("Published form not found or not editable.");
  }

  const updatedForm = await prisma.form.update({
    where: { id: formId },
    data: { status: "CLOSED" },
  });

  void logAction({
    workspaceId: form.workspaceId,
    userId,
    action: "FORM_CLOSED",
    entityType: "form",
    entityId: form.id,
    metadata: { title: form.title },
  }).catch((err) => console.error("logAction FORM_CLOSED failed:", err));

  return updatedForm;
}

export async function listFormVersions(
  formId: string,
  userId: string,
) {
  const form = await getForm(formId, userId);

  return prisma.formVersion.findMany({
    where: { formId: form.id },
    orderBy: { versionNumber: "desc" },
    select: {
      id: true,
      versionNumber: true,
      title: true,
      createdBy: true,
      createdAt: true,
      publishedAt: true,
    },
  });
}

/** Fetch a single version snapshot (including its full schema) for preview. */
export async function getFormVersion(
  formId: string,
  versionNumber: number,
  userId: string,
) {
  const form = await getForm(formId, userId);

  const version = await prisma.formVersion.findFirst({
    where: { formId: form.id, versionNumber },
  });

  if (!version) {
    const error = new Error("Version not found.");
    error.name = "FORM_NOT_FOUND";
    throw error;
  }

  const schema = getFormSchema(version.schema);
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    title: version.title,
    description: version.description,
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
    schema,
  };
}

/**
 * Restore a past version: copy its schema/title/description back onto the form
 * as the current DRAFT so the user can review and re-publish. Does not itself
 * publish — it reverts the working copy.
 */
export async function restoreFormVersion(
  formId: string,
  versionNumber: number,
  userId: string,
) {
  const form = await getEditableForm(formId, userId);

  const version = await prisma.formVersion.findFirst({
    where: { formId: form.id, versionNumber },
  });

  if (!version) {
    const error = new Error("Version not found.");
    error.name = "FORM_NOT_FOUND";
    throw error;
  }

  const schema = getFormSchema(version.schema);

  const updated = await prisma.form.update({
    where: { id: form.id },
    data: {
      schema: toPrismaJson(schema),
      title: version.title,
      description: version.description,
      status: "DRAFT",
    },
  });

  void logAction({
    workspaceId: form.workspaceId,
    userId,
    action: "FORM_VERSION_RESTORED",
    entityType: "form",
    entityId: form.id,
    metadata: { title: version.title, restoredFrom: versionNumber },
  }).catch((err) => console.error("logAction FORM_VERSION_RESTORED failed:", err));

  return updated;
}

export async function deleteFormResponse(
  formId: string,
  responseId: string,
  userId: string,
) {
  // Only admins/owners/editors can delete responses
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: {
        members: {
          some: { userId, role: { not: "VIEWER" } },
        },
      },
    },
  });

  if (!form) {
    const error = new Error("Form not found.");
    error.name = "FORM_NOT_FOUND";
    throw error;
  }

  const response = await prisma.formResponse.findFirst({
    where: { id: responseId, formId },
  });

  if (!response) {
    const error = new Error("Response not found.");
    error.name = "RESPONSE_NOT_FOUND";
    throw error;
  }

  return prisma.formResponse.delete({ where: { id: responseId } });
}

export async function getFormResponseCount(
  formId: string,
  userId: string,
) {
  await getFormForResponseAccess(formId, userId);
  return prisma.formResponse.count({ where: { formId } });
}

export async function getFormAnalytics(
  formId: string,
  userId: string,
) {
  await getFormForResponseAccess(formId, userId);

  const [views, submissions] = await Promise.all([
    prisma.formAnalytics.count({ where: { formId, event: "view" } }),
    prisma.formAnalytics.count({ where: { formId, event: "submission" } }),
  ]);

  // Conversion rate
  const conversionRate = views > 0 ? Math.round((submissions / views) * 100) : 0;

  return { views, submissions, conversionRate };
}

// ─── Reports aggregation ────────────────────────────────────────────────────
//
// Server-side per-question aggregation for the reports page. Previously the
// client fetched every response (up to 5000 rows) and aggregated in the browser.
// This computes the same breakdowns on the server in a single DB read.

type ChoiceReport = {
  kind: "choice";
  options: Array<{ name: string; count: number; percentage: number }>;
};

type RatingReport = {
  kind: "rating";
  min: number;
  max: number;
  average: number | null;
  distribution: Array<{ rating: number; count: number }>;
};

type NumberReport = {
  kind: "number";
  average: number | null;
  min: number | null;
  max: number | null;
  sum: number;
};

type TextReport = {
  kind: "text";
  sample: string[]; // up to 20 non-empty answers
};

type QuestionReport = {
  questionId: string;
  label: string;
  type: QuestionType;
  answered: number;
  skipped: number;
} & (ChoiceReport | RatingReport | NumberReport | TextReport);

function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

export async function getFormReport(formId: string, userId: string) {
  const form = await getFormForResponseAccess(formId, userId);
  const schema = getFormSchema(form.schema);
  const questions = schema.sections.flatMap((s) => s.questions);

  // Single read of all responses for this form (answers only — no pagination
  // round trips). Ordered newest-first so text samples show recent answers.
  const [responses, views, submissions] = await Promise.all([
    prisma.formResponse.findMany({
      where: { formId: form.id },
      orderBy: { submittedAt: "desc" },
      select: { answers: true },
    }),
    prisma.formAnalytics.count({ where: { formId: form.id, event: "view" } }),
    prisma.formAnalytics.count({ where: { formId: form.id, event: "submission" } }),
  ]);

  const totalResponses = responses.length;

  const answerRows = responses.map(
    (r) => (r.answers ?? {}) as Record<string, unknown>,
  );

  const questionReports: QuestionReport[] = questions.map((question) => {
    const values = answerRows.map((row) => row[question.id]);
    const answers = values.filter(isAnswered);
    const answered = answers.length;
    const skipped = totalResponses - answered;

    const base = {
      questionId: question.id,
      label: question.label,
      type: question.type,
      answered,
      skipped,
    };

    if (
      question.type === "SINGLE_CHOICE" ||
      question.type === "MULTIPLE_CHOICE" ||
      question.type === "YES_NO"
    ) {
      const counts = new Map<string, number>();
      for (const answer of answers) {
        if (Array.isArray(answer)) {
          for (const item of answer) {
            const key = String(item);
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        } else {
          const key = String(answer);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const options = Array.from(counts.entries())
        .map(([name, count]) => ({
          name,
          count,
          percentage: answered > 0 ? Math.round((count / answered) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);
      return { ...base, kind: "choice", options };
    }

    if (question.type === "RATING" || question.type === "LINEAR_SCALE") {
      const min = Number(question.settings?.["min"] ?? 1);
      const max = Number(question.settings?.["max"] ?? 5);
      const counts = new Map<number, number>();
      for (let i = min; i <= max; i++) counts.set(i, 0);
      let sum = 0;
      let n = 0;
      for (const answer of answers) {
        const num = Number(answer);
        if (!Number.isNaN(num)) {
          counts.set(num, (counts.get(num) ?? 0) + 1);
          sum += num;
          n += 1;
        }
      }
      const distribution = Array.from(counts.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([rating, count]) => ({ rating, count }));
      return {
        ...base,
        kind: "rating",
        min,
        max,
        average: n > 0 ? Math.round((sum / n) * 10) / 10 : null,
        distribution,
      };
    }

    if (question.type === "NUMBER") {
      const numbers = answers
        .map(Number)
        .filter((n) => !Number.isNaN(n));
      const sum = numbers.reduce((a, b) => a + b, 0);
      return {
        ...base,
        kind: "number",
        average: numbers.length > 0 ? Math.round((sum / numbers.length) * 10) / 10 : null,
        min: numbers.length > 0 ? Math.min(...numbers) : null,
        max: numbers.length > 0 ? Math.max(...numbers) : null,
        sum,
      };
    }

    // Text-based (SHORT_TEXT, LONG_TEXT, EMAIL, DATE, PHONE, URL, FILE_UPLOAD)
    const sample = answers.slice(0, 20).map((a) => String(a));
    return { ...base, kind: "text", sample };
  });

  const conversionRate = views > 0 ? Math.round((submissions / views) * 100) : 0;

  // Daily views/submissions for the last 30 days (server-side group-by-day).
  const timeSeries = await getFormDailyTimeSeries(form.id, 30);

  return {
    totalResponses,
    analytics: { views, submissions, conversionRate },
    timeSeries,
    questions: questionReports,
  };
}

/**
 * Views and submissions grouped by calendar day for the last `days` days.
 * Returns a contiguous series (zero-filled days) so charts don't have gaps.
 */
export async function getFormDailyTimeSeries(formId: string, days: number) {
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; event: string; count: bigint }>
  >`
    SELECT date_trunc('day', "createdAt") AS day, "event", COUNT(*) AS count
    FROM "FormAnalytics"
    WHERE "formId" = ${formId}
      AND "createdAt" >= now() - (${days}::text || ' days')::interval
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;

  // Index counts by "YYYY-MM-DD" + event.
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const key = `${new Date(r.day).toISOString().slice(0, 10)}:${r.event}`;
    byKey.set(key, Number(r.count));
  }

  // Zero-fill each day in the window.
  const series: Array<{ date: string; views: number; submissions: number }> = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    series.push({
      date,
      views: byKey.get(`${date}:view`) ?? 0,
      submissions: byKey.get(`${date}:submission`) ?? 0,
    });
  }

  return series;
}
