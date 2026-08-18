import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";

type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  metadata?: { formId?: string } | null;
  createdAt: string;
};

export default function NotificationsPage() {
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get<{ notifications: NotificationRecord[] }>(
          "/api/notifications?limit=50",
        );
        setNotifications(data.notifications);
      } catch (err) {
        setError(
          err instanceof ApiRequestError ? err.message : "Unable to load notifications.",
        );
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function markAsRead(id: string) {
    try {
      await api.patch(`/api/notifications/${id}/read`);
      setNotifications((current) =>
        current.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
    } catch {
      // silent
    }
  }

  async function markAllRead() {
    try {
      await api.post("/api/notifications/mark-all-read");
      setNotifications((current) => current.map((n) => ({ ...n, read: true })));
    } catch {
      // silent
    }
  }

  function handleClick(notification: NotificationRecord) {
    void markAsRead(notification.id);

    // Navigate to form if metadata has formId
    if (notification.metadata?.formId) {
      navigate(`/forms/${notification.metadata.formId}/edit`);
    }
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading notifications...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <button
            className="back-button"
            type="button"
            onClick={() => navigate("/dashboard")}
          >
            ← Dashboard
          </button>
          <p className="eyebrow">Notifications</p>
          <h1>Activity</h1>
          <p className="muted">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "All caught up."}
          </p>
        </div>

        {unreadCount > 0 ? (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void markAllRead()}
          >
            Mark all as read
          </button>
        ) : null}
      </header>

      {error ? (
        <p
          className="submit-error"
          role="alert"
          style={{ maxWidth: 980, margin: "0 auto 18px" }}
        >
          {error}
        </p>
      ) : null}

      <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto" }}>
        {notifications.length === 0 ? (
          <div className="empty-state">
            <h2>No notifications</h2>
            <p className="muted">
              You'll be notified about form reviews, approvals, and team activity.
            </p>
          </div>
        ) : (
          <div className="editor-question-list">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                className="response-row"
                onClick={() => handleClick(notification)}
                style={{
                  opacity: notification.read ? 0.7 : 1,
                  borderLeftWidth: 4,
                  borderLeftColor: notification.read ? "transparent" : "#2563eb",
                }}
              >
                <span>
                  <strong style={{ color: "#111827" }}>{notification.title}</strong>
                  <small
                    style={{
                      display: "block",
                      marginTop: 4,
                      color: "#475569",
                      fontSize: "0.88rem",
                    }}
                  >
                    {notification.message}
                  </small>
                  <small style={{ display: "block", marginTop: 4 }}>
                    {new Date(notification.createdAt).toLocaleString()}
                  </small>
                </span>
                {!notification.read ? (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#2563eb",
                      flexShrink: 0,
                    }}
                  />
                ) : null}
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
