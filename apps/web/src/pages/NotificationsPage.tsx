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

const TYPE_ICONS: Record<string, string> = {
  FORM_SUBMITTED_FOR_REVIEW: "📋",
  FORM_APPROVED: "✅",
  FORM_CHANGES_REQUESTED: "✏️",
  FORM_REJECTED: "❌",
  FORM_PUBLISHED: "🚀",
  MEMBER_INVITED: "👋",
  MEMBER_REMOVED: "👤",
  RESPONSE_MILESTONE: "🎉",
};

function groupByDate(notifications: NotificationRecord[]) {
  const groups: { label: string; items: NotificationRecord[] }[] = [];
  const map = new Map<string, NotificationRecord[]>();

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const n of notifications) {
    const d = new Date(n.createdAt);
    let label: string;

    if (d.toDateString() === today.toDateString()) {
      label = "Today";
    } else if (d.toDateString() === yesterday.toDateString()) {
      label = "Yesterday";
    } else {
      label = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    }

    if (!map.has(label)) {
      map.set(label, []);
      groups.push({ label, items: map.get(label)! });
    }
    map.get(label)!.push(n);
  }

  return groups;
}

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
        setError(err instanceof ApiRequestError ? err.message : "Unable to load notifications.");
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
    } catch { /* silent */ }
  }

  async function markAllRead() {
    try {
      await api.post("/api/notifications/mark-all-read");
      setNotifications((current) => current.map((n) => ({ ...n, read: true })));
    } catch { /* silent */ }
  }

  function handleClick(notification: NotificationRecord) {
    void markAsRead(notification.id);
    if (notification.metadata?.formId) {
      navigate(`/forms/${notification.metadata.formId}/edit`);
    }
  }

  const unreadCount = notifications.filter((n) => !n.read).length;
  const groups = groupByDate(notifications);

  if (loading) {
    return (
      <main className="dashboard-shell">
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "16px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div className="skeleton-block" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton-block" style={{ width: "60%", height: 16, marginBottom: 8 }} />
                <div className="skeleton-block" style={{ width: "80%", height: 13 }} />
              </div>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Notifications</h1>
          <p className="muted">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "All caught up."}
          </p>
        </div>

        {unreadCount > 0 ? (
          <button className="secondary-button" type="button" onClick={() => void markAllRead()}>
            Mark all as read
          </button>
        ) : null}
      </header>

      {error ? (
        <p className="submit-error" role="alert" style={{ maxWidth: 680, margin: "0 auto 18px" }}>
          {error}
        </p>
      ) : null}

      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {notifications.length === 0 ? (
          <div className="editor-card" style={{ textAlign: "center", padding: "48px 24px" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 12px" }}>🔔</p>
            <h2 style={{ margin: "0 0 8px", color: "#111827" }}>No notifications</h2>
            <p className="muted">
              You'll be notified about form reviews, approvals, response milestones, and team activity.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} style={{ marginBottom: 24 }}>
              <p
                style={{
                  color: "#94a3b8",
                  fontSize: "0.75rem",
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  margin: "0 0 8px",
                }}
              >
                {group.label}
              </p>
              <div className="editor-card" style={{ padding: 0, overflow: "hidden" }}>
                {group.items.map((notification, idx) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => handleClick(notification)}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 14,
                      width: "100%",
                      padding: "16px 20px",
                      background: notification.read ? "#ffffff" : "#f0f7ff",
                      borderBottom: idx < group.items.length - 1 ? "1px solid #f1f5f9" : "none",
                      border: "none",
                      cursor: notification.metadata?.formId ? "pointer" : "default",
                      textAlign: "left",
                      transition: "background 150ms ease",
                    }}
                    onMouseEnter={(e) => {
                      if (notification.metadata?.formId) {
                        (e.currentTarget as HTMLButtonElement).style.background = "#e8f4ff";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = notification.read ? "#ffffff" : "#f0f7ff";
                    }}
                  >
                    {/* Icon */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        background: notification.read ? "#f1f5f9" : "#dbeafe",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1.1rem",
                        flexShrink: 0,
                      }}
                    >
                      {TYPE_ICONS[notification.type] ?? "📌"}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <strong style={{ color: "#111827", fontSize: "0.92rem", fontWeight: notification.read ? 600 : 750 }}>
                          {notification.title}
                        </strong>
                        <span style={{ color: "#94a3b8", fontSize: "0.75rem", whiteSpace: "nowrap", flexShrink: 0 }}>
                          {new Date(notification.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p style={{ margin: "4px 0 0", color: "#475569", fontSize: "0.86rem", lineHeight: 1.5 }}>
                        {notification.message}
                      </p>
                    </div>

                    {/* Unread dot */}
                    {!notification.read ? (
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#2563eb",
                          flexShrink: 0,
                          marginTop: 6,
                        }}
                      />
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
