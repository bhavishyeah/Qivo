import type { ManualPaymentRecord, ManualPaymentStatus } from "../types";
import { formatInr, formatSummary } from "../lib/manualUpi";
import { isImageUrl } from "../lib/upload";

const STATUS_LABEL: Record<ManualPaymentStatus, string> = {
  pending: "Pending",
  verified: "Verified",
  rejected: "Rejected",
};

const STATUS_MARK: Record<ManualPaymentStatus, string> = {
  pending: "…",
  verified: "✓",
  rejected: "✕",
};

// Text plus symbol plus colour, so status is never conveyed by colour alone.
export function ManualPaymentBadge({ status }: { status: ManualPaymentStatus }) {
  return (
    <span className={`manual-upi-badge manual-upi-badge-${status}`}>
      <span aria-hidden="true">{STATUS_MARK[status]}</span> {STATUS_LABEL[status]}
    </span>
  );
}

type CellProps = {
  payment: ManualPaymentRecord;
  /** Another non-rejected response on this form uses the same UTR. */
  duplicate?: boolean;
  /** A status request for this response is in flight. */
  busy?: boolean;
  compact?: boolean;
  onStatusChange: (next: ManualPaymentStatus) => void;
};

// UTR, screenshot thumbnail, status badge, duplicate warning and the
// Verify / Reject / Reset controls. All values render as React text nodes.
export function ManualPaymentCell({
  payment,
  duplicate = false,
  busy = false,
  compact = false,
  onStatusChange,
}: CellProps) {
  // Only https URLs are ever used as href/src.
  const proof =
    payment.proofUrl && /^https:\/\//.test(payment.proofUrl) ? payment.proofUrl : undefined;
  const showProofImage = proof ? isImageUrl(proof) : false;
  return (
    <div className={`manual-upi-cell${compact ? " is-compact" : ""}`}>
      <div className="manual-upi-cell-head">
        <ManualPaymentBadge status={payment.status} />
        <code className="manual-upi-utr">{payment.utr}</code>
      </div>
      {!compact && payment.amount !== undefined ? (
        <div className="muted">Amount: {formatInr(payment.amount)}</div>
      ) : null}
      {duplicate ? (
        <p className="manual-upi-duplicate" role="note">
          ⚠ This UTR is used on more than one response.
        </p>
      ) : null}
      {proof && showProofImage ? (
        <a href={proof} target="_blank" rel="noopener noreferrer" className="manual-upi-thumb-link">
          <img
            src={proof}
            alt="Payment screenshot"
            className="manual-upi-thumb"
            loading="lazy"
          />
        </a>
      ) : proof ? (
        <a href={proof} target="_blank" rel="noopener noreferrer">
          View screenshot
        </a>
      ) : null}
      <div className="manual-upi-actions">
        <button
          type="button"
          className="secondary-button compact"
          disabled={busy || payment.status === "verified"}
          onClick={() => onStatusChange("verified")}
        >
          Verify
        </button>
        <button
          type="button"
          className="secondary-button compact"
          disabled={busy || payment.status === "rejected"}
          onClick={() => onStatusChange("rejected")}
        >
          Reject
        </button>
        <button
          type="button"
          className="secondary-button compact"
          disabled={busy || payment.status === "pending"}
          onClick={() => onStatusChange("pending")}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

type SummaryBarProps = {
  counts: { pending: number; verified: number; rejected: number };
  duplicateCount?: number;
  filter: "" | ManualPaymentStatus;
  onFilterChange: (next: "" | ManualPaymentStatus) => void;
  id?: string;
};

export function ManualPaymentSummaryBar({
  counts,
  duplicateCount = 0,
  filter,
  onFilterChange,
  id = "manual-upi-filter",
}: SummaryBarProps) {
  return (
    <div className="manual-upi-summary">
      <strong>UPI payments:</strong> <span>{formatSummary(counts)}</span>
      {duplicateCount > 0 ? (
        <span className="manual-upi-duplicate">
          {" "}
          · ⚠ {duplicateCount} duplicate UTR{duplicateCount === 1 ? "" : "s"}
        </span>
      ) : null}
      <label htmlFor={id} className="manual-upi-filter-label">
        Show
      </label>
      <select
        id={id}
        value={filter}
        onChange={(e) => onFilterChange(e.target.value as "" | ManualPaymentStatus)}
      >
        <option value="">All responses</option>
        <option value="pending">Pending</option>
        <option value="verified">Verified</option>
        <option value="rejected">Rejected</option>
      </select>
    </div>
  );
}
