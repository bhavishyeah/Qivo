import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import { parseSharedWithMe } from "../lib/sharedWithMe";
import type { SharedWithMeItem } from "../types";

const ROLE_LABELS: Record<string, string> = {
  EDITOR: "Editor",
  VIEWER: "Viewer",
  RESPONDER: "Responder",
};

const ROLE_BADGES: Record<string, string> = {
  EDITOR: "badge badge-status-published",
  VIEWER: "badge badge-status-draft",
  RESPONDER: "badge badge-tag",
};

function formLink(item: SharedWithMeItem): string {
  if (item.role === "RESPONDER") return `/f/${item.form.slug}`;
  if (item.role === "EDITOR") return `/forms/${item.form.id}/edit`;
  return `/forms/${item.form.id}/responses`;
}

export default function SharedWithMePage() {
  const [items, setItems] = useState<SharedWithMeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadSharedForms();
  }, []);

  async function loadSharedForms() {
    try {
      // The API returns { shares: [...] } (api.get unwraps the outer `data`).
      const data = await api.get<{ shares: SharedWithMeItem[] }>("/api/forms/shared-with-me");
      setItems(parseSharedWithMe(data));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load shared forms.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="dashboard-shell">
        <div className="page-col-md" aria-hidden="true">
          <div className="skeleton-line skeleton-line-lg" style={{ width: 220, marginBottom: 16 }} />
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-tile" style={{ marginBottom: 8 }}>
              <div className="skeleton-line skeleton-line-lg" />
            </div>
          ))}
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="dashboard-shell">
        <p className="msg msg-error page-col-md" role="alert">{error}</p>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="dash-kicker">Collaboration</p>
          <h1>Shared with me</h1>
        </div>
      </header>

      <div className="panel page-col-md">
        {items.length === 0 ? (
          <div className="panel-empty">
            <p>No forms have been shared with you yet.</p>
          </div>
        ) : (
          <ul className="row-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((item) => (
              <li key={item.shareId} className="row-item">
                <div className="row-main">
                  <strong className="row-title">{item.form.title}</strong>
                  <span className="row-meta">{item.form.status}</span>
                </div>
                <span className={ROLE_BADGES[item.role] ?? "badge"}>
                  {ROLE_LABELS[item.role] ?? item.role}
                </span>
                <Link className="row-link" to={formLink(item)}>
                  {item.role === "RESPONDER" ? "Fill form" : item.role === "EDITOR" ? "Edit" : "View responses"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
