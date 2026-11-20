import { Link, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, setToken } from "../lib/api";
import Logo from "./Logo";
import UserMenu from "./UserMenu";
import { useThemePreference } from "../lib/useThemePreference";
import { ToastProvider } from "./Toast";

const iconProps = { viewBox: "0 0 24 24", width: 22, height: 22, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const NavIcons = {
  forms: <svg {...iconProps}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>,
  folders: <svg {...iconProps}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>,
  create: <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>,
  alerts: <svg {...iconProps}><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21h4" /></svg>,
  more: <svg {...iconProps}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>,
};

type UserInfo = { id: string; name: string; email: string };

export default function AppLayout({
  user,
  children,
}: {
  user: UserInfo;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchUnread() {
      try {
        const data = await api.get<{ count: number }>("/api/notifications/unread-count");
        if (!cancelled) setUnreadCount(data.count);
      } catch {
        // non-critical
      }
    }

    // Fetch now, then poll every 60s (visible tab only), and refresh when the tab regains focus.
    void fetchUnread();
    // Skip polling while the tab is hidden (saves API rate limit).
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchUnread();
    }, 60_000);
    const onFocus = () => void fetchUnread();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
    // Re-run on navigation too so the badge updates when leaving the
    // notifications page (where items get marked read).
  }, [location.pathname]);

  useEffect(() => {
    function handleSessionExpired() {
      setSessionExpired(true);
    }
    window.addEventListener("qivo:session-expired", handleSessionExpired);
    return () => window.removeEventListener("qivo:session-expired", handleSessionExpired);
  }, []);

  async function handleLogout() {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // ignore
    }
    setToken(null);
    navigate("/login");
  }

  const isPreviewRoute = /^\/forms\/[^/]+\/preview\/?$/.test(location.pathname);
  const [themePref, setThemePref] = useThemePreference(!isPreviewRoute);
  const isActive = (path: string) => location.pathname === path;
  // The form editor renders its own compact header (logo, title, actions and
  // tabs), so the global top bar is hidden there to avoid a double navbar.
  const isEditorRoute = /^\/forms\/[^/]+\/edit\/?$/.test(location.pathname);
  // The preview route renders the public form, which must stay outside .app-root.

  return (
    <ToastProvider>
    <div className="app-layout">
      {sessionExpired ? (
        <div className="app-root notice-banner" role="alert">
          <span>
            Your session has expired. Please log in again.
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { setToken(null); navigate("/login"); }}
          >
            Log in
          </button>
        </div>
      ) : null}
      {isEditorRoute ? null : <nav className="app-nav app-root">
        <div className="app-nav-inner">
          <Link to="/dashboard" className="app-nav-brand" aria-label="Qivo">
            <Logo size="md" />
          </Link>

          <div className="app-nav-links">
            <Link
              to="/dashboard"
              className={`app-nav-link ${isActive("/dashboard") ? "active" : ""}`}
            >
              Forms
            </Link>
            <Link
              to="/folders"
              className={`app-nav-link ${isActive("/folders") ? "active" : ""}`}
            >
              Folders
            </Link>
            <Link
              to="/shared"
              className={`app-nav-link ${isActive("/shared") ? "active" : ""}`}
            >
              Shared with me
            </Link>
            <Link
              to="/team"
              className={`app-nav-link ${isActive("/team") ? "active" : ""}`}
            >
              Team
            </Link>
            <Link
              to="/notifications"
              className={`app-nav-link ${isActive("/notifications") ? "active" : ""}`}
            >
              Notifications
              {unreadCount > 0 ? (
                <span className="app-nav-badge">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </Link>
            <Link
              to="/audit"
              className={`app-nav-link ${isActive("/audit") ? "active" : ""}`}
            >
              Audit
            </Link>
            <Link
              to="/events"
              className={`app-nav-link ${isActive("/events") ? "active" : ""}`}
            >
              Events
            </Link>
            <Link
              to="/admin"
              className={`app-nav-link ${isActive("/admin") ? "active" : ""}`}
            >
              Admin
            </Link>
          </div>

          <div className="app-nav-user">
            <UserMenu
              name={user.name}
              email={user.email}
              preference={themePref}
              onPreferenceChange={setThemePref}
              onLogout={() => void handleLogout()}
            />
          </div>
        </div>
      </nav>}

      <div className={isPreviewRoute ? "app-content" : "app-content app-root app-shell"}>{children}</div>

      {/* Mobile bottom nav */}
      <nav className="app-bottom-nav app-root">
        <Link
          to="/dashboard"
          className={`app-bottom-nav-item ${isActive("/dashboard") ? "active" : ""}`}
        >
          <span className="app-bottom-nav-icon">{NavIcons.forms}</span>
          Forms
        </Link>
        <Link
          to="/folders"
          className={`app-bottom-nav-item ${isActive("/folders") ? "active" : ""}`}
        >
          <span className="app-bottom-nav-icon">{NavIcons.folders}</span>
          Folders
        </Link>
        <Link
          to="/forms/new"
          className={`app-bottom-nav-item ${isActive("/forms/new") ? "active" : ""}`}
        >
          <span className="app-bottom-nav-icon">{NavIcons.create}</span>
          Create
        </Link>
        <Link
          to="/notifications"
          className={`app-bottom-nav-item ${isActive("/notifications") ? "active" : ""}`}
        >
          <span className="app-bottom-nav-icon">{NavIcons.alerts}</span>
          Alerts
          {unreadCount > 0 ? <span className="app-bottom-nav-badge">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
        </Link>
        <UserMenu
          name={user.name}
          email={user.email}
          preference={themePref}
          onPreferenceChange={setThemePref}
          onLogout={() => void handleLogout()}
          triggerClassName={`app-bottom-nav-item ${isActive("/settings") ? "active" : ""}`}
          trigger={
            <>
              <span className="app-bottom-nav-icon">{NavIcons.more}</span>
              Profile
            </>
          }
        />
      </nav>
    </div>
    </ToastProvider>
  );
}
