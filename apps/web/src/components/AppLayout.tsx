import { Link, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, setToken } from "../lib/api";

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
    async function fetchUnread() {
      try {
        const data = await api.get<{ count: number }>("/api/notifications/unread-count");
        setUnreadCount(data.count);
      } catch {
        // non-critical
      }
    }
    void fetchUnread();
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

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="app-layout">
      {sessionExpired ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            background: "#fef3c7",
            borderBottom: "2px solid #f59e0b",
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <span style={{ color: "#92400e", fontWeight: 600, fontSize: "0.9rem" }}>
            Your session has expired. Please log in again.
          </span>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => navigate("/login")}
          >
            Log in
          </button>
        </div>
      ) : null}
      <nav className="app-nav">
        <div className="app-nav-inner">
          <Link to="/dashboard" className="app-nav-brand">
            Qivo
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
              to="/team"
              className={`app-nav-link ${isActive("/team") ? "active" : ""}`}
            >
              Team
            </Link>
            <Link
              to="/notifications"
              className={`app-nav-link ${isActive("/notifications") ? "active" : ""}`}
              style={{ position: "relative" }}
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
          </div>

          <div className="app-nav-user">
            <Link to="/settings" className="app-nav-link">
              {user.name}
            </Link>
            <button
              type="button"
              className="app-nav-logout"
              onClick={() => void handleLogout()}
            >
              Log out
            </button>
          </div>
        </div>
      </nav>

      <div className="app-content">{children}</div>

      {/* Mobile bottom nav */}
      <nav className="app-bottom-nav">
        <Link
          to="/dashboard"
          className={`app-bottom-nav-item ${isActive("/dashboard") ? "active" : ""}`}
        >
          <span className="app-bottom-nav-icon">📋</span>
          Forms
        </Link>
        <Link
          to="/folders"
          className={`app-bottom-nav-item ${isActive("/folders") ? "active" : ""}`}
        >
          <span className="app-bottom-nav-icon">📁</span>
          Folders
        </Link>
        <Link
          to="/forms/new"
          className={`app-bottom-nav-item ${isActive("/forms/new") ? "active" : ""}`}
        >
          <span className="app-bottom-nav-icon">➕</span>
          Create
        </Link>
        <Link
          to="/notifications"
          className={`app-bottom-nav-item ${isActive("/notifications") ? "active" : ""}`}
        >
          <span className="app-bottom-nav-icon">🔔</span>
          Alerts
          {unreadCount > 0 ? <span className="app-bottom-nav-badge">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
        </Link>
        <Link
          to="/settings"
          className={`app-bottom-nav-item ${isActive("/settings") ? "active" : ""}`}
        >
          <span className="app-bottom-nav-icon">⚙️</span>
          More
        </Link>
      </nav>
    </div>
  );
}
