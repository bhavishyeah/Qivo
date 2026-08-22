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
  | "LINEAR_SCALE";

export type QuestionOption = {
  value: string;
  label: string;
};

export type QuestionSettings = {
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  maxFileSizeMB?: number;
  allowedFileTypes?: string[];
};

export type ConditionRule = {
  questionId: string;
  operator: "equals" | "not_equals" | "contains" | "not_empty";
  value?: string;
};

export type Question = {
  id: string;
  label: string;
  description?: string | null;
  type: QuestionType;
  required: boolean;
  options?: QuestionOption[];
  settings?: QuestionSettings;
  conditions?: ConditionRule[];
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
    scheduledPublishAt?: string | null;
    scheduledCloseAt?: string | null;
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
  branding?: {
    workspaceName: string;
    logoUrl?: string | null;
    primaryColor?: string | null;
  };
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
