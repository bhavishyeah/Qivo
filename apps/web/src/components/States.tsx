import type { ReactNode } from "react";

/** Flat-shape palette sheet used by empty states. Brand tokens only, decorative. */
export function PaletteIllustration() {
  return (
    <svg className="empty-art" viewBox="0 0 220 140" width="220" height="140" fill="none" aria-hidden="true">
      <rect x="40" y="14" width="120" height="112" rx="10" fill="var(--color-surface)" stroke="var(--brand-indigo)" strokeWidth="3" />
      <rect x="40" y="14" width="120" height="14" rx="7" fill="var(--brand-indigo)" />
      <rect x="56" y="42" width="56" height="8" rx="4" fill="var(--brand-olive)" />
      <rect x="56" y="60" width="88" height="10" rx="5" fill="var(--brand-cream)" />
      <rect x="56" y="78" width="88" height="10" rx="5" fill="var(--brand-cream)" />
      <rect x="56" y="100" width="36" height="14" rx="7" fill="var(--brand-lime)" />
      <circle cx="176" cy="38" r="14" fill="var(--brand-orchid)" />
      <circle cx="188" cy="86" r="9" fill="var(--brand-moss)" />
      <rect x="22" y="84" width="20" height="20" rx="5" fill="var(--brand-stone)" />
      <circle cx="30" cy="48" r="6" fill="var(--brand-berry)" />
    </svg>
  );
}

export function EmptyState({
  title,
  body,
  action,
  art = false,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  art?: boolean;
}) {
  return (
    <section className="empty-state">
      {art ? <PaletteIllustration /> : null}
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </section>
  );
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <section className="notice notice-danger" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </section>
  );
}

export function SkeletonTile() {
  return (
    <div className="skeleton-tile" aria-hidden="true">
      <div className="skeleton-line" style={{ width: "30%" }} />
      <div className="skeleton-line skeleton-line-lg" style={{ width: "70%" }} />
      <div className="skeleton-line" style={{ width: "50%" }} />
    </div>
  );
}
