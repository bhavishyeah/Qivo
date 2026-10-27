import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import { evaluateConditions } from "../lib/conditions";
import { resolvePipedLabel } from "../lib/piping";
import { DEFAULT_ACCENT, ensureFontLoaded, resolveTheme } from "../lib/theme";
import SignaturePad from "../components/SignaturePad";
import type { AnswerValue, FormRecord, Question } from "../types";

/**
 * Preview page — shows exactly what the respondent will see,
 * without actually submitting any data.
 */
export default function FormPreviewPage() {
  const { formId } = useParams<{ formId: string }>();

  const [form, setForm] = useState<FormRecord | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentSection, setCurrentSection] = useState(0);

  useEffect(() => {
    async function loadForm() {
      if (!formId) { setError("Missing form ID."); setLoading(false); return; }
      try {
        const data = await api.get<{ form: FormRecord }>(`/api/forms/${formId}`);
        setForm(data.form);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "Unable to load form.");
      } finally {
        setLoading(false);
      }
    }
    void loadForm();
  }, [formId]);

  const sections = useMemo(() => form?.schema?.sections ?? [], [form]);
  const totalSections = sections.length;
  const section = sections[currentSection];
  const questions = useMemo(
    () => (section?.questions ?? []).filter((q) => evaluateConditions(q.conditions, answers)),
    [section, answers],
  );
  // Form-wide flattened list so piped labels can reference questions in any
  // section (distinct from the current-section `questions` above).
  const allQuestions = useMemo(
    () => sections.flatMap((s) => s.questions),
    [sections],
  );

  function updateAnswer(questionId: string, value: AnswerValue) {
    setAnswers((c) => ({ ...c, [questionId]: value }));
  }

  function handleInputChange(questionId: string, event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const rawValue = event.target.value;
    if (event.target.type === "number") {
      // An empty number input must stay "unanswered" (empty string), not become
      // 0 — otherwise a cleared required field silently passes validation and
      // submits 0. Non-numeric intermediate input is also kept as-is rather than
      // coerced to NaN.
      if (rawValue === "") {
        updateAnswer(questionId, "");
      } else {
        const parsed = Number(rawValue);
        updateAnswer(questionId, Number.isNaN(parsed) ? "" : parsed);
      }
      return;
    }
    updateAnswer(questionId, rawValue);
  }

  if (loading) {
    return (
      <main className="public-form-shell">
        <div className="public-form-loading">
          <div className="skeleton-block" style={{ width: "60%", height: 36, marginBottom: 16 }} />
          <div className="skeleton-block" style={{ width: "80%", height: 18, marginBottom: 32 }} />
        </div>
      </main>
    );
  }

  if (error || !form) {
    return (
      <main className="page-shell">
        <div className="status-card error-card">
          <h1>Unable to preview</h1>
          <p>{error || "Form not found."}</p>
          <Link to="/dashboard">Back to dashboard</Link>
        </div>
      </main>
    );
  }

  // FormRecord carries no workspace branding, so the preview resolves the
  // per-form theme only. Buttons use `accent ?? DEFAULT_ACCENT` because the
  // scaled custom container has no `.submit-button` CSS default to inherit.
  const resolved = resolveTheme(form.schema.settings.theme);
  ensureFontLoaded(form.schema.settings.theme?.fontFamily);
  const previewAccent = resolved.accent ?? DEFAULT_ACCENT;

  return (
    <main
      className="public-form-shell"
      style={{
        ...(resolved.background ? { background: resolved.background } : {}),
        ...(resolved.fontFamily ? { fontFamily: resolved.fontFamily } : {}),
      }}
    >
      <div className="public-form-wrap">
        {resolved.coverImageUrl ? (
          <img
            className="public-form-cover"
            src={resolved.coverImageUrl}
            alt=""
            style={{
              width: "100%",
              height: "auto",
              borderRadius: 12,
              marginBottom: 16,
              objectFit: "cover",
            }}
          />
        ) : null}
        {/* Preview banner */}
        <div
          style={{
            background: "#fef3c7",
            border: "1px solid #fde68a",
            borderRadius: 12,
            padding: "12px 20px",
            marginBottom: 20,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <span style={{ color: "#92400e", fontWeight: 700, fontSize: "0.88rem" }}>
            👁 Preview mode — responses won't be saved
          </span>
          <Link
            to={`/forms/${formId}/edit`}
            className="secondary-button compact"
            style={{ fontSize: "0.82rem" }}
          >
            ← Back to editor
          </Link>
        </div>

        {/* Progress */}
        {totalSections > 1 ? (
          <div className="public-progress-bar">
            <div className="public-progress-fill" style={{ width: `${Math.round((currentSection / totalSections) * 100)}%` }} />
          </div>
        ) : null}

        {/* Header */}
        <header className="public-form-header">
          <p className="eyebrow" style={{ color: previewAccent }}>Qivo Form (Preview)</p>
          <h1 className="public-form-title">{form.title}</h1>
          {form.description ? <p className="public-form-description">{form.description}</p> : null}
          {totalSections > 1 ? (
            <p className="public-section-counter">
              Section {currentSection + 1} of {totalSections}
              {section?.title ? ` — ${section.title}` : ""}
            </p>
          ) : null}
        </header>

        {/* Body */}
        <div className="public-form-body">
          {form.schema.settings.collectEmail && currentSection === 0 ? (
            <div className="question-field">
              <label><span className="question-label">Email address <span className="required-mark">*</span></span></label>
              <input type="email" placeholder="you@example.com" disabled style={{ opacity: 0.6 }} />
            </div>
          ) : null}

          {questions.map((question) => (
            <PreviewQuestion
              key={question.id}
              question={question}
              value={answers[question.id]}
              allQuestions={allQuestions}
              answers={answers}
              onChange={updateAnswer}
              onInputChange={handleInputChange}
            />
          ))}

          {questions.length === 0 && section ? (
            <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>No visible questions in this section.</p>
          ) : null}

          {/* Nav */}
          <div className="public-form-nav" style={{ marginTop: 16 }}>
            {currentSection > 0 ? (
              <button type="button" className="secondary-button" onClick={() => setCurrentSection((i) => i - 1)}>← Back</button>
            ) : <span />}
            {currentSection < totalSections - 1 ? (
              <button type="button" className="submit-button" style={{ maxWidth: 240, background: previewAccent }} onClick={() => setCurrentSection((i) => i + 1)}>Next →</button>
            ) : (
              <button type="button" className="submit-button" style={{ maxWidth: 240, opacity: 0.7, background: previewAccent }} disabled>Submit (preview only)</button>
            )}
          </div>
        </div>

        <p className="public-form-brand">Preview mode — this is what respondents will see</p>
        <p className="muted" style={{ textAlign: "center", fontSize: "0.8rem", marginTop: 4 }}>
          Workspace brand color is applied on the live form.
        </p>
      </div>
    </main>
  );
}

function PreviewQuestion({
  question,
  value,
  allQuestions,
  answers,
  onChange,
  onInputChange,
}: {
  question: Question;
  value: AnswerValue | undefined;
  allQuestions: Question[];
  answers: Record<string, AnswerValue>;
  onChange: (id: string, value: AnswerValue) => void;
  onInputChange: (id: string, event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  const resolvedLabel = resolvePipedLabel(question.label, allQuestions, answers);

  const label = (
    <span className="question-label">
      {resolvedLabel}
      {question.required ? <span className="required-mark"> *</span> : null}
    </span>
  );

  const desc = question.description ? (
    <span className="question-description">{question.description}</span>
  ) : null;

  if (question.type === "SINGLE_CHOICE" || question.type === "YES_NO") {
    const options = question.type === "YES_NO"
      ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
      : question.options ?? [];
    return (
      <fieldset className="question-field">
        <legend>{label}</legend>
        {desc}
        <div className="choice-list">
          {options.map((o) => (
            <label className="choice-item" key={o.value}>
              <input type="radio" name={question.id} value={o.value} checked={value === o.value} onChange={() => onChange(question.id, o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (question.type === "MULTIPLE_CHOICE") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="question-field">
        <legend>{label}</legend>
        {desc}
        <div className="choice-list">
          {(question.options ?? []).map((o) => (
            <label className="choice-item" key={o.value}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => {
                const next = selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value];
                onChange(question.id, next);
              }} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (question.type === "RATING") {
    const min = question.settings?.min ?? 1;
    const max = question.settings?.max ?? 5;
    const current = typeof value === "number" ? value : null;
    return (
      <fieldset className="question-field">
        <legend>{label}</legend>
        {desc}
        <div className="rating-list">
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((r) => (
            <label className="rating-item" key={r}>
              <input type="radio" name={question.id} checked={current === r} onChange={() => onChange(question.id, r)} />
              <span>{r}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (question.type === "LONG_TEXT") {
    return (
      <div className="question-field">
        <label>{label}</label>
        {desc}
        <textarea rows={4} value={typeof value === "string" ? value : ""} onChange={(e) => onInputChange(question.id, e)} placeholder="Your answer..." />
      </div>
    );
  }

  if (question.type === "LINEAR_SCALE") {
    const min = question.settings?.min ?? 1;
    const max = question.settings?.max ?? 10;
    const current = typeof value === "number" ? value : null;
    return (
      <fieldset className="question-field">
        <legend>{label}</legend>
        {desc}
        <div className="rating-list">
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((r) => (
            <label className="rating-item" key={r}>
              <input type="radio" name={question.id} checked={current === r} onChange={() => onChange(question.id, r)} />
              <span>{r}</span>
            </label>
          ))}
        </div>
        <div className="rating-labels">
          <span>{question.settings?.minLabel ?? ""}</span>
          <span>{question.settings?.maxLabel ?? ""}</span>
        </div>
      </fieldset>
    );
  }

  if (question.type === "FILE_UPLOAD") {
    return (
      <div className="question-field">
        <label>{label}</label>
        {desc}
        <div style={{ border: "2px dashed #cbd5e1", borderRadius: 12, padding: "24px 16px", textAlign: "center", background: "#f8fafc" }}>
          <p style={{ margin: 0, color: "#475569", fontWeight: 600 }}>Click to upload (preview only)</p>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "0.82rem" }}>Max {question.settings?.maxFileSizeMB ?? 5}MB</p>
        </div>
      </div>
    );
  }

  // Signature: live interactive canvas (draw + clear) but no Save / upload —
  // preview submissions are never persisted.
  if (question.type === "SIGNATURE") {
    return (
      <div className="question-field">
        <label>{label}</label>
        {desc}
        <SignaturePad ariaLabel={resolvedLabel} />
      </div>
    );
  }

  if (question.type === "MULTI_ENTRY") {
    const entries: string[] = Array.isArray(value)
      ? (value as string[])
      : [""];

    return (
      <div className="question-field">
        <label>{label}</label>
        {desc}
        <div style={{ display: "grid", gap: 8 }}>
          {entries.map((entry, idx) => (
            <div
              key={idx}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <input
                type="text"
                value={entry}
                onChange={(e) => {
                  const next = [...entries];
                  next[idx] = e.target.value;
                  onChange(question.id, next);
                }}
                placeholder={`Entry ${idx + 1}`}
                aria-label={`${question.label} — entry ${idx + 1}`}
                style={{
                  flex: 1,
                  border: "1px solid #cbd5e1",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: "inherit",
                }}
              />
              {entries.length > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = entries.filter((_, i) => i !== idx);
                    onChange(question.id, next.length > 0 ? next : [""]);
                  }}
                  aria-label={`Remove entry ${idx + 1}`}
                  style={{
                    border: "none",
                    background: "none",
                    color: "#94a3b8",
                    fontSize: "1.2rem",
                    cursor: "pointer",
                    padding: "4px 8px",
                    borderRadius: 6,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange(question.id, [...entries, ""])}
          style={{
            marginTop: 8,
            background: "none",
            border: "none",
            color: "#2563eb",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
            padding: "4px 0",
          }}
        >
          + Add another
        </button>
      </div>
    );
  }

  const inputType = question.type === "EMAIL" ? "email" : question.type === "NUMBER" ? "number" : question.type === "DATE" ? "date" : question.type === "URL" ? "url" : question.type === "PHONE" ? "tel" : "text";
  const placeholder = question.type === "PHONE" ? "+91 98765 43210" : question.type === "URL" ? "https://example.com" : "Your answer...";
  return (
    <div className="question-field">
      <label>{label}</label>
      {desc}
      <input type={inputType} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(e) => onInputChange(question.id, e)} placeholder={placeholder} />
    </div>
  );
}
