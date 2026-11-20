import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PublicManualUpi } from "../types";
import { buildUpiUri, formatInr } from "../lib/manualUpi";
import { uploadToCloudinary } from "../lib/upload";

const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export type ManualUpiValue = { utr: string; proofUrl: string };

type Props = {
  config: PublicManualUpi;
  formTitle: string;
  slug: string | null;
  value: ManualUpiValue;
  onChange: (next: ManualUpiValue) => void;
  errors: { utr?: string; proof?: string };
  onBlurUtr?: () => void;
  onUploadingChange?: (uploading: boolean) => void;
  preview?: boolean;
  disabled?: boolean;
};

// Everything the owner typed (payee, UPI ID, instructions) and everything the
// respondent typed is rendered as a React text node. Never HTML.
export default function ManualUpiPayment({
  config,
  formTitle,
  slug,
  value,
  onChange,
  errors,
  onBlurUtr,
  onUploadingChange,
  preview = false,
  disabled = false,
}: Props) {
  const upiId = config.upiId ?? "";
  const payeeName = config.payeeName ?? "";
  const requireScreenshot = config.requireScreenshot !== false;

  const [copyStatus, setCopyStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");

  const uri = useMemo(
    () =>
      buildUpiUri({
        upiId,
        payeeName,
        amountPaise: config.amount,
        note: formTitle.slice(0, 50),
      }),
    [upiId, payeeName, config.amount, formTitle],
  );

  // The button label returns to "Copy" two seconds after a successful copy.
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyUpiId() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(upiId);
      setCopyStatus("UPI ID copied");
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyStatus("Couldn't copy. Select the ID and copy it manually.");
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploadError("");
    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file (PNG or JPG).");
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      setUploadError("The screenshot must be 5 MB or smaller.");
      return;
    }
    if (!slug) return;
    setUploading(true);
    onUploadingChange?.(true);
    setProgress(0);
    try {
      const url = await uploadToCloudinary(slug, file, setProgress);
      onChange({ ...value, proofUrl: url });
      setFileName(file.name);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload failed. Please try again.",
      );
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
      setProgress(0);
    }
  }

  const inputsDisabled = disabled;
  const fileDisabled = preview || !slug || disabled || uploading;
  const proofError = errors.proof || uploadError;
  const utrDescribedBy = ["manual-upi-utr-help", errors.utr ? "manual-upi-utr-error" : ""]
    .filter(Boolean)
    .join(" ");
  const proofDescribedBy = [
    "manual-upi-proof-help",
    proofError ? "manual-upi-proof-error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="manual-upi" aria-labelledby="manual-upi-heading">
      <header className="manual-upi-head">
        <p className="manual-upi-step">Step 1 of 2</p>
        <h3 id="manual-upi-heading" className="manual-upi-heading">
          Pay via UPI
        </h3>
        <p className="manual-upi-label">
          Paid directly to the organiser. Qivo doesn't process or confirm this payment.
        </p>
      </header>

      <dl className="manual-upi-details">
        <div>
          <dt>Pay to</dt>
          <dd>{payeeName}</dd>
        </div>
        <div className="manual-upi-row-id">
          <dt>UPI ID</dt>
          <dd>
            <code className="manual-upi-id">{upiId}</code>
            <button
              type="button"
              className={`secondary-button manual-upi-copy${copied ? " is-copied" : ""}`}
              onClick={copyUpiId}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </dd>
        </div>
        {config.amount !== undefined ? (
          <div className="manual-upi-row-amount">
            <dt>Amount</dt>
            <dd>{formatInr(config.amount)}</dd>
          </div>
        ) : null}
      </dl>
      <span className="manual-upi-copy-status" role="status" aria-live="polite">
        {copyStatus}
      </span>

      {config.instructions ? (
        <div className="manual-upi-note">
          <p className="manual-upi-note-label">Note from the organiser</p>
          <p className="manual-upi-instructions">{config.instructions}</p>
        </div>
      ) : null}

      <p className="manual-upi-warning" role="note">
        <svg
          className="manual-upi-warning-icon"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 10v4" />
          <path d="M12 17.2v.1" />
        </svg>
        <span>Check that the payee name shown in your UPI app matches before you pay.</span>
      </p>

      <figure className="manual-upi-qr" aria-describedby="manual-upi-qr-desc">
        <div className="manual-upi-qr-tile">
          <QRCodeSVG
            value={uri}
            size={176}
            level="M"
            role="img"
            title={`UPI payment QR code for ${payeeName}`}
            aria-label={`UPI payment QR code for ${payeeName}`}
          />
        </div>
        <figcaption id="manual-upi-qr-desc">
          Scan with any UPI app to pay {payeeName}
        </figcaption>
      </figure>

      <div className="manual-upi-app">
        <a className="primary-button manual-upi-open-app" href={uri}>
          Open UPI app
        </a>
        <p className="manual-upi-helper">
          If your UPI app declines the link, scan the QR from another device or pay to the UPI ID
          manually.
        </p>
      </div>

      <hr className="manual-upi-divider" />
      <header className="manual-upi-head">
        <p className="manual-upi-step">Step 2 of 2</p>
        <h4 className="manual-upi-subheading">Confirm your payment</h4>
      </header>

      <div className="public-field manual-upi-field">
        <label htmlFor="manual-upi-utr">
          UTR / reference number
          <span aria-hidden="true" className="required-mark"> *</span>
        </label>
        <input
          id="manual-upi-utr"
          type="text"
          required
          aria-required="true"
          aria-invalid={errors.utr ? true : undefined}
          aria-describedby={utrDescribedBy}
          autoComplete="off"
          autoCapitalize="characters"
          inputMode="text"
          maxLength={35}
          value={value.utr}
          disabled={inputsDisabled}
          onChange={(e) => onChange({ ...value, utr: e.target.value.toUpperCase() })}
          onBlur={onBlurUtr}
        />
        <small className="muted" id="manual-upi-utr-help">
          Enter the 12-digit UTR (reference number) shown in your payment app.
        </small>
        {errors.utr ? (
          <p id="manual-upi-utr-error" className="field-error" role="alert">
            {errors.utr}
          </p>
        ) : null}
      </div>

      <div className="public-field manual-upi-field">
        <span className="manual-upi-proof-title" id="manual-upi-proof-title">
          Payment screenshot
          {requireScreenshot ? (
            <span aria-hidden="true" className="required-mark"> *</span>
          ) : (
            <span className="muted"> (optional)</span>
          )}
        </span>
        <div className="upload-dropzone manual-upi-dropzone">
          {value.proofUrl ? (
            <div className="manual-upi-proof-preview">
              <img
                src={value.proofUrl}
                alt="Payment screenshot preview"
                className="manual-upi-thumb"
              />
              <div className="manual-upi-proof-actions">
                {fileName ? <span className="manual-upi-file-name">{fileName}</span> : null}
                <label
                  htmlFor="manual-upi-proof"
                  className={`secondary-button manual-upi-file-label${fileDisabled ? " is-disabled" : ""}`}
                >
                  Replace
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled || uploading}
                  onClick={() => {
                    setFileName("");
                    onChange({ ...value, proofUrl: "" });
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <label
              htmlFor="manual-upi-proof"
              className={`secondary-button manual-upi-file-label${fileDisabled ? " is-disabled" : ""}`}
            >
              Choose screenshot
            </label>
          )}
          {value.proofUrl ? null : (
            <span className="manual-upi-drop-hint">PNG or JPG, up to 5 MB</span>
          )}
          <input
            id="manual-upi-proof"
            type="file"
            accept="image/*"
            className="manual-upi-file-input"
            disabled={fileDisabled}
            aria-labelledby="manual-upi-proof-title"
            aria-required={requireScreenshot ? true : undefined}
            aria-invalid={proofError ? true : undefined}
            aria-describedby={proofDescribedBy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void handleFile(file);
            }}
          />
          {uploading ? (
            <div role="status" aria-live="polite">
              <p className="manual-upi-uploading">
                Uploading… {progress > 0 ? `${progress}%` : ""}
              </p>
              <div className="upload-progress-track">
                <div className="upload-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : null}
        </div>
        <small className="muted" id="manual-upi-proof-help">
          {preview
            ? "Uploads are disabled in preview."
            : "An image of the payment confirmation, up to 5 MB."}
        </small>
        {proofError ? (
          <p id="manual-upi-proof-error" className="field-error" role="alert">
            {proofError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
