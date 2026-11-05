import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useParams } from "react-router-dom";
import {
  publicGet,
  publicPost,
  createPaymentOrder,
  checkResponseExists,
  saveDraft,
  loadDraft,
  deleteDraft,
  emailResumeLink,
  ApiRequestError,
} from "../lib/api";
import { evaluateConditions } from "../lib/conditions";
import { isValidEmail, validateQuestionFormat } from "../lib/validation";
import { computeReachedSections, nextSectionAfter } from "../lib/sectionJumps";
import { clampResumeSection } from "../lib/resumeSection";
import { resolvePipedLabel } from "../lib/piping";
import { isImageUrl, uploadToCloudinary } from "../lib/upload";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";
import ColorSchemeToggle from "../components/ColorSchemeToggle";
import { ensureFontLoaded, resolveTheme } from "../lib/theme";
import type { AnswerValue, PublicForm, Question, Section } from "../types";

// ─── Razorpay Checkout (lazy-loaded) ───────────────────────────────────────

type RazorpayCheckoutOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name?: string;
  description?: string;
  handler: (resp: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
};

type RazorpayInstance = { open: () => void };

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
  }
}

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let razorpayLoadPromise: Promise<void> | null = null;

// Inject checkout.js exactly once and resolve when window.Razorpay exists.
function loadRazorpayCheckout(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  if (razorpayLoadPromise) return razorpayLoadPromise;
  razorpayLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_CHECKOUT_SRC}"]`,
    );
    if (existing) {
      if (window.Razorpay) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Razorpay Checkout.")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_SRC;
    script.async = true;
    script.onload = () => {
      if (window.Razorpay) resolve();
      else reject(new Error("Razorpay Checkout did not initialize."));
    };
    script.onerror = () => {
      razorpayLoadPromise = null;
      reject(new Error("Failed to load Razorpay Checkout."));
    };
    document.body.appendChild(script);
  });
  return razorpayLoadPromise;
}

// ─── File type helpers ────────────────────────────────────────────────────────

/** Maps known MIME types to their file extensions for the accept attribute. */
const MIME_TO_EXT: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/msword": ".doc",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-powerpoint": ".ppt",
};

function buildAcceptString(mimeTypes: string[]): string {
  const parts: string[] = [];
  for (const mime of mimeTypes) {
    parts.push(mime);
    const ext = MIME_TO_EXT[mime];
    if (ext) parts.push(ext);
  }
  return parts.join(",");
}

const MIME_FRIENDLY: Record<string, string> = {
  "image/*": "Images",
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word (.docx)",
  "application/msword": "Word (.doc)",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel (.xlsx)",
  "application/vnd.ms-excel": "Excel (.xls)",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint (.pptx)",
  "application/vnd.ms-powerpoint": "PowerPoint (.ppt)",
};

function friendlyFileTypes(mimeTypes: string[]): string {
  return mimeTypes.map((m) => MIME_FRIENDLY[m] ?? m).join(", ");
}

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
  // Inline per-field format errors, keyed by field id ("respondent-email" or a
  // question id). A field appears here only once it has been touched (blur) or a
  // submit/Next attempt surfaced it; clearing to "" removes the message.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // True once the post-payment save failed, so the error banner can explain the
  // payment was received (distinct styling + copy).
  const [paymentSaveFailed, setPaymentSaveFailed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState<{ earned: number; total: number; percentage: number } | null>(null);
  // Stack of section INDICES the respondent has actually visited, in order.
  // The last element is the current section. Starts at [0]. Jump logic pushes
  // forward targets; Back pops, so skipped sections are never re-shown.
  const [history, setHistory] = useState<number[]>([0]);
  const currentSectionIndex = history[history.length - 1] ?? 0;

  // Fire the 'start' analytics event once per load on first interaction, and
  // stamp the client-measured elapsed time into the submit metadata. Refs so
  // neither re-renders nor re-fires on every keystroke.
  const startFiredRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);

  // Same-session response editing (never persisted — lost on reload by design).
  const [responseId, setResponseId] = useState<string | null>(null);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [editWindowExpiresAt, setEditWindowExpiresAt] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  // A ticking "now" so the confirmation screen hides the edit button client-side
  // once the window passes. UX only — the server re-check is the real guard.
  const [now, setNow] = useState(() => Date.now());

  // ── Partial save / resume later ──
  // The active draft token (from a save response OR the ?resume= param). Held in
  // a ref too so the submit path can read the latest token without re-rendering.
  const [resumeToken, setResumeToken] = useState<string | null>(null);
  const resumeTokenRef = useRef<string | null>(null);
  const [resumeLink, setResumeLink] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [resumeNotice, setResumeNotice] = useState("");
  const [copiedResumeLink, setCopiedResumeLink] = useState(false);
  const [emailedResumeLink, setEmailedResumeLink] = useState(false);
  // Guards the resume-on-load effect so it runs at most once per form load.
  const resumeAttemptedRef = useRef(false);

  useEffect(() => {
    resumeTokenRef.current = resumeToken;
  }, [resumeToken]);

  useEffect(() => {
    if (!editToken || editWindowExpiresAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [editToken, editWindowExpiresAt]);

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

  const allowPartialSave = form?.schema.settings.allowPartialSave === true;

  // ── Resume-on-load ──
  // Once the form (and its sections) are available, if the URL carries a
  // ?resume=<token> and partial save is on, fetch the draft and pre-fill the
  // form: answers, email, and the saved section (clamped to a reachable one).
  // Runs at most once per load. An unknown/expired token shows a friendly notice
  // and starts fresh, never crashing.
  useEffect(() => {
    if (!form || !slug) return;
    if (resumeAttemptedRef.current) return;
    if (!allowPartialSave) return;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("resume");
    if (!token) return;

    resumeAttemptedRef.current = true;

    void (async () => {
      try {
        const draft = await loadDraft(slug, token);
        // Restore directly (NOT via updateAnswer) so the 'start' analytics event
        // doesn't fire from a programmatic restore.
        setAnswers(
          (draft.answers ?? {}) as Record<string, AnswerValue>,
        );
        setEmail(draft.email ?? "");
        setResumeToken(token);
        const { history: restoredHistory } = clampResumeSection(
          form.schema.sections,
          (draft.answers ?? {}) as Record<string, AnswerValue>,
          draft.currentSection,
        );
        setHistory(restoredHistory);
        setResumeNotice("We restored your progress.");
      } catch {
        // Unknown / expired / wrong-form token: clear the param so a reload is
        // clean, tell the respondent, and render an empty form.
        params.delete("resume");
        const cleanSearch = params.toString();
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}`,
        );
        setResumeNotice(
          "That resume link is no longer valid — starting fresh.",
        );
      }
    })();
  }, [form, slug, allowPartialSave]);

  // Progress: base the numerator on how many sections have actually been
  // visited (stack depth) so it advances monotonically and never divides by a
  // skipped count. Clamped to [0, 100].
  const progressPercent = totalSections > 0
    ? Math.min(100, Math.max(0, Math.round(((history.length - 1) / totalSections) * 100)))
    : 0;

  function updateAnswer(questionId: string, value: AnswerValue) {
    // First real interaction: start the clock and fire 'start' once, never
    // blocking typing or surfacing an error.
    if (!startFiredRef.current && slug) {
      startFiredRef.current = true;
      startedAtRef.current = Date.now();
      void publicPost(`/api/forms/public/${slug}/track`, { event: "start" }).catch(
        () => {},
      );
    }
    setAnswers((current) => {
      const next = { ...current, [questionId]: value };
      // If this field already shows an error, clear it as soon as the new value
      // is valid (live feedback once touched). Uses the merged `next` value.
      setFieldErrors((errs) => {
        if (!errs[questionId]) return errs;
        const question = allQuestions.find((q) => q.id === questionId);
        if (!question) return errs;
        if (validateQuestionFormat(question, value) === null) {
          const { [questionId]: _removed, ...rest } = errs;
          return rest;
        }
        return errs;
      });
      return next;
    });
  }

  // Validate one question's format on blur (after it has been touched). Empty
  // values never show a format error here — required-ness is handled on submit.
  function handleFieldBlur(question: Question) {
    const message = validateQuestionFormat(question, answers[question.id]);
    setFieldErrors((errs) => {
      if (message) return { ...errs, [question.id]: message };
      if (!errs[question.id]) return errs;
      const { [question.id]: _removed, ...rest } = errs;
      return rest;
    });
  }

  function handleEmailBlur() {
    if (!form?.schema.settings.collectEmail) return;
    const value = email.trim();
    let message = "";
    if (value && !isValidEmail(value)) {
      message = "Please enter a valid email address, like name@example.com.";
    }
    setFieldErrors((errs) => {
      if (message) return { ...errs, "respondent-email": message };
      if (!errs["respondent-email"]) return errs;
      const { "respondent-email": _removed, ...rest } = errs;
      return rest;
    });
  }

  // Scroll to and focus the first element whose id is in `ids`, in DOM order.
  function focusFirstInvalid(ids: string[]) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        (el as HTMLElement).focus({ preventScroll: true });
        return;
      }
    }
  }

  // Collect format errors for every VISIBLE question in the given sections
  // (respecting conditional visibility). Returns the map plus ordered ids so the
  // caller can focus the first offender. Does not include required-ness.
  function collectFormatErrors(sectionsToCheck: Section[]): {
    errors: Record<string, string>;
    orderedIds: string[];
  } {
    const errors: Record<string, string> = {};
    const orderedIds: string[] = [];
    for (const section of sectionsToCheck) {
      for (const q of section.questions) {
        if (!evaluateConditions(q.conditions, answers)) continue;
        const message = validateQuestionFormat(q, answers[q.id]);
        if (message) {
          errors[q.id] = message;
          orderedIds.push(`question-${q.id}`);
        }
      }
    }
    return { errors, orderedIds };
  }

  function handleInputChange(
    questionId: string,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
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

  function validateSection(questions: Question[]): string {
    const missing = questions.find((q) => {
      if (!q.required) return false;
      // Skip questions hidden by conditional logic
      if (!evaluateConditions(q.conditions, answers)) return false;
      const answer = answers[q.id];
      if (Array.isArray(answer)) {
        return answer.length === 0 ||
          (answer as string[]).every((e) => !e.trim());
      }
      return answer === undefined || answer === null || answer === "";
    });
    if (missing) return `Please answer: ${missing.label}`;
    return "";
  }

  function validateAll(): string {
    // Check email
    if (form?.schema.settings.collectEmail) {
      if (!email.trim()) return "Please enter your email address.";
      // The form is noValidate, so check the format ourselves — the server
      // rejects malformed addresses with a generic 400 otherwise.
      if (!isValidEmail(email)) {
        return "Please enter a valid email address, like name@example.com.";
      }
    }
    // Reach-aware: a required question in a section skipped by jump logic must
    // not block submission. The server recomputes this regardless; this only
    // prevents a spurious client-side block.
    const reached = computeReachedSections(sections, answers);
    for (const section of sections) {
      if (!reached.has(section.id)) continue;
      for (const q of section.questions) {
        if (!q.required) continue;
        // Skip questions hidden by conditional logic
        if (!evaluateConditions(q.conditions, answers)) continue;
        const answer = answers[q.id];
        if (
          Array.isArray(answer) &&
          (answer.length === 0 || (answer as string[]).every((e) => !e.trim()))
        ) return `Please answer: ${q.label}`;
        if (answer === undefined || answer === null || answer === "") return `Please answer: ${q.label}`;
      }
    }
    return "";
  }

  async function handleNext() {
    setSubmitError("");
    // Format errors for the current section's visible questions.
    const { errors, orderedIds } = currentSection
      ? collectFormatErrors([currentSection])
      : { errors: {}, orderedIds: [] };
    if (orderedIds.length > 0) {
      setFieldErrors((errs) => ({ ...errs, ...errors }));
      setSubmitError("Please fix the highlighted fields before continuing.");
      focusFirstInvalid(orderedIds);
      return;
    }
    const validationError = validateSection(currentQuestions);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }
    const step = nextSectionAfter(sections, currentSectionIndex, answers);
    if (step.kind === "submit") {
      await doSubmit();
      return;
    }
    setHistory((h) => [...h, step.index]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleBack() {
    setSubmitError("");
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── Save & resume later ──
  // Snapshots the current answers (+ email + section) as a draft and shows a
  // resume link. Deliberately does NOT run validateAll/collectFormatErrors — a
  // draft is intentionally incomplete.
  async function handleSaveDraft() {
    if (!slug) return;
    setDraftError("");
    setSavingDraft(true);
    const collectEmail = Boolean(form?.schema.settings.collectEmail);
    const trimmedEmail = email.trim().toLowerCase();
    try {
      const result = await saveDraft(slug, {
        answers,
        ...(collectEmail && trimmedEmail ? { email: trimmedEmail } : {}),
        currentSection: currentSectionIndex,
        ...(resumeToken ? { token: resumeToken } : {}),
      });
      setResumeToken(result.token);
      setResumeLink(
        `${window.location.origin}/f/${slug}?resume=${result.token}`,
      );
      setCopiedResumeLink(false);
      setEmailedResumeLink(false);
    } catch {
      setDraftError(
        "We couldn't save your progress just now. Please try again.",
      );
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleCopyResumeLink() {
    if (!resumeLink) return;
    try {
      await navigator.clipboard.writeText(resumeLink);
      setCopiedResumeLink(true);
      window.setTimeout(() => setCopiedResumeLink(false), 2500);
    } catch {
      // Clipboard denied (e.g. insecure context): the link is still on-screen
      // for the respondent to copy manually.
      setCopiedResumeLink(false);
    }
  }

  async function handleEmailResumeLink() {
    if (!slug || !resumeToken) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;
    // Best-effort: the link is always on-screen regardless of delivery outcome.
    await emailResumeLink(slug, resumeToken, trimmedEmail);
    setEmailedResumeLink(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await doSubmit();
  }

  async function doSubmit() {
    setSubmitError("");
    setPaymentSaveFailed(false);

    // Format checks across every reached section's visible questions, plus the
    // respondent email. Collect first so we can focus the first offender.
    const reached = computeReachedSections(sections, answers);
    const reachedSections = sections.filter((s) => reached.has(s.id));
    const { errors, orderedIds } = collectFormatErrors(reachedSections);

    const focusIds = [...orderedIds];
    if (form?.schema.settings.collectEmail) {
      const value = email.trim();
      if (value && !isValidEmail(value)) {
        errors["respondent-email"] =
          "Please enter a valid email address, like name@example.com.";
        focusIds.unshift("respondent-email");
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors((errs) => ({ ...errs, ...errors }));
      setSubmitError("Please fix the highlighted fields before submitting.");
      focusFirstInvalid(focusIds);
      return;
    }

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
      const collectEmail = Boolean(form?.schema.settings.collectEmail);
      const normalizedEmail = email.trim().toLowerCase();
      const body: {
        answers: typeof answers;
        email?: string;
        metadata: Record<string, unknown>;
        payment?: {
          razorpayOrderId: string;
          razorpayPaymentId: string;
          razorpaySignature: string;
        };
      } = {
        answers,
        ...(collectEmail ? { email: normalizedEmail } : {}),
        metadata: {
          source: "qivo-web",
          ...(startedAtRef.current
            ? {
                elapsedSeconds: Math.round(
                  (Date.now() - startedAtRef.current) / 1000,
                ),
              }
            : {}),
        },
      };

      if (isEditing && responseId && editToken) {
        // Editing an existing response: re-use the same-session token.
        const result = await publicPost<{
          quizScore?: { earned: number; total: number; percentage: number };
        }>(
          `/api/forms/public/${slug}/responses/${responseId}/edit`,
          { ...body, editToken },
        );
        if (result?.quizScore) setQuizScore(result.quizScore);
        // Keep the same token/window so the respondent can edit again.
        setIsEditing(false);
        setSubmitted(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      // Post the final response (free or paid) and render the confirmation.
      const postResponse = async () => {
        const result = await publicPost<{
          response?: { id: string; submittedAt: string };
          quizScore?: { earned: number; total: number; percentage: number };
          editToken?: string;
        }>(
          `/api/forms/public/${slug}/responses`,
          body,
        );
        if (result?.quizScore) setQuizScore(result.quizScore);

        // Capture the edit token + compute the client-side window end for the UI.
        if (result?.editToken && result.response?.id) {
          setResponseId(result.response.id);
          setEditToken(result.editToken);
          setEditWindowExpiresAt(
            computeEditWindowEnd(result.response.submittedAt),
          );
          setNow(Date.now());
        }

        setSubmitted(true);
        window.scrollTo({ top: 0, behavior: "smooth" });

        // Best-effort: delete the backing draft so a resume link can't resurrect
        // a submitted draft. Never blocks the already-rendered success. Reads the
        // ref so the latest token (set on save or resume) is used.
        const tokenToPrune = resumeTokenRef.current;
        if (slug && tokenToPrune) {
          void deleteDraft(slug, tokenToPrune);
        }
      };

      // ── Paid flow: new responses on payment-required forms only ──
      if (form?.payment?.required) {
        if (form.payment.configured === false) {
          setSubmitError(
            "Payments are temporarily unavailable. Please try again later.",
          );
          return;
        }

        // Pre-check so a known duplicate is not charged then rejected.
        if (
          form.schema.settings.collectEmail &&
          !form.schema.settings.allowMultipleResponses
        ) {
          const check = await checkResponseExists(slug, normalizedEmail);
          if (check.alreadyResponded) {
            setSubmitError("You have already responded to this form.");
            return;
          }
        }

        // Server-side pre-check: validate answers + email BEFORE an order
        // exists, so a payer is never charged for a submission the server would
        // reject. A 400 here surfaces the specific message and opens no Checkout.
        const order = await createPaymentOrder(slug, {
          answers,
          ...(collectEmail ? { email: normalizedEmail } : {}),
        });
        await loadRazorpayCheckout();
        if (!order.keyId || !window.Razorpay) {
          setSubmitError("Could not start the payment. Please try again.");
          return;
        }

        const checkout = new window.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          ...(form.branding?.workspaceName
            ? { name: form.branding.workspaceName }
            : {}),
          ...(form.payment.description
            ? { description: form.payment.description }
            : {}),
          handler: (resp) => {
            // On a verified payment, submit the answers + razorpay fields.
            body.payment = {
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
            };
            void (async () => {
              setSubmitting(true);
              try {
                await postResponse();
              } catch (err) {
                // Last-resort net: the payment succeeded but the save failed.
                // Make it unmistakable that money was taken and how to proceed.
                const reason =
                  err instanceof ApiRequestError
                    ? mapEditErrorMessage(err)
                    : "an unexpected error occurred.";
                setPaymentSaveFailed(true);
                setSubmitError(
                  `Your payment was received but we could not save your response: ${reason} ` +
                    `Please contact the form owner and quote payment id ${resp.razorpay_payment_id}.`,
                );
              } finally {
                setSubmitting(false);
              }
            })();
          },
          modal: {
            ondismiss: () => {
              setSubmitError("Payment cancelled — you can try again.");
              setSubmitting(false);
            },
          },
        });
        checkout.open();
        // Keep `submitting` true while Checkout is open; handler/ondismiss clear it.
        return;
      }

      await postResponse();
    } catch (err) {
      setSubmitError(
        err instanceof ApiRequestError
          ? mapEditErrorMessage(err)
          : "Unable to submit your response.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Client-side edit-window end (ms epoch), or null when open until the server
  // rejects (until_close with no close date). Mirrors the server's derivation.
  function computeEditWindowEnd(submittedAt: string): number | null {
    const mode = form?.schema.settings.responseEditing ?? "disabled";
    if (mode === "timed") {
      const minutes = form?.schema.settings.responseEditMinutes ?? 15;
      return new Date(submittedAt).getTime() + minutes * 60_000;
    }
    if (mode === "until_close") {
      const closeAt = form?.schema.settings.scheduledCloseAt;
      return closeAt ? new Date(closeAt).getTime() : null;
    }
    return null;
  }

  // Map the edit-path 403 codes to the design's user-facing messages.
  function mapEditErrorMessage(err: ApiRequestError): string {
    switch (err.code) {
      case "EDIT_WINDOW_EXPIRED":
        return "Your edit window has closed.";
      case "EDITING_DISABLED":
        return "Editing is no longer allowed.";
      case "INVALID_EDIT_TOKEN":
        return "This edit link is no longer valid.";
      default:
        return err.message;
    }
  }

  // Begin editing the just-submitted response: answers are still in memory, so
  // re-rendering the form shows them prefilled.
  function startEditing() {
    setIsEditing(true);
    setSubmitted(false);
    setSubmitError("");
    setHistory([0]);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          <div className="public-status-icon" aria-hidden="true">🔒</div>
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
          <div className="public-status-icon" aria-hidden="true">⚠️</div>
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
          <div className="public-status-icon" aria-hidden="true">✅</div>
          <h1>Response submitted</h1>
          {quizScore && form.schema.settings.showScore ? (
            <div className="quiz-score-card">
              <p className="quiz-score-label">Your score</p>
              <p className="quiz-score-value">
                {quizScore.earned}/{quizScore.total}
              </p>
              <p className="quiz-score-percent">
                {quizScore.percentage}% correct
              </p>
            </div>
          ) : null}
          <p>
            {form.schema.confirmationMessage ||
              "Thank you! Your response has been recorded."}
          </p>
          {editToken &&
          (editWindowExpiresAt === null || now < editWindowExpiresAt) ? (
            <div style={{ marginTop: 20 }}>
              <button
                type="button"
                className="submit-button"
                style={{ maxWidth: 220 }}
                onClick={startEditing}
              >
                Edit my response
              </button>
              <p
                className="muted"
                style={{ marginTop: 10, fontSize: "0.85rem" }}
              >
                {editWindowExpiresAt === null
                  ? "You can edit your response until this form closes."
                  : `You can edit your response until ${new Date(
                      editWindowExpiresAt,
                    ).toLocaleTimeString()}.`}
              </p>
            </div>
          ) : null}
          <p className="public-status-brand">Powered by Qivo Forms</p>
        </div>
      </main>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────────────────

  const isLastSection = currentSectionIndex === totalSections - 1;
  const isFirstSection = currentSectionIndex === 0;
  // Back is only shown once the respondent has navigated past the start.
  const canGoBack = history.length > 1;

  const resolved = resolveTheme(
    form.schema.settings.theme,
    form.branding?.primaryColor,
  );
  ensureFontLoaded(form.schema.settings.theme?.fontFamily);

  return (
    <main
      className="public-form-shell"
      // A per-form custom background is passed as --qivo-form-bg (not `background`)
      // so the [data-color-scheme="dark"] block can override it with the dark page
      // background — the owner's light bg is shown in light mode only. The cover
      // image and accent apply in both schemes.
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
          <ColorSchemeToggle />
          {form.branding?.logoUrl ? (
            <img
              src={form.branding.logoUrl}
              alt={form.branding.workspaceName}
              style={{ height: 40, width: "auto", borderRadius: 8, marginBottom: 12 }}
            />
          ) : null}
          <p className="eyebrow" style={resolved.accent ? { color: resolved.accent } : undefined}>
            {form.branding?.workspaceName ?? "Qivo Form"}
          </p>
          <h1 className="public-form-title">{form.title}</h1>
          {form.description ? (
            <p className="public-form-description">{form.description}</p>
          ) : null}
          {isMultiSection ? (
            <p className="public-section-counter" aria-live="polite">
              Section {currentSectionIndex + 1} of {totalSections}
              {currentSection?.title ? ` — ${currentSection.title}` : ""}
            </p>
          ) : null}
        </header>

        {/* Resume notice (draft restored / invalid link) */}
        {resumeNotice ? (
          <p
            className="public-resume-notice"
            role="status"
            aria-live="polite"
            style={{
              margin: "0 0 16px",
              padding: "10px 14px",
              borderRadius: 10,
              background: "var(--qivo-surface, #f1f5f9)",
              color: "var(--qivo-text-secondary, #475569)",
              fontSize: "0.9rem",
            }}
          >
            {resumeNotice}
          </p>
        ) : null}

        {/* Form body */}
        <form onSubmit={handleSubmit} noValidate className="public-form-body">
          {/* Email field — only on first section */}
          {form.schema.settings.collectEmail && isFirstSection ? (
            <div className="question-field">
              <label htmlFor="respondent-email">
                <span className="question-label">
                  Email address
                  <span className="required-mark" aria-hidden="true"> *</span>
                  <span className="required-text"> (required)</span>
                </span>
              </label>
              <input
                id="respondent-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  // Clear the error as soon as it becomes valid (once touched).
                  setFieldErrors((errs) => {
                    if (!errs["respondent-email"]) return errs;
                    if (isValidEmail(e.target.value.trim())) {
                      const { "respondent-email": _r, ...rest } = errs;
                      return rest;
                    }
                    return errs;
                  });
                }}
                onBlur={handleEmailBlur}
                required
                aria-required="true"
                autoComplete="email"
                placeholder="you@example.com"
                aria-invalid={fieldErrors["respondent-email"] ? true : undefined}
                aria-describedby={
                  fieldErrors["respondent-email"]
                    ? "respondent-email-error"
                    : undefined
                }
              />
              {fieldErrors["respondent-email"] ? (
                <p
                  className="field-error"
                  id="respondent-email-error"
                  role="alert"
                  aria-live="polite"
                >
                  {fieldErrors["respondent-email"]}
                </p>
              ) : null}
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
                      slug={slug ?? ""}
                      allQuestions={allQuestions}
                      answers={answers}
                      onChange={updateAnswer}
                      onInputChange={handleInputChange}
                      error={fieldErrors[question.id]}
                      onBlur={() => handleFieldBlur(question)}
                    />
                  ))
              )}
            </div>
          ) : null}

          {/* Error */}
          {submitError ? (
            <p
              className={`submit-error${paymentSaveFailed ? " payment-warning" : ""}`}
              role="alert"
              aria-live="assertive"
              style={{ marginBottom: 16 }}
            >
              {submitError}
            </p>
          ) : null}

          {/* Navigation */}
          <div className="public-form-nav">
            {isMultiSection && canGoBack ? (
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
                style={{ flex: 1, maxWidth: 240, ...(resolved.accent ? { background: resolved.accent } : {}) }}
                onClick={() => void handleNext()}
              >
                Next →
              </button>
            ) : (
              <button
                className="submit-button"
                type="submit"
                style={{ flex: 1, maxWidth: 240, ...(resolved.accent ? { background: resolved.accent } : {}) }}
                disabled={submitting || allQuestions.length === 0}
              >
                {submitting
                  ? isEditing
                    ? "Saving..."
                    : "Submitting..."
                  : isEditing
                    ? "Save changes"
                    : !isEditing &&
                        form.payment?.required &&
                        typeof form.payment.amount === "number"
                      ? `Pay ₹${form.payment.amount / 100} & Submit`
                      : "Submit response"}
              </button>
            )}
          </div>
          {!isEditing &&
          isLastSection &&
          form.payment?.required &&
          typeof form.payment.amount === "number" ? (
            <p className="muted" style={{ textAlign: "center", marginTop: 12 }}>
              A payment of ₹{form.payment.amount / 100} is required to submit
              this form.
            </p>
          ) : null}

          {/* Save & resume later (owner opt-in). Shown on every section while
              not editing a submitted response. A saved draft never charges and
              never submits. */}
          {allowPartialSave && !isEditing ? (
            <div className="public-resume-save" style={{ marginTop: 16 }}>
              <div style={{ textAlign: "center" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void handleSaveDraft()}
                  disabled={savingDraft}
                >
                  {savingDraft ? "Saving…" : "Save & resume later"}
                </button>
              </div>
              {draftError ? (
                <p
                  className="submit-error"
                  role="alert"
                  aria-live="polite"
                  style={{ marginTop: 10, textAlign: "center" }}
                >
                  {draftError}
                </p>
              ) : null}

              {resumeLink ? (
                <div
                  className="public-resume-panel"
                  role="status"
                  aria-live="polite"
                  style={{
                    marginTop: 14,
                    padding: 16,
                    borderRadius: 12,
                    border: "1px solid var(--qivo-input-border, #e2e8f0)",
                    background: "var(--qivo-surface, #f8fafc)",
                  }}
                >
                  <p style={{ margin: "0 0 10px", fontWeight: 600 }}>
                    Your progress is saved. Use this link to come back and
                    finish:
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <input
                      type="text"
                      readOnly
                      value={resumeLink}
                      aria-label="Your resume link"
                      onFocus={(e) => e.currentTarget.select()}
                      style={{ flex: 1, minWidth: 220 }}
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleCopyResumeLink()}
                    >
                      {copiedResumeLink ? "Copied" : "Copy link"}
                    </button>
                  </div>
                  <p
                    className="muted"
                    style={{ margin: "10px 0 0", fontSize: "0.85rem" }}
                  >
                    This link works for 30 days. Keep it safe — anyone with it
                    can continue your response.
                  </p>

                  {form.schema.settings.collectEmail && email.trim() ? (
                    <div style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void handleEmailResumeLink()}
                        disabled={emailedResumeLink}
                      >
                        {emailedResumeLink
                          ? "Link sent"
                          : "Email me this link"}
                      </button>
                      {emailedResumeLink ? (
                        <p
                          className="muted"
                          style={{ margin: "8px 0 0", fontSize: "0.85rem" }}
                        >
                          If that address can receive our mail, the link is on
                          its way — and it's also right here.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </form>

        <p className="public-form-brand">Powered by Qivo Forms</p>
      </div>
    </main>
  );
}

// ─── Question Field ───────────────────────────────────────────────────────────

export function QuestionField({
  question,
  value,
  slug,
  allQuestions,
  answers,
  onChange,
  onInputChange,
  error,
  onBlur,
}: {
  question: Question;
  value: AnswerValue | undefined;
  slug: string;
  allQuestions: Question[];
  answers: Record<string, AnswerValue>;
  onChange: (questionId: string, value: AnswerValue) => void;
  onInputChange: (
    questionId: string,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  error?: string | undefined;
  onBlur?: (() => void) | undefined;
}) {
  const inputId = `question-${question.id}`;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const description = question.description ?? undefined;

  // Inline validation message shown under the offending field.
  const errorElement = error ? (
    <p className="field-error" id={errorId} role="alert" aria-live="polite">
      {error}
    </p>
  ) : null;

  // File-upload state (unconditional hooks; only used by the FILE_UPLOAD branch)
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0); // 0-100
  // Signature state (unconditional hooks; only used by the SIGNATURE branch)
  const sigRef = useRef<SignaturePadHandle>(null);
  const [sigEmpty, setSigEmpty] = useState(true);
  // MULTI_ENTRY focus management (unconditional hooks; only used by that branch).
  // entryRefs holds the current entry <input> elements by index; addButtonRef is
  // the "+ Add another" button. pendingFocusRef records where focus should move
  // after the next entries re-render (add -> new last input; remove -> neighbor).
  const entryRefs = useRef<Array<HTMLInputElement | null>>([]);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingFocusRef = useRef<number | "add" | null>(null);

  // Move focus after an add/remove once the new entries have rendered.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    if (target === "add") {
      addButtonRef.current?.focus();
    } else {
      entryRefs.current[target]?.focus();
    }
  });

  async function uploadFileToCloudinary(
    rawFile: File,
    opts?: { skipCompression?: boolean },
  ) {
    setUploadError("");
    setUploading(true);
    setUploadProgress(0);
    try {
      const secureUrl = await uploadToCloudinary(
        slug,
        rawFile,
        (percent) => setUploadProgress(percent),
        opts,
      );
      // Store the delivered URL as the answer.
      onChange(question.id, secureUrl);
    } catch (err) {
      setUploadError(
        err instanceof ApiRequestError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed. Please try again.",
      );
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  const resolvedLabel = resolvePipedLabel(question.label, allQuestions, answers);

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
        <legend id={`${inputId}-legend`}>{label}</legend>
        {descriptionElement}
        <div
          className="choice-list"
          role="radiogroup"
          aria-labelledby={`${inputId}-legend`}
          aria-required={question.required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
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
        {errorElement}
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
        <legend id={`${inputId}-legend`}>{label}</legend>
        {descriptionElement}
        <div
          className="choice-list"
          role="group"
          aria-labelledby={`${inputId}-legend`}
          aria-required={question.required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
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
        {errorElement}
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
        <legend id={`${inputId}-legend`}>{label}</legend>
        {descriptionElement}
        <div
          className="rating-list"
          role="radiogroup"
          aria-labelledby={`${inputId}-legend`}
          aria-required={question.required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
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
        {errorElement}
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
          onBlur={onBlur}
          aria-required={question.required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          rows={5}
          placeholder="Your answer..."
        />
        {errorElement}
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
        <legend id={`${inputId}-legend`}>{label}</legend>
        {descriptionElement}
        <div
          className="rating-list"
          role="radiogroup"
          aria-labelledby={`${inputId}-legend`}
          aria-required={question.required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
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
        {errorElement}
      </fieldset>
    );
  }

  // File upload
  if (question.type === "FILE_UPLOAD") {
    const maxSize = question.settings?.maxFileSizeMB ?? 5;
    const allowedTypes = question.settings?.allowedFileTypes ?? [];
    const uploadedUrl = typeof value === "string" && value.startsWith("http") ? value : "";

    return (
      <div className="question-field">
        <label htmlFor={inputId}>{label}</label>
        {descriptionElement}
        <div
          className="upload-dropzone"
          style={{
            cursor: uploading ? "default" : "pointer",
            opacity: uploading ? 0.7 : 1,
          }}
          onClick={() => { if (!uploading) document.getElementById(inputId)?.click(); }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " " || e.key === "Spacebar") && !uploading) {
              e.preventDefault();
              document.getElementById(inputId)?.click();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={`Upload a file for: ${resolvedLabel}`}
          aria-describedby={
            [description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          <input
            id={inputId}
            type="file"
            accept={buildAcceptString(allowedTypes)}
            style={{ display: "none" }}
            disabled={uploading}
            aria-required={question.required ? true : undefined}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > maxSize * 1024 * 1024) {
                setUploadError(`File too large. Maximum ${maxSize}MB allowed.`);
                return;
              }
              void uploadFileToCloudinary(file);
            }}
          />
          {uploading ? (
            <div>
              <p style={{ margin: "0 0 10px", color: "var(--qivo-text-secondary)", fontWeight: 600 }}>
                Uploading… {uploadProgress > 0 ? `${uploadProgress}%` : ""}
              </p>
              <div className="upload-progress-track">
                <div
                  className="upload-progress-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : uploadedUrl ? (
            <div style={{ color: "#16a34a", fontWeight: 600 }}>
              {isImageUrl(uploadedUrl) ? (
                <img
                  src={uploadedUrl}
                  alt={`Uploaded file preview for: ${resolvedLabel}`}
                  style={{
                    maxWidth: "100%",
                    maxHeight: 180,
                    borderRadius: 8,
                    marginBottom: 8,
                    objectFit: "contain",
                  }}
                />
              ) : null}
              <p style={{ margin: 0 }}>
                ✓ File uploaded ·{" "}
                <a
                  href={uploadedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: "var(--qivo-primary)", textDecoration: "underline" }}
                >
                  view
                </a>
                <span className="upload-hint" style={{ display: "block", marginTop: 4 }}>
                  Click to replace
                </span>
              </p>
            </div>
          ) : (
            <>
              <p style={{ margin: "0 0 4px", color: "var(--qivo-text-secondary)", fontWeight: 600 }}>
                Click to upload a file
              </p>
              <p className="upload-hint" style={{ margin: 0 }}>
                Max {maxSize}MB
                {allowedTypes.length > 0 ? ` · ${friendlyFileTypes(allowedTypes)}` : ""}
              </p>
            </>
          )}
        </div>
        {uploadError ? (
          <p className="submit-error" style={{ marginTop: 8 }}>{uploadError}</p>
        ) : null}
        {errorElement}
      </div>
    );
  }

  // Signature: draw on a canvas, Save -> upload the PNG to Cloudinary (reusing
  // the FILE_UPLOAD upload path), store the delivered URL as the answer.
  if (question.type === "SIGNATURE") {
    const uploadedUrl = typeof value === "string" && value.startsWith("http") ? value : "";

    return (
      <div className="question-field" role="group" aria-labelledby={`${inputId}-legend`}>
        {/* No native control owns the drawing surface, so the label is linked via
            aria-labelledby on the group (and the canvas keeps its own aria-label). */}
        <label id={`${inputId}-legend`}>{label}</label>
        {descriptionElement}
        {uploadedUrl ? (
          // Reuse the FILE_UPLOAD uploaded-state UI: thumbnail + view + re-sign.
          <div className="upload-dropzone">
            <div style={{ color: "#16a34a", fontWeight: 600 }}>
              {isImageUrl(uploadedUrl) ? (
                <img
                  src={uploadedUrl}
                  alt={`Saved signature for: ${resolvedLabel}`}
                  style={{
                    maxWidth: "100%",
                    maxHeight: 180,
                    borderRadius: 8,
                    marginBottom: 8,
                    objectFit: "contain",
                  }}
                />
              ) : null}
              <p style={{ margin: 0 }}>
                ✓ Signature saved ·{" "}
                <a
                  href={uploadedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--qivo-primary)", textDecoration: "underline" }}
                >
                  view
                </a>
              </p>
              <button
                type="button"
                onClick={() => {
                  sigRef.current?.clear();
                  setSigEmpty(true);
                  onChange(question.id, null);
                }}
                style={{
                  marginTop: 8,
                  fontSize: "0.85rem",
                  color: "var(--qivo-primary)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Re-sign
              </button>
            </div>
          </div>
        ) : (
          <>
            <SignaturePad
              ref={sigRef}
              disabled={uploading}
              onChange={(empty) => setSigEmpty(empty)}
              ariaLabel={resolvedLabel}
            />
            {uploading ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ margin: "0 0 10px", color: "var(--qivo-text-secondary)", fontWeight: 600 }}>
                  Uploading… {uploadProgress > 0 ? `${uploadProgress}%` : ""}
                </p>
                <div className="upload-progress-track">
                  <div
                    className="upload-progress-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={sigEmpty || uploading}
                onClick={async () => {
                  const file = await sigRef.current?.toPngFile();
                  // Bypass maybeCompressImage — keep the PNG crisp (Finding #1).
                  if (file) await uploadFileToCloudinary(file, { skipCompression: true });
                }}
                style={{
                  marginTop: 10,
                  padding: "8px 16px",
                  borderRadius: 10,
                  border: "1px solid var(--qivo-input-border)",
                  background: sigEmpty ? "var(--qivo-surface)" : "var(--qivo-primary)",
                  color: sigEmpty ? "var(--qivo-text-muted)" : "#fff",
                  fontWeight: 600,
                  cursor: sigEmpty || uploading ? "default" : "pointer",
                }}
              >
                Save signature
              </button>
            )}
          </>
        )}
        {uploadError ? (
          <p className="submit-error" style={{ marginTop: 8 }}>{uploadError}</p>
        ) : null}
        {errorElement}
      </div>
    );
  }

  // Multi-entry: dynamic list of text inputs
  if (question.type === "MULTI_ENTRY") {
    // Mirrors MAX_MULTI_ENTRY_COUNT in apps/api/src/modules/forms/form.service.ts —
    // keep both in sync.
    const MAX_MULTI_ENTRY_COUNT = 50;
    const entries: string[] = Array.isArray(value)
      ? (value as string[])
      : [""];
    const atCap = entries.length >= MAX_MULTI_ENTRY_COUNT;

    function updateEntry(idx: number, text: string) {
      const next = [...entries];
      next[idx] = text;
      onChange(question.id, next);
    }

    function addEntry() {
      if (entries.length >= MAX_MULTI_ENTRY_COUNT) return;
      // Focus the newly added (now last) input after it renders.
      pendingFocusRef.current = entries.length;
      onChange(question.id, [...entries, ""]);
    }

    function removeEntry(idx: number) {
      const next = entries.filter((_, i) => i !== idx);
      // Move focus to a sensible neighbour: the previous entry, or the first if
      // the first was removed; the add button when no entries would remain.
      if (next.length === 0) {
        pendingFocusRef.current = "add";
      } else {
        pendingFocusRef.current = Math.max(0, idx - 1);
      }
      onChange(question.id, next.length > 0 ? next : [""]);
    }

    return (
      <div className="question-field" role="group" aria-labelledby={`${inputId}-legend`}>
        <label id={`${inputId}-legend`} htmlFor={`${inputId}-0`}>{label}</label>
        {descriptionElement}
        <div style={{ display: "grid", gap: 8 }}>
          {entries.map((entry, idx) => (
            <div
              key={idx}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <input
                ref={(el) => {
                  entryRefs.current[idx] = el;
                }}
                id={idx === 0 ? `${inputId}-0` : undefined}
                className="multi-entry-input"
                type="text"
                value={entry}
                onChange={(e) => updateEntry(idx, e.target.value)}
                onBlur={idx === entries.length - 1 ? onBlur : undefined}
                placeholder={`Entry ${idx + 1}`}
                aria-label={`${resolvedLabel} — entry ${idx + 1}`}
                aria-required={question.required && idx === 0 ? true : undefined}
                aria-invalid={error && idx === 0 ? true : undefined}
                aria-describedby={
                  [
                    description && idx === 0 ? descriptionId : null,
                    error && idx === 0 ? errorId : null,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              />
              {entries.length > 1 ? (
                <button
                  type="button"
                  className="multi-entry-remove"
                  onClick={() => removeEntry(idx)}
                  aria-label={`Remove entry ${idx + 1}`}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {atCap ? (
          <p className="upload-hint" style={{ marginTop: 8 }}>
            Maximum {MAX_MULTI_ENTRY_COUNT} entries
          </p>
        ) : (
          <button
            ref={addButtonRef}
            type="button"
            className="multi-entry-add"
            onClick={addEntry}
            aria-label="Add another entry"
          >
            + Add another
          </button>
        )}
        {errorElement}
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
        onBlur={onBlur}
        aria-required={question.required ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [description ? descriptionId : null, error ? errorId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        placeholder={placeholder}
      />
      {errorElement}
    </div>
  );
}
