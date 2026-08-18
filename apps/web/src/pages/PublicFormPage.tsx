import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useParams } from "react-router-dom";
import { publicGet, publicPost, ApiRequestError } from "../lib/api";
import type { AnswerValue, PublicForm, Question } from "../types";

export default function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();

  const [form, setForm] = useState<PublicForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    async function loadForm() {
      if (!slug) {
        setError("A form slug is missing.");
        setLoading(false);
        return;
      }

      try {
        const data = await publicGet<{ form: PublicForm }>(
          `/api/forms/public/${slug}`,
        );
        setForm(data.form);
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : "Unable to load this form.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadForm();
  }, [slug]);

  const questions = useMemo(
    () => form?.schema.sections.flatMap((section) => section.questions) ?? [],
    [form],
  );

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

  function validateAnswers() {
    if (!form) return "Form is unavailable.";

    const missing = questions.find((question) => {
      if (!question.required) return false;
      const answer = answers[question.id];
      if (Array.isArray(answer)) return answer.length === 0;
      return answer === undefined || answer === null || answer === "";
    });

    if (missing) return `Please answer: ${missing.label}`;
    if (form.schema.settings.collectEmail && !email.trim())
      return "Please enter your email address.";
    return "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");

    const validationError = validateAnswers();
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
        ...(form?.schema.settings.collectEmail
          ? { email: email.trim().toLowerCase() }
          : {}),
        metadata: { source: "qivo-web" },
      });
      setSubmitted(true);
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

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading form...</p>
        </div>
      </main>
    );
  }

  if (error || !form) {
    return (
      <main className="page-shell">
        <div className="status-card error-card">
          <p className="eyebrow">Unavailable</p>
          <h1>We couldn't open this form.</h1>
          <p>{error || "Form not found."}</p>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="page-shell">
        <div className="status-card success-card">
          <p className="eyebrow">Response received</p>
          <h1>Thank you.</h1>
          <p>
            {form.schema.confirmationMessage ||
              "Your response was submitted successfully."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="form-card">
        <header className="form-header">
          <p className="eyebrow">Qivo Form</p>
          <h1>{form.title}</h1>
          {form.description ? (
            <p className="form-description">{form.description}</p>
          ) : null}
        </header>

        <form onSubmit={handleSubmit} noValidate>
          {form.schema.settings.collectEmail ? (
            <div className="question-field">
              <label htmlFor="respondent-email">Email address</label>
              <input
                id="respondent-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          ) : null}

          {form.schema.sections.map((section) => (
            <section className="form-section" key={section.id}>
              {section.title ? <h2>{section.title}</h2> : null}
              {section.questions.map((question) => (
                <QuestionField
                  key={question.id}
                  question={question}
                  value={answers[question.id]}
                  onChange={updateAnswer}
                  onInputChange={handleInputChange}
                />
              ))}
            </section>
          ))}

          {questions.length === 0 ? (
            <p className="empty-state">This form does not contain any questions.</p>
          ) : null}

          {submitError ? (
            <p className="submit-error" role="alert">
              {submitError}
            </p>
          ) : null}

          <button
            className="submit-button"
            type="submit"
            disabled={submitting || questions.length === 0}
          >
            {submitting ? "Submitting..." : "Submit response"}
          </button>
        </form>
      </section>
    </main>
  );
}

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
        ? [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]
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

    return (
      <fieldset className="question-field">
        <legend>{label}</legend>
        {descriptionElement}
        <div className="rating-list" role="radiogroup" aria-label={question.label}>
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(
            (rating) => (
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
            ),
          )}
        </div>
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
        />
      </div>
    );
  }

  const inputType =
    question.type === "EMAIL"
      ? "email"
      : question.type === "NUMBER"
        ? "number"
        : question.type === "DATE"
          ? "date"
          : "text";

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
      />
    </div>
  );
}
