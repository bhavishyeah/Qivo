import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import { PIPING_TOKEN_RE } from "../lib/piping";
import { uploadToCloudinary } from "../lib/upload";
import WebhooksTabPanel from "../components/WebhooksTabPanel";
import {
  DEFAULT_ACCENT,
  ensureFontLoaded,
  FONT_ALLOW_LIST,
  resolveTheme,
} from "../lib/theme";
import {
  JUMP_TARGET_SUBMIT,
  type FormRecord,
  type Question,
  type QuestionOption,
  type QuestionType,
  type ConditionRule,
  type SectionJumpRule,
} from "../types";

// ─── Types ───────────────────────────────────────────────────────────────────

type MemberRecord = {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
};

type VersionRecord = {
  id: string;
  versionNumber: number;
  title: string;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
};

type HistoryEntry = {
  questions: Question[];
};

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SHORT_TEXT: "Short text",
  LONG_TEXT: "Long text",
  EMAIL: "Email",
  NUMBER: "Number",
  DATE: "Date",
  SINGLE_CHOICE: "Single choice",
  MULTIPLE_CHOICE: "Multiple choice",
  RATING: "Rating",
  YES_NO: "Yes / No",
  PHONE: "Phone number",
  URL: "URL",
  FILE_UPLOAD: "File upload",
  SIGNATURE: "Signature",
  LINEAR_SCALE: "Linear scale",
  MULTI_ENTRY: "Multi-Entry",
};

const CHOICE_TYPES = new Set<QuestionType>(["SINGLE_CHOICE", "MULTIPLE_CHOICE"]);
const RATING_TYPES = new Set<QuestionType>(["RATING", "LINEAR_SCALE"]);

// Convert a datetime-local value (local wall-clock, no timezone) into a full
// ISO instant (…Z) the backend's z.string().datetime() accepts. Empty or
// invalid input becomes null.
function toIsoInstant(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Convert a stored ISO instant back into the YYYY-MM-DDTHH:mm shape a
// datetime-local input expects, in the viewer's local timezone. Empty or
// invalid input becomes "".
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FormEditorPage() {
  const { formId } = useParams<{ formId: string }>();

  const [form, setForm] = useState<FormRecord | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  // Sections (id + title + jumpRules), ordered. Derived from the form schema on
  // load. jumpRules round-trip so a save never silently wipes them.
  const [sections, setSections] = useState<
    Array<{ id: string; title: string; jumpRules?: SectionJumpRule[] }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Autosave
  type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline";
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending saves keyed by questionId so edits to different questions within
  // the debounce window are all flushed (previously a single slot dropped all
  // but the last-edited question's changes).
  const pendingSaves = useRef<Map<string, Question>>(new Map());

  // Undo history (local state only, not persisted). Lengths are mirrored into
  // state so the Undo/Redo buttons' disabled state re-renders correctly.
  const history = useRef<HistoryEntry[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);

  // Add question form
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [newQuestionType, setNewQuestionType] = useState<QuestionType>("SHORT_TEXT");
  const [newQuestionLabel, setNewQuestionLabel] = useState("");
  const [addingQuestion, setAddingQuestion] = useState(false);

  // Settings
  const [collectEmail, setCollectEmail] = useState(false);
  const [allowMultipleResponses, setAllowMultipleResponses] = useState(true);
  const [confirmationMessage, setConfirmationMessage] = useState("");
  const [scheduledPublishAt, setScheduledPublishAt] = useState("");
  const [scheduledCloseAt, setScheduledCloseAt] = useState("");
  const [quizMode, setQuizMode] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [responseNotification, setResponseNotification] = useState<"off" | "immediate" | "daily">("off");
  const [sendConfirmationEmail, setSendConfirmationEmail] = useState(false);
  const [responseEditing, setResponseEditing] = useState<"disabled" | "timed" | "until_close">("disabled");
  const [responseEditMinutes, setResponseEditMinutes] = useState(15);
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  // Rupee text input; converted to/from paise at load/save.
  const [paymentAmountRupees, setPaymentAmountRupees] = useState("");
  const [paymentDescription, setPaymentDescription] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  // Appearance (per-form theme). "" means inherit / default.
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverError, setCoverError] = useState("");

  // Approval workflow
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [reviewers, setReviewers] = useState<MemberRecord[]>([]);
  const [selectedReviewer, setSelectedReviewer] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [submittingForReview, setSubmittingForReview] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewing, setReviewing] = useState(false);

  // Drag state
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Active question (for progressive disclosure)
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);

  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Workspace tabs
  type EditorTab = "builder" | "responses" | "settings" | "appearance" | "webhooks";
  const [activeTab, setActiveTab] = useState<EditorTab>("builder");

  // ─── Load ──────────────────────────────────────────────────────────────────

  // Fetch form/questions/sections and settings/theme into state. Does NOT touch
  // the initial `loading` flag so it can be reused for in-place refreshes.
  async function reloadEditorData() {
    if (!formId) return;
    const [formData, questionsData] = await Promise.all([
      api.get<{ form: FormRecord }>(`/api/forms/${formId}`),
      api.get<{ questions: Question[] }>(`/api/forms/${formId}/questions`),
    ]);
    setForm(formData.form);
    setQuestions(questionsData.questions);
    const schema = formData.form.schema;
    setSections(
      (schema.sections ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        ...(s.jumpRules ? { jumpRules: s.jumpRules } : {}),
      })),
    );
    setCollectEmail(schema.settings?.collectEmail ?? false);
    setAllowMultipleResponses(schema.settings?.allowMultipleResponses ?? true);
    setConfirmationMessage(schema.confirmationMessage ?? "");
    setScheduledPublishAt(toDatetimeLocal(schema.settings?.scheduledPublishAt));
    setScheduledCloseAt(toDatetimeLocal(schema.settings?.scheduledCloseAt));
    setQuizMode(schema.settings?.quizMode ?? false);
    setShowScore(schema.settings?.showScore ?? false);
    setResponseNotification(schema.settings?.responseNotification ?? "off");
    setSendConfirmationEmail(schema.settings?.sendConfirmationEmail ?? false);
    setResponseEditing(schema.settings?.responseEditing ?? "disabled");
    setResponseEditMinutes(schema.settings?.responseEditMinutes ?? 15);
    const payment = schema.settings?.payment;
    setPaymentEnabled(payment?.enabled ?? false);
    setPaymentAmountRupees(
      payment && typeof payment.amount === "number"
        ? String(payment.amount / 100)
        : "",
    );
    setPaymentDescription(payment?.description ?? "");
    const theme = schema.settings?.theme;
    setCoverImageUrl(theme?.coverImageUrl ?? "");
    setAccentColor(theme?.accentColor ?? "");
    setBackgroundColor(theme?.backgroundColor ?? "");
    setFontFamily(theme?.fontFamily ?? "");
  }

  useEffect(() => {
    async function loadEditor() {
      if (!formId) { setError("A form ID is missing."); setLoading(false); return; }
      try {
        await reloadEditorData();
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "Unable to load editor.");
      } finally {
        setLoading(false);
      }
    }
    void loadEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  // ─── Undo / Redo ────────────────────────────────────────────────────────────

  const redoStack = useRef<HistoryEntry[]>([]);
  const lastHistoryPush = useRef<number>(0);

  function syncHistoryDepth() {
    setUndoDepth(history.current.length);
    setRedoDepth(redoStack.current.length);
  }

  function pushHistory(current: Question[]) {
    // Don't push if less than 500ms since last push (debounce for rapid typing)
    const now = Date.now();
    if (now - lastHistoryPush.current < 500 && history.current.length > 0) {
      // Update the latest entry instead
      history.current[history.current.length - 1] = { questions: current };
      return;
    }
    lastHistoryPush.current = now;
    history.current = [...history.current.slice(-29), { questions: current }];
    // Clear redo stack when a new action is performed
    redoStack.current = [];
    syncHistoryDepth();
  }

  function undo() {
    if (history.current.length === 0) return;
    const prev = history.current.pop();
    if (prev) {
      // Push current state to redo, restore previous, and persist the restore
      // so the server doesn't drift from the reverted local state.
      redoStack.current.push({ questions });
      setQuestions(prev.questions);
      persistQuestionSet(prev.questions);
      syncHistoryDepth();
    }
  }

  function redo() {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop();
    if (next) {
      // Push current state to undo
      history.current.push({ questions });
      setQuestions(next.questions);
      persistQuestionSet(next.questions);
      syncHistoryDepth();
    }
  }

  // After an undo/redo, push each changed question to the server so the DB
  // matches the restored local state (autosave only fires on direct edits).
  function persistQuestionSet(restored: Question[]) {
    if (!formId) return;
    for (const q of restored) {
      pendingSaves.current.set(q.id, q);
    }
    scheduleAutosaveFlush();
  }

  // Keyboard shortcuts. The handler closes over lots of frequently-changing
  // state (questions, activeQuestionId, undo/redo). To avoid re-binding the
  // window listener on every render (the old code had no dep array), we keep the
  // latest handler in a ref and register the listener exactly once.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const currentKeyHandler = (e: KeyboardEvent) => {
    const isCtrl = e.ctrlKey || e.metaKey;

    // Ctrl+Z/Y for undo/redo
    if (isCtrl) {
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); return; }
      if (e.key === "y") { e.preventDefault(); redo(); return; }
    }

    // Tab / Shift+Tab to navigate between cards (only when not in an input)
    if (e.key === "Tab" && activeQuestionId) {
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      if (!isInInput) {
        e.preventDefault();
        const currentIdx = questions.findIndex((q) => q.id === activeQuestionId);
        if (e.shiftKey) {
          if (currentIdx > 0) setActiveQuestionId(questions[currentIdx - 1].id);
        } else {
          if (currentIdx < questions.length - 1) setActiveQuestionId(questions[currentIdx + 1].id);
        }
      }
    }

    // Delete key to remove active card (only when not in input)
    if (e.key === "Delete" && activeQuestionId) {
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      if (!isInInput) {
        e.preventDefault();
        if (confirm("Delete this question?")) {
          void deleteEditorQuestion(activeQuestionId);
        }
      }
    }
  };

  // Keep the ref pointing at the latest handler (updated in an effect, not
  // during render), then bind the window listener exactly once.
  useEffect(() => {
    keyHandlerRef.current = currentKeyHandler;
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // ─── Question mutations ───────────────────────────────────────────────────

  function updateQuestionLocal(questionId: string, patch: Partial<Question>) {
    // Push current state to history before modifying
    pushHistory(questions);
    setQuestions((current) => {
      const updated = current.map((q) => (q.id === questionId ? { ...q, ...patch } : q));
      // Queue this question for autosave (keyed, so concurrent edits to
      // different questions are all saved rather than overwriting each other).
      const question = updated.find((q) => q.id === questionId);
      if (question) {
        pendingSaves.current.set(questionId, question);
        scheduleAutosaveFlush();
      }
      return updated;
    });
  }

  function scheduleAutosaveFlush() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushAutosaves();
    }, 1500);
  }

  async function flushAutosaves() {
    if (!formId || pendingSaves.current.size === 0) return;

    // Snapshot and clear the queue so edits made during the flush are batched
    // into the next flush rather than lost.
    const batch = Array.from(pendingSaves.current.values());
    pendingSaves.current.clear();

    setSaveStatus("saving");
    try {
      // Save all queued questions; a failure re-queues them for the next flush.
      for (const question of batch) {
        try {
          await api.patch(`/api/forms/${formId}/questions/${question.id}`, {
            label: question.label,
            type: question.type,
            description: question.description,
            required: question.required,
            options: question.options,
            settings: question.settings,
            conditions: question.conditions,
          });
        } catch (err) {
          pendingSaves.current.set(question.id, question);
          throw err;
        }
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus((s) => s === "saved" ? "idle" : s), 3000);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setSaveStatus("error");
        setError(err.message);
      } else {
        setSaveStatus("offline");
      }
    }
  }

  async function saveTitle(newTitle: string) {
    if (!formId || !newTitle.trim()) return;
    setSaveStatus("saving");
    try {
      const data = await api.patch<{ form: FormRecord }>(`/api/forms/${formId}`, { title: newTitle.trim() });
      setForm(data.form);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus((s) => s === "saved" ? "idle" : s), 3000);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to save title.");
      setSaveStatus("error");
    }
    setEditingTitle(false);
  }

  async function deleteEditorQuestion(questionId: string) {
    if (!formId) return;
    pushHistory(questions);
    setSaving(true); setMessage(""); setError("");
    try {
      await api.delete(`/api/forms/${formId}/questions/${questionId}`);
      setQuestions((current) => current.filter((q) => q.id !== questionId));
      setMessage("Question deleted.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to delete.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateQuestion(question: Question) {
    if (!formId) return;
    pushHistory(questions);
    setSaving(true); setMessage(""); setError("");
    try {
      const data = await api.post<{ question: Question }>(
        `/api/forms/${formId}/questions`,
        {
          label: `${question.label} (copy)`,
          type: question.type,
          required: question.required,
          ...(question.description ? { description: question.description } : {}),
          ...(question.options ? { options: question.options } : {}),
          ...(question.settings ? { settings: question.settings } : {}),
        },
      );
      // Insert copy right after the original
      setQuestions((current) => {
        const idx = current.findIndex((q) => q.id === question.id);
        const next = [...current];
        next.splice(idx + 1, 0, data.question);
        return next;
      });
      setMessage("Question duplicated.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to duplicate.");
    } finally {
      setSaving(false);
    }
  }

  async function addEditorQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formId || !newQuestionLabel.trim()) return;
    setAddingQuestion(true); setMessage(""); setError("");
    try {
      const data = await api.post<{ question: Question }>(
        `/api/forms/${formId}/questions`,
        {
          label: newQuestionLabel.trim(),
          type: newQuestionType,
          required: false,
          ...(RATING_TYPES.has(newQuestionType) ? { settings: { min: 1, max: 5 } } : {}),
          ...(newQuestionType === "LINEAR_SCALE" ? { settings: { min: 1, max: 10, minLabel: "Low", maxLabel: "High" } } : {}),
          ...(CHOICE_TYPES.has(newQuestionType)
            ? { options: [{ value: "option_1", label: "Option 1" }] }
            : {}),
          ...(newQuestionType === "FILE_UPLOAD" ? { settings: { maxFileSizeMB: 5, allowedFileTypes: ["image/*", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"] } } : {}),
        },
      );
      setQuestions((current) => [...current, data.question]);
      setNewQuestionLabel("");
      setNewQuestionType("SHORT_TEXT");
      setShowAddQuestion(false);
      setMessage("Question added.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to add question.");
    } finally {
      setAddingQuestion(false);
    }
  }

  async function addSection() {
    if (!formId) return;
    setMessage(""); setError("");
    try {
      const data = await api.post<{ section: { id: string; title: string } }>(
        `/api/forms/${formId}/sections`,
        {},
      );
      setSections((current) => [...current, { id: data.section.id, title: data.section.title }]);
      setMessage("Section added. Use “+ Question” within it to add questions.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to add section.");
    }
  }

  // Shared optimistic section PATCH used by both the title-blur rename and the
  // jump-rule editor, so both edits go through one request shape.
  async function patchSection(
    sectionId: string,
    patch: { title?: string; jumpRules?: SectionJumpRule[] },
  ) {
    if (!formId) return;
    setSections((current) =>
      current.map((s) => {
        if (s.id !== sectionId) return s;
        const next = { ...s };
        if (patch.title !== undefined) next.title = patch.title;
        if (patch.jumpRules !== undefined) next.jumpRules = patch.jumpRules;
        return next;
      }),
    );
    try {
      await api.patch(`/api/forms/${formId}/sections/${sectionId}`, patch);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to update section.");
    }
  }

  async function renameSection(sectionId: string, title: string) {
    if (!formId || !title.trim()) return;
    await patchSection(sectionId, { title: title.trim() });
  }

  async function deleteSectionById(sectionId: string) {
    if (!formId) return;
    if (sections.length <= 1) {
      setError("A form must keep at least one section.");
      return;
    }
    if (!confirm("Delete this section? Its questions move to the previous section.")) return;
    setError(""); setMessage("");
    try {
      await api.delete(`/api/forms/${formId}/sections/${sectionId}`);
      // Refresh in place so questions re-group under their new section correctly.
      await reloadEditorData();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to delete section.");
    }
  }

  async function addQuestionToSection(sectionId: string) {
    if (!formId) return;
    setError(""); setMessage("");
    try {
      const data = await api.post<{ question: Question }>(
        `/api/forms/${formId}/questions`,
        { label: "Untitled question", type: "SHORT_TEXT", required: false, sectionId },
      );
      setQuestions((current) => [...current, { ...data.question, sectionId }]);
      setActiveQuestionId(data.question.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to add question.");
    }
  }

  // ─── Drag and drop ────────────────────────────────────────────────────────

  function handleDragStart(index: number) {
    dragIndex.current = index;
    setDraggingIndex(index);
  }

  function handleDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    setDragOverIndex(index);
  }

  function handleDragEnd() {
    setDragOverIndex(null);
    setDraggingIndex(null);
    dragIndex.current = null;
  }

  async function handleDrop(event: DragEvent, dropIndex: number) {
    event.preventDefault();
    setDragOverIndex(null);

    const fromIndex = dragIndex.current;
    if (fromIndex === null || fromIndex === dropIndex) { dragIndex.current = null; return; }

    pushHistory(questions);
    const reordered = [...questions];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    setQuestions(reordered);
    dragIndex.current = null;

    if (!formId) return;
    try {
      await api.post(`/api/forms/${formId}/questions/reorder`, {
        questionIds: reordered.map((q) => q.id),
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to save order.");
    }
  }

  // ─── Approval ─────────────────────────────────────────────────────────────

  async function loadReviewers() {
    if (!form) return;
    try {
      const data = await api.get<{ members: MemberRecord[] }>(
        `/api/members?workspaceId=${encodeURIComponent(form.workspaceId)}`,
      );
      const eligible = data.members.filter((m) => m.role === "OWNER" || m.role === "ADMIN");
      setReviewers(eligible);
      if (eligible.length > 0 && !selectedReviewer) setSelectedReviewer(eligible[0].user.id);
    } catch { /* silently fail */ }
  }

  async function openReviewPanel() { setShowReviewPanel(true); await loadReviewers(); }

  async function submitForReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formId || !selectedReviewer) return;
    setSubmittingForReview(true); setError(""); setMessage("");
    try {
      const data = await api.post<{ form: FormRecord }>(
        `/api/approvals/${formId}/submit-for-review`,
        { reviewerId: selectedReviewer, ...(reviewMessage.trim() ? { message: reviewMessage.trim() } : {}) },
      );
      setForm(data.form); setShowReviewPanel(false); setReviewMessage("");
      setMessage("Form submitted for review.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to submit for review.");
    } finally { setSubmittingForReview(false); }
  }

  async function handleReviewDecision(decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED") {
    if (!formId) return;
    setReviewing(true); setError(""); setMessage("");
    try {
      const data = await api.post<{ form: FormRecord }>(
        `/api/approvals/${formId}/review`,
        { decision, ...(reviewComment.trim() ? { comment: reviewComment.trim() } : {}) },
      );
      setForm(data.form); setReviewComment("");
      setMessage({ APPROVED: "Form approved!", CHANGES_REQUESTED: "Changes requested.", REJECTED: "Form rejected." }[decision] ?? "Done.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to submit review.");
    } finally { setReviewing(false); }
  }

  async function handleCoverUpload(file: File) {
    if (!form) return;
    setCoverError("");
    setUploadingCover(true);
    try {
      const url = await uploadToCloudinary(form.slug, file);
      setCoverImageUrl(url);
    } catch (err) {
      setCoverError(
        err instanceof ApiRequestError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed. Please try again.",
      );
    } finally {
      setUploadingCover(false);
    }
  }

  async function saveFormSettings(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (!formId) return;
    setSavingSettings(true); setError(""); setMessage("");
    // Build the theme from set fields only. An empty object clears all theming
    // back to inherit/default (the API does a whole-object replace on `theme`).
    const theme: Record<string, string> = {};
    if (coverImageUrl) theme.coverImageUrl = coverImageUrl;
    if (accentColor) theme.accentColor = accentColor;
    if (backgroundColor) theme.backgroundColor = backgroundColor;
    if (fontFamily) theme.fontFamily = fontFamily;

    // Build the payment block. amount is required by the API schema even when
    // disabled, so carry the current value (or the ₹1 floor) when off. When
    // enabled, mirror the server floor exactly (≥ ₹1, integer paise in
    // [100, 15_000_000], ≤ 2 decimals) so a sub-₹1 entry is caught here.
    let payment: { enabled: boolean; amount: number; description?: string };
    if (paymentEnabled) {
      const rupees = Number(paymentAmountRupees);
      const amountPaise = Math.round(rupees * 100);
      if (
        !Number.isFinite(rupees) ||
        rupees < 1 ||
        Math.abs(amountPaise / 100 - rupees) > 1e-9 ||
        amountPaise < 100 ||
        amountPaise > 15_000_000
      ) {
        setSavingSettings(false);
        setError(
          "Enter a payment amount of at least ₹1 (up to ₹1,50,000, max 2 decimals).",
        );
        return;
      }
      payment = { enabled: true, amount: amountPaise };
      const desc = paymentDescription.trim();
      if (desc) payment.description = desc;
    } else {
      const currentRupees = Number(paymentAmountRupees);
      const currentPaise = Math.round(currentRupees * 100);
      payment = {
        enabled: false,
        amount:
          Number.isFinite(currentRupees) &&
          currentPaise >= 100 &&
          currentPaise <= 15_000_000
            ? currentPaise
            : 100,
      };
    }

    try {
      const data = await api.patch<{ form: FormRecord }>(
        `/api/forms/${formId}/settings`,
        {
          collectEmail,
          allowMultipleResponses,
          confirmationMessage,
          scheduledPublishAt: toIsoInstant(scheduledPublishAt),
          scheduledCloseAt: toIsoInstant(scheduledCloseAt),
          quizMode,
          showScore,
          responseNotification,
          sendConfirmationEmail,
          responseEditing,
          responseEditMinutes,
          payment,
          theme,
        },
      );
      setForm(data.form); setMessage("Settings saved.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to save settings.");
    } finally { setSavingSettings(false); }
  }

  async function publishEditorForm() {
    if (!formId) return;
    setSaving(true); setMessage(""); setError("");
    try {
      await api.post(`/api/forms/${formId}/publish`);
      setForm((f) => f ? { ...f, status: "PUBLISHED" } : f);
      setMessage("Form published! Share it from the Share page.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to publish.");
    } finally { setSaving(false); }
  }

  async function closeEditorForm() {
    if (!formId) return;
    setSaving(true); setMessage(""); setError("");
    try {
      await api.post(`/api/forms/${formId}/close`);
      setForm((f) => f ? { ...f, status: "CLOSED" } : f);
      setMessage("Form closed. No longer accepting responses.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to close.");
    } finally { setSaving(false); }
  }

  // ─── Render guards ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="editor-shell">
        <div className="editor-header" style={{ maxWidth: 980, margin: "0 auto 24px" }}>
          <div className="skeleton-block" style={{ width: 320, height: 40 }} />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="editor-card" style={{ marginBottom: 16 }}>
            <div className="skeleton-block" style={{ width: "60%", height: 20, marginBottom: 12 }} />
            <div className="skeleton-block" style={{ width: "40%", height: 16 }} />
          </div>
        ))}
      </main>
    );
  }

  if (error && !form) {
    return (
      <main className="page-shell">
        <div className="status-card error-card">
          <h1>Unable to load editor</h1>
          <p>{error}</p>
          <Link to="/dashboard">Back to dashboard</Link>
        </div>
      </main>
    );
  }

  if (!form) return null;

  const canSubmitForReview = form.status === "DRAFT" || form.status === "CHANGES_REQUESTED";
  const canReview = form.status === "PENDING_REVIEW";
  const canPublish = form.status === "APPROVED" || form.status === "DRAFT";
  const isPublished = form.status === "PUBLISHED";

  return (
    <main className="editor-shell">
      {/* ── Sticky Top Nav ── */}
      <nav className="editor-topnav">
        <div className="editor-topnav-inner">
          {/* Left: logo + title */}
          <div className="editor-topnav-left">
            <Link to="/dashboard" className="editor-topnav-logo">Qivo</Link>
            {editingTitle ? (
              <input
                className="editor-topnav-title-input"
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void saveTitle(titleDraft)}
                onKeyDown={(e) => { if (e.key === "Enter") void saveTitle(titleDraft); if (e.key === "Escape") setEditingTitle(false); }}
                autoFocus
              />
            ) : (
              <button
                className="editor-topnav-title"
                type="button"
                onClick={() => { setEditingTitle(true); setTitleDraft(form.title); }}
                title="Click to rename"
              >
                {form.title}
              </button>
            )}
            <SaveStatusBadge status={saveStatus} />
          </div>

          {/* Right: actions */}
          <div className="editor-topnav-actions">
            <button
              className="editor-topnav-btn"
              type="button"
              onClick={undo}
              disabled={undoDepth === 0}
              title="Undo (Ctrl+Z)"
              style={{ opacity: undoDepth === 0 ? 0.3 : 1 }}
            >↩</button>
            <button
              className="editor-topnav-btn"
              type="button"
              onClick={redo}
              disabled={redoDepth === 0}
              title="Redo (Ctrl+Y)"
              style={{ opacity: redoDepth === 0 ? 0.3 : 1 }}
            >↪</button>

            <Link className="editor-topnav-btn" to={`/forms/${formId}/preview`} title="Preview">👁</Link>

            {isPublished ? (
              <Link className="editor-topnav-btn" to={`/forms/${formId}/share`} title="Share / QR">🔗</Link>
            ) : null}

            {isPublished ? (
              <button className="editor-topnav-btn danger" type="button" disabled={saving} onClick={closeEditorForm} title="Close form">🔒</button>
            ) : null}

            {canSubmitForReview ? (
              <button className="editor-topnav-btn" type="button" disabled={saving} onClick={() => void openReviewPanel()} title="Submit for review">📋</button>
            ) : null}

            {canPublish ? (
              <button
                className="editor-topnav-publish"
                type="button"
                disabled={saving}
                onClick={publishEditorForm}
              >
                {form.status === "APPROVED" ? "Publish ✓" : "Publish"}
              </button>
            ) : null}
          </div>
        </div>
      </nav>

      {message ? <p className="editor-message" role="status">{message}</p> : null}
      {error ? <p className="submit-error" role="alert">{error}</p> : null}

      {/* ── Workspace Tabs ── */}
      <div className="editor-tabs">
        <button type="button" className={`editor-tab ${activeTab === "builder" ? "active" : ""}`} onClick={() => setActiveTab("builder")}>
          Builder
        </button>
        <button type="button" className={`editor-tab ${activeTab === "responses" ? "active" : ""}`} onClick={() => setActiveTab("responses")}>
          Responses
        </button>
        <button type="button" className={`editor-tab ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
          Settings
        </button>
        <button type="button" className={`editor-tab ${activeTab === "appearance" ? "active" : ""}`} onClick={() => setActiveTab("appearance")}>
          Appearance
        </button>
        <button type="button" className={`editor-tab ${activeTab === "webhooks" ? "active" : ""}`} onClick={() => setActiveTab("webhooks")}>
          Webhooks
        </button>
      </div>

      {/* ── TAB: Builder ── */}
      {activeTab === "builder" ? (
        <>

      {/* ── Review panel (admin) ── */}
      {canReview ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 20px" }}>
          <div className="editor-card-header">
            <div><p className="eyebrow">Review required</p><h2>Awaiting your review</h2></div>
          </div>
          <p className="muted" style={{ marginBottom: 16 }}>Review questions below, then approve or request changes.</p>
          <div className="question-field">
            <label htmlFor="review-comment">Comment (optional)</label>
            <textarea id="review-comment" rows={3} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="Add feedback..." />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button className="secondary-button" type="button" disabled={reviewing} onClick={() => void handleReviewDecision("APPROVED")} style={{ background: "#16a34a", color: "#fff", border: "none" }}>{reviewing ? "..." : "Approve"}</button>
            <button className="secondary-button" type="button" disabled={reviewing} onClick={() => void handleReviewDecision("CHANGES_REQUESTED")} style={{ background: "#f59e0b", color: "#fff", border: "none" }}>{reviewing ? "..." : "Request changes"}</button>
            <button className="danger-button" type="button" disabled={reviewing} onClick={() => void handleReviewDecision("REJECTED")}>{reviewing ? "..." : "Reject"}</button>
          </div>
        </section>
      ) : null}

      {/* ── Submit for review panel ── */}
      {showReviewPanel ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 20px" }}>
          <div className="editor-card-header">
            <div><p className="eyebrow">Approval workflow</p><h2>Submit for review</h2></div>
            <button className="back-button inline-button" type="button" onClick={() => setShowReviewPanel(false)}>Cancel</button>
          </div>
          <form onSubmit={submitForReview}>
            <div className="question-field">
              <label htmlFor="reviewer-select">Select reviewer</label>
              {reviewers.length === 0
                ? <p className="muted">No eligible reviewers found (needs Owner or Admin role).</p>
                : (
                  <select id="reviewer-select" value={selectedReviewer} onChange={(e) => setSelectedReviewer(e.target.value)} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
                    {reviewers.map((r) => (
                      <option key={r.user.id} value={r.user.id}>{r.user.name} — {r.role}</option>
                    ))}
                  </select>
                )}
            </div>
            <div className="question-field">
              <label htmlFor="review-msg">Message (optional)</label>
              <textarea id="review-msg" rows={3} value={reviewMessage} onChange={(e) => setReviewMessage(e.target.value)} placeholder="Notes for the reviewer..." />
            </div>
            <button className="secondary-button" type="submit" disabled={submittingForReview || !selectedReviewer || reviewers.length === 0}>
              {submittingForReview ? "Submitting..." : "Send for review"}
            </button>
          </form>
        </section>
      ) : null}

      {/* ── Changes requested banner ── */}
      {form.status === "CHANGES_REQUESTED" ? (
        <div style={{ maxWidth: 980, margin: "0 auto 20px", background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 12, padding: "16px 20px", color: "#92400e" }}>
          <strong>Changes requested</strong>
          <p style={{ margin: "6px 0 0" }}>Edit the questions below and resubmit when ready.</p>
        </div>
      ) : null}

      {/* ── Form Header Card (accent-bordered) ── */}
      <section className="editor-form-header-card">
        <div className="editor-form-header-accent" />
        <div className="editor-form-header-content">
          <h2 className="editor-form-header-title">{form.title}</h2>
          {form.description ? (
            <p className="editor-form-header-desc">{form.description}</p>
          ) : (
            <p className="editor-form-header-desc" style={{ color: "#94a3b8", fontStyle: "italic" }}>
              No description
            </p>
          )}
          <div className="editor-form-header-meta">
            <span className={`status-pill status-${form.status.toLowerCase()}`}>
              {form.status.replace(/_/g, " ")}
            </span>
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              {questions.length} question{questions.length !== 1 ? "s" : ""}
            </span>
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              Updated {new Date(form.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </section>

      {/* ── Questions ── */}
      <section className="editor-card">
        <div className="editor-card-header">
          <div>
            <p className="eyebrow">Questions</p>
            <h2>{questions.length} question{questions.length !== 1 ? "s" : ""}</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => setShowAddQuestion((v) => !v)}>
            {showAddQuestion ? "Cancel" : "+ Add question"}
          </button>
        </div>

        {/* ── Add question form ── */}
        {showAddQuestion ? (
          <form className="add-question-form" onSubmit={addEditorQuestion}>
            <div>
              <label htmlFor="new-question-label">Question label</label>
              <input
                id="new-question-label"
                type="text"
                value={newQuestionLabel}
                onChange={(e) => setNewQuestionLabel(e.target.value)}
                placeholder="e.g. What could we improve?"
                autoFocus
                required
              />
            </div>
            <div>
              <label htmlFor="new-question-type">Type</label>
              <select id="new-question-type" value={newQuestionType} onChange={(e) => setNewQuestionType(e.target.value as QuestionType)}>
                {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
                  <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="add-question-actions">
              <button className="secondary-button compact" type="submit" disabled={addingQuestion || !newQuestionLabel.trim()}>
                {addingQuestion ? "Adding..." : "Add"}
              </button>
            </div>
          </form>
        ) : null}

        {questions.length === 0 && sections.length <= 1 ? (
          <div className="empty-state" style={{ textAlign: "center", padding: "32px 0" }}>
            <p style={{ fontSize: "1.5rem", marginBottom: 8 }}>📝</p>
            <p className="muted">No questions yet. Click "+ Add question" to start.</p>
          </div>
        ) : (
          <div className="editor-canvas-with-toolbar">
            <div className="editor-question-list">
              {(() => {
                // Group questions by section while preserving each card's GLOBAL
                // index into the flat `questions` array so drag-drop stays valid.
                const groups =
                  sections.length > 0
                    ? sections
                    : [{ id: "__default__", title: "" }];
                // Only show section chrome when there's more than one section.
                const showSectionChrome = sections.length > 1;
                return groups.map((section, sectionIndex) => {
                  const sectionQuestions = questions
                    .map((q, index) => ({ q, index }))
                    .filter(({ q }) =>
                      section.id === "__default__"
                        ? true
                        : (q.sectionId ?? sections[0]?.id) === section.id,
                    );
                  // In-section questions (the real Question objects) — the
                  // trigger-question source for the jump editor.
                  const inSectionQuestions = questions.filter(
                    (q) => (q.sectionId ?? sections[0]?.id) === section.id,
                  );
                  // Sections strictly AFTER this one in document order are the
                  // only valid forward jump targets.
                  const laterSections = sections.slice(sectionIndex + 1);
                  return (
                    <div key={section.id} className="editor-section-group">
                      {showSectionChrome ? (
                        <div
                          className="editor-section-header"
                          style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 12px" }}
                        >
                          <input
                            type="text"
                            defaultValue={section.title}
                            onBlur={(e) => {
                              if (e.target.value.trim() && e.target.value.trim() !== section.title) {
                                void renameSection(section.id, e.target.value);
                              }
                            }}
                            style={{
                              flex: 1, fontWeight: 700, fontSize: "1rem",
                              border: "none", borderBottom: "2px solid #e2e8f0",
                              padding: "6px 2px", background: "transparent",
                            }}
                            aria-label="Section title"
                          />
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => void deleteSectionById(section.id)}
                            title="Delete section"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}

                      {showSectionChrome ? (
                        <SectionJumpEditor
                          rules={section.jumpRules ?? []}
                          inSectionQuestions={inSectionQuestions}
                          laterSections={laterSections}
                          onChange={(nextRules) =>
                            void patchSection(section.id, {
                              title: section.title,
                              jumpRules: nextRules,
                            })
                          }
                        />
                      ) : null}

                      {sectionQuestions.map(({ q: question, index }) => (
                        <QuestionCard
                          key={question.id}
                          question={question}
                          index={index}
                          total={questions.length}
                          saving={saving}
                          isDragOver={dragOverIndex === index}
                          isDragging={draggingIndex === index}
                          allQuestions={questions}
                          isQuizMode={quizMode}
                          isActive={activeQuestionId === question.id}
                          onActivate={() => setActiveQuestionId(question.id)}
                          onDragStart={() => handleDragStart(index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDrop={(e) => void handleDrop(e, index)}
                          onDragEnd={handleDragEnd}
                          onChange={updateQuestionLocal}
                          onDelete={() => void deleteEditorQuestion(question.id)}
                          onDuplicate={() => void duplicateQuestion(question)}
                        />
                      ))}

                      {showSectionChrome ? (
                        <button
                          type="button"
                          className="secondary-button compact"
                          style={{ marginTop: 4 }}
                          onClick={() => void addQuestionToSection(section.id)}
                        >
                          + Question in this section
                        </button>
                      ) : null}
                    </div>
                  );
                });
              })()}
            </div>

            {/* Floating creation toolbar */}
            <div className="editor-floating-toolbar">
              <button
                className="editor-floating-btn"
                type="button"
                onClick={() => setShowAddQuestion(true)}
                title="Add question"
              >
                <span>＋</span>
                <span className="editor-floating-label">Question</span>
              </button>
              <button
                className="editor-floating-btn"
                type="button"
                onClick={() => void addSection()}
                title="Add section"
              >
                <span>§</span>
                <span className="editor-floating-label">Section</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Version history ── */}
      <VersionHistory formId={formId!} />

        </>
      ) : null}

      {/* ── TAB: Responses ── */}
      {activeTab === "responses" ? (
        <ResponsesTabPanel formId={formId!} formTitle={form.title} questions={questions} />
      ) : null}

      {/* ── TAB: Webhooks ── */}
      {activeTab === "webhooks" ? (
        <WebhooksTabPanel formId={formId!} />
      ) : null}

      {/* ── TAB: Settings ── */}
      {activeTab === "settings" ? (
        <section className="editor-card settings-card">
          <div className="editor-card-header">
            <div><p className="eyebrow">Settings</p><h2>Form configuration</h2></div>
            <button className="secondary-button compact" type="button" onClick={(e) => void saveFormSettings(e)} disabled={savingSettings}>
              {savingSettings ? "Saving..." : "Save all"}
            </button>
          </div>
          <form onSubmit={saveFormSettings}>
            <SettingsGroup title="Collection" description="How responses are collected" summary={`${collectEmail ? "Email required" : "Anonymous"} · ${allowMultipleResponses ? "Multiple allowed" : "One per person"}`}>
              <label className="settings-toggle"><input type="checkbox" checked={collectEmail} onChange={(e) => setCollectEmail(e.target.checked)} /><span><strong>Collect email addresses</strong><small>Ask respondents to provide their email.</small></span></label>
              <label className="settings-toggle"><input type="checkbox" checked={allowMultipleResponses} onChange={(e) => setAllowMultipleResponses(e.target.checked)} /><span><strong>Allow multiple responses</strong><small>Let the same person submit more than once.</small></span></label>
              <label className="settings-toggle"><input type="checkbox" checked={quizMode} onChange={(e) => setQuizMode(e.target.checked)} /><span><strong>Quiz mode</strong><small>Enable scoring — set correct answers per question.</small></span></label>
              {quizMode ? (<label className="settings-toggle"><input type="checkbox" checked={showScore} onChange={(e) => setShowScore(e.target.checked)} /><span><strong>Show score after submission</strong><small>Respondent sees their score.</small></span></label>) : null}
              <div className="question-field"><label htmlFor="s-response-notification">Email me about new responses</label><select id="s-response-notification" value={responseNotification} onChange={(e) => setResponseNotification(e.target.value as "off" | "immediate" | "daily")} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }}><option value="off">Off</option><option value="immediate">Immediately</option><option value="daily">Daily digest</option></select><small className="muted">Get notified by email when this form receives responses.</small></div>
              <label className="settings-toggle" style={collectEmail ? undefined : { opacity: 0.5 }}><input type="checkbox" checked={sendConfirmationEmail} disabled={!collectEmail} onChange={(e) => setSendConfirmationEmail(e.target.checked)} /><span><strong>Send respondents a confirmation email</strong><small>{collectEmail ? "Email respondents a copy of their submission." : "Turn on 'Collect email addresses' to enable."}</small></span></label>
            </SettingsGroup>
            <SettingsGroup title="Access & Schedule" description="When the form opens and closes" summary={`${scheduledPublishAt ? "Scheduled" : "Manual publish"} · ${scheduledCloseAt ? "Auto-close set" : "No close date"}`}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div className="question-field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="s-publish">Scheduled publish</label><input id="s-publish" type="datetime-local" value={scheduledPublishAt} onChange={(e) => setScheduledPublishAt(e.target.value)} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }} /><small className="muted">Form becomes public at this time.</small></div>
                <div className="question-field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="s-close">Scheduled close</label><input id="s-close" type="datetime-local" value={scheduledCloseAt} onChange={(e) => setScheduledCloseAt(e.target.value)} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }} /><small className="muted">Stops accepting responses at this time.</small></div>
              </div>
              <div className="question-field"><label htmlFor="s-response-editing">Let respondents edit their response</label><select id="s-response-editing" value={responseEditing} onChange={(e) => setResponseEditing(e.target.value as "disabled" | "timed" | "until_close")} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }}><option value="disabled">Off</option><option value="timed">Allow editing for a few minutes</option><option value="until_close">Allow editing until the form closes</option></select><small className="muted">Respondents can correct their own just-submitted response in the same session.</small></div>
              {responseEditing === "timed" ? (<div className="question-field"><label htmlFor="s-response-edit-minutes">Editing window (minutes)</label><input id="s-response-edit-minutes" type="number" min={1} max={1440} value={responseEditMinutes} onChange={(e) => setResponseEditMinutes(Math.max(1, Math.min(1440, Number(e.target.value) || 1)))} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }} /><small className="muted">How long after submitting a respondent can edit (1–1440).</small></div>) : null}
            </SettingsGroup>
            <SettingsGroup title="Presentation" description="What respondents see after submitting" summary={confirmationMessage ? "Custom message set" : "Default message"}>
              <div className="question-field"><label htmlFor="s-confirm">Confirmation message</label><textarea id="s-confirm" rows={3} value={confirmationMessage} onChange={(e) => setConfirmationMessage(e.target.value)} placeholder="Thanks for your response." /><small className="muted">Shown to respondents after they submit.</small></div>
            </SettingsGroup>
            <SettingsGroup title="Payments" description="Require a payment before respondents can submit" summary={paymentEnabled ? `Required · ₹${paymentAmountRupees || "0"}` : "Off"}>
              <label className="settings-toggle"><input type="checkbox" checked={paymentEnabled} onChange={(e) => setPaymentEnabled(e.target.checked)} /><span><strong>Require payment to submit</strong><small>Respondents pay with Razorpay before their response is saved.</small></span></label>
              {paymentEnabled ? (
                <>
                  <div className="question-field">
                    <label htmlFor="s-payment-amount">Amount (₹)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span aria-hidden="true" style={{ color: "#64748b" }}>₹</span>
                      <input id="s-payment-amount" type="number" min={1} max={150000} step="0.01" inputMode="decimal" value={paymentAmountRupees} onChange={(e) => setPaymentAmountRupees(e.target.value)} placeholder="100" style={{ flex: 1, border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }} />
                    </div>
                    <small className="muted">Fixed amount per response. Minimum ₹1 (up to ₹1,50,000).</small>
                  </div>
                  <div className="question-field">
                    <label htmlFor="s-payment-description">Payment description (optional)</label>
                    <textarea id="s-payment-description" rows={2} maxLength={300} value={paymentDescription} onChange={(e) => setPaymentDescription(e.target.value)} placeholder="Shown to the respondent in Checkout." />
                    <small className="muted">Up to 300 characters.</small>
                  </div>
                  <small className="muted">Razorpay keys must be set on the server to collect live payments.</small>
                </>
              ) : null}
            </SettingsGroup>
          </form>
        </section>
      ) : null}

      {/* ── TAB: Appearance ── */}
      {activeTab === "appearance" ? (
        <section className="editor-card settings-card">
          <div className="editor-card-header">
            <div><p className="eyebrow">Appearance</p><h2>Theme &amp; branding</h2></div>
            <button className="secondary-button compact" type="button" onClick={(e) => void saveFormSettings(e)} disabled={savingSettings}>
              {savingSettings ? "Saving..." : "Save all"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 320px)", gap: 24 }}>
            {/* Controls */}
            <div style={{ display: "grid", gap: 20 }}>
              {/* Cover image */}
              <div className="question-field">
                <label>Cover image</label>
                <small className="muted" style={{ display: "block", marginBottom: 8 }}>
                  Shown as a banner at the top of the form.
                </small>
                {form.status === "PUBLISHED" ? (
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingCover}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleCoverUpload(file);
                      e.target.value = "";
                    }}
                  />
                ) : (
                  <small className="muted">
                    Publish the form to upload a cover image, or paste an image URL below.
                  </small>
                )}
                {uploadingCover ? <small className="muted">Uploading…</small> : null}
                {coverError ? <p className="submit-error" role="alert">{coverError}</p> : null}
                <input
                  type="url"
                  value={coverImageUrl}
                  onChange={(e) => setCoverImageUrl(e.target.value)}
                  placeholder="https://example.com/cover.jpg"
                  style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px", marginTop: 8 }}
                />
                {coverImageUrl ? (
                  <button type="button" className="secondary-button compact" style={{ marginTop: 8 }} onClick={() => setCoverImageUrl("")}>
                    Remove cover
                  </button>
                ) : null}
              </div>

              {/* Accent color */}
              <div className="question-field">
                <label htmlFor="a-accent">Accent color</label>
                <small className="muted" style={{ display: "block", marginBottom: 8 }}>
                  Overrides the workspace brand color for this form.
                </small>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    id="a-accent"
                    type="color"
                    value={accentColor || DEFAULT_ACCENT}
                    onChange={(e) => setAccentColor(e.target.value)}
                  />
                  <span className="muted">{accentColor || "Inherit workspace color"}</span>
                  {accentColor ? (
                    <button type="button" className="secondary-button compact" onClick={() => setAccentColor("")}>
                      Reset to workspace color
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Background */}
              <div className="question-field">
                <label htmlFor="a-bg">Background color</label>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    id="a-bg"
                    type="color"
                    value={backgroundColor || "#f8fafc"}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                  />
                  <span className="muted">{backgroundColor || "Default"}</span>
                  {backgroundColor ? (
                    <button type="button" className="secondary-button compact" onClick={() => setBackgroundColor("")}>
                      Reset
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Font */}
              <div className="question-field">
                <label htmlFor="a-font">Font</label>
                <select
                  id="a-font"
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }}
                >
                  <option value="">Default</option>
                  {FONT_ALLOW_LIST.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Live preview */}
            <AppearancePreview
              title={form.title}
              coverImageUrl={coverImageUrl}
              accentColor={accentColor}
              backgroundColor={backgroundColor}
              fontFamily={fontFamily}
            />
          </div>
        </section>
      ) : null}

    </main>
  );
}

/**
 * Scaled-down live preview of the public form header + a sample question,
 * reusing resolveTheme + ensureFontLoaded so it matches the real public form.
 * It intentionally resolves the per-form theme only (no workspace primaryColor);
 * the caption notes that the workspace brand color applies on the live form.
 */
function AppearancePreview({
  title,
  coverImageUrl,
  accentColor,
  backgroundColor,
  fontFamily,
}: {
  title: string;
  coverImageUrl: string;
  accentColor: string;
  backgroundColor: string;
  fontFamily: string;
}) {
  const resolved = resolveTheme({
    ...(coverImageUrl ? { coverImageUrl } : {}),
    ...(accentColor ? { accentColor } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(fontFamily ? { fontFamily } : {}),
  });
  ensureFontLoaded(fontFamily || undefined);
  const previewAccent = resolved.accent ?? DEFAULT_ACCENT;

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Live preview</p>
      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 16,
          background: resolved.background ?? "#ffffff",
          ...(resolved.fontFamily ? { fontFamily: resolved.fontFamily } : {}),
        }}
      >
        {resolved.coverImageUrl ? (
          <img
            src={resolved.coverImageUrl}
            alt=""
            style={{ width: "100%", height: "auto", borderRadius: 8, marginBottom: 12, objectFit: "cover" }}
          />
        ) : null}
        <p className="eyebrow" style={{ color: previewAccent, margin: 0 }}>Your workspace</p>
        <h3 style={{ margin: "4px 0 12px" }}>{title || "Form title"}</h3>
        <div className="question-field" style={{ marginBottom: 12 }}>
          <label><span className="question-label">Sample question</span></label>
          <input type="text" placeholder="Your answer..." disabled style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }} />
        </div>
        <button type="button" className="submit-button" style={{ background: previewAccent, maxWidth: 200 }} disabled>
          Submit response
        </button>
      </div>
      <small className="muted" style={{ display: "block", marginTop: 8 }}>
        Workspace brand color is applied on the live form.
      </small>
    </div>
  );
}

// ─── Question Card ────────────────────────────────────────────────────────────

/**
 * Editor-only helper: replaces each `{{id}}` token in a raw label with the
 * referenced question's label wrapped in brackets, e.g.
 * `Confirm {{question_x}}'s size` -> `Confirm [Team captain name]'s size`.
 * Unknown ids become `[unknown reference]`. This gives the author a readable
 * sense of the token without live answers; it never reaches respondents.
 */
function previewLabelWithPlaceholders(label: string, allQuestions: Question[]): string {
  // `.replace` with a fresh call manages the global regex's lastIndex safely.
  return label.replace(PIPING_TOKEN_RE, (_match, id: string) => {
    const ref = allQuestions.find((q) => q.id === id);
    return ref ? `[${ref.label.trim() || "Untitled question"}]` : "[unknown reference]";
  });
}

function QuestionCard({
  question,
  index,
  saving,
  isDragOver,
  isDragging,
  allQuestions,
  isQuizMode,
  isActive,
  onActivate,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onChange,
  onDelete,
  onDuplicate,
}: {
  question: Question;
  index: number;
  total: number;
  saving: boolean;
  isDragOver: boolean;
  isDragging: boolean;
  allQuestions: Question[];
  isQuizMode: boolean;
  isActive: boolean;
  onActivate: () => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onChange: (id: string, patch: Partial<Question>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const isChoice = CHOICE_TYPES.has(question.type);
  const isRating = RATING_TYPES.has(question.type);

  function addOption() {
    const existing = question.options ?? [];
    const newOption: QuestionOption = {
      value: `option_${Date.now()}`,
      label: `Option ${existing.length + 1}`,
    };
    onChange(question.id, { options: [...existing, newOption] });
  }

  function updateOption(idx: number, label: string) {
    const updated = (question.options ?? []).map((o, i) =>
      i === idx ? { ...o, label, value: label.toLowerCase().replace(/\s+/g, "_") || o.value } : o,
    );
    onChange(question.id, { options: updated });
  }

  function removeOption(idx: number) {
    const updated = (question.options ?? []).filter((_, i) => i !== idx);
    onChange(question.id, { options: updated });
  }

  return (
    <article
      className={`editor-question ${isDragOver ? "drag-over" : ""} ${isDragging ? "dragging" : ""} ${isActive ? "active-card" : "inactive-card"}`}
      draggable={!isActive}
      onDragStart={(e) => { if ((e.target as HTMLElement).closest("input, textarea, select")) { e.preventDefault(); return; } onDragStart(); }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onActivate}
      style={{ cursor: isDragging ? "grabbing" : isActive ? "default" : "pointer" }}
    >
      {/* Drag handle + number */}
      <div
        className="editor-question-number"
        title="Drag to reorder"
        style={{ cursor: "grab", userSelect: "none" }}
      >
        <span style={{ fontSize: "0.7rem", color: "#94a3b8" }}>⠿</span>
        <br />
        <span style={{ fontSize: "0.8rem" }}>{index + 1}</span>
      </div>

      <div className="editor-question-body">
        {/* ── Inactive view: minimal info ── */}
        {!isActive ? (
          <div className="editor-question-meta" style={{ gap: 10 }}>
            <span className="status-pill" style={{ fontSize: "0.7rem" }}>
              {QUESTION_TYPE_LABELS[question.type]}
            </span>
            <span style={{ flex: 1, color: "#1e293b", fontWeight: 600, fontSize: "0.95rem" }}>
              {question.label || "Untitled question"}
            </span>
            {question.required ? (
              <span style={{ color: "#dc2626", fontSize: "0.75rem", fontWeight: 700 }}>Required</span>
            ) : null}
          </div>
        ) : null}

        {/* ── Active view: full editing controls ── */}
        {isActive ? (
          <>
            {/* Type selector + Meta */}
            <div className="editor-question-meta" style={{ marginBottom: 12, gap: 10 }}>
              <select
                value={question.type}
                onChange={(e) => {
                  const newType = e.target.value as QuestionType;
                  // Preserve compatible data, reset type-specific fields
                  const patch: Partial<Question> = { type: newType };
                  // Reset options if switching away from choice types
                  if (!CHOICE_TYPES.has(newType) && CHOICE_TYPES.has(question.type)) {
                    patch.options = undefined;
                  }
                  // Add default options if switching TO choice types
                  if (CHOICE_TYPES.has(newType) && !question.options?.length) {
                    patch.options = [{ value: "option_1", label: "Option 1" }];
                  }
                  // Reset settings for rating/scale
                  if (RATING_TYPES.has(newType) && !question.settings?.min) {
                    patch.settings = { ...question.settings, min: 1, max: newType === "LINEAR_SCALE" ? 10 : 5 };
                  }
                  // SIGNATURE reads no settings; clear any leftover FILE_UPLOAD
                  // settings for tidiness (they would be inert otherwise).
                  if (newType === "SIGNATURE") {
                    patch.settings = undefined;
                  }
                  onChange(question.id, patch);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  padding: "5px 10px",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "#334155",
                  background: "#f8fafc",
                  cursor: "pointer",
                }}
              >
                {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
                  <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                {question.required ? "Required" : "Optional"}
              </span>
            </div>

            {/* Label */}
            <label htmlFor={`editor-label-${question.id}`}>Question label</label>
            <input
              id={`editor-label-${question.id}`}
              type="text"
              value={question.label}
              onChange={(e) => onChange(question.id, { label: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />

            {/* Answer piping: insert a reference to an EARLIER question's answer */}
            {(() => {
              // Only questions BEFORE this one can be piped (same filter as
              // ConditionEditor). A hand-crafted forward/self reference still
              // degrades gracefully at render time, but the UI never offers one.
              const earlierQuestions = allQuestions.filter(
                (q) => q.id !== question.id && allQuestions.indexOf(q) < allQuestions.indexOf(question),
              );
              const hasTokens = question.label.match(PIPING_TOKEN_RE) !== null;
              return (
                <div style={{ marginTop: 6 }}>
                  <select
                    value=""
                    disabled={earlierQuestions.length === 0}
                    title={earlierQuestions.length === 0 ? "Add questions above first" : "Insert answer reference"}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      const sep = question.label && !question.label.endsWith(" ") ? " " : "";
                      onChange(question.id, { label: `${question.label}${sep}{{${id}}}` });
                      // Reset back to the placeholder so the same reference can
                      // be inserted again.
                      e.target.value = "";
                    }}
                    style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "5px 10px", fontSize: "0.78rem", color: "#334155", background: "#f8fafc" }}
                  >
                    <option value="" disabled>
                      Insert answer reference
                    </option>
                    {earlierQuestions.map((q) => (
                      <option key={q.id} value={q.id}>{q.label.slice(0, 30) || "Untitled question"}</option>
                    ))}
                  </select>
                  {hasTokens ? (
                    <p className="muted" style={{ fontSize: "0.78rem", marginTop: 6 }}>
                      Preview: {previewLabelWithPlaceholders(question.label, allQuestions)}
                    </p>
                  ) : null}
                </div>
              );
            })()}

            {/* Description */}
            <label
              htmlFor={`editor-desc-${question.id}`}
              style={{ marginTop: 12, display: "block" }}
            >
              Description <span className="muted">(optional)</span>
            </label>
            <input
              id={`editor-desc-${question.id}`}
              type="text"
              value={question.description ?? ""}
              onChange={(e) => onChange(question.id, { description: e.target.value || null })}
              placeholder="Add a hint or explanation..."
              onClick={(e) => e.stopPropagation()}
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px", width: "100%", marginBottom: 12 }}
            />

            {/* Required toggle */}
            <label className="editor-checkbox">
              <input
                type="checkbox"
                checked={question.required}
                onChange={(e) => onChange(question.id, { required: e.target.checked })}
              />
              Required question
            </label>

            {/* Choice options editor */}
            {isChoice ? (
              <div style={{ marginTop: 14 }}>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 750, fontSize: "0.86rem" }}>
                  Options
                </label>
                <div style={{ display: "grid", gap: 8 }}>
                  {(question.options ?? []).map((option, idx) => (
                    <div key={option.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="text"
                        value={option.label}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        style={{ flex: 1, border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px" }}
                        placeholder={`Option ${idx + 1}`}
                      />
                      {(question.options ?? []).length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeOption(idx)}
                          style={{ border: "none", background: "none", color: "#94a3b8", fontSize: "1.1rem", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}
                          title="Remove option"
                          aria-label="Remove option"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="back-button inline-button"
                  style={{ marginTop: 10, fontSize: "0.82rem" }}
                  onClick={addOption}
                >
                  + Add option
                </button>
              </div>
            ) : null}

            {/* Rating range editor */}
            {isRating ? (
              <div style={{ display: "flex", gap: 16, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 750, marginBottom: 4 }}>Min</label>
                  <input
                    type="number"
                    value={question.settings?.min ?? 1}
                    min={0}
                    max={9}
                    onChange={(e) => onChange(question.id, { settings: { ...question.settings, min: Number(e.target.value) } })}
                    style={{ width: 64, border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 750, marginBottom: 4 }}>Max</label>
                  <input
                    type="number"
                    value={question.settings?.max ?? 5}
                    min={2}
                    max={10}
                    onChange={(e) => onChange(question.id, { settings: { ...question.settings, max: Number(e.target.value) } })}
                    style={{ width: 64, border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}
                  />
                </div>
                {question.type === "LINEAR_SCALE" ? (
                  <>
                    <div>
                      <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 750, marginBottom: 4 }}>Low label</label>
                      <input
                        type="text"
                        value={question.settings?.minLabel ?? ""}
                        onChange={(e) => onChange(question.id, { settings: { ...question.settings, minLabel: e.target.value } })}
                        placeholder="e.g. Not at all"
                        style={{ width: 120, border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 750, marginBottom: 4 }}>High label</label>
                      <input
                        type="text"
                        value={question.settings?.maxLabel ?? ""}
                        onChange={(e) => onChange(question.id, { settings: { ...question.settings, maxLabel: e.target.value } })}
                        placeholder="e.g. Extremely"
                        style={{ width: 120, border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px" }}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {/* File upload settings */}
            {question.type === "FILE_UPLOAD" ? (
              <div style={{marginTop: 14}}>
                <label style={{display: "block", fontSize: "0.82rem", fontWeight: 750, marginBottom: 8}}>File upload settings</label>
                <div style={{display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start"}}>
                  <div>
                    <label style={{display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4}}>Max size (MB)</label>
                    <input
                      type="number"
                      value={question.settings?.maxFileSizeMB ?? 5}
                      min={1}
                      max={50}
                      onChange={(e) => onChange(question.id, { settings: { ...question.settings, maxFileSizeMB: Number(e.target.value) } })}
                      style={{width: 80, border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px"}}
                    />
                  </div>
                  <div>
                    <label style={{display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4}}>Allowed file types</label>
                    <div style={{display: "flex", flexDirection: "column", gap: 6}}>
                      {([
                        { label: "Images (jpg, png, gif, webp…)", mime: "image/*" },
                        { label: "PDF", mime: "application/pdf" },
                        { label: "Word (.docx)", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
                        { label: "Word legacy (.doc)", mime: "application/msword" },
                        { label: "Excel (.xlsx)", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
                        { label: "Excel legacy (.xls)", mime: "application/vnd.ms-excel" },
                        { label: "PowerPoint (.pptx)", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
                        { label: "PowerPoint legacy (.ppt)", mime: "application/vnd.ms-powerpoint" },
                      ]).map(({ label, mime }) => {
                        const allowed = question.settings?.allowedFileTypes ?? [];
                        const checked = allowed.includes(mime);
                        return (
                          <label key={mime} style={{display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", cursor: "pointer"}}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const current = question.settings?.allowedFileTypes ?? [];
                                const next = e.target.checked
                                  ? [...current, mime]
                                  : current.filter((t) => t !== mime);
                                onChange(question.id, { settings: { ...question.settings, allowedFileTypes: next } });
                              }}
                            />
                            {label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <p className="muted" style={{marginTop: 6, fontSize: "0.75rem"}}>
                  Select which file types respondents may upload.
                </p>
              </div>
            ) : null}

            {/* Multi-entry preview */}
            {question.type === "MULTI_ENTRY" ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <input
                    type="text"
                    disabled
                    placeholder="Entry 1"
                    style={{
                      border: "1px solid #cbd5e1",
                      borderRadius: 10,
                      padding: "10px 12px",
                      background: "#f8fafc",
                      color: "#94a3b8",
                      width: "100%",
                    }}
                  />
                </div>
                <span
                  style={{
                    display: "inline-block",
                    marginTop: 8,
                    fontSize: "0.82rem",
                    color: "#94a3b8",
                    cursor: "default",
                  }}
                >
                  + Add another
                </span>
              </div>
            ) : null}

            {/* Signature preview (static placeholder — no live canvas) */}
            {question.type === "SIGNATURE" ? (
              <div style={{ marginTop: 14 }}>
                <div
                  style={{
                    border: "2px dashed #cbd5e1",
                    borderRadius: 12,
                    padding: "24px 16px",
                    textAlign: "center",
                    background: "#f8fafc",
                  }}
                >
                  <p style={{ margin: "0 0 4px", color: "#475569", fontWeight: 600 }}>Signature</p>
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.82rem" }}>Respondent signs here</p>
                </div>
              </div>
            ) : null}

            {/* Quiz mode: correct answer + points */}
            {isQuizMode ? (
              <div style={{ marginTop: 14, padding: "12px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10 }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 750, color: "#166534", display: "block", marginBottom: 10 }}>
                  Quiz scoring
                </span>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>Correct answer</label>
                    {question.options ? (
                      <select
                        value={question.settings?.correctAnswer ?? ""}
                        onChange={(e) => onChange(question.id, { settings: { ...question.settings, correctAnswer: e.target.value || undefined } })}
                        style={{ width: "100%", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 10px", fontSize: "0.85rem" }}
                      >
                        <option value="">Not set</option>
                        {question.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={question.settings?.correctAnswer ?? ""}
                        onChange={(e) => onChange(question.id, { settings: { ...question.settings, correctAnswer: e.target.value || undefined } })}
                        placeholder="Correct value..."
                        style={{ width: "100%", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 10px", fontSize: "0.85rem" }}
                      />
                    )}
                  </div>
                  <div style={{ width: 80 }}>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>Points</label>
                    <input
                      type="number"
                      value={question.settings?.points ?? 1}
                      min={0}
                      max={100}
                      onChange={(e) => onChange(question.id, { settings: { ...question.settings, points: Number(e.target.value) } })}
                      style={{ width: "100%", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {/* Conditional logic */}
            <ConditionEditor
              question={question}
              allQuestions={allQuestions}
              onChange={onChange}
            />

            {/* Actions */}
            <div className="editor-question-actions" style={{ marginTop: 16 }}>
              <button className="secondary-button compact" type="button" disabled={saving} onClick={onDuplicate}>Duplicate</button>
              <button className="danger-button" type="button" disabled={saving} onClick={onDelete}>Delete</button>
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}

// ─── Responses Tab Panel ──────────────────────────────────────────────────────

function ResponsesTabPanel({ formId }: { formId: string; formTitle: string; questions: Question[] }) {
  const [responses, setResponses] = useState<Array<{ id: string; answers: Record<string, unknown>; metadata?: Record<string, unknown> | null; submittedAt: string }>>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [respData, countData] = await Promise.all([
          api.get<{ responses: typeof responses }>(`/api/forms/${formId}/responses?limit=50`),
          api.get<{ count: number }>(`/api/forms/${formId}/responses-count`),
        ]);
        setResponses(respData.responses);
        setTotalCount(countData.count);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "Unable to load responses.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [formId]);

  if (loading) {
    return (
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "20px 0" }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton-card" style={{ marginBottom: 12 }}>
            <div className="skeleton-block" style={{ width: "40%", height: 16, marginBottom: 8 }} />
            <div className="skeleton-block" style={{ width: "60%", height: 12 }} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="submit-error" style={{ maxWidth: 980, margin: "20px auto" }}>{error}</p>;
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "20px 0" }}>
      {/* Summary */}
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div className="editor-card" style={{ flex: 1, minWidth: 140, padding: "20px", textAlign: "center" }}>
          <span className="muted" style={{ fontSize: "0.78rem", display: "block", marginBottom: 4 }}>Total</span>
          <strong style={{ fontSize: "1.8rem", color: "#111827" }}>{totalCount ?? 0}</strong>
        </div>
        <div className="editor-card" style={{ flex: 1, minWidth: 140, padding: "20px", textAlign: "center" }}>
          <span className="muted" style={{ fontSize: "0.78rem", display: "block", marginBottom: 4 }}>Showing</span>
          <strong style={{ fontSize: "1.8rem", color: "#111827" }}>{responses.length}</strong>
        </div>
        <div className="editor-card" style={{ flex: 1, minWidth: 140, padding: "20px", textAlign: "center" }}>
          <Link to={`/forms/${formId}/reports`} className="secondary-link" style={{ fontSize: "0.88rem" }}>
            📊 View Reports →
          </Link>
        </div>
      </div>

      {/* Response list */}
      <div className="editor-card">
        <div className="editor-card-header">
          <div><p className="eyebrow">Recent responses</p><h2>{responses.length} shown</h2></div>
          <Link to={`/forms/${formId}/responses`} className="secondary-button compact">Full view →</Link>
        </div>

        {responses.length === 0 ? (
          <div className="empty-state" style={{ padding: "32px 0", textAlign: "center" }}>
            <p style={{ fontSize: "1.5rem", marginBottom: 8 }}>📭</p>
            <p className="muted">No responses yet. Share your form to start collecting.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {responses.slice(0, 20).map((resp) => (
              <div key={resp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#f8fafc", borderRadius: 10, border: "1px solid #f1f5f9" }}>
                <div>
                  <strong style={{ color: "#1e293b", fontSize: "0.9rem" }}>
                    {new Date(resp.submittedAt).toLocaleString()}
                  </strong>
                  {typeof resp.metadata?.email === "string" ? (
                    <span className="muted" style={{ marginLeft: 12, fontSize: "0.8rem" }}>{resp.metadata.email}</span>
                  ) : null}
                </div>
                <span className="muted" style={{ fontSize: "0.72rem" }}>{resp.id.slice(0, 8)}…</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings Group ───────────────────────────────────────────────────────────

function SettingsGroup({
  title,
  description,
  summary,
  children,
}: {
  title: string;
  description: string;
  summary: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="settings-group">
      <button
        type="button"
        className="settings-group-header"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <strong className="settings-group-title">{title}</strong>
          <span className="settings-group-desc">{description}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!expanded ? (
            <span className="settings-group-summary">{summary}</span>
          ) : null}
          <span style={{ fontSize: "0.9rem", color: "#94a3b8" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </button>
      {expanded ? (
        <div className="settings-group-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}

// ─── Save Status Badge ────────────────────────────────────────────────────────

function SaveStatusBadge({ status }: { status: string }) {
  if (status === "idle") return null;

  const config: Record<string, { text: string; color: string; bg: string }> = {
    saving: { text: "Saving…", color: "#64748b", bg: "#f1f5f9" },
    saved: { text: "Saved ✓", color: "#16a34a", bg: "#f0fdf4" },
    error: { text: "Error saving", color: "#dc2626", bg: "#fef2f2" },
    offline: { text: "Offline ⚠", color: "#d97706", bg: "#fefce8" },
  };

  const c = config[status] ?? config["saving"];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 10px",
        borderRadius: 6,
        fontSize: "0.75rem",
        fontWeight: 700,
        color: c.color,
        background: c.bg,
        transition: "opacity 200ms ease",
      }}
    >
      {status === "saving" ? (
        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", border: "2px solid currentColor", borderTopColor: "transparent", animation: "spin 600ms linear infinite" }} />
      ) : null}
      {c.text}
    </span>
  );
}

// ─── Condition Editor ─────────────────────────────────────────────────────────

// ─── Section Jump (skip logic) Editor ──────────────────────────────────────────

function SectionJumpEditor({
  rules,
  inSectionQuestions,
  laterSections,
  onChange,
}: {
  rules: SectionJumpRule[];
  inSectionQuestions: Question[];
  laterSections: Array<{ id: string; title: string }>;
  onChange: (nextRules: SectionJumpRule[]) => void;
}) {
  const [showEditor, setShowEditor] = useState(false);

  // Valid forward targets: every later section, plus the submit sentinel.
  const validTargets = new Set<string>([
    JUMP_TARGET_SUBMIT,
    ...laterSections.map((s) => s.id),
  ]);

  // Default target: the first later section if any, else end-of-form.
  const defaultTarget = laterSections[0]?.id ?? JUMP_TARGET_SUBMIT;

  function emit(nextRules: SectionJumpRule[]) {
    // Defensive: drop any rule whose target is neither a later section nor the
    // submit sentinel (mirrors ConditionEditor dropping empties).
    onChange(nextRules.filter((r) => validTargets.has(r.target)));
  }

  function addRule() {
    if (inSectionQuestions.length === 0) return;
    const newRule: SectionJumpRule = {
      questionId: inSectionQuestions[0].id,
      operator: "equals",
      value: "",
      target: defaultTarget,
    };
    emit([...rules, newRule]);
  }

  function updateRule(idx: number, patch: Partial<SectionJumpRule>) {
    emit(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRule(idx: number) {
    emit(rules.filter((_, i) => i !== idx));
  }

  if (!showEditor && rules.length === 0) {
    return (
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="back-button inline-button"
          style={{ fontSize: "0.78rem", color: "#94a3b8" }}
          onClick={() => setShowEditor(true)}
          disabled={inSectionQuestions.length === 0}
          title={inSectionQuestions.length === 0 ? "Add a question to this section first" : ""}
        >
          + Add skip logic
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 12, padding: "12px 14px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 750, color: "#92400e" }}>
          Skip logic — after this section, jump when:
        </span>
        {rules.length === 0 ? (
          <button
            type="button"
            className="back-button inline-button"
            style={{ fontSize: "0.75rem" }}
            onClick={() => setShowEditor(false)}
          >
            Cancel
          </button>
        ) : null}
      </div>

      {rules.map((rule, idx) => {
        const refQuestion = inSectionQuestions.find((q) => q.id === rule.questionId);
        return (
          <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={rule.questionId}
              onChange={(e) => updateRule(idx, { questionId: e.target.value })}
              style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", fontSize: "0.8rem", maxWidth: 180 }}
            >
              {inSectionQuestions.map((q) => (
                <option key={q.id} value={q.id}>{q.label.slice(0, 30)}</option>
              ))}
            </select>

            <select
              value={rule.operator}
              onChange={(e) => updateRule(idx, { operator: e.target.value as SectionJumpRule["operator"] })}
              style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", fontSize: "0.8rem" }}
            >
              <option value="equals">equals</option>
              <option value="not_equals">not equals</option>
              <option value="contains">contains</option>
              <option value="not_empty">is answered</option>
            </select>

            {rule.operator !== "not_empty" ? (
              refQuestion?.options ? (
                <select
                  value={rule.value ?? ""}
                  onChange={(e) => updateRule(idx, { value: e.target.value })}
                  style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", fontSize: "0.8rem" }}
                >
                  <option value="">Select...</option>
                  {refQuestion.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={rule.value ?? ""}
                  onChange={(e) => updateRule(idx, { value: e.target.value })}
                  placeholder="value"
                  style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", fontSize: "0.8rem", width: 120 }}
                />
              )
            ) : null}

            <span style={{ fontSize: "0.78rem", color: "#92400e" }}>→ go to</span>

            <select
              value={rule.target}
              onChange={(e) => updateRule(idx, { target: e.target.value })}
              style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", fontSize: "0.8rem", maxWidth: 180 }}
            >
              {laterSections.map((s) => (
                <option key={s.id} value={s.id}>{(s.title || "Untitled section").slice(0, 30)}</option>
              ))}
              <option value={JUMP_TARGET_SUBMIT}>End of form (submit)</option>
            </select>

            <button
              type="button"
              onClick={() => removeRule(idx)}
              style={{ border: "none", background: "none", color: "#dc2626", cursor: "pointer", fontSize: "1rem", padding: "2px 6px" }}
              title="Remove rule"
            >
              ×
            </button>
          </div>
        );
      })}

      {inSectionQuestions.length > 0 ? (
        <button
          type="button"
          className="back-button inline-button"
          style={{ fontSize: "0.75rem", marginTop: 4 }}
          onClick={addRule}
        >
          + Add another rule
        </button>
      ) : null}
    </div>
  );
}

function ConditionEditor({
  question,
  allQuestions,
  onChange,
}: {
  question: Question;
  allQuestions: Question[];
  onChange: (id: string, patch: Partial<Question>) => void;
}) {
  const conditions = question.conditions ?? [];
  const [showEditor, setShowEditor] = useState(false);

  // Only questions that appear BEFORE this one can be used as conditions
  const availableQuestions = allQuestions.filter(
    (q) => q.id !== question.id && allQuestions.indexOf(q) < allQuestions.indexOf(question),
  );

  function addCondition() {
    if (availableQuestions.length === 0) return;
    const newRule: ConditionRule = {
      questionId: availableQuestions[0].id,
      operator: "equals",
      value: "",
    };
    onChange(question.id, { conditions: [...conditions, newRule] });
  }

  function updateCondition(idx: number, patch: Partial<ConditionRule>) {
    const updated = conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(question.id, { conditions: updated });
  }

  function removeCondition(idx: number) {
    const updated = conditions.filter((_, i) => i !== idx);
    onChange(question.id, { conditions: updated.length > 0 ? updated : undefined });
  }

  if (!showEditor && conditions.length === 0) {
    return (
      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          className="back-button inline-button"
          style={{ fontSize: "0.78rem", color: "#94a3b8" }}
          onClick={() => setShowEditor(true)}
          disabled={availableQuestions.length === 0}
          title={availableQuestions.length === 0 ? "Add questions above first" : ""}
        >
          + Add condition
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, padding: "12px 14px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 750, color: "#92400e" }}>
          Conditional logic — show this question when:
        </span>
        {conditions.length === 0 ? (
          <button
            type="button"
            className="back-button inline-button"
            style={{ fontSize: "0.75rem" }}
            onClick={() => setShowEditor(false)}
          >
            Cancel
          </button>
        ) : null}
      </div>

      {conditions.map((rule, idx) => {
        const refQuestion = allQuestions.find((q) => q.id === rule.questionId);
        return (
          <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={rule.questionId}
              onChange={(e) => updateCondition(idx, { questionId: e.target.value })}
              style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", fontSize: "0.8rem", maxWidth: 180 }}
            >
              {availableQuestions.map((q) => (
                <option key={q.id} value={q.id}>{q.label.slice(0, 30)}</option>
              ))}
            </select>

            <select
              value={rule.operator}
              onChange={(e) => updateCondition(idx, { operator: e.target.value as ConditionRule["operator"] })}
              style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", fontSize: "0.8rem" }}
            >
              <option value="equals">equals</option>
              <option value="not_equals">not equals</option>
              <option value="contains">contains</option>
              <option value="not_empty">is answered</option>
            </select>

            {rule.operator !== "not_empty" ? (
              refQuestion?.options ? (
                <select
                  value={rule.value ?? ""}
                  onChange={(e) => updateCondition(idx, { value: e.target.value })}
                  style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", fontSize: "0.8rem" }}
                >
                  <option value="">Select...</option>
                  {refQuestion.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={rule.value ?? ""}
                  onChange={(e) => updateCondition(idx, { value: e.target.value })}
                  placeholder="value"
                  style={{ border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", fontSize: "0.8rem", width: 120 }}
                />
              )
            ) : null}

            <button
              type="button"
              onClick={() => removeCondition(idx)}
              style={{ border: "none", background: "none", color: "#dc2626", cursor: "pointer", fontSize: "1rem", padding: "2px 6px" }}
              title="Remove condition"
            >
              ×
            </button>
          </div>
        );
      })}

      {availableQuestions.length > 0 ? (
        <button
          type="button"
          className="back-button inline-button"
          style={{ fontSize: "0.75rem", marginTop: 4 }}
          onClick={addCondition}
        >
          + Add another condition
        </button>
      ) : null}
    </div>
  );
}

// ─── Version History ──────────────────────────────────────────────────────────

function VersionHistory({ formId }: { formId: string }) {
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState("");

  const loadVersions = useCallback(async () => {
    if (versions.length > 0) { setExpanded((v) => !v); return; }
    setLoading(true);
    try {
      const data = await api.get<{ versions: VersionRecord[] }>(`/api/forms/${formId}/versions`);
      setVersions(data.versions);
      setExpanded(true);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [formId, versions.length]);

  async function restoreVersion(versionNumber: number) {
    if (!confirm(`Restore version ${versionNumber}? This replaces the current draft with that version's content.`)) {
      return;
    }
    setRestoringVersion(versionNumber);
    setRestoreError("");
    try {
      await api.post(`/api/forms/${formId}/versions/${versionNumber}/restore`);
      // Reload the editor so the restored draft is shown.
      window.location.reload();
    } catch (err) {
      setRestoreError(err instanceof ApiRequestError ? err.message : "Unable to restore version.");
      setRestoringVersion(null);
    }
  }

  return (
    <section className="editor-card" style={{ marginTop: 20 }}>
      <div className="editor-card-header">
        <div><p className="eyebrow">History</p><h2>Version history</h2></div>
        <button className="secondary-button compact" type="button" onClick={() => void loadVersions()}>
          {loading ? "Loading..." : expanded ? "Hide" : "Show versions"}
        </button>
      </div>
      {expanded && versions.length === 0 ? (
        <p className="muted">No published versions yet.</p>
      ) : null}
      {restoreError ? (
        <p className="submit-error" style={{ marginTop: 12 }}>{restoreError}</p>
      ) : null}
      {expanded && versions.length > 0 ? (
        <div className="editor-question-list">
          {versions.map((v) => (
            <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <div>
                <strong style={{ color: "#111827" }}>v{v.versionNumber}</strong>
                <span className="muted" style={{ marginLeft: 12 }}>{v.title}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  {v.publishedAt ? `Published ${new Date(v.publishedAt).toLocaleDateString()}` : `Created ${new Date(v.createdAt).toLocaleDateString()}`}
                </span>
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={restoringVersion !== null}
                  onClick={() => void restoreVersion(v.versionNumber)}
                >
                  {restoringVersion === v.versionNumber ? "Restoring..." : "Restore"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
