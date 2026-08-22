import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import { evaluateConditions } from "../lib/conditions";
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

  const sections = form?.schema?.sections ?? [];
  const totalSections = sections.length;
  const section = sections[currentSection];
  const questions = useMemo(
    () => (section?.questions ?? []).filter((q) => evaluateConditions(q.conditions, answers)),
    [section, answers],
  );

  function updateAnswer(questionId: string, value: AnswerValue) {
    setAnswers((c) => ({ ...c, [questionId]: value }));
  }

  function handleInputChange(questionId: string, event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    updateAnswer(questionId, event.target.type === "number" ? Number(event.target.value) : event.target.value);
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

  return (
    <main className="public-form-shell">
      <div className="public-form-wrap">
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
          <p className="eyebrow">Qivo Form (Preview)</p>
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
              <button type="button" className="submit-button" style={{ maxWidth: 240 }} onClick={() => setCurrentSection((i) => i + 1)}>Next →</button>
            ) : (
              <button type="button" className="submit-button" style={{ maxWidth: 240, opacity: 0.7 }} disabled>Submit (preview only)</button>
            )}
          </div>
        </div>

        <p className="public-form-brand">Preview mode — this is what respondents will see</p>
      </div>
    </main>
  );
}

function PreviewQuestion({
  question,
  value,
  onChange,
  onInputChange,
}: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (id: string, value: AnswerValue) => void;
  onInputChange: (id: string, event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  const label = (
    <span className="question-label">
      {question.label}
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
