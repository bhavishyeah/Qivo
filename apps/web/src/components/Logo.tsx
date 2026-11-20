import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Icon slot. Drop the SVG at apps/web/src/assets/logo-icon.svg (square-ish
 * viewBox, transparent background, ideally under 5KB) and every wordmark shows
 * it before the text. With no file there, only the wordmark renders.
 * PWA/favicon icons are separate files in apps/web/public.
 */
const iconFiles = import.meta.glob<string>("../assets/logo-icon.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
const ICON_URL: string | undefined = Object.values(iconFiles)[0];

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
  icon,
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
      ) : ICON_URL ? (
        <img className="logo-icon" src={ICON_URL} alt="" aria-hidden="true" width={24} height={24} />
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
