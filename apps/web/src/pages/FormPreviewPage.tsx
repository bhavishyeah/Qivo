import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { Link, useParams } from "react-router-dom";
import ColorSchemeToggle from "../components/ColorSchemeToggle";
import { api, ApiRequestError } from "../lib/api";
import { evaluateConditions } from "../lib/conditions";
import { validateQuestionFormat } from "../lib/validation";
import { nextSectionAfter } from "../lib/sectionJumps";
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
  // Visited-section stack (indices); last element is the current section.
  const [history, setHistory] = useState<number[]>([0]);
  const currentSection = history[history.length - 1] ?? 0;
  // Set when jump logic lands on the submit sentinel from a non-last section —
  // preview never submits, so it shows the disabled submit control instead.
  const [reachedEnd, setReachedEnd] = useState(false);
  // Inline per-field format errors, keyed by question id — mirrors the public
  // form so editors see exactly what respondents will.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
    // Clear a shown error once the value becomes valid.
    setFieldErrors((errs) => {
      if (!errs[questionId]) return errs;
      const question = sections
        .flatMap((s) => s.questions)
        .find((q) => q.id === questionId);
      if (question && validateQuestionFormat(question, value) === null) {
        const { [questionId]: _r, ...rest } = errs;
        return rest;
      }
      return errs;
    });
  }

  function handleFieldBlur(question: Question) {
    const message = validateQuestionFormat(question, answers[question.id]);
    setFieldErrors((errs) => {
      if (message) return { ...errs, [question.id]: message };
      if (!errs[question.id]) return errs;
      const { [question.id]: _r, ...rest } = errs;
      return rest;
    });
  }

  // Validate the current section's visible questions' formats before advancing.
  // Returns true when it is safe to proceed.
  function validateCurrentSection(): boolean {
    const errors: Record<string, string> = {};
    let firstInvalidId: string | null = null;
    for (const q of questions) {
      const message = validateQuestionFormat(q, answers[q.id]);
      if (message) {
        errors[q.id] = message;
        if (!firstInvalidId) firstInvalidId = `preview-question-${q.id}`;
      }
    }
    if (firstInvalidId) {
      setFieldErrors((errs) => ({ ...errs, ...errors }));
      const el = document.getElementById(firstInvalidId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus({ preventScroll: true });
      }
      return false;
    }
    return true;
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
      // Per-form custom background is passed as --qivo-form-bg so dark mode can
      // override it (shown in light mode only); cover/accent apply in both.
      style={{
        ...(resolved.background
          ? ({ "--qivo-form-bg": resolved.background } as CSSProperties)
          : {}),
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
          <div
            className="public-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.max(0, Math.round(((history.length - 1) / totalSections) * 100)))}
          >
            <div className="public-progress-fill" style={{ width: `${Math.min(100, Math.max(0, Math.round(((history.length - 1) / totalSections) * 100)))}%` }} />
          </div>
        ) : null}

        {/* Header */}
        <header className="public-form-header">
          <ColorSchemeToggle />
          <p className="eyebrow" style={{ color: previewAccent }}>Qivo Form (Preview)</p>
          <h1 className="public-form-title">{form.title}</h1>
          {form.description ? <p className="public-form-description">{form.description}</p> : null}
          {totalSections > 1 ? (
            <p className="public-section-counter" aria-live="polite">
              Section {currentSection + 1} of {totalSections}
              {section?.title ? ` — ${section.title}` : ""}
            </p>
          ) : null}
        </header>

        {/* Body */}
        <div className="public-form-body">
          {form.schema.settings.collectEmail && currentSection === 0 ? (
            <div className="question-field">
              <label htmlFor="preview-respondent-email"><span className="question-label">Email address <span className="required-mark" aria-hidden="true">*</span><span className="required-text"> (required)</span></span></label>
              <input id="preview-respondent-email" type="email" placeholder="you@example.com" disabled aria-required="true" style={{ opacity: 0.6 }} />
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
              error={fieldErrors[question.id]}
              onBlur={() => handleFieldBlur(question)}
            />
          ))}

          {questions.length === 0 && section ? (
            <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>No visible questions in this section.</p>
          ) : null}

          {/* Nav */}
          <div className="public-form-nav" style={{ marginTop: 16 }}>
            {history.length > 1 ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setReachedEnd(false);
                  setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
                }}
              >
                ← Back
              </button>
            ) : <span />}
            {!reachedEnd && currentSection < totalSections - 1 ? (
              <button
                type="button"
                className="submit-button"
                style={{ maxWidth: 240, background: previewAccent }}
                onClick={() => {
                  if (!validateCurrentSection()) return;
                  const step = nextSectionAfter(sections, currentSection, answers);
                  if (step.kind === "submit") {
                    setReachedEnd(true);
                    return;
                  }
                  setHistory((h) => [...h, step.index]);
                }}
              >
                Next →
              </button>
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
  error,
  onBlur,
}: {
  question: Question;
  value: AnswerValue | undefined;
  allQuestions: Question[];
  answers: Record<string, AnswerValue>;
  onChange: (id: string, value: AnswerValue) => void;
  onInputChange: (id: string, event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  error?: string | undefined;
  onBlur?: (() => void) | undefined;
}) {
  const resolvedLabel = resolvePipedLabel(question.label, allQuestions, answers);
  const previewId = `preview-question-${question.id}`;
  const descriptionId = `${previewId}-description`;
  const errorId = `${previewId}-error`;
  const errorElement = error ? (
    <p className="field-error" id={errorId} role="alert" aria-live="polite">
      {error}
    </p>
  ) : null;

  const label = (
    <span className="question-label">
      {resolvedLabel}
      {question.required ? (
        <>
          <span className="required-mark" aria-hidden="true"> *</span>
          <span className="required-text"> (required)</span>
        </>
      ) : null}
    </span>
  );

  const desc = question.description ? (
    <span className="question-description" id={descriptionId}>{question.description}</span>
  ) : null;

  if (question.type === "SINGLE_CHOICE" || question.type === "YES_NO") {
    const options = question.type === "YES_NO"
      ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
      : question.options ?? [];
    return (
      <fieldset className="question-field">
        <legend id={`${previewId}-legend`}>{label}</legend>
        {desc}
        <div
          className="choice-list"
          role="radiogroup"
          aria-labelledby={`${previewId}-legend`}
          aria-required={question.required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [question.description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {options.map((o) => (
            <label className="choice-item" key={o.value}>
              <input type="radio" name={question.id} value={o.value} checked={value === o.value} onChange={() => onChange(question.id, o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
        {errorElement}
      </fieldset>
    );
  }

  if (question.type === "MULTIPLE_CHOICE") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="question-field">
        <legend id={`${previewId}-legend`}>{label}</legend>
        {desc}
        <div
          className="choice-list"
          role="group"
          aria-labelledby={`${previewId}-legend`}
          aria-required={question.required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [question.description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
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
        {errorElement}
      </fieldset>
    );
  }

  if (question.type === "RATING") {
    const min = question.settings?.min ?? 1;
    const max = question.settings?.max ?? 5;
    const current = typeof value === "number" ? value : null;
    return (
      <fieldset className="question-field">
        <legend id={`${previewId}-legend`}>{label}</legend>
        {desc}
        <div
          className="rating-list"
          role="radiogroup"
          aria-labelledby={`${previewId}-legend`}
          aria-required={question.required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [question.description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((r) => (
            <label className="rating-item" key={r}>
              <input type="radio" name={question.id} checked={current === r} onChange={() => onChange(question.id, r)} />
              <span>{r}</span>
            </label>
          ))}
        </div>
        {errorElement}
      </fieldset>
    );
  }

  if (question.type === "LONG_TEXT") {
    return (
      <div className="question-field">
        <label htmlFor={previewId}>{label}</label>
        {desc}
        <textarea
          id={previewId}
          rows={4}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onInputChange(question.id, e)}
          onBlur={onBlur}
          aria-required={question.required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [question.description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          placeholder="Your answer..."
        />
        {errorElement}
      </div>
    );
  }

  if (question.type === "LINEAR_SCALE") {
    const min = question.settings?.min ?? 1;
    const max = question.settings?.max ?? 10;
    const current = typeof value === "number" ? value : null;
    return (
      <fieldset className="question-field">
        <legend id={`${previewId}-legend`}>{label}</legend>
        {desc}
        <div
          className="rating-list"
          role="radiogroup"
          aria-labelledby={`${previewId}-legend`}
          aria-required={question.required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [question.description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
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
        {errorElement}
      </fieldset>
    );
  }

  if (question.type === "FILE_UPLOAD") {
    return (
      <div className="question-field" role="group" aria-labelledby={`${previewId}-legend`}>
        <label id={`${previewId}-legend`}>{label}</label>
        {desc}
        <div className="upload-dropzone">
          <p style={{ margin: 0, color: "var(--qivo-text-secondary)", fontWeight: 600 }}>Click to upload (preview only)</p>
          <p className="upload-hint" style={{ margin: "4px 0 0" }}>Max {question.settings?.maxFileSizeMB ?? 5}MB</p>
        </div>
      </div>
    );
  }

  // Signature: live interactive canvas (draw + clear) but no Save / upload —
  // preview submissions are never persisted.
  if (question.type === "SIGNATURE") {
    return (
      <div className="question-field" role="group" aria-labelledby={`${previewId}-legend`}>
        <label id={`${previewId}-legend`}>{label}</label>
        {desc}
        <SignaturePad ariaLabel={resolvedLabel} />
      </div>
    );
  }

  if (question.type === "MULTI_ENTRY") {
    const MAX_MULTI_ENTRY_COUNT = 50;
    const entries: string[] = Array.isArray(value)
      ? (value as string[])
      : [""];
    const atCap = entries.length >= MAX_MULTI_ENTRY_COUNT;

    return (
      <div className="question-field" role="group" aria-labelledby={`${previewId}-legend`}>
        <label id={`${previewId}-legend`} htmlFor={`${previewId}-0`}>{label}</label>
        {desc}
        <div style={{ display: "grid", gap: 8 }}>
          {entries.map((entry, idx) => (
            <div
              key={idx}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <input
                id={idx === 0 ? `${previewId}-0` : undefined}
                className="multi-entry-input"
                type="text"
                value={entry}
                onChange={(e) => {
                  const next = [...entries];
                  next[idx] = e.target.value;
                  onChange(question.id, next);
                }}
                placeholder={`Entry ${idx + 1}`}
                aria-label={`${resolvedLabel} — entry ${idx + 1}`}
                aria-required={question.required && idx === 0 ? true : undefined}
              />
              {entries.length > 1 ? (
                <button
                  type="button"
                  className="multi-entry-remove"
                  onClick={() => {
                    const next = entries.filter((_, i) => i !== idx);
                    onChange(question.id, next.length > 0 ? next : [""]);
                  }}
                  aria-label={`Remove entry ${idx + 1}`}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="multi-entry-add"
          onClick={() => { if (!atCap) onChange(question.id, [...entries, ""]); }}
          disabled={atCap}
          aria-label="Add another entry"
        >
          + Add another
        </button>
        {atCap ? <p style={{color: '#6b7280', fontSize: '0.875rem', margin: '4px 0 0 0'}}>Maximum 50 entries</p> : null}
      </div>
    );
  }

  const inputType = question.type === "EMAIL" ? "email" : question.type === "NUMBER" ? "number" : question.type === "DATE" ? "date" : question.type === "URL" ? "url" : question.type === "PHONE" ? "tel" : "text";
  const placeholder = question.type === "PHONE" ? "+91 98765 43210" : question.type === "URL" ? "https://example.com" : "Your answer...";
  return (
    <div className="question-field">
      <label htmlFor={previewId}>{label}</label>
      {desc}
      <input
        id={previewId}
        type={inputType}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
        onChange={(e) => onInputChange(question.id, e)}
        onBlur={onBlur}
        aria-required={question.required ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [question.description ? descriptionId : null, error ? errorId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        placeholder={placeholder}
      />
      {errorElement}
    </div>
  );
}
