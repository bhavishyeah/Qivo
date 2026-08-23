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
import type { FormRecord, Question, QuestionOption, QuestionType, ConditionRule } from "../types";

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
  LINEAR_SCALE: "Linear scale",
};

const CHOICE_TYPES = new Set<QuestionType>(["SINGLE_CHOICE", "MULTIPLE_CHOICE"]);
const RATING_TYPES = new Set<QuestionType>(["RATING", "LINEAR_SCALE"]);

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FormEditorPage() {
  const { formId } = useParams<{ formId: string }>();

  const [form, setForm] = useState<FormRecord | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Autosave
  type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline";
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ questionId: string; question: Question } | null>(null);

  // Undo history (local state only, not persisted)
  const history = useRef<HistoryEntry[]>([]);

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
  const [savingSettings, setSavingSettings] = useState(false);

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

  // ─── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadEditor() {
      if (!formId) { setError("A form ID is missing."); setLoading(false); return; }
      try {
        const [formData, questionsData] = await Promise.all([
          api.get<{ form: FormRecord }>(`/api/forms/${formId}`),
          api.get<{ questions: Question[] }>(`/api/forms/${formId}/questions`),
        ]);
        setForm(formData.form);
        setQuestions(questionsData.questions);
        const schema = formData.form.schema;
        setCollectEmail(schema.settings?.collectEmail ?? false);
        setAllowMultipleResponses(schema.settings?.allowMultipleResponses ?? true);
        setConfirmationMessage(schema.confirmationMessage ?? "");
        setScheduledPublishAt(schema.settings?.scheduledPublishAt ?? "");
        setScheduledCloseAt(schema.settings?.scheduledCloseAt ?? "");
        setQuizMode(schema.settings?.quizMode ?? false);
        setShowScore(schema.settings?.showScore ?? false);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "Unable to load editor.");
      } finally {
        setLoading(false);
      }
    }
    void loadEditor();
  }, [formId]);

  // ─── Undo / Redo ────────────────────────────────────────────────────────────

  const redoStack = useRef<HistoryEntry[]>([]);
  const lastHistoryPush = useRef<number>(0);

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
  }

  function undo() {
    if (history.current.length === 0) return;
    const prev = history.current.pop();
    if (prev) {
      // Push current state to redo
      redoStack.current.push({ questions });
      setQuestions(prev.questions);
    }
  }

  function redo() {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop();
    if (next) {
      // Push current state to undo
      history.current.push({ questions });
      setQuestions(next.questions);
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (e.key === "y") {
        e.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // ─── Question mutations ───────────────────────────────────────────────────

  function updateQuestionLocal(questionId: string, patch: Partial<Question>) {
    // Push current state to history before modifying
    pushHistory(questions);
    setQuestions((current) => {
      const updated = current.map((q) => (q.id === questionId ? { ...q, ...patch } : q));
      // Schedule autosave for this question
      const question = updated.find((q) => q.id === questionId);
      if (question) {
        scheduleAutosave(questionId, question);
      }
      return updated;
    });
  }

  function scheduleAutosave(questionId: string, question: Question) {
    pendingSave.current = { questionId, question };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void performAutosave();
    }, 1500);
  }

  async function performAutosave() {
    const pending = pendingSave.current;
    if (!pending || !formId) return;
    pendingSave.current = null;

    setSaveStatus("saving");
    try {
      await api.patch(`/api/forms/${formId}/questions/${pending.questionId}`, {
        label: pending.question.label,
        description: pending.question.description,
        required: pending.question.required,
        options: pending.question.options,
        settings: pending.question.settings,
        conditions: pending.question.conditions,
      });
      setSaveStatus("saved");
      // Reset to idle after 3 seconds
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
          ...(newQuestionType === "FILE_UPLOAD" ? { settings: { maxFileSizeMB: 5, allowedFileTypes: ["image/*", "application/pdf"] } } : {}),
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

  async function saveFormSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formId) return;
    setSavingSettings(true); setError(""); setMessage("");
    try {
      const data = await api.patch<{ form: FormRecord }>(
        `/api/forms/${formId}/settings`,
        {
          collectEmail,
          allowMultipleResponses,
          confirmationMessage,
          scheduledPublishAt: scheduledPublishAt || null,
          scheduledCloseAt: scheduledCloseAt || null,
          quizMode,
          showScore,
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
              disabled={history.current.length === 0}
              title="Undo (Ctrl+Z)"
              style={{ opacity: history.current.length === 0 ? 0.3 : 1 }}
            >↩</button>
            <button
              className="editor-topnav-btn"
              type="button"
              onClick={redo}
              disabled={redoStack.current.length === 0}
              title="Redo (Ctrl+Y)"
              style={{ opacity: redoStack.current.length === 0 ? 0.3 : 1 }}
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

      {/* ── Settings ── */}
      <section className="editor-card settings-card">
        <div className="editor-card-header">
          <div><p className="eyebrow">Settings</p><h2>Response settings</h2></div>
        </div>
        <form onSubmit={saveFormSettings}>
          <label className="settings-toggle">
            <input type="checkbox" checked={collectEmail} onChange={(e) => setCollectEmail(e.target.checked)} />
            <span><strong>Collect email addresses</strong><small>Ask respondents to provide their email.</small></span>
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={allowMultipleResponses} onChange={(e) => setAllowMultipleResponses(e.target.checked)} />
            <span><strong>Allow multiple responses</strong><small>Let the same person submit more than once.</small></span>
          </label>
          <div className="question-field">
            <label htmlFor="confirmation-message">Confirmation message</label>
            <textarea id="confirmation-message" rows={3} value={confirmationMessage} onChange={(e) => setConfirmationMessage(e.target.value)} placeholder="Thanks for your response." />
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
            <div className="question-field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="scheduled-publish">Scheduled publish (optional)</label>
              <input id="scheduled-publish" type="datetime-local" value={scheduledPublishAt} onChange={(e) => setScheduledPublishAt(e.target.value)} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }} />
              <small className="muted">Form will become public at this time.</small>
            </div>
            <div className="question-field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="scheduled-close">Scheduled close (optional)</label>
              <input id="scheduled-close" type="datetime-local" value={scheduledCloseAt} onChange={(e) => setScheduledCloseAt(e.target.value)} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }} />
              <small className="muted">Form will stop accepting responses at this time.</small>
            </div>
          </div>
          <label className="settings-toggle">
            <input type="checkbox" checked={quizMode} onChange={(e) => setQuizMode(e.target.checked)} />
            <span><strong>Quiz mode</strong><small>Enable scoring — set correct answers on each question.</small></span>
          </label>
          {quizMode ? (
            <label className="settings-toggle">
              <input type="checkbox" checked={showScore} onChange={(e) => setShowScore(e.target.checked)} />
              <span><strong>Show score to respondent</strong><small>Display score after submission.</small></span>
            </label>
          ) : null}
          <button className="secondary-button" type="submit" disabled={savingSettings}>{savingSettings ? "Saving..." : "Save settings"}</button>
        </form>
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

        {questions.length === 0 ? (
          <div className="empty-state" style={{ textAlign: "center", padding: "32px 0" }}>
            <p style={{ fontSize: "1.5rem", marginBottom: 8 }}>📝</p>
            <p className="muted">No questions yet. Click "+ Add question" to start.</p>
          </div>
        ) : (
          <div className="editor-canvas-with-toolbar">
            <div className="editor-question-list">
              {questions.map((question, index) => (
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
                onClick={() => {/* Future: add section */}}
                title="Add section"
              >
                <span>§</span>
                <span className="editor-floating-label">Section</span>
              </button>
              <button
                className="editor-floating-btn"
                type="button"
                onClick={() => {/* Future: add image */}}
                title="Add image"
              >
                <span>🖼</span>
                <span className="editor-floating-label">Media</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Version history ── */}
      <VersionHistory formId={formId!} />
    </main>
  );
}

// ─── Question Card ────────────────────────────────────────────────────────────

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
            {/* Type + Meta */}
            <div className="editor-question-meta" style={{ marginBottom: 12 }}>
              <span className="status-pill" style={{ fontSize: "0.7rem" }}>
                {QUESTION_TYPE_LABELS[question.type]}
              </span>
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
              <div style={{ marginTop: 14 }}>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 750, marginBottom: 8 }}>File upload settings</label>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>Max size (MB)</label>
                    <input
                      type="number"
                      value={question.settings?.maxFileSizeMB ?? 5}
                      min={1}
                      max={50}
                      onChange={(e) => onChange(question.id, { settings: { ...question.settings, maxFileSizeMB: Number(e.target.value) } })}
                      style={{ width: 80, border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>Allowed types</label>
                    <input
                      type="text"
                      value={(question.settings?.allowedFileTypes ?? []).join(", ")}
                      onChange={(e) => onChange(question.id, { settings: { ...question.settings, allowedFileTypes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })}
                      placeholder="image/*, application/pdf"
                      style={{ width: 220, border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: "0.82rem" }}
                    />
                  </div>
                </div>
                <p className="muted" style={{ marginTop: 6, fontSize: "0.75rem" }}>
                  Comma-separated MIME types. E.g. image/*, application/pdf, .docx
                </p>
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

  const loadVersions = useCallback(async () => {
    if (versions.length > 0) { setExpanded((v) => !v); return; }
    setLoading(true);
    try {
      const data = await api.get<{ versions: VersionRecord[] }>(`/api/forms/${formId}/versions`);
      setVersions(data.versions);
      setExpanded(true);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [formId, versions.length]);

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
      {expanded && versions.length > 0 ? (
        <div className="editor-question-list">
          {versions.map((v) => (
            <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <div>
                <strong style={{ color: "#111827" }}>v{v.versionNumber}</strong>
                <span className="muted" style={{ marginLeft: 12 }}>{v.title}</span>
              </div>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {v.publishedAt ? `Published ${new Date(v.publishedAt).toLocaleDateString()}` : `Created ${new Date(v.createdAt).toLocaleDateString()}`}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
