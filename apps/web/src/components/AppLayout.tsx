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
    </div>
  );
}
