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
  });

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

  const firstSection = schema.sections[0];

  if (!firstSection) {
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

  firstSection.questions.push(question);

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
      (question as any).conditions = input.conditions;
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
  const section = schema.sections[0];

  if (!section) {
    const error = new Error(
      "Form has no section.",
    );
    error.name = "QUESTION_NOT_FOUND";
    throw error;
  }

  const questionsById = new Map(
    section.questions.map((question) => [
      question.id,
      question,
    ]),
  );

  if (
    questionIds.length !==
      section.questions.length ||
    new Set(questionIds).size !==
      questionIds.length ||
    questionIds.some(
      (id) => !questionsById.has(id),
    )
  ) {
    const error = new Error(
      "questionIds must contain every question exactly once.",
    );
    error.name = "INVALID_QUESTION_ORDER";
    throw error;
  }

  section.questions = questionIds.map(
    (id) => questionsById.get(id)!,
  );

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

  // Create a version snapshot and increment version number
  const newVersion = form.version + 1;

  await prisma.formVersion.create({
    data: {
      formId: form.id,
      versionNumber: newVersion,
      schema: toPrismaJson(schema),
      title: form.title,
      description: form.description,
      createdBy: userId,
      publishedAt: new Date(),
    },
  });

  const updatedForm = await prisma.form.update({
    where: {
      id: formId,
    },
    data: {
      status: "PUBLISHED",
      version: newVersion,
    },
  });

  void logAction({
    workspaceId: form.workspaceId,
    userId,
    action: "FORM_PUBLISHED",
    entityType: "form",
    entityId: form.id,
    metadata: { title: form.title, version: newVersion },
  });

  return updatedForm;
}

export async function getPublicForm(
  slug: string,
) {
  const form = await prisma.form.findFirst({
    where: {
      slug,
      status: "PUBLISHED",
      deletedAt: null,
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

  if (!form) {
    const error = new Error(
      "Published form not found.",
    );
    error.name = "PUBLIC_FORM_NOT_FOUND";
    throw error;
  }

  // Track view (fire-and-forget)
  void prisma.formAnalytics.create({
    data: { formId: form.id, event: "view" },
  });

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

  if (
    !schema.settings.allowMultipleResponses &&
    input.email
  ) {
    const existingResponse =
      await prisma.formResponse.findFirst({
        where: {
          formId: form.id,
          metadata: {
            path: ["email"],
            equals: input.email.trim().toLowerCase(),
          },
        },
      });

    if (existingResponse) {
      const error = new Error(
        "You have already submitted a response.",
      );
      error.name = "DUPLICATE_RESPONSE";
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
  const existingResponses =
    await prisma.formResponse.findMany({
      where: {
        formId: form.id,
      },
      select: {
        metadata: true,
      },
    });

  const hasDuplicate = existingResponses.some(
    (response) => {
      const metadata = response.metadata;

      if (
        !metadata ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      ) {
        return false;
      }

      const storedEmail = (
        metadata as {
          email?: unknown;
        }
      ).email;

      return (
        typeof storedEmail === "string" &&
        storedEmail.toLowerCase() ===
          normalizedEmail
      );
    },
  );

  if (hasDuplicate) {
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

const response = await prisma.formResponse.create({
  data: {
    formId: form.id,
    ...(respondentId !== undefined
      ? { respondentId }
      : {}),
    answers:
      input.answers as Prisma.InputJsonValue,
    metadata:
      responseMetadata as Prisma.InputJsonValue,
  },
});

// Check for response milestones and notify form owner
void (async () => {
  // Track submission
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
})();

return response;
}

export async function listFormResponses(
  formId: string,
  userId: string,
  input: {
    limit: number;
    cursor?: string;
  },
) {
  const form = await getForm(
    formId,
    userId,
  );

  const pageSize = input.limit + 1;

  const responses =
    await prisma.formResponse.findMany({
      where: {
        formId: form.id,
      },
      orderBy: {
        submittedAt: "desc",
      },
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
  const form = await getForm(
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
  const form = await getForm(formId, userId);

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
  });

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
  await getForm(formId, userId);
  return prisma.formResponse.count({ where: { formId } });
}

export async function getFormAnalytics(
  formId: string,
  userId: string,
) {
  await getForm(formId, userId);

  const [views, submissions] = await Promise.all([
    prisma.formAnalytics.count({ where: { formId, event: "view" } }),
    prisma.formAnalytics.count({ where: { formId, event: "submission" } }),
  ]);

  // Conversion rate
  const conversionRate = views > 0 ? Math.round((submissions / views) * 100) : 0;

  return { views, submissions, conversionRate };
}