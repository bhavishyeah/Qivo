import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import type { FormRecord, Question, QuestionType } from "../types";

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

export default function FormEditorPage() {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormRecord | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [newQuestionType, setNewQuestionType] = useState<QuestionType>("SHORT_TEXT");
  const [newQuestionLabel, setNewQuestionLabel] = useState("");
  const [addingQuestion, setAddingQuestion] = useState(false);

  const [collectEmail, setCollectEmail] = useState(false);
  const [allowMultipleResponses, setAllowMultipleResponses] = useState(true);
  const [confirmationMessage, setConfirmationMessage] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  // Approval workflow state
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [reviewers, setReviewers] = useState<MemberRecord[]>([]);
  const [selectedReviewer, setSelectedReviewer] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [submittingForReview, setSubmittingForReview] = useState(false);

  // Review decision state (for admins reviewing PENDING_REVIEW forms)
  const [reviewComment, setReviewComment] = useState("");
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    async function loadEditor() {
      if (!formId) {
        setError("A form ID is missing.");
        setLoading(false);
        return;
      }

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
      } catch (err) {
        setError(
          err instanceof ApiRequestError ? err.message : "Unable to load editor.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadEditor();
  }, [formId]);

  async function loadReviewers() {
    if (!form) return;
    try {
      // Get workspace members who can review (OWNER/ADMIN)
      const data = await api.get<{ members: MemberRecord[] }>(
        `/api/members?workspaceId=${encodeURIComponent(form.workspaceId)}`,
      );
      const eligible = data.members.filter(
        (m) => m.role === "OWNER" || m.role === "ADMIN",
      );
      setReviewers(eligible);
      if (eligible.length > 0 && !selectedReviewer) {
        setSelectedReviewer(eligible[0].user.id);
      }
    } catch {
      // Silently fail — reviewer list is optional enhancement
    }
  }

  async function openReviewPanel() {
    setShowReviewPanel(true);
    await loadReviewers();
  }

  async function submitForReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formId || !selectedReviewer) return;

    setSubmittingForReview(true);
    setError("");
    setMessage("");

    try {
      const data = await api.post<{ form: FormRecord }>(
        `/api/approvals/${formId}/submit-for-review`,
        {
          reviewerId: selectedReviewer,
          ...(reviewMessage.trim() ? { message: reviewMessage.trim() } : {}),
        },
      );
      setForm(data.form);
      setShowReviewPanel(false);
      setReviewMessage("");
      setMessage("Form submitted for review.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to submit for review.",
      );
    } finally {
      setSubmittingForReview(false);
    }
  }

  async function handleReviewDecision(
    decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED",
  ) {
    if (!formId) return;

    setReviewing(true);
    setError("");
    setMessage("");

    try {
      const data = await api.post<{ form: FormRecord }>(
        `/api/approvals/${formId}/review`,
        {
          decision,
          ...(reviewComment.trim() ? { comment: reviewComment.trim() } : {}),
        },
      );
      setForm(data.form);
      setReviewComment("");

      const messages: Record<string, string> = {
        APPROVED: "Form approved! It can now be published.",
        CHANGES_REQUESTED: "Changes requested. The author will be notified.",
        REJECTED: "Form rejected and returned to draft.",
      };
      setMessage(messages[decision] ?? "Review submitted.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to submit review.",
      );
    } finally {
      setReviewing(false);
    }
  }

  async function saveFormSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formId) return;

    setSavingSettings(true);
    setError("");
    setMessage("");

    try {
      const data = await api.patch<{ form: FormRecord }>(
        `/api/forms/${formId}/settings`,
        { collectEmail, allowMultipleResponses, confirmationMessage },
      );
      setForm(data.form);
      setMessage("Settings saved.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to save settings.",
      );
    } finally {
      setSavingSettings(false);
    }
  }

  function updateQuestionLocal(questionId: string, patch: Partial<Question>) {
    setQuestions((current) =>
      current.map((q) => (q.id === questionId ? { ...q, ...patch } : q)),
    );
  }

  async function addEditorQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formId || !newQuestionLabel.trim()) return;

    setAddingQuestion(true);
    setMessage("");
    setError("");

    try {
      const data = await api.post<{ question: Question }>(
        `/api/forms/${formId}/questions`,
        {
          label: newQuestionLabel.trim(),
          type: newQuestionType,
          required: false,
          ...(newQuestionType === "RATING" ? { settings: { min: 1, max: 5 } } : {}),
        },
      );

      setQuestions((current) => [...current, data.question]);
      setNewQuestionLabel("");
      setNewQuestionType("SHORT_TEXT");
      setShowAddQuestion(false);
      setMessage("Question added.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to add question.",
      );
    } finally {
      setAddingQuestion(false);
    }
  }

  async function saveQuestion(question: Question) {
    if (!formId) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      await api.patch(`/api/forms/${formId}/questions/${question.id}`, {
        label: question.label,
        required: question.required,
      });
      setMessage("Question saved.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to save question.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteEditorQuestion(questionId: string) {
    if (!formId) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      await api.delete(`/api/forms/${formId}/questions/${questionId}`);
      setQuestions((current) => current.filter((q) => q.id !== questionId));
      setMessage("Question deleted.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to delete question.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function publishEditorForm() {
    if (!formId) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      await api.post(`/api/forms/${formId}/publish`);
      setForm((current) => (current ? { ...current, status: "PUBLISHED" } : current));
      setMessage("Form published! Share it using the QR/Share page.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to publish form.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function closeEditorForm() {
    if (!formId) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      await api.post(`/api/forms/${formId}/close`);
      setForm((current) => (current ? { ...current, status: "CLOSED" } : current));
      setMessage("Form closed. It will no longer accept responses.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to close form.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading editor...</p>
        </div>
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

  // Determine which action buttons to show based on form status
  const canEdit = form.status === "DRAFT" || form.status === "CHANGES_REQUESTED";
  const canSubmitForReview = form.status === "DRAFT" || form.status === "CHANGES_REQUESTED";
  const canReview = form.status === "PENDING_REVIEW";
  const canPublish = form.status === "APPROVED" || form.status === "DRAFT";
  const isPublished = form.status === "PUBLISHED";

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <div>
          <button
            className="back-button"
            type="button"
            onClick={() => navigate("/dashboard")}
          >
            ← Dashboard
          </button>
          <p className="eyebrow">Form editor</p>
          <h1>{form.title}</h1>
          <p className="muted">Edit questions and publish your form.</p>
        </div>

        <div className="editor-actions">
          <span className={`status-pill status-${form.status.toLowerCase()}`}>
            {form.status.replace(/_/g, " ")}
          </span>

          {isPublished ? (
            <Link className="secondary-button" to={`/forms/${formId}/share`}>
              Share / QR
            </Link>
          ) : null}

          {isPublished ? (
            <button
              className="danger-button"
              type="button"
              disabled={saving}
              onClick={closeEditorForm}
            >
              Close form
            </button>
          ) : null}

          {canSubmitForReview ? (
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() => void openReviewPanel()}
            >
              Submit for review
            </button>
          ) : null}

          {canPublish ? (
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={publishEditorForm}
              style={
                form.status === "APPROVED"
                  ? { background: "#16a34a", color: "#fff", border: "none" }
                  : undefined
              }
            >
              {form.status === "APPROVED" ? "Publish approved form" : "Publish directly"}
            </button>
          ) : null}
        </div>
      </header>

      {message ? (
        <p className="editor-message" role="status">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="submit-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* Review decision panel — shown when form is PENDING_REVIEW (for admins) */}
      {canReview ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 20px" }}>
          <div className="editor-card-header">
            <div>
              <p className="eyebrow">Review required</p>
              <h2>This form is awaiting your review</h2>
            </div>
          </div>

          <p className="muted" style={{ marginBottom: 16 }}>
            Review the questions below and approve, request changes, or reject.
          </p>

          <div className="question-field">
            <label htmlFor="review-comment">Comment (optional)</label>
            <textarea
              id="review-comment"
              rows={3}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder="Add feedback for the form author..."
            />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button
              className="secondary-button"
              type="button"
              disabled={reviewing}
              onClick={() => void handleReviewDecision("APPROVED")}
              style={{ background: "#16a34a", color: "#fff", border: "none" }}
            >
              {reviewing ? "..." : "Approve"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={reviewing}
              onClick={() => void handleReviewDecision("CHANGES_REQUESTED")}
              style={{ background: "#f59e0b", color: "#fff", border: "none" }}
            >
              {reviewing ? "..." : "Request changes"}
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={reviewing}
              onClick={() => void handleReviewDecision("REJECTED")}
            >
              {reviewing ? "..." : "Reject"}
            </button>
          </div>
        </section>
      ) : null}

      {/* Submit for review panel */}
      {showReviewPanel ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 20px" }}>
          <div className="editor-card-header">
            <div>
              <p className="eyebrow">Approval workflow</p>
              <h2>Submit for review</h2>
            </div>
            <button
              className="back-button inline-button"
              type="button"
              onClick={() => setShowReviewPanel(false)}
            >
              Cancel
            </button>
          </div>

          <form onSubmit={submitForReview}>
            <div className="question-field">
              <label htmlFor="reviewer-select">Select reviewer</label>
              {reviewers.length === 0 ? (
                <p className="muted">
                  No eligible reviewers found. Only workspace Owners and Admins can
                  review forms.
                </p>
              ) : (
                <select
                  id="reviewer-select"
                  value={selectedReviewer}
                  onChange={(e) => setSelectedReviewer(e.target.value)}
                  style={{
                    width: "100%",
                    border: "1px solid #cbd5e1",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: "#fff",
                  }}
                >
                  {reviewers.map((r) => (
                    <option key={r.user.id} value={r.user.id}>
                      {r.user.name} ({r.user.email}) — {r.role}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="question-field">
              <label htmlFor="review-msg">Message (optional)</label>
              <textarea
                id="review-msg"
                rows={3}
                value={reviewMessage}
                onChange={(e) => setReviewMessage(e.target.value)}
                placeholder="Any notes for the reviewer..."
              />
            </div>

            <button
              className="secondary-button"
              type="submit"
              disabled={submittingForReview || !selectedReviewer || reviewers.length === 0}
            >
              {submittingForReview ? "Submitting..." : "Send for review"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Status banner for CHANGES_REQUESTED */}
      {form.status === "CHANGES_REQUESTED" ? (
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto 20px",
            background: "#fef3c7",
            border: "1px solid #fbbf24",
            borderRadius: 12,
            padding: "16px 20px",
            color: "#92400e",
          }}
        >
          <strong>Changes requested</strong>
          <p style={{ margin: "6px 0 0" }}>
            A reviewer has requested changes to this form. Edit the questions below and
            resubmit for review when ready.
          </p>
        </div>
      ) : null}

      {/* Settings card */}
      <section className="editor-card settings-card">
        <div className="editor-card-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Response settings</h2>
          </div>
        </div>

        <form onSubmit={saveFormSettings}>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={collectEmail}
              onChange={(e) => setCollectEmail(e.target.checked)}
            />
            <span>
              <strong>Collect email addresses</strong>
              <small>Ask respondents to provide an email address.</small>
            </span>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={allowMultipleResponses}
              onChange={(e) => setAllowMultipleResponses(e.target.checked)}
            />
            <span>
              <strong>Allow multiple responses</strong>
              <small>Let the same respondent submit more than once.</small>
            </span>
          </label>

          <div className="question-field">
            <label htmlFor="confirmation-message">Confirmation message</label>
            <textarea
              id="confirmation-message"
              rows={3}
              value={confirmationMessage}
              onChange={(e) => setConfirmationMessage(e.target.value)}
              placeholder="Thanks for submitting your response."
            />
          </div>

          <button className="secondary-button" type="submit" disabled={savingSettings}>
            {savingSettings ? "Saving..." : "Save settings"}
          </button>
        </form>
      </section>

      {/* Questions card */}
      <section className="editor-card">
        <div className="editor-card-header">
          <div>
            <p className="eyebrow">Questions</p>
            <h2>{questions.length} questions</h2>
          </div>

          <button
            className="secondary-button"
            type="button"
            onClick={() => setShowAddQuestion(true)}
          >
            + Add question
          </button>
        </div>

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
                required
              />
            </div>

            <div>
              <label htmlFor="new-question-type">Question type</label>
              <select
                id="new-question-type"
                value={newQuestionType}
                onChange={(e) => setNewQuestionType(e.target.value as QuestionType)}
              >
                <option value="SHORT_TEXT">Short text</option>
                <option value="LONG_TEXT">Long text</option>
                <option value="EMAIL">Email</option>
                <option value="NUMBER">Number</option>
                <option value="DATE">Date</option>
                <option value="SINGLE_CHOICE">Single choice</option>
                <option value="MULTIPLE_CHOICE">Multiple choice</option>
                <option value="RATING">Rating</option>
                <option value="YES_NO">Yes / No</option>
              </select>
            </div>

            <div className="add-question-actions">
              <button
                className="secondary-button compact"
                type="submit"
                disabled={addingQuestion || !newQuestionLabel.trim()}
              >
                {addingQuestion ? "Adding..." : "Add question"}
              </button>
              <button
                className="back-button inline-button"
                type="button"
                onClick={() => setShowAddQuestion(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {questions.length === 0 ? (
          <p className="empty-state">This form has no questions yet.</p>
        ) : (
          <div className="editor-question-list">
            {questions.map((question, index) => (
              <article className="editor-question" key={question.id}>
                <div className="editor-question-number">{index + 1}</div>

                <div className="editor-question-body">
                  <div className="editor-question-meta">
                    <span className="status-pill">{question.type}</span>
                    <span className="muted">
                      {question.required ? "Required" : "Optional"}
                    </span>
                  </div>

                  <label htmlFor={`editor-${question.id}`}>Question label</label>
                  <input
                    id={`editor-${question.id}`}
                    type="text"
                    value={question.label}
                    onChange={(e) =>
                      updateQuestionLocal(question.id, { label: e.target.value })
                    }
                  />

                  <label className="editor-checkbox">
                    <input
                      type="checkbox"
                      checked={question.required}
                      onChange={(e) =>
                        updateQuestionLocal(question.id, {
                          required: e.target.checked,
                        })
                      }
                    />
                    Required question
                  </label>

                  <div className="editor-question-actions">
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={saving}
                      onClick={() => void saveQuestion(question)}
                    >
                      Save
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      disabled={saving}
                      onClick={() => void deleteEditorQuestion(question.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Version history */}
      <VersionHistory formId={formId!} />
    </main>
  );
}

function VersionHistory({ formId }: { formId: string }) {
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadVersions() {
    if (versions.length > 0) {
      setExpanded(!expanded);
      return;
    }

    setLoading(true);
    try {
      const data = await api.get<{ versions: VersionRecord[] }>(
        `/api/forms/${formId}/versions`,
      );
      setVersions(data.versions);
      setExpanded(true);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="editor-card" style={{ marginTop: 20 }}>
      <div className="editor-card-header">
        <div>
          <p className="eyebrow">History</p>
          <h2>Version history</h2>
        </div>
        <button
          className="secondary-button compact"
          type="button"
          onClick={() => void loadVersions()}
        >
          {loading ? "Loading..." : expanded ? "Hide" : "Show versions"}
        </button>
      </div>

      {expanded && versions.length === 0 ? (
        <p className="muted">No published versions yet. Versions are created when you publish.</p>
      ) : null}

      {expanded && versions.length > 0 ? (
        <div className="editor-question-list">
          {versions.map((v) => (
            <div
              key={v.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                background: "#f8fafc",
                borderRadius: 12,
                border: "1px solid #e2e8f0",
              }}
            >
              <div>
                <strong style={{ color: "#111827" }}>v{v.versionNumber}</strong>
                <span className="muted" style={{ marginLeft: 12 }}>
                  {v.title}
                </span>
              </div>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {v.publishedAt
                  ? `Published ${new Date(v.publishedAt).toLocaleDateString()}`
                  : `Created ${new Date(v.createdAt).toLocaleDateString()}`}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
