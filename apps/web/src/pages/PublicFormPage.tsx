import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useParams } from "react-router-dom";
import { publicGet, publicPost, ApiRequestError } from "../lib/api";
import { evaluateConditions } from "../lib/conditions";
import type { AnswerValue, PublicForm, Question, Section } from "../types";

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();

  const [form, setForm] = useState<PublicForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState<{ earned: number; total: number; percentage: number } | null>(null);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);

  useEffect(() => {
    async function loadForm() {
      if (!slug) {
        setError("A form slug is missing.");
        setLoading(false);
        return;
      }
      try {
        const data = await publicGet<{ form: PublicForm }>(`/api/forms/public/${slug}`);
        setForm(data.form);
      } catch (err) {
        if (err instanceof ApiRequestError) {
          setError(err.message);
          setErrorCode(err.code);
        } else {
          setError("Unable to load this form.");
        }
      } finally {
        setLoading(false);
      }
    }
    void loadForm();
  }, [slug]);

  // Sections with email as section 0 if needed
  const sections = useMemo((): Section[] => {
    if (!form) return [];
    return form.schema.sections;
  }, [form]);

  const totalSections = sections.length;
  const isMultiSection = totalSections > 1;
  const currentSection = sections[currentSectionIndex];

  // All questions flattened (for validation)
  const allQuestions = useMemo(
    () => sections.flatMap((s) => s.questions),
    [sections],
  );

  // Questions in current section
  const currentQuestions = currentSection?.questions ?? [];

  // Progress: email counts as part of first section
  const progressPercent = totalSections > 0
    ? Math.round(((currentSectionIndex) / totalSections) * 100)
    : 0;

  function updateAnswer(questionId: string, value: AnswerValue) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function handleInputChange(
    questionId: string,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const rawValue = event.target.value;
    updateAnswer(
      questionId,
      event.target.type === "number" ? Number(rawValue) : rawValue,
    );
  }

  function validateSection(questions: Question[]): string {
    const missing = questions.find((q) => {
      if (!q.required) return false;
      const answer = answers[q.id];
      if (Array.isArray(answer)) return answer.length === 0;
      return answer === undefined || answer === null || answer === "";
    });
    if (missing) return `Please answer: ${missing.label}`;
    return "";
  }

  function validateAll(): string {
    // Check email
    if (form?.schema.settings.collectEmail && !email.trim()) {
      return "Please enter your email address.";
    }
    // Check all visible questions only
    for (const q of allQuestions) {
      if (!q.required) continue;
      // Skip questions hidden by conditional logic
      if (!evaluateConditions(q.conditions, answers)) continue;
      const answer = answers[q.id];
      if (Array.isArray(answer) && answer.length === 0) return `Please answer: ${q.label}`;
      if (answer === undefined || answer === null || answer === "") return `Please answer: ${q.label}`;
    }
    return "";
  }

  function handleNext() {
    setSubmitError("");
    const validationError = validateSection(currentQuestions);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }
    setCurrentSectionIndex((i) => Math.min(i + 1, totalSections - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleBack() {
    setSubmitError("");
    setCurrentSectionIndex((i) => Math.max(i - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");

    const validationError = validateAll();
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    if (!slug) {
      setSubmitError("A form slug is missing.");
      return;
    }

    setSubmitting(true);
    try {
      await publicPost(`/api/forms/public/${slug}/responses`, {
        answers,
        ...(form?.schema.settings.collectEmail ? { email: email.trim().toLowerCase() } : {}),
        metadata: { source: "qivo-web" },
      }).then((data: any) => {
        if (data?.quizScore) setQuizScore(data.quizScore);
      });
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setSubmitError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to submit your response.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="public-form-shell">
        <div className="public-form-loading">
          <div className="skeleton-block" style={{ width: "60%", height: 36, marginBottom: 16 }} />
          <div className="skeleton-block" style={{ width: "80%", height: 18, marginBottom: 32 }} />
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ marginBottom: 24 }}>
              <div className="skeleton-block" style={{ width: "40%", height: 16, marginBottom: 10 }} />
              <div className="skeleton-block" style={{ height: 44 }} />
            </div>
          ))}
        </div>
      </main>
    );
  }

  // ─── Error states ──────────────────────────────────────────────────────────

  if (errorCode === "PUBLIC_FORM_NOT_FOUND" || (!form && !error)) {
    return (
      <main className="public-form-shell">
        <div className="public-status-card public-status-error">
          <div className="public-status-icon">🔒</div>
          <h1>Form not available</h1>
          <p>This form doesn't exist or hasn't been published yet.</p>
        </div>
      </main>
    );
  }

  if (error || !form) {
    return (
      <main className="public-form-shell">
        <div className="public-status-card public-status-error">
          <div className="public-status-icon">⚠️</div>
          <h1>Something went wrong</h1>
          <p>{error || "Unable to load this form."}</p>
          <button
            type="button"
            className="submit-button"
            style={{ marginTop: 20, maxWidth: 200 }}
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  // ─── Success ───────────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <main className="public-form-shell">
        <div className="public-status-card public-status-success">
          <div className="public-status-icon">✅</div>
          <h1>Response submitted</h1>
          {quizScore && form.schema.settings.showScore ? (
            <div style={{ margin: "20px 0", padding: "20px", background: "#f0fdf4", borderRadius: 14, border: "1px solid #bbf7d0" }}>
              <p style={{ margin: "0 0 8px", color: "#166534", fontWeight: 700, fontSize: "0.9rem" }}>Your score</p>
              <p style={{ margin: 0, fontSize: "2.5rem", fontWeight: 900, color: "#111827" }}>
                {quizScore.earned}/{quizScore.total}
              </p>
              <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: "0.9rem" }}>
                {quizScore.percentage}% correct
              </p>
            </div>
          ) : null}
          <p>
            {form.schema.confirmationMessage ||
              "Thank you! Your response has been recorded."}
          </p>
          <p className="public-status-brand">Powered by Qivo Forms</p>
        </div>
      </main>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────────────────

  const isLastSection = currentSectionIndex === totalSections - 1;
  const isFirstSection = currentSectionIndex === 0;

  return (
    <main className="public-form-shell">
      <div className="public-form-wrap">
        {/* Progress bar */}
        {isMultiSection ? (
          <div className="public-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
            <div
              className="public-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : null}

        {/* Header */}
        <header className="public-form-header">
          {form.branding?.logoUrl ? (
            <img
              src={form.branding.logoUrl}
              alt={form.branding.workspaceName}
              style={{ height: 40, width: "auto", borderRadius: 8, marginBottom: 12 }}
            />
          ) : null}
          <p className="eyebrow" style={form.branding?.primaryColor ? { color: form.branding.primaryColor } : undefined}>
            {form.branding?.workspaceName ?? "Qivo Form"}
          </p>
          <h1 className="public-form-title">{form.title}</h1>
          {form.description ? (
            <p className="public-form-description">{form.description}</p>
          ) : null}
          {isMultiSection ? (
            <p className="public-section-counter">
              Section {currentSectionIndex + 1} of {totalSections}
              {currentSection?.title ? ` — ${currentSection.title}` : ""}
            </p>
          ) : null}
        </header>

        {/* Form body */}
        <form onSubmit={handleSubmit} noValidate className="public-form-body">
          {/* Email field — only on first section */}
          {form.schema.settings.collectEmail && isFirstSection ? (
            <div className="question-field">
              <label htmlFor="respondent-email">
                <span className="question-label">
                  Email address
                  <span className="required-mark"> *</span>
                </span>
              </label>
              <input
                id="respondent-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>
          ) : null}

          {/* Section questions */}
          {currentSection ? (
            <div className="public-section">
              {currentQuestions.length === 0 ? (
                <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>
                  This section has no questions.
                </p>
              ) : (
                currentQuestions
                  .filter((question) => evaluateConditions(question.conditions, answers))
                  .map((question) => (
                    <QuestionField
                      key={question.id}
                      question={question}
                      value={answers[question.id]}
                      onChange={updateAnswer}
                      onInputChange={handleInputChange}
                    />
                  ))
              )}
            </div>
          ) : null}

          {/* Error */}
          {submitError ? (
            <p className="submit-error" role="alert" style={{ marginBottom: 16 }}>
              {submitError}
            </p>
          ) : null}

          {/* Navigation */}
          <div className="public-form-nav">
            {isMultiSection && !isFirstSection ? (
              <button
                type="button"
                className="secondary-button"
                onClick={handleBack}
              >
                ← Back
              </button>
            ) : <span />}

            {isMultiSection && !isLastSection ? (
              <button
                type="button"
                className="submit-button"
                style={{ flex: 1, maxWidth: 240, ...(form.branding?.primaryColor ? { background: form.branding.primaryColor } : {}) }}
                onClick={handleNext}
              >
                Next →
              </button>
            ) : (
              <button
                className="submit-button"
                type="submit"
                style={{ flex: 1, maxWidth: 240, ...(form.branding?.primaryColor ? { background: form.branding.primaryColor } : {}) }}
                disabled={submitting || allQuestions.length === 0}
              >
                {submitting ? "Submitting..." : "Submit response"}
              </button>
            )}
          </div>
        </form>

        <p className="public-form-brand">Powered by Qivo Forms</p>
      </div>
    </main>
  );
}

// ─── Question Field ───────────────────────────────────────────────────────────

function QuestionField({
  question,
  value,
  onChange,
  onInputChange,
}: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (questionId: string, value: AnswerValue) => void;
  onInputChange: (
    questionId: string,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
}) {
  const inputId = `question-${question.id}`;
  const descriptionId = `${inputId}-description`;
  const description = question.description ?? undefined;

  const label = (
    <span className="question-label">
      {question.label}
      {question.required ? <span className="required-mark"> *</span> : null}
    </span>
  );

  const descriptionElement = description ? (
    <span className="question-description" id={descriptionId}>
      {description}
    </span>
  ) : null;

  if (question.type === "SINGLE_CHOICE" || question.type === "YES_NO") {
    const options =
      question.type === "YES_NO"
        ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
        : question.options ?? [];

    return (
      <fieldset className="question-field">
        <legend>{label}</legend>
        {descriptionElement}
        <div className="choice-list">
          {options.map((option) => (
            <label className="choice-item" key={option.value}>
              <input
                type="radio"
                name={question.id}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(question.id, option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (question.type === "MULTIPLE_CHOICE") {
    const selected = Array.isArray(value) ? value : [];

    function toggleOption(optionValue: string) {
      const next = selected.includes(optionValue)
        ? selected.filter((item) => item !== optionValue)
        : [...selected, optionValue];
      onChange(question.id, next);
    }

    return (
      <fieldset className="question-field">
        <legend>{label}</legend>
        {descriptionElement}
        <div className="choice-list">
          {(question.options ?? []).map((option) => (
            <label className="choice-item" key={option.value}>
              <input
                type="checkbox"
                value={option.value}
                checked={selected.includes(option.value)}
                onChange={() => toggleOption(option.value)}
              />
              <span>{option.label}</span>
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
    const range = Array.from({ length: max - min + 1 }, (_, i) => min + i);

    return (
      <fieldset className="question-field">
        <legend>{label}</legend>
        {descriptionElement}
        <div className="rating-list" role="radiogroup" aria-label={question.label}>
          {range.map((rating) => (
            <label className="rating-item" key={rating}>
              <input
                type="radio"
                name={question.id}
                value={rating}
                checked={current === rating}
                onChange={() => onChange(question.id, rating)}
              />
              <span>{rating}</span>
            </label>
          ))}
        </div>
        {range.length > 2 ? (
          <div className="rating-labels">
            <span>Low</span>
            <span>High</span>
          </div>
        ) : null}
      </fieldset>
    );
  }

  if (question.type === "LONG_TEXT") {
    return (
      <div className="question-field">
        <label htmlFor={inputId}>{label}</label>
        {descriptionElement}
        <textarea
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onInputChange(question.id, event)}
          aria-describedby={description ? descriptionId : undefined}
          rows={5}
          placeholder="Your answer..."
        />
      </div>
    );
  }

  // Linear scale
  if (question.type === "LINEAR_SCALE") {
    const min = question.settings?.min ?? 1;
    const max = question.settings?.max ?? 10;
    const minLabel = question.settings?.minLabel ?? "";
    const maxLabel = question.settings?.maxLabel ?? "";
    const current = typeof value === "number" ? value : null;
    const range = Array.from({ length: max - min + 1 }, (_, i) => min + i);

    return (
      <fieldset className="question-field">
        <legend>{label}</legend>
        {descriptionElement}
        <div className="rating-list" role="radiogroup" aria-label={question.label}>
          {range.map((rating) => (
            <label className="rating-item" key={rating}>
              <input
                type="radio"
                name={question.id}
                value={rating}
                checked={current === rating}
                onChange={() => onChange(question.id, rating)}
              />
              <span>{rating}</span>
            </label>
          ))}
        </div>
        {(minLabel || maxLabel) ? (
          <div className="rating-labels">
            <span>{minLabel}</span>
            <span>{maxLabel}</span>
          </div>
        ) : null}
      </fieldset>
    );
  }

  // File upload
  if (question.type === "FILE_UPLOAD") {
    const maxSize = question.settings?.maxFileSizeMB ?? 5;
    const allowedTypes = question.settings?.allowedFileTypes ?? [];
    const fileName = typeof value === "string" && value ? value : "";

    return (
      <div className="question-field">
        <label htmlFor={inputId}>{label}</label>
        {descriptionElement}
        <div
          style={{
            border: "2px dashed #cbd5e1",
            borderRadius: 12,
            padding: "24px 16px",
            textAlign: "center",
            background: "#f8fafc",
            cursor: "pointer",
          }}
          onClick={() => document.getElementById(inputId)?.click()}
          onKeyDown={(e) => { if (e.key === "Enter") document.getElementById(inputId)?.click(); }}
          role="button"
          tabIndex={0}
        >
          <input
            id={inputId}
            type="file"
            accept={allowedTypes.join(",")}
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                if (file.size > maxSize * 1024 * 1024) {
                  alert(`File too large. Maximum ${maxSize}MB allowed.`);
                  return;
                }
                // Store file name as value (actual upload would go to S3 in production)
                onChange(question.id, `[file:${file.name}:${file.size}]`);
              }
            }}
          />
          {fileName ? (
            <p style={{ margin: 0, color: "#16a34a", fontWeight: 600 }}>
              ✓ {fileName.replace("[file:", "").replace(/:\d+\]$/, "")}
            </p>
          ) : (
            <>
              <p style={{ margin: "0 0 4px", color: "#475569", fontWeight: 600 }}>
                Click to upload a file
              </p>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.82rem" }}>
                Max {maxSize}MB
                {allowedTypes.length > 0 ? ` · ${allowedTypes.join(", ")}` : ""}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const inputType =
    question.type === "EMAIL" ? "email"
    : question.type === "NUMBER" ? "number"
    : question.type === "DATE" ? "date"
    : question.type === "URL" ? "url"
    : question.type === "PHONE" ? "tel"
    : "text";

  const placeholder =
    question.type === "EMAIL" ? "your@email.com"
    : question.type === "NUMBER" ? "Enter a number"
    : question.type === "URL" ? "https://example.com"
    : question.type === "PHONE" ? "+91 98765 43210"
    : question.type === "DATE" ? ""
    : "Your answer...";

  return (
    <div className="question-field">
      <label htmlFor={inputId}>{label}</label>
      {descriptionElement}
      <input
        id={inputId}
        type={inputType}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
        onChange={(event) => onInputChange(question.id, event)}
        aria-describedby={description ? descriptionId : undefined}
        placeholder={placeholder}
      />
    </div>
  );
}
