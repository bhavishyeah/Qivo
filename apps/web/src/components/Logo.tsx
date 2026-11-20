import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Slot for the future SVG icon. Set it here and every wordmark picks it up. */
export const LOGO_ICON: ReactNode = null;

type LogoProps = {
  to?: string;
  size?: "sm" | "md" | "lg";
  tone?: "auto" | "on-indigo";
  icon?: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export default function Logo({
  to,
  size = "md",
  tone = "auto",
  icon = LOGO_ICON,
  className,
  ariaLabel = "Qivo",
}: LogoProps) {
  const classes = ["logo", `logo-${size}`, tone === "on-indigo" ? "logo-on-indigo" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      {icon ? (
        <span className="logo-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="logo-word">Qivo</span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={classes} aria-label={ariaLabel}>
        {content}
      </Link>
    );
  }
  return <span className={classes}>{content}</span>;
}
