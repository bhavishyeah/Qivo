import { useId, useRef, useState, type FormEvent } from "react";
import Modal from "./Modal";
import { ApiRequestError } from "../lib/api";
import {
  MAX_REPORT_DETAILS,
  REPORT_REASONS,
  REPORT_SUCCESS_MESSAGE,
  sendReport,
  validateReport,
  type ReportDraft,
  type ReportErrors,
} from "../lib/reportForm";
import "../styles/report-form.css";

/** Subtle "Report this form" link that opens the report dialog. */
export default function ReportFormLink({ slug }: { slug: string | null }) {
  const [open, setOpen] = useState(false);
  if (!slug) return null;
  return (
    <>
      <button type="button" className="report-link" onClick={() => setOpen(true)}>
        Report this form
      </button>
      {open ? <ReportFormModal slug={slug} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ReportFormModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const uid = useId();
  const honeypotRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ReportDraft>({ reason: "", details: "", email: "" });
  const [errors, setErrors] = useState<ReportErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validateReport(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await sendReport(slug, draft, honeypotRef.current?.value ?? "");
      setDone(true);
    } catch (err) {
      setSubmitError(
        err instanceof ApiRequestError ? err.message : "Could not send your report. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Report this form" onClose={onClose}>
      {done ? (
        <div className="report-done">
          <p role="status">{REPORT_SUCCESS_MESSAGE}</p>
          <div className="modal-actions">
            <button type="button" className="primary-button" onClick={onClose} data-autofocus>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form className="report-form" onSubmit={onSubmit} noValidate>
          <fieldset
            className="report-reasons"
            aria-describedby={errors.reason ? `${uid}-reason-error` : undefined}
          >
            <legend>What is wrong with this form?</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r.value} className="report-reason">
                <input
                  type="radio"
                  name={`${uid}-reason`}
                  value={r.value}
                  checked={draft.reason === r.value}
                  onChange={() => {
                    setDraft((d) => ({ ...d, reason: r.value }));
                    setErrors((e) => ({ ...e, reason: undefined }));
                  }}
                />
                <span>{r.label}</span>
              </label>
            ))}
            {errors.reason ? (
              <p id={`${uid}-reason-error`} className="field-error" role="alert">
                {errors.reason}
              </p>
            ) : null}
          </fieldset>
          <div className="report-field">
            <label htmlFor={`${uid}-details`}>Details (optional)</label>
            <textarea
              id={`${uid}-details`}
              rows={4}
              maxLength={MAX_REPORT_DETAILS}
              value={draft.details}
              aria-invalid={errors.details ? true : undefined}
              onChange={(e) => setDraft((d) => ({ ...d, details: e.target.value }))}
            />
            <small className="report-count">
              {draft.details.length}/{MAX_REPORT_DETAILS}
            </small>
            {errors.details ? (
              <p className="field-error" role="alert">{errors.details}</p>
            ) : null}
          </div>
          <div className="report-field">
            <label htmlFor={`${uid}-email`}>Your email (optional)</label>
            <input
              id={`${uid}-email`}
              type="email"
              autoComplete="email"
              value={draft.email}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? `${uid}-email-error` : undefined}
              onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            />
            {errors.email ? (
              <p id={`${uid}-email-error`} className="field-error" role="alert">
                {errors.email}
              </p>
            ) : null}
          </div>
          {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
          <div className="report-hp" aria-hidden="true">
            <label>
              Website
              <input ref={honeypotRef} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
            </label>
          </div>
          {submitError ? <p className="msg msg-error" role="alert">{submitError}</p> : null}
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? "Sending..." : "Send report"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}