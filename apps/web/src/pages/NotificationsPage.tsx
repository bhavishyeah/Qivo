import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import { PageIcon, type PageIconName } from "../components/PageIcons";

type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  metadata?: { formId?: string } | null;
  createdAt: string;
};

const TYPE_ICONS: Record<string, PageIconName> = {
  FORM_SUBMITTED_FOR_REVIEW: "doc",
  FORM_APPROVED: "check",
  FORM_CHANGES_REQUESTED: "edit",
  FORM_REJECTED: "cross",
  FORM_PUBLISHED: "send",
  MEMBER_INVITED: "user",
  MEMBER_REMOVED: "user",
  RESPONSE_MILESTONE: "chart",
  FORM_SHARED: "link",
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
        <div className="page-col-sm" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="act-skel">
              <div className="skeleton-line act-skel-icon" />
              <div style={{ flex: 1 }}>
                <div className="skeleton-line skeleton-line-lg" style={{ width: "60%", marginBottom: 8 }} />
                <div className="skeleton-line" style={{ width: "80%" }} />
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
          <p className="dash-kicker">Activity</p>
          <h1>Notifications</h1>
          <p className="page-sub">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "All caught up."}
          </p>
        </div>
        {unreadCount > 0 ? (
          <button className="btn btn-secondary" type="button" onClick={() => void markAllRead()}>
            Mark all as read
          </button>
        ) : null}
      </header>

      {error ? (
        <p className="msg msg-error page-col-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="page-col-sm">
        {notifications.length === 0 ? (
          <div className="panel panel-empty">
            <h2>No notifications</h2>
            <p>
              You'll be notified about form reviews, approvals, response milestones, and team activity.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="act-group">
              <h2 className="act-group-title">{group.label}</h2>
              <div className="panel panel-flush" style={{ marginBottom: 0 }}>
                {group.items.map((notification) => {
                  const linked = Boolean(notification.metadata?.formId);
                  return (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => handleClick(notification)}
                      className={`act-item${notification.read ? "" : " act-item-unread"}${linked ? " act-item-link" : ""}`}
                    >
                      <span className="act-icon">
                        <PageIcon name={TYPE_ICONS[notification.type] ?? "pin"} />
                      </span>
                      <span className="act-body">
                        <span className="act-head">
                          <span className="act-title">{notification.title}</span>
                          <span className="act-time">
                            {new Date(notification.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </span>
                        <span className="act-text" style={{ display: "block" }}>
                          {notification.message}
                        </span>
                      </span>
                      {!notification.read ? <span className="act-unread-label">NEW</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
