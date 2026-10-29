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
  correctAnswer?: string;
  points?: number;
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
  // Present when questions are loaded via the flattened list endpoint.
  sectionId?: string;
};

// Sentinel target meaning "end the form / go to submit". Distinguishable from
// any real section id because generated ids are always `section_<hex>`.
export const JUMP_TARGET_SUBMIT = "__submit__";

export type SectionJumpRule = {
  // The question WITHIN this section whose answer is tested.
  questionId: string;
  // Reuses the exact ConditionRule operator union.
  operator: ConditionRule["operator"];
  value?: string;
  // A later section's id, or the JUMP_TARGET_SUBMIT sentinel.
  target: string;
};

export type Section = {
  id: string;
  title: string;
  questions: Question[];
  jumpRules?: SectionJumpRule[]; // optional; absent/empty = linear fall-through
};

export type FormTheme = {
  coverImageUrl?: string;
  accentColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
};

export type FormSchema = {
  version: number;
  sections: Section[];
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

export type FormRecord = {
  id: string;
  workspaceId: string;
  folderId?: string | null;
  eventId?: string | null;
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
  logoUrl?: string | null;
  primaryColor?: string | null;
};

export type FormShareRole = "RESPONDER" | "EDITOR" | "VIEWER";
export type FormShareStatus = "PENDING" | "ACCEPTED";

export type FormShare = {
  id: string;
  formId: string;
  email: string;
  role: FormShareRole;
  status: FormShareStatus;
  createdAt: string;
  acceptedAt?: string | null;
  user?: { id: string; name: string; email: string; avatarUrl?: string | null } | null;
};

export type SharedWithMeItem = {
  shareId: string;
  role: FormShareRole;
  form: { id: string; title: string; slug: string; status: string };
};

export type InvitePreview = {
  formTitle: string;
  role: FormShareRole;
  inviterName: string;
  status: FormShareStatus;
};

export type AnswerValue = string | number | string[] | boolean | null;

export type UserInfo = {
  id: string;
  name: string;
  email: string;
};

export type Webhook = {
  id: string;
  formId: string;
  url: string;
  description: string | null;
  enabled: boolean;
  secret: string;
  createdAt: string;
};

export type WebhookDeliveryStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "exhausted";

export type WebhookDelivery = {
  id: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastResponseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
};
