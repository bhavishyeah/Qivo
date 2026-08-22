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
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "Unable to load editor.");
      } finally {
        setLoading(false);
      }
    }
    void loadEditor();
  }, [formId]);

  // ─── Undo ─────────────────────────────────────────────────────────────────

  function pushHistory(current: Question[]) {
    history.current = [...history.current.slice(-19), { questions: current }];
  }

  function undo() {
    const prev = history.current.pop();
    if (prev) setQuestions(prev.questions);
  }

  // ─── Question mutations ───────────────────────────────────────────────────

  function updateQuestionLocal(questionId: string, patch: Partial<Question>) {
    setQuestions((current) =>
      current.map((q) => (q.id === questionId ? { ...q, ...patch } : q)),
    );
  }

  async function saveQuestion(question: Question) {
    if (!formId) return;
    setSaving(true);
    setMessage(""); setError("");
    try {
      await api.patch(`/api/forms/${formId}/questions/${question.id}`, {
        label: question.label,
        description: question.description,
        required: question.required,
        options: question.options,
        settings: question.settings,
        conditions: question.conditions,
      });
      setMessage("Question saved.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to save.");
    } finally {
      setSaving(false);
    }
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
  }

  function handleDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    setDragOverIndex(index);
  }

  function handleDragEnd() {
    setDragOverIndex(null);
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
      {/* ── Header ── */}
      <header className="editor-header">
        <div>
          <p className="eyebrow">Form editor</p>
          <h1>{form.title}</h1>
          <p className="muted">Edit questions and publish your form.</p>
        </div>

        <div className="editor-actions">
          <span className={`status-pill status-${form.status.toLowerCase()}`}>
            {form.status.replace(/_/g, " ")}
          </span>

          {history.current.length > 0 ? (
            <button className="secondary-button compact" type="button" onClick={undo}>
              ↩ Undo
            </button>
          ) : null}

          <Link className="secondary-button compact" to={`/forms/${formId}/preview`}>
            👁 Preview
          </Link>

          {isPublished ? (
            <>
              <Link className="secondary-button" to={`/forms/${formId}/share`}>Share / QR</Link>
              <button className="danger-button" type="button" disabled={saving} onClick={closeEditorForm}>Close form</button>
            </>
          ) : null}

          {canSubmitForReview ? (
            <button className="secondary-button" type="button" disabled={saving} onClick={() => void openReviewPanel()}>
              Submit for review
            </button>
          ) : null}

          {canPublish ? (
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={publishEditorForm}
              style={form.status === "APPROVED" ? { background: "#16a34a", color: "#fff", border: "none" } : undefined}
            >
              {form.status === "APPROVED" ? "Publish approved form" : "Publish"}
            </button>
          ) : null}
        </div>
      </header>

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
          <div className="editor-question-list">
            {questions.map((question, index) => (
              <QuestionCard
                key={question.id}
                question={question}
                index={index}
                total={questions.length}
                saving={saving}
                isDragOver={dragOverIndex === index}
                allQuestions={questions}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => void handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                onChange={updateQuestionLocal}
                onSave={() => void saveQuestion(question)}
                onDelete={() => void deleteEditorQuestion(question.id)}
                onDuplicate={() => void duplicateQuestion(question)}
              />
            ))}
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
  allQuestions,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onChange,
  onSave,
  onDelete,
  onDuplicate,
}: {
  question: Question;
  index: number;
  total: number;
  saving: boolean;
  isDragOver: boolean;
  allQuestions: Question[];
  onDragStart: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onChange: (id: string, patch: Partial<Question>) => void;
  onSave: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

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
      className={`editor-question ${isDragOver ? "drag-over" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{ cursor: "grab", opacity: isDragOver ? 0.6 : 1 }}
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
        {/* Meta row */}
        <div className="editor-question-meta">
          <span className="status-pill" style={{ fontSize: "0.7rem" }}>
            {QUESTION_TYPE_LABELS[question.type]}
          </span>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            {question.required ? "Required" : "Optional"}
          </span>
          <button
            type="button"
            className="back-button inline-button"
            style={{ marginLeft: "auto", fontSize: "0.78rem" }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Collapse ↑" : "Expand ↓"}
          </button>
        </div>

        {/* Always visible: label */}
        <label htmlFor={`editor-label-${question.id}`}>Question label</label>
        <input
          id={`editor-label-${question.id}`}
          type="text"
          value={question.label}
          onChange={(e) => onChange(question.id, { label: e.target.value })}
        />

        {expanded ? (
          <>
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

            {/* Conditional logic */}
            <ConditionEditor
              question={question}
              allQuestions={allQuestions}
              onChange={onChange}
            />

            {/* Actions */}
            <div className="editor-question-actions" style={{ marginTop: 16 }}>
              <button className="secondary-button compact" type="button" disabled={saving} onClick={onSave}>Save</button>
              <button className="secondary-button compact" type="button" disabled={saving} onClick={onDuplicate}>Duplicate</button>
              <button className="danger-button" type="button" disabled={saving} onClick={onDelete}>Delete</button>
            </div>
          </>
        ) : null}
      </div>
    </article>
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
