export type QuestionType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "EMAIL"
  | "NUMBER"
  | "DATE"
  | "SINGLE_CHOICE"
  | "MULTIPLE_CHOICE"
  | "RATING"
  | "YES_NO";

export type QuestionOption = {
  value: string;
  label: string;
};

export type QuestionSettings = {
  min?: number;
  max?: number;
};

export type Question = {
  id: string;
  label: string;
  description?: string | null;
  type: QuestionType;
  required: boolean;
  options?: QuestionOption[];
  settings?: QuestionSettings;
};

export type Section = {
  id: string;
  title: string;
  questions: Question[];
};

export type FormSchema = {
  version: number;
  sections: Section[];
  settings: {
    collectEmail: boolean;
    allowMultipleResponses: boolean;
  };
  confirmationMessage?: string;
};

export type FormRecord = {
  id: string;
  workspaceId: string;
  title: string;
  description?: string | null;
  slug: string;
  status: string;
  schema: FormSchema;
  createdAt: string;
  updatedAt: string;
};

export type PublicForm = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  schema: FormSchema;
};

export type ResponseRecord = {
  id: string;
  formId: string;
  answers: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  respondentId?: string | null;
  submittedAt: string;
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  type: "PERSONAL" | "TEAM";
  role: string;
  createdAt: string;
};

export type AnswerValue = string | number | string[] | boolean | null;

export type UserInfo = {
  id: string;
  name: string;
  email: string;
};
