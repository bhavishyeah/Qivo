import type { ReactNode } from "react";
import Logo from "./Logo";

type AuthLayoutProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

const STRIP = ["olive", "moss", "cream", "lime", "orchid", "stone", "berry", "deep"] as const;

/** Split auth layout: Indigo brand panel on the left, form on the right. One column on mobile. */
export default function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="app-root app-shell auth-layout">
      <aside className="auth-panel">
        <Logo to="/" size="lg" tone="on-indigo" />
        <div className="auth-panel-body">
          <p className="auth-tagline display">
            Ask better.
            <br />
            <span className="auth-tagline-accent">Hear back.</span>
          </p>
          <p className="auth-panel-copy">
            Forms for college fests, orientations and events, with UPI payments, QR check-in and live responses in one link.
          </p>
        </div>
        <div className="auth-strip" aria-hidden="true">
          {STRIP.map((name) => (
            <span key={name} className={`auth-strip-seg auth-strip-${name}`} />
          ))}
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-box">
          <h1 className="auth-title">{title}</h1>
          {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}
          {children}
          {footer ? <p className="auth-footer">{footer}</p> : null}
        </div>
      </main>
    </div>
  );
}
