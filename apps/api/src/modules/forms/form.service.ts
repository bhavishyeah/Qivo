import { randomBytes } from "node:crypto";

import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../db/prisma.js";
import { logAction } from "../audit/audit.service.js";
import { notifyFormEvent } from "../notifications/notification.service.js";
import { signUpload, type CloudinarySignature } from "../../services/cloudinary.js";
import {
  signEditToken,
  verifyEditToken,
} from "../../services/responseEditToken.js";
import {
  sendNewResponseNotificationEmail,
  sendResponseConfirmationEmail,
  sendResponseDigestEmail,
} from "../../services/email.js";
import {
  hasEditorShare,
  hasResponseViewShare,
} from "../formShares/formShare.access.js";
import { TEMPLATES } from "./templates.js";
import type {
  UpdateFormSettingsInput,
} from "./form.schemas.js";

export type QuestionType =
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
  | "SIGNATURE"
  | "LINEAR_SCALE"
  | "MULTI_ENTRY";

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

type SectionJumpRule = {
  questionId: string;
  operator: "equals" | "not_equals" | "contains" | "not_empty";
  value?: string | undefined;
  target: string;
};

type FormSection = {
  id: string;
  title: string;
  questions: FormQuestion[];
  jumpRules?: SectionJumpRule[];
};

// Sentinel target meaning "end the form / go to submit". Mirrors the web copy
// (JUMP_TARGET_SUBMIT in apps/web/src/types). Never collides with a real id
// because createSectionId() always emits `section_<hex>`.
const JUMP_TARGET_SUBMIT = "__submit__";

/**
 * A single navigation step: move to the section at `index`, or submit (end).
 */
export type JumpStep = { kind: "section"; index: number } | { kind: "submit" };

/**
 * Single step of the jump replay: given the index of the section just
 * completed and the answers, return the next section to show or "submit". First
 * matching rule wins; malformed targets (unknown id, self, backward) fall
 * through to the linear next section. Byte-identical in behavior to the web
 * copy in apps/web/src/lib/sectionJumps.ts; inlines the operator evaluation the
 * way isQuestionVisibleFor already does.
 */
export function nextSectionAfter(
  sections: FormSection[],
  currentIndex: number,
  answers: Record<string, unknown>,
): JumpStep {
  const section = sections[currentIndex];
  const rules = section?.jumpRules ?? [];

  for (const rule of rules) {
    if (!matchesJumpRule(rule, answers)) continue;
    if (rule.target === JUMP_TARGET_SUBMIT) return { kind: "submit" };
    const targetIndex = sections.findIndex((s) => s.id === rule.target);
    if (targetIndex > currentIndex) return { kind: "section", index: targetIndex };
    // else: malformed/backward/self — fall through to the next rule.
  }

  const next = currentIndex + 1;
  if (next >= sections.length) return { kind: "submit" };
  return { kind: "section", index: next };
}

/**
 * Evaluate a single jump rule against answers. Mirrors evaluateConditions with a
 * one-element array — the exact operator semantics used by isQuestionVisibleFor.
 */
function matchesJumpRule(
  rule: SectionJumpRule,
  answers: Record<string, unknown>,
): boolean {
  return matchesAnswerFilter(answers[rule.questionId], rule.operator, rule.value);
}

export type AnswerFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_empty";

/**
 * Evaluate a single answer against an operator/value. This is the array-aware
 * operator engine shared verbatim by section jumps, visibility conditions, and
 * the report cross-question filter: for an array answer `equals` means
 * array-contains (not exact-set), `not_equals` array-excludes, `contains`
 * some-element substring, `not_empty` length>0; for a scalar they are
 * string-equality / substring (case-insensitive) / non-empty. Keeping one copy
 * guarantees the three callers never drift.
 */
export function matchesAnswerFilter(
  answer: unknown,
  operator: AnswerFilterOperator,
  value: string | undefined,
): boolean {
  const answerIsArray = Array.isArray(answer);
  switch (operator) {
    case "equals":
      return answerIsArray
        ? (answer as unknown[]).includes(value ?? "")
        : String(answer ?? "") === (value ?? "");
    case "not_equals":
      return answerIsArray
        ? !(answer as unknown[]).includes(value ?? "")
        : String(answer ?? "") !== (value ?? "");
    case "contains":
      return answerIsArray
        ? (answer as string[]).some((a) => a.includes(value ?? ""))
        : String(answer ?? "")
            .toLowerCase()
            .includes((value ?? "").toLowerCase());
    case "not_empty":
      return answerIsArray
        ? (answer as unknown[]).length > 0
        : answer !== undefined && answer !== null && answer !== "";
    default:
      return true;
  }
}

/**
 * Full replay: walk from section 0 following nextSectionAfter until submit,
 * collecting every reached section id. Pure, terminating, loop-free (forward
 * targets strictly increase the index). This is the authoritative source of
 * truth for which sections' required questions to enforce — never trust a
 * client-supplied reached list.
 */
export function computeReachedSections(
  sections: FormSection[],
  answers: Record<string, unknown>,
): Set<string> {
  const reached = new Set<string>();
  if (sections.length === 0) return reached;

  let index = 0;
  const seenIndexes = new Set<number>();
  while (index >= 0 && index < sections.length) {
    if (seenIndexes.has(index)) break; // impossible with forward-only, but safe.
    seenIndexes.add(index);
    const section = sections[index];
    if (section) reached.add(section.id);

    const step = nextSectionAfter(sections, index, answers);
    if (step.kind === "submit") break;
    index = step.index;
  }
  return reached;
}

type FormTheme = {
  coverImageUrl?: string;
  accentColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
};

// Zod infers theme fields as `string | undefined`, which can't assign to
// FormTheme under exactOptionalPropertyTypes. Rebuild via conditional-spread so
// only defined fields are present (an absent field clears, matching the
// whole-object replace semantics).
function normalizeTheme(theme: {
  coverImageUrl?: string | undefined;
  accentColor?: string | undefined;
  backgroundColor?: string | undefined;
  fontFamily?: string | undefined;
}): FormTheme {
  return {
    ...(theme.coverImageUrl !== undefined
      ? { coverImageUrl: theme.coverImageUrl }
      : {}),
    ...(theme.accentColor !== undefined
      ? { accentColor: theme.accentColor }
      : {}),
    ...(theme.backgroundColor !== undefined
      ? { backgroundColor: theme.backgroundColor }
      : {}),
    ...(theme.fontFamily !== undefined
      ? { fontFamily: theme.fontFamily }
      : {}),
  };
}

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
    responseNotification?: "off" | "immediate" | "daily";
    sendConfirmationEmail?: boolean;
    theme?: FormTheme;
    responseEditing?: "disabled" | "timed" | "until_close";
    responseEditMinutes?: number;
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
      responseNotification:
        candidate?.settings?.responseNotification ?? "off",
      sendConfirmationEmail:
        candidate?.settings?.sendConfirmationEmail ?? false,
      ...(candidate?.settings?.theme !== undefined
        ? { theme: candidate.settings.theme }
        : {}),
      responseEditing:
        candidate?.settings?.responseEditing ?? "disabled",
      responseEditMinutes:
        candidate?.settings?.responseEditMinutes ?? 15,
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

function templateNotFoundError(message = "Template not found.") {
  const error = new Error(message);
  error.name = "TEMPLATE_NOT_FOUND";
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
  // 1) existing workspace path — UNCHANGED
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

  if (form) return form;

  // 2) NEW fallback: per-form EDITOR share grants edit access to this one form.
  if (await hasEditorShare(formId, userId)) {
    const shared = await prisma.form.findFirst({
      where: { id: formId, deletedAt: null },
    });
    if (shared) return shared;
  }

  throw formNotFoundError(
    "Form not found or not editable.",
  );
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
  // 1) existing workspace path — UNCHANGED (any member may read the definition)
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

  if (form) return form;

  // 2) NEW fallback: an EDITOR/VIEWER share may load the form document.
  //    RESPONDER may NOT (that is why this is hasResponseViewShare, not
  //    getAcceptedShareRole !== null — RESPONDER reaches the form via /f/<slug>).
  if (await hasResponseViewShare(formId, userId)) {
    const shared = await prisma.form.findFirst({
      where: { id: formId, deletedAt: null },
    });
    if (shared) return shared;
  }

  throw formNotFoundError();
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
    // NEW fallback: an ACCEPTED EDITOR/VIEWER share may read this form's
    // responses. Runs before the 404-vs-403 disambiguation so a share grantee
    // is never wrongly rejected.
    if (await hasResponseViewShare(formId, userId)) {
      const shared = await prisma.form.findFirst({
        where: { id: formId, deletedAt: null },
      });
      if (shared) return shared;
    }

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
  // 1) workspace path: a NON-VIEWER member (the VIEWER -> FORBIDDEN check is
  //    folded into the query, so a VIEWER no longer matches here and instead
  //    falls through to the share fallback below).
  let form = await prisma.form.findFirst({
    where: {
      id: formId,
      deletedAt: null,
      workspace: {
        members: {
          some: {
            userId,
            role: { not: "VIEWER" },
          },
        },
      },
    },
  });

  // 2) NEW fallback: per-form EDITOR share. Runs for BOTH the non-member case
  //    (external HOD/principal) AND the VIEWER-member case — both leave `form`
  //    null above.
  if (!form && (await hasEditorShare(formId, userId))) {
    form = await prisma.form.findFirst({
      where: { id: formId, deletedAt: null },
    });
  }

  if (!form) {
    throw formNotFoundError();
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
      ...(input.responseNotification !== undefined
        ? { responseNotification: input.responseNotification }
        : {}),
      ...(input.sendConfirmationEmail !== undefined
        ? { sendConfirmationEmail: input.sendConfirmationEmail }
        : {}),
      ...(input.theme !== undefined
        ? { theme: normalizeTheme(input.theme) }
        : {}),
      ...(input.responseEditing !== undefined
        ? { responseEditing: input.responseEditing }
        : {}),
      ...(input.responseEditMinutes !== undefined
        ? { responseEditMinutes: input.responseEditMinutes }
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
  input: { title: string; jumpRules?: SectionJumpRule[] },
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

  if (input.jumpRules !== undefined) {
    // Mirror how updateQuestion handles conditions: store a non-empty array,
    // delete the key when empty so a cleared ruleset round-trips as absent.
    if (input.jumpRules.length > 0) {
      section.jumpRules = input.jumpRules;
    } else {
      delete section.jumpRules;
    }
  }

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
  // Only PUBLISHED forms are ever publicly reachable. Fetching DRAFT/APPROVED/
  // CHANGES_REQUESTED forms here would leak unpublished form structure to anyone
  // who guesses a slug, so we scope strictly to PUBLISHED.
  //
  // Scheduled publishing (scheduledPublishAt) is handled by publishDueForms(),
  // which runs on a timer — NOT lazily on this read path. Mutating form state
  // inside an unauthenticated GET is both an HTTP-semantics violation and a way
  // for an anonymous visitor to trigger a permanent publish, so we don't do it.
  const form = await prisma.form.findFirst({
    where: {
      slug,
      deletedAt: null,
      status: "PUBLISHED",
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

  // Track view (fire-and-forget; never let analytics failure break form load)
  void prisma.formAnalytics
    .create({ data: { formId: form.id, event: "view" } })
    .catch((err) => console.error("formAnalytics view tracking failed:", err));

  const schema = getFormSchema(form.schema);

  // Strip owner-only settings (email engagement toggles) from the public
  // payload so anonymous respondents never see them. Mirrors stripAnswerKeys'
  // destructure-and-`void` pattern for intentional omission.
  const { responseNotification, sendConfirmationEmail, ...publicSettings } =
    schema.settings;
  void responseNotification;
  void sendConfirmationEmail;

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
      // Strip answer-key fields (correctAnswer/points) from every question so
      // quiz respondents can't read the answers out of the public payload.
      sections: stripAnswerKeys(schema.sections),
      settings: publicSettings,
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

/**
 * Validate a single submitted answer against its question definition. Returns a
 * human-readable problem string if invalid, or null if the answer is acceptable.
 * Called server-side on submit so a crafted request can't bypass the UI's
 * checks. Assumes the value is non-empty (empties are filtered by the caller).
 */
const MAX_TEXT_LEN = 10_000;

// ─── FILE_UPLOAD / SIGNATURE url enforcement (M1 hardening) ───────────────────
// Every FILE_UPLOAD/SIGNATURE answer is a Cloudinary `secure_url` delivery URL,
// served from the default secure delivery host below. We host-match with the
// built-in URL parser's `.hostname` (never a regex over the raw string), so
// bypass tricks like `res.cloudinary.com.evil.com` or userinfo
// (`https://res.cloudinary.com@evil.com/…`) are correctly rejected.
const CLOUDINARY_DELIVERY_HOSTS = new Set(["res.cloudinary.com"]);

// Pinned MIME → allowed-extension map covering the builder's allow-list
// vocabulary (MIME_TO_EXT / MIME_FRIENDLY in PublicFormPage.tsx) plus the
// browser-compression reality that FILE_UPLOAD images are re-encoded to .jpg.
// The `image/*` wildcard's extension list is identical to isImageUrl's imageExts
// in apps/web/src/lib/upload.ts so server and client agree on "what is an image".
const MIME_EXTENSIONS: Record<string, string[]> = {
  "image/*": ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"],
  "application/pdf": ["pdf"],
  // Office — OpenXML
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  // Office — legacy binary
  "application/msword": ["doc"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.ms-powerpoint": ["ppt"],
};

// Extensions treated as a valid signature image (strict subset of image/*).
const SIGNATURE_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);

/**
 * Validate a FILE_UPLOAD/SIGNATURE answer URL. Returns a user-facing error
 * message, or null when the value is acceptable. Pure (no DB/IO) so it is unit
 * tested directly. The host check is the security floor and always runs; the
 * type check is best-effort tightening on top (an unknown/extensionless URL
 * passes the type check once the host check succeeds).
 */
export function isAllowedUploadUrl(
  value: unknown,
  opts: { kind: "file" | "signature"; allowedTypes: string[] },
): string | null {
  if (typeof value !== "string") return "expected a file URL";

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "expected a file URL";
  }

  if (url.protocol !== "https:") return "expected a file URL";
  if (!CLOUDINARY_DELIVERY_HOSTS.has(url.hostname)) {
    return "file must be uploaded to this form";
  }

  // Extension from the pathname's last segment only (never query/fragment).
  const lastSeg = url.pathname.split("/").pop() ?? "";
  const dot = lastSeg.lastIndexOf(".");
  const ext = dot > 0 ? lastSeg.slice(dot + 1).toLowerCase() : "";

  if (opts.kind === "signature") {
    // SIGNATURE is never subject to allowedTypes; it is implicitly an image.
    if (ext !== "" && !SIGNATURE_EXTENSIONS.has(ext)) {
      return "signature must be an image";
    }
    return null;
  }

  // kind === "file": only restrict when an allow-list is configured.
  if (opts.allowedTypes.length === 0) return null;

  const allowedExts = new Set<string>();
  for (const mime of opts.allowedTypes) {
    const exts = MIME_EXTENSIONS[mime];
    if (exts) for (const e of exts) allowedExts.add(e);
  }

  // Unknown (extensionless) → accept via fallback; known-but-not-allowed → reject.
  if (ext !== "" && !allowedExts.has(ext)) return "file type not allowed";
  return null;
}

function validateAnswerAgainstQuestion(
  question: FormQuestion,
  value: unknown,
): string | null {
  const isString = typeof value === "string";
  const isArray = Array.isArray(value);

  // Cap any string (and each array member) to guard against giant blobs even
  // within the 1MB body limit.
  if (isString && value.length > MAX_TEXT_LEN) {
    return "answer is too long";
  }
  if (isArray) {
    for (const item of value) {
      if (typeof item !== "string") return "invalid selection";
      if (item.length > MAX_TEXT_LEN) return "answer is too long";
    }
  }

  const allowedOptionValues = new Set(
    (question.options ?? []).map((o) => o.value),
  );

  switch (question.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
    case "PHONE":
      if (!isString) return "expected text";
      return null;

    case "EMAIL":
      if (!isString) return "expected text";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "invalid email";
      return null;

    case "URL":
      if (!isString) return "expected text";
      try {
        new URL(value);
        return null;
      } catch {
        return "invalid URL";
      }

    case "NUMBER":
    case "RATING":
    case "LINEAR_SCALE": {
      const num = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(num)) return "expected a number";
      return null;
    }

    case "DATE":
      if (!isString || Number.isNaN(new Date(value).getTime())) {
        return "invalid date";
      }
      return null;

    case "YES_NO":
      if (value !== "yes" && value !== "no" && typeof value !== "boolean") {
        return "expected yes or no";
      }
      return null;

    case "SINGLE_CHOICE":
      if (!isString) return "expected a single selection";
      if (allowedOptionValues.size > 0 && !allowedOptionValues.has(value)) {
        return "selection is not an available option";
      }
      return null;

    case "MULTIPLE_CHOICE": {
      const selections = isArray ? value : [value];
      if (allowedOptionValues.size > 0) {
        for (const sel of selections) {
          if (typeof sel !== "string" || !allowedOptionValues.has(sel)) {
            return "selection is not an available option";
          }
        }
      }
      return null;
    }

    case "FILE_UPLOAD": {
      // Answer is the delivered Cloudinary file URL. Enforce host + (when an
      // allow-list is configured) file type server-side; the client accept/size
      // checks are UX-only and not trusted.
      const allowedTypes = Array.isArray(question.settings?.allowedFileTypes)
        ? (question.settings!.allowedFileTypes as unknown[]).filter(
            (t): t is string => typeof t === "string",
          )
        : [];
      return isAllowedUploadUrl(value, { kind: "file", allowedTypes });
    }

    case "SIGNATURE":
      // Answer is the delivered Cloudinary signature image URL. Host-checked and
      // constrained to an image type; never subject to allowedFileTypes.
      return isAllowedUploadUrl(value, { kind: "signature", allowedTypes: [] });

    case "MULTI_ENTRY":
      if (!isArray) return "expected an array of text entries";
      for (const item of value) {
        if (typeof item !== "string") return "expected an array of text entries";
        if (item.trim() === "") return "entries must not be blank";
        if (item.length > MAX_TEXT_LEN) return "answer is too long";
      }
      return null;

    default:
      return null;
  }
}

/**
 * Compare a submitted answer against a question's stored correct answer for quiz
 * scoring. Handles both single-value answers (SHORT_TEXT/SINGLE_CHOICE/etc.) and
 * multiple-choice array answers. For arrays, the response is correct only if the
 * selected set exactly matches the correct set (order-independent). The stored
 * correctAnswer may be a single value or a comma-separated list for multi-select.
 */
function isAnswerCorrect(userAnswer: unknown, correctAnswer: unknown): boolean {
  const correctSet = new Set(
    String(correctAnswer)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  if (Array.isArray(userAnswer)) {
    const userSet = new Set(
      userAnswer.map((v) => String(v).trim()).filter(Boolean),
    );
    if (userSet.size !== correctSet.size) return false;
    for (const v of userSet) {
      if (!correctSet.has(v)) return false;
    }
    return true;
  }

  // Single-value answer: correct if it matches the (single) correct value, or is
  // the sole member of a one-item correct set.
  const user = String(userAnswer ?? "").trim();
  return correctSet.size === 1 && correctSet.has(user);
}

/**
 * Evaluate a question's conditional-visibility rules against a set of answers.
 * Mirrors the evaluateConditions logic from the frontend so hidden questions are
 * never flagged as missing.
 */
function isQuestionVisibleFor(
  question: FormQuestion,
  answers: Record<string, unknown>,
): boolean {
  const conditions = question.conditions;
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((rule) => {
    const answer = answers[rule.questionId];
    const answerIsArray = Array.isArray(answer);
    switch (rule.operator) {
      case "equals":
        return answerIsArray
          ? (answer as unknown[]).includes(rule.value ?? "")
          : String(answer ?? "") === (rule.value ?? "");
      case "not_equals":
        return answerIsArray
          ? !(answer as unknown[]).includes(rule.value ?? "")
          : String(answer ?? "") !== (rule.value ?? "");
      case "contains":
        return answerIsArray
          ? (answer as string[]).some((a) => a.includes(rule.value ?? ""))
          : String(answer ?? "")
              .toLowerCase()
              .includes((rule.value ?? "").toLowerCase());
      case "not_empty":
        return answerIsArray
          ? (answer as unknown[]).length > 0
          : answer !== undefined && answer !== null && answer !== "";
      default:
        return true;
    }
  });
}

/**
 * Shared answer-validation gate run byte-identically by submit and edit. It
 * contains ONLY the three answer rules — unknown-question rejection, the
 * visibility-aware required check (incl. the MULTI_ENTRY empty-array
 * special-case), and the per-answer validateAnswerAgainstQuestion loop. It does
 * NOT check email-required or duplicates: those are submit-only concerns
 * (identity + email are fixed at first submit). Throws INVALID_RESPONSE on the
 * first problem.
 */
export function validateSubmission(
  schema: FormSchema,
  answers: Record<string, unknown>,
): void {
  const questions = schema.sections.flatMap(
    (section) => section.questions,
  );

  const questionIds = new Set(questions.map((question) => question.id));

  const unknownQuestionId = Object.keys(answers).find(
    (questionId) => !questionIds.has(questionId),
  );

  if (unknownQuestionId) {
    const error = new Error(`Unknown question ID: ${unknownQuestionId}`);
    error.name = "INVALID_RESPONSE";
    throw error;
  }

  // Recompute reached sections server-side. Never trust the client. A required
  // question is only enforced when its section was reached by the jump replay
  // AND the question is visible by its own per-question conditions.
  const reached = computeReachedSections(schema.sections, answers);

  let missingRequiredQuestion: FormQuestion | undefined;
  for (const section of schema.sections) {
    if (!reached.has(section.id)) continue; // skipped section: don't enforce.
    for (const question of section.questions) {
      if (!question.required) continue;
      if (!isQuestionVisibleFor(question, answers)) continue;
      const answer = answers[question.id];
      const isMissing =
        question.type === "MULTI_ENTRY"
          ? !Array.isArray(answer) ||
            (answer as unknown[]).every(
              (v) => v === "" || v === null || v === undefined,
            )
          : answer === undefined || answer === null || answer === "";
      if (isMissing) {
        missingRequiredQuestion = question;
        break;
      }
    }
    if (missingRequiredQuestion) break;
  }

  if (missingRequiredQuestion) {
    const error = new Error(
      `Answer required for question: ${missingRequiredQuestion.label}`,
    );
    error.name = "INVALID_RESPONSE";
    throw error;
  }

  for (const question of questions) {
    const value = answers[question.id];
    if (value === undefined || value === null || value === "") continue;
    const problem = validateAnswerAgainstQuestion(question, value);
    if (problem) {
      const error = new Error(
        `Invalid answer for "${question.label}": ${problem}`,
      );
      error.name = "INVALID_RESPONSE";
      throw error;
    }
  }
}

/**
 * Compute a quiz score from answers using the same rules as submit. Returns null
 * when the form is not in quiz mode. Shared by submit + edit so a corrected quiz
 * answer yields the correct on-screen score.
 */
function computeQuizScore(
  schema: FormSchema,
  answers: Record<string, unknown>,
): { earned: number; total: number; percentage: number } | null {
  if (!schema.settings.quizMode) return null;

  const scoringQuestions = schema.sections.flatMap((s) => s.questions);
  let earned = 0;
  let total = 0;
  for (const q of scoringQuestions) {
    const correct = q.settings?.correctAnswer;
    if (correct === undefined) continue;

    const rawPoints = (q.settings as { points?: unknown } | undefined)?.points;
    const points = typeof rawPoints === "number" ? rawPoints : 1;
    total += points;

    if (isAnswerCorrect(answers[q.id], correct)) {
      earned += points;
    }
  }
  return {
    earned,
    total,
    percentage: total > 0 ? Math.round((earned / total) * 100) : 0,
  };
}

/**
 * Remove quiz answer-key fields from question settings before sending a form to
 * public respondents. `correctAnswer` and `points` are needed only server-side
 * (for scoring in submitFormResponse) and must never reach the client.
 */
function stripAnswerKeys(sections: FormSection[]): FormSection[] {
  return sections.map((section) => ({
    ...section,
    questions: section.questions.map((q) => {
      if (!q.settings) return q;
      const { correctAnswer, points, ...safeSettings } = q.settings as Record<
        string,
        unknown
      >;
      // Reference the extracted fields so the linter knows they're intentionally
      // dropped (they carry the answer key).
      void correctAnswer;
      void points;
      return { ...q, settings: safeSettings };
    }),
  }));
}

/**
 * HTML-escape a respondent-supplied string so it can't break or inject markup
 * into the confirmation email body.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build a defensive `label: value` list from a form's questions and a submitted
 * answers record, for the respondent confirmation email. Tolerant by design —
 * never throws; awkward or empty answers are simply omitted. Every value is
 * HTML-escaped so it is safe to interpolate into the email HTML.
 */
function buildConfirmationAnswerList(
  questions: FormQuestion[],
  answers: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const list: Array<{ label: string; value: string }> = [];

  for (const question of questions) {
    const raw = answers[question.id];
    if (raw === undefined || raw === null || raw === "") continue;

    let rendered: string | null = null;

    if (Array.isArray(raw)) {
      const parts = raw
        .map((item) => (item == null ? "" : String(item).trim()))
        .filter((item) => item !== "");
      rendered = parts.length > 0 ? parts.join(", ") : null;
    } else if (question.type === "YES_NO") {
      if (raw === true || raw === "yes") rendered = "Yes";
      else if (raw === false || raw === "no") rendered = "No";
      else rendered = String(raw);
    } else if (typeof raw === "number") {
      rendered = String(raw);
    } else if (typeof raw === "string") {
      rendered = raw;
    } else if (typeof raw === "boolean") {
      rendered = raw ? "Yes" : "No";
    } else {
      // Unknown shape — skip rather than risk awkward output.
      continue;
    }

    if (rendered === null || rendered.trim() === "") continue;

    list.push({
      label: escapeHtml(question.label),
      value: escapeHtml(rendered),
    });
  }

  return list;
}

/**
 * Publish any forms whose scheduledPublishAt has passed. Intended to be called
 * from a scheduled task (e.g. a timer/cron), NOT from a request handler. This
 * replaces the previous lazy-publish-on-GET behaviour, which mutated state on an
 * unauthenticated read.
 */
export async function publishDueForms(now: Date = new Date()): Promise<number> {
  // Candidate forms: not published yet, not deleted, in a state that a schedule
  // could legitimately advance from.
  const candidates = await prisma.form.findMany({
    where: {
      deletedAt: null,
      status: { in: ["DRAFT", "APPROVED", "CHANGES_REQUESTED"] },
    },
    select: { id: true, schema: true },
  });

  const dueIds = candidates
    .filter((f) => {
      const scheduledAt = getFormSchema(f.schema).settings.scheduledPublishAt;
      if (!scheduledAt) return false;
      const when = new Date(scheduledAt);
      return !Number.isNaN(when.getTime()) && when <= now;
    })
    .map((f) => f.id);

  if (dueIds.length === 0) return 0;

  const result = await prisma.form.updateMany({
    where: { id: { in: dueIds } },
    data: { status: "PUBLISHED" },
  });
  return result.count;
}

/**
 * Close any published forms whose scheduledCloseAt has passed. Intended to be
 * called from a scheduled task (e.g. a timer/cron), mirroring publishDueForms.
 * The per-request close check in submitFormResponse remains as a safety net.
 */
export async function closeDueForms(now: Date = new Date()): Promise<number> {
  const candidates = await prisma.form.findMany({
    where: {
      deletedAt: null,
      status: "PUBLISHED",
    },
    select: { id: true, schema: true },
  });

  const dueIds = candidates
    .filter((f) => {
      const scheduledAt = getFormSchema(f.schema).settings.scheduledCloseAt;
      if (!scheduledAt) return false;
      const when = new Date(scheduledAt);
      return !Number.isNaN(when.getTime()) && when <= now;
    })
    .map((f) => f.id);

  if (dueIds.length === 0) return 0;

  const result = await prisma.form.updateMany({
    where: { id: { in: dueIds } },
    data: { status: "CLOSED" },
  });
  return result.count;
}

/**
 * Send the daily response digest to owners of forms with
 * responseNotification === "daily". Called from the same scheduled sweep as
 * publishDueForms/closeDueForms. Idempotent via the persisted lastDigestSentAt
 * stamp: a form is only due when it was never digested or its last digest is
 * ~24h old, so the per-form send rate is independent of the 60s sweep cadence.
 * Returns the number of digests actually sent.
 */
export async function sendResponseDigests(now: Date = new Date()): Promise<number> {
  const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const DIGEST_TOLERANCE_MS = 60_000;

  const candidates = await prisma.form.findMany({
    where: {
      deletedAt: null,
      status: { in: ["PUBLISHED", "CLOSED"] },
    },
    select: {
      id: true,
      title: true,
      ownerId: true,
      schema: true,
      lastDigestSentAt: true,
    },
  });

  const due = candidates.filter((f) => {
    if (getFormSchema(f.schema).settings.responseNotification !== "daily") {
      return false;
    }
    if (f.lastDigestSentAt == null) return true;
    return (
      f.lastDigestSentAt.getTime() <=
      now.getTime() - (DIGEST_INTERVAL_MS - DIGEST_TOLERANCE_MS)
    );
  });

  let sent = 0;

  for (const f of due) {
    try {
      const since =
        f.lastDigestSentAt ?? new Date(now.getTime() - DIGEST_INTERVAL_MS);

      const count = await prisma.formResponse.count({
        where: { formId: f.id, submittedAt: { gt: since, lte: now } },
      });

      // Zero new responses: don't send and don't stamp, so the window doesn't
      // slide past un-notified responses.
      if (count === 0) continue;

      const owner = await prisma.user.findUnique({
        where: { id: f.ownerId },
        select: { email: true, name: true },
      });
      if (!owner?.email) continue;

      await sendResponseDigestEmail(owner.email, {
        formTitle: f.title,
        formId: f.id,
        count,
      });

      // Stamp AFTER a successful send attempt (at-least-once: a rare duplicate
      // on a stamp-update failure is safer than silently dropping a digest).
      await prisma.form.update({
        where: { id: f.id },
        data: { lastDigestSentAt: now },
      });

      sent += 1;
    } catch (err) {
      console.error(`response digest failed for form ${f.id}:`, err);
    }
  }

  return sent;
}

/**
 * Produce a short-lived Cloudinary upload signature for a respondent uploading
 * a file to a published form. Verifies the form exists + is published so we
 * don't hand out signatures for arbitrary/unpublished forms. Files are foldered
 * per form for tidiness.
 */
export async function getUploadSignatureForForm(
  slug: string,
): Promise<CloudinarySignature> {
  const form = await prisma.form.findFirst({
    where: { slug, status: "PUBLISHED", deletedAt: null },
    select: { id: true },
  });

  if (!form) {
    const error = new Error("Published form not found.");
    error.name = "PUBLIC_FORM_NOT_FOUND";
    throw error;
  }

  return signUpload(`qivo/forms/${form.id}`);
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

  // Shared answer-only validation (unknown-question, visibility-aware required,
  // per-answer type checks). Submit wraps its EMAIL_REQUIRED / DUPLICATE gates
  // around this; edit calls the same helper so answer rules never drift.
  validateSubmission(schema, input.answers);

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

// Feature A (immediate): notify the form OWNER of the new response. Independent
// fire-and-forget so an email failure can't break submission or the milestone
// logic, and no-ops without Resend (sendEmail handles that).
if (schema.settings.responseNotification === "immediate") {
  void (async () => {
    const owner = await prisma.user.findUnique({
      where: { id: form.ownerId },
      select: { email: true, name: true },
    });
    if (!owner?.email) return;
    await sendNewResponseNotificationEmail(owner.email, {
      formTitle: form.title,
      formId: form.id,
    });
  })().catch((err) => console.error("response notification email failed:", err));
}

// Feature B: respondent confirmation email. Only when the owner enabled it AND
// email collection is on AND we actually have the respondent's email (reuse the
// normalized email already computed for duplicate detection).
if (
  schema.settings.sendConfirmationEmail === true &&
  schema.settings.collectEmail === true &&
  normalizedEmail
) {
  const confirmationAnswers = buildConfirmationAnswerList(questions, input.answers);
  void (async () => {
    await sendResponseConfirmationEmail(normalizedEmail, {
      formTitle: form.title,
      formId: form.id,
      slug: form.slug,
      answers: confirmationAnswers,
    });
  })().catch((err) => console.error("confirmation email failed:", err));
}

// Calculate quiz score if quiz mode is enabled (shared with the edit path).
const quizScore = computeQuizScore(schema, input.answers);

// Issue a same-session edit token when editing is enabled. The expiry is
// derived from the mode; the server re-checks the live window on edit, so this
// is a cap, not the authoritative guard.
const editToken = computeEditToken(schema, response.id);

return { ...response, quizScore, editToken };
}

const UNTIL_CLOSE_CAP_MS = 24 * 60 * 60 * 1000;

/**
 * Derive the edit-token expiry from the form's responseEditing mode and sign a
 * stateless token for `responseId`. Returns null when editing is disabled.
 */
function computeEditToken(
  schema: FormSchema,
  responseId: string,
): string | null {
  const mode = schema.settings.responseEditing ?? "disabled";
  if (mode === "disabled") return null;

  const now = Date.now();
  let expiresAtMs: number;

  if (mode === "timed") {
    const minutes = schema.settings.responseEditMinutes ?? 15;
    expiresAtMs = now + minutes * 60_000;
  } else {
    // until_close: cap at 24h; when a close date is set, use the earlier of the
    // close time and now+24h so editing never outlives the form.
    const cap = now + UNTIL_CLOSE_CAP_MS;
    if (schema.settings.scheduledCloseAt) {
      const closeMs = new Date(schema.settings.scheduledCloseAt).getTime();
      expiresAtMs = Number.isNaN(closeMs) ? cap : Math.min(closeMs, cap);
    } else {
      expiresAtMs = cap;
    }
  }

  return signEditToken(responseId, new Date(expiresAtMs));
}

/**
 * Overwrite a respondent's own just-submitted response within the edit window,
 * authorized by a stateless HMAC edit token. The server is the single owner of
 * every guard: token signature + rid-matches-path binding, a decoupled
 * PUBLISHED-or-CLOSED form lookup, response scoping by formId, and a live
 * mode/window re-check that ignores a stale token's optimistic expiry. No
 * emails, no analytics submission event, and no respondentEmail/duplicate
 * changes — an edit is a correction, not a new submission.
 */
export async function editFormResponse(
  slug: string,
  responseId: string,
  input: {
    answers: Record<string, unknown>;
    email?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  },
  editToken: string,
) {
  // 1) Verify the token signature (constant-time) + parse payload.
  const verified = verifyEditToken(editToken);
  if (!verified) {
    const error = new Error("This edit link is no longer valid.");
    error.name = "INVALID_EDIT_TOKEN";
    throw error;
  }

  // 2) The token's rid MUST match the path responseId — a client can't present
  //    a token for response A to edit response B. A mismatch is a tamper signal.
  if (verified.responseId !== responseId) {
    console.warn(
      `[editFormResponse] token rid (${verified.responseId}) !== path responseId (${responseId}) — possible tampering`,
    );
    const error = new Error("This edit link is no longer valid.");
    error.name = "INVALID_EDIT_TOKEN";
    throw error;
  }

  // 3) Dedicated lookup accepting PUBLISHED or CLOSED (decoupled from the
  //    PUBLISHED-only submit lookup) so the until_close CLOSED branch below is
  //    reachable and returns EDIT_WINDOW_EXPIRED, not FORM_CLOSED.
  const form = await prisma.form.findFirst({
    where: {
      slug,
      deletedAt: null,
      status: { in: ["PUBLISHED", "CLOSED"] },
    },
  });

  if (!form) {
    const error = new Error("Form not available.");
    error.name = "PUBLIC_FORM_NOT_FOUND";
    throw error;
  }

  // 4) Load the response, scoped by formId so a guessed id from another form
  //    can't be edited through this form's slug.
  const existing = await prisma.formResponse.findFirst({
    where: { id: responseId, formId: form.id },
  });

  if (!existing) {
    const error = new Error("Response not found.");
    error.name = "RESPONSE_NOT_FOUND";
    throw error;
  }

  const schema = getFormSchema(form.schema);
  const mode = schema.settings.responseEditing ?? "disabled";
  const now = Date.now();

  // 5) Re-check mode + window against live state (authoritative).
  if (mode === "disabled") {
    const error = new Error("Editing is no longer allowed.");
    error.name = "EDITING_DISABLED";
    throw error;
  }

  if (mode === "timed") {
    const minutes = schema.settings.responseEditMinutes ?? 15;
    const windowEnd = existing.submittedAt.getTime() + minutes * 60_000;
    if (now > windowEnd) {
      const error = new Error("Your edit window has closed.");
      error.name = "EDIT_WINDOW_EXPIRED";
      throw error;
    }
  } else {
    // until_close: closed form OR an elapsed scheduledCloseAt both end the
    // window. NEVER throw FORM_CLOSED here (that maps to 410 and mis-signals
    // the client, which maps EDIT_WINDOW_EXPIRED to "edit window closed").
    if (form.status === "CLOSED") {
      const error = new Error("Your edit window has closed.");
      error.name = "EDIT_WINDOW_EXPIRED";
      throw error;
    }
    if (schema.settings.scheduledCloseAt) {
      const closeMs = new Date(schema.settings.scheduledCloseAt).getTime();
      if (!Number.isNaN(closeMs) && now > closeMs) {
        const error = new Error("Your edit window has closed.");
        error.name = "EDIT_WINDOW_EXPIRED";
        throw error;
      }
    }
  }

  // Token exp as an upper bound (belt-and-suspenders; live recompute wins).
  if (now > verified.exp * 1000) {
    const error = new Error("Your edit window has closed.");
    error.name = "EDIT_WINDOW_EXPIRED";
    throw error;
  }

  // 6) Re-run the SAME answer validation as submit (no email/duplicate gates).
  validateSubmission(schema, input.answers);

  // 7) Overwrite answers + stamp metadata.editedAt (merge existing metadata).
  //    submittedAt is NOT written, so the original submit time is preserved.
  const mergedMetadata = {
    ...((existing.metadata as Record<string, unknown> | null) ?? {}),
    editedAt: new Date().toISOString(),
  };

  const updated = await prisma.formResponse.update({
    where: { id: responseId },
    data: {
      answers: input.answers as Prisma.InputJsonValue,
      metadata: mergedMetadata as Prisma.InputJsonValue,
    },
    select: { id: true, submittedAt: true },
  });

  // Recompute the quiz score from the edited answers (display-only; no emails).
  const quizScore = computeQuizScore(schema, input.answers);

  return { id: updated.id, submittedAt: updated.submittedAt, quizScore };
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

// ─── Custom form templates ───────────────────────────────────────────────────

// Custom templates are surfaced with a `custom:` prefix on their id so they can
// never collide with built-in string ids (cuids and built-in ids never contain
// a colon). The API serialization layer adds the prefix; the resolution/delete
// paths strip it.
const CUSTOM_TEMPLATE_PREFIX = "custom:";

/** Prefix a raw FormTemplate cuid for wire/UI exposure. */
export function addCustomTemplatePrefix(id: string): string {
  return `${CUSTOM_TEMPLATE_PREFIX}${id}`;
}

/** Strip a leading `custom:` prefix if present; otherwise return the input. */
export function stripCustomTemplatePrefix(id: string): string {
  return id.startsWith(CUSTOM_TEMPLATE_PREFIX)
    ? id.slice(CUSTOM_TEMPLATE_PREFIX.length)
    : id;
}

/** True when a templateId references a custom (workspace) template. */
export function isCustomTemplateId(id: string): boolean {
  return id.startsWith(CUSTOM_TEMPLATE_PREFIX);
}

/** Count every question across all sections of a snapshot schema. */
function countSnapshotQuestions(schema: FormSchema): number {
  return schema.sections.reduce(
    (sum, section) => sum + section.questions.length,
    0,
  );
}

/**
 * Clone a snapshot schema assigning fresh ids to every section and question,
 * then rewrite all id references (per-question `conditions[].questionId`,
 * section `jumpRules[].questionId` and `jumpRules[].target`) through the remap.
 * The `__submit__` jump target sentinel is preserved verbatim. References that
 * don't resolve in the remap are dropped defensively (matching the jump
 * engine's tolerance for malformed targets). Pure — no DB, no mutation of the
 * input. Exported for unit testing like the other pure helpers.
 */
export function rebuildSchemaWithFreshIds(snapshot: FormSchema): FormSchema {
  const sectionIdMap = new Map<string, string>();
  const questionIdMap = new Map<string, string>();

  for (const section of snapshot.sections) {
    sectionIdMap.set(section.id, createSectionId());
    for (const question of section.questions) {
      questionIdMap.set(question.id, createQuestionId());
    }
  }

  const sections: FormSection[] = snapshot.sections.map((section) => {
    const questions: FormQuestion[] = section.questions.map((question) => {
      const newQuestion: FormQuestion = {
        ...question,
        id: questionIdMap.get(question.id) as string,
      };

      if (question.conditions) {
        const remappedConditions = question.conditions
          .map((condition) => {
            const mapped = questionIdMap.get(condition.questionId);
            if (mapped === undefined) return null;
            return { ...condition, questionId: mapped };
          })
          .filter(
            (c): c is NonNullable<typeof c> => c !== null,
          );
        if (remappedConditions.length > 0) {
          newQuestion.conditions = remappedConditions;
        } else {
          delete newQuestion.conditions;
        }
      }

      return newQuestion;
    });

    const newSection: FormSection = {
      ...section,
      id: sectionIdMap.get(section.id) as string,
      questions,
    };

    if (section.jumpRules) {
      const remappedRules = section.jumpRules
        .map((rule) => {
          const mappedQuestionId = questionIdMap.get(rule.questionId);
          if (mappedQuestionId === undefined) return null;

          let target: string;
          if (rule.target === JUMP_TARGET_SUBMIT) {
            target = JUMP_TARGET_SUBMIT;
          } else {
            const mappedTarget = sectionIdMap.get(rule.target);
            if (mappedTarget === undefined) return null;
            target = mappedTarget;
          }

          return { ...rule, questionId: mappedQuestionId, target };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (remappedRules.length > 0) {
        newSection.jumpRules = remappedRules;
      } else {
        delete newSection.jumpRules;
      }
    }

    return newSection;
  });

  return {
    ...snapshot,
    sections,
  };
}

/**
 * Save a SNAPSHOT of a form's current schema as a workspace-scoped custom
 * template. Requires edit rights on the source form (reuses getEditableForm, so
 * a VIEWER cannot and a per-form EDITOR share can). The snapshot is independent
 * — later edits to the source form do not change the template.
 */
export async function saveFormAsTemplate(
  formId: string,
  userId: string,
  input: {
    name: string;
    description?: string | undefined;
    category?: string | undefined;
  },
) {
  const form = await getEditableForm(formId, userId);

  const snapshot = getFormSchema(form.schema);

  const template = await prisma.formTemplate.create({
    data: {
      workspaceId: form.workspaceId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
      schema: toPrismaJson(snapshot),
      createdById: userId,
    },
  });

  void logAction({
    workspaceId: form.workspaceId,
    userId,
    action: "TEMPLATE_CREATED",
    entityType: "form_template",
    entityId: template.id,
    metadata: { name: template.name },
  }).catch((err) => console.error("logAction TEMPLATE_CREATED failed:", err));

  return {
    id: addCustomTemplatePrefix(template.id),
    name: template.name,
    description: template.description,
    category: template.category,
    questionCount: countSnapshotQuestions(snapshot),
    custom: true as const,
  };
}

/**
 * List templates visible to a workspace for the picker: built-ins first (with
 * `custom: false`), then the workspace's custom templates ordered newest-first
 * (`custom: true`). Any workspace role may list; a non-member gets
 * WORKSPACE_NOT_FOUND.
 */
export async function listTemplatesForWorkspace(
  workspaceId: string,
  userId: string,
) {
  const membership = await getMembership(workspaceId, userId);
  if (!membership) {
    const error = new Error("Workspace not found.");
    error.name = "WORKSPACE_NOT_FOUND";
    throw error;
  }

  const builtIns = TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    questionCount: t.questions.length,
    custom: false as const,
  }));

  const customRows = await prisma.formTemplate.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });

  const custom = customRows.map((row) => ({
    id: addCustomTemplatePrefix(row.id),
    name: row.name,
    description: row.description,
    category: row.category,
    // A corrupt snapshot degrades to 0 via getFormSchema tolerance (defaults
    // sections to []), so the row still lists rather than throwing.
    questionCount: countSnapshotQuestions(getFormSchema(row.schema)),
    custom: true as const,
  }));

  return [...builtIns, ...custom];
}

/**
 * Create a new DRAFT form from a custom template's stored snapshot, with fresh
 * section/question ids and a fresh slug, owned by the caller. The custom path
 * uses prisma.form.create directly (to carry the snapshot schema) and therefore
 * does NOT inherit createForm's VIEWER gate — so it enforces its own membership
 * + VIEWER check here. The template lookup is scoped to the target workspace,
 * which also prevents instantiating another workspace's template. Responses are
 * not copied (a template has none).
 */
export async function createFormFromCustomTemplate(input: {
  templateId: string;
  workspaceId: string;
  ownerId: string;
  title: string;
  description?: string | undefined;
}) {
  const membership = await getMembership(input.workspaceId, input.ownerId);
  if (!membership) {
    const error = new Error("Workspace not found.");
    error.name = "WORKSPACE_NOT_FOUND";
    throw error;
  }
  if (membership.role === "VIEWER") {
    throw forbiddenError("You do not have permission to create forms.");
  }

  const template = await prisma.formTemplate.findFirst({
    where: { id: input.templateId, workspaceId: input.workspaceId },
  });
  if (!template) {
    throw templateNotFoundError();
  }

  const snapshot = getFormSchema(template.schema);
  const rebuilt = rebuildSchemaWithFreshIds(snapshot);

  // Clear time-bound scheduling: it is meaningless on a fresh draft. Omit the
  // keys rather than copy them forward.
  const { scheduledPublishAt, scheduledCloseAt, ...carriedSettings } =
    rebuilt.settings;
  void scheduledPublishAt;
  void scheduledCloseAt;

  const rebuiltSchema: FormSchema = {
    ...rebuilt,
    settings: carriedSettings,
  };

  const form = await prisma.form.create({
    data: {
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      slug: createFormSlug(input.title),
      status: "DRAFT",
      schema: toPrismaJson(rebuiltSchema),
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

/**
 * Delete a custom template. Only non-VIEWER members of the template's own
 * workspace may delete. A non-member gets TEMPLATE_NOT_FOUND (no cross-workspace
 * existence leak). Built-in ids never match a row, so attempting to delete a
 * built-in yields TEMPLATE_NOT_FOUND (built-ins are undeletable by construction).
 */
export async function deleteTemplate(templateId: string, userId: string) {
  const id = stripCustomTemplatePrefix(templateId);

  const template = await prisma.formTemplate.findUnique({ where: { id } });
  if (!template) {
    throw templateNotFoundError();
  }

  const membership = await getMembership(template.workspaceId, userId);
  if (!membership) {
    // Don't reveal that a template exists in another workspace.
    throw templateNotFoundError();
  }
  if (membership.role === "VIEWER") {
    throw forbiddenError("You do not have permission to delete templates.");
  }

  await prisma.formTemplate.delete({ where: { id } });
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

// ─── Pure report-aggregation helpers (unit-tested in form.service.test.ts) ────

/**
 * Inclusive date-range predicate. Returns true when `at` falls within
 * [from, to] (either bound optional). Shared by the in-memory response scoping
 * so the same semantics apply as the DB `where`.
 */
export function isWithinRange(
  at: Date,
  from?: Date,
  to?: Date,
): boolean {
  const t = at.getTime();
  if (from && t < from.getTime()) return false;
  if (to && t > to.getTime()) return false;
  return true;
}

export type FunnelMetrics = {
  views: number;
  starts: number;
  completions: number;
  viewToStart: number | null;
  startToCompletion: number | null;
  viewToCompletion: number | null;
  filterAffectsCompletionsOnly: boolean;
};

/**
 * Funnel math. When a cross-question filter is active we must NOT emit any
 * conversion percentage (they would divide a filtered completion numerator by
 * an unfiltered view/start denominator — mixed-population nonsense), so every
 * rate is null and `filterAffectsCompletionsOnly` is true. Percentages are
 * null whenever their denominator is 0. `starts > views` is possible (reloads);
 * we report the true counts and let the UI clamp the drawn width.
 */
export function computeFunnel(
  views: number,
  starts: number,
  completions: number,
  filterActive: boolean,
): FunnelMetrics {
  const pct = (num: number, den: number): number | null =>
    den > 0 ? Math.round((num / den) * 100) : null;
  return {
    views,
    starts,
    completions,
    viewToStart: filterActive ? null : pct(starts, views),
    startToCompletion: filterActive ? null : pct(completions, starts),
    viewToCompletion: filterActive ? null : pct(completions, views),
    filterAffectsCompletionsOnly: filterActive,
  };
}

export type AvgTimeMetrics = {
  medianSeconds: number | null;
  meanSeconds: number | null;
  sampleSize: number;
};

/**
 * Average time-to-complete from client-measured `elapsedSeconds` values. Keeps
 * only finite, strictly positive, sane values (< 24h) to discard
 * tab-left-open outliers, then reports median (headline, robust) + mean +
 * sampleSize. Empty set → nulls with sampleSize 0.
 */
export function computeAvgTime(elapsedValues: unknown[]): AvgTimeMetrics {
  const usable = elapsedValues
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 86_400)
    .sort((a, b) => a - b);
  const sampleSize = usable.length;
  if (sampleSize === 0) {
    return { medianSeconds: null, meanSeconds: null, sampleSize: 0 };
  }
  const mid = Math.floor(sampleSize / 2);
  const median =
    sampleSize % 2 === 0
      ? ((usable[mid - 1] as number) + (usable[mid] as number)) / 2
      : (usable[mid] as number);
  const mean = usable.reduce((a, b) => a + b, 0) / sampleSize;
  return {
    medianSeconds: Math.round(median),
    meanSeconds: Math.round(mean),
    sampleSize,
  };
}

export type SectionCompleteness = {
  sectionId: string;
  title: string;
  percentage: number;
};

/**
 * Section-completeness proxy (multi-section forms only): for each section, the
 * share of in-scope submitted responses that answered at least one question in
 * that section. Not true drop-off (partials aren't stored) — labeled as such in
 * the UI. Single-section forms get null (the caller hides the card).
 */
export function computeSectionCompleteness(
  sections: Array<{ id: string; title: string; questions: Array<{ id: string }> }>,
  answerRows: Array<Record<string, unknown>>,
): SectionCompleteness[] | null {
  if (sections.length <= 1) return null;
  const total = answerRows.length;
  return sections.map((section) => {
    const questionIds = section.questions.map((q) => q.id);
    const withAnswer = answerRows.filter((row) =>
      questionIds.some((qid) => isAnswered(row[qid])),
    ).length;
    return {
      sectionId: section.id,
      title: section.title,
      percentage: total > 0 ? Math.round((withAnswer / total) * 100) : 0,
    };
  });
}

/**
 * Peak submission day from a daily series: the single day with the most
 * submissions. Null when the series is empty or every day is 0.
 */
export function computePeakDay(
  series: Array<{ date: string; submissions: number }>,
): { date: string; count: number } | null {
  let best: { date: string; count: number } | null = null;
  for (const point of series) {
    if (point.submissions > 0 && (!best || point.submissions > best.count)) {
      best = { date: point.date, count: point.submissions };
    }
  }
  return best;
}

export type GetFormReportOptions = {
  from?: Date;
  to?: Date;
  filter?: { questionId: string; operator: AnswerFilterOperator; value?: string };
};

export async function getFormReport(
  formId: string,
  userId: string,
  options?: GetFormReportOptions,
) {
  const form = await getFormForResponseAccess(formId, userId);
  const schema = getFormSchema(form.schema);
  const questions = schema.sections.flatMap((s) => s.questions);

  const from = options?.from;
  const to = options?.to;

  // Validate the cross-question filter against the real schema. An unknown
  // questionId (stale bookmarked URL after a question was deleted) is ignored
  // rather than throwing, surfaced via warnings so the UI can tell the user.
  const warnings: string[] = [];
  let filter = options?.filter;
  if (filter && !questions.some((q) => q.id === filter!.questionId)) {
    warnings.push("UNKNOWN_FILTER_QUESTION");
    filter = undefined;
  }
  const filterApplied = Boolean(filter);

  // Date-range where fragments (index-backed). Spread conditionally so
  // exactOptionalPropertyTypes doesn't choke on undefined bounds.
  const rangeBounds = {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
  const hasRange = Boolean(from || to);
  const responseWhere = {
    formId: form.id,
    ...(hasRange ? { submittedAt: rangeBounds } : {}),
  };
  const analyticsWhere = (event: string) => ({
    formId: form.id,
    event,
    ...(hasRange ? { createdAt: rangeBounds } : {}),
  });

  // Single read of all responses for this form. Ordered newest-first so text
  // samples show recent answers.
  //
  // Cap how many rows we pull into memory: aggregating hundreds of thousands of
  // responses at once could OOM the process. We still report the true total via
  // a separate count; the per-question aggregates are computed over the most
  // recent REPORT_SAMPLE_CAP responses when a form exceeds that size.
  const REPORT_SAMPLE_CAP = 5000;
  const [responses, totalResponses, views, starts, submissions] =
    await Promise.all([
      prisma.formResponse.findMany({
        where: responseWhere,
        orderBy: { submittedAt: "desc" },
        select: { answers: true, submittedAt: true, metadata: true },
        take: REPORT_SAMPLE_CAP,
      }),
      prisma.formResponse.count({ where: { formId: form.id } }),
      prisma.formAnalytics.count({ where: analyticsWhere("view") }),
      prisma.formAnalytics.count({ where: analyticsWhere("start") }),
      prisma.formAnalytics.count({ where: analyticsWhere("submission") }),
    ]);

  // Apply the cross-question filter in memory BEFORE aggregation so
  // completions, per-question charts, completion rate, avg time, and section
  // completeness all reflect only matching responses. Views/starts stay
  // unfiltered (they have no answers to match).
  const scopedResponses = filter
    ? responses.filter((r) =>
        matchesAnswerFilter(
          ((r.answers ?? {}) as Record<string, unknown>)[filter!.questionId],
          filter!.operator,
          filter!.value,
        ),
      )
    : responses;

  const sampledResponses = scopedResponses.length;

  const answerRows = scopedResponses.map(
    (r) => (r.answers ?? {}) as Record<string, unknown>,
  );

  const questionReports: QuestionReport[] = questions.map((question) => {
    const values = answerRows.map((row) => row[question.id]);
    const answers = values.filter(isAnswered);
    const answered = answers.length;
    // skipped is relative to the sampled rows the aggregates were computed over.
    const skipped = sampledResponses - answered;

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

    // MULTI_ENTRY: each answer is a string[]; flatten to individual entries so
    // the report shows one entry per row rather than "Name1,Name2" as a single
    // concatenated string.
    if (question.type === "MULTI_ENTRY") {
      const entries: string[] = [];
      for (const answer of answers) {
        if (Array.isArray(answer)) {
          for (const entry of answer) {
            const s = String(entry).trim();
            if (s) entries.push(s);
          }
        } else {
          const s = String(answer).trim();
          if (s) entries.push(s);
        }
      }
      const sample = entries.slice(0, 20);
      return { ...base, kind: "text", sample };
    }

    // Text-based (SHORT_TEXT, LONG_TEXT, EMAIL, DATE, PHONE, URL, FILE_UPLOAD,
    // SIGNATURE). URL answers (FILE_UPLOAD / SIGNATURE) render as thumbnails
    // downstream via isImageUrl.
    const sample = answers.slice(0, 20).map((a) => String(a));
    return { ...base, kind: "text", sample };
  });

  const conversionRate = views > 0 ? Math.round((submissions / views) * 100) : 0;

  // Daily views/submissions. Range-aware: the active window when from/to are
  // set, else the last-30-days default (unchanged behavior).
  const { series: timeSeries, warnings: seriesWarnings } =
    await getFormDailyTimeSeries(
      form.id,
      hasRange ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : undefined,
    );
  for (const w of seriesWarnings) warnings.push(w);

  // Completions == the scoped FormResponse count (filtered when a filter is
  // active; range-scoped by the where clause). The funnel clamps display.
  const completions = sampledResponses;

  const funnel = computeFunnel(views, starts, completions, filterApplied);

  const avgTime = computeAvgTime(
    scopedResponses.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return meta["elapsedSeconds"];
    }),
  );

  const sectionCompleteness = computeSectionCompleteness(
    schema.sections,
    answerRows,
  );

  const peakDay = computePeakDay(timeSeries);

  return {
    totalResponses,
    analytics: { views, submissions, conversionRate },
    funnel,
    metrics: {
      completionRateViews: funnel.viewToCompletion,
      completionRateStarts: funnel.startToCompletion,
      avgTime,
      peakDay,
      sectionCompleteness,
    },
    range: {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
    },
    filterApplied,
    filter: filter
      ? {
          questionId: filter.questionId,
          operator: filter.operator,
          ...(filter.value !== undefined ? { value: filter.value } : {}),
        }
      : null,
    warnings,
    timeSeries,
    questions: questionReports,
  };
}

export type DailyTimeSeriesPoint = {
  date: string;
  views: number;
  submissions: number;
};

// Zero-filled span is capped so a hostile/huge custom range can't allocate an
// unbounded array; beyond this the range is clamped and a warning is returned.
const DAILY_SERIES_MAX_DAYS = 366;

/**
 * Views and submissions grouped by calendar day (server-side group-by-day).
 * Range-aware: with no opts it reproduces the last-30-days behavior; with
 * { from, to } it scopes the SQL to `createdAt BETWEEN` and zero-fills across
 * the requested window. Returns a contiguous (zero-filled) series so charts
 * don't have gaps, plus any warnings (e.g. RANGE_TRUNCATED_SERIES).
 */
export async function getFormDailyTimeSeries(
  formId: string,
  opts?: { from?: Date; to?: Date },
): Promise<{ series: DailyTimeSeriesPoint[]; warnings: string[] }> {
  const warnings: string[] = [];

  // Resolve the inclusive [startDay, endDay] window (both truncated to a UTC
  // calendar day) that the zero-fill walks over.
  const dayFloorUTC = (d: Date): Date => {
    const copy = new Date(d);
    copy.setUTCHours(0, 0, 0, 0);
    return copy;
  };

  let endDay: Date;
  let startDay: Date;
  if (opts?.from || opts?.to) {
    endDay = dayFloorUTC(opts.to ?? new Date());
    startDay = dayFloorUTC(
      opts.from ??
        new Date(endDay.getTime() - 29 * 24 * 60 * 60 * 1000),
    );
    // Clamp a window wider than the cap to the most recent DAILY_SERIES_MAX_DAYS.
    const maxSpanMs = (DAILY_SERIES_MAX_DAYS - 1) * 24 * 60 * 60 * 1000;
    if (endDay.getTime() - startDay.getTime() > maxSpanMs) {
      startDay = new Date(endDay.getTime() - maxSpanMs);
      warnings.push("RANGE_TRUNCATED_SERIES");
    }
  } else {
    endDay = dayFloorUTC(new Date());
    startDay = new Date(endDay.getTime() - 29 * 24 * 60 * 60 * 1000);
  }

  // Inclusive upper bound for the SQL scan (end of the end day).
  const endExclusive = new Date(endDay.getTime() + 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<
    Array<{ day: Date; event: string; count: bigint }>
  >`
    SELECT date_trunc('day', "createdAt") AS day, "event", COUNT(*) AS count
    FROM "FormAnalytics"
    WHERE "formId" = ${formId}
      AND "createdAt" >= ${startDay}
      AND "createdAt" < ${endExclusive}
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
  const series: DailyTimeSeriesPoint[] = [];
  for (
    let d = new Date(startDay);
    d.getTime() <= endDay.getTime();
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
  ) {
    const date = d.toISOString().slice(0, 10);
    series.push({
      date,
      views: byKey.get(`${date}:view`) ?? 0,
      submissions: byKey.get(`${date}:submission`) ?? 0,
    });
  }

  return { series, warnings };
}

/**
 * Record a respondent "start" event for a published form. Resolves the slug to
 * a PUBLISHED, not-deleted form (same gate as getPublicForm) and throws
 * PUBLIC_FORM_NOT_FOUND if absent, so we never write a start row for a formId
 * that does not exist. The analytics insert is fire-and-forget: a DB hiccup
 * must never surface to the respondent (the form still works).
 */
export async function recordFormStart(slug: string): Promise<void> {
  const form = await prisma.form.findFirst({
    where: { slug, deletedAt: null, status: "PUBLISHED" },
    select: { id: true },
  });

  if (!form) {
    const error = new Error("Published form not found.");
    error.name = "PUBLIC_FORM_NOT_FOUND";
    throw error;
  }

  void prisma.formAnalytics
    .create({ data: { formId: form.id, event: "start" } })
    .catch((err) => console.error("formAnalytics start tracking failed:", err));
}
