import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import type { SharedWithMeItem } from "../types";

const ROLE_LABELS: Record<string, string> = {
  EDITOR: "Editor",
  VIEWER: "Viewer",
  RESPONDER: "Responder",
};

const ROLE_COLORS: Record<string, string> = {
  EDITOR: "#2563eb",
  VIEWER: "#6b7280",
  RESPONDER: "#059669",
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
      const data = await api.get<SharedWithMeItem[]>("/api/forms/shared-with-me");
      setItems(data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load shared forms.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <div className="skeleton-block" style={{ width: 220, height: 24, marginBottom: 12 }} />
          <div className="skeleton-block" style={{ width: "100%", height: 64, marginBottom: 8 }} />
          <div className="skeleton-block" style={{ width: "100%", height: 64, marginBottom: 8 }} />
          <div className="skeleton-block" style={{ width: "100%", height: 64 }} />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p style={{ color: "#dc2626" }}>{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <div className="status-card">
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: 16 }}>
          Shared with me
        </h1>

        {items.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: "0.95rem" }}>
            No forms have been shared with you yet.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {items.map((item) => (
              <li
                key={item.shareId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 16px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  background: "#fafafa",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontWeight: 500,
                      fontSize: "0.95rem",
                      margin: 0,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.form.title}
                  </p>
                  <p style={{ fontSize: "0.8rem", color: "#9ca3af", margin: "2px 0 0 0" }}>
                    {item.form.status}
                  </p>
                </div>
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#fff",
                    background: ROLE_COLORS[item.role] ?? "#6b7280",
                    padding: "2px 10px",
                    borderRadius: 12,
                    whiteSpace: "nowrap",
                  }}
                >
                  {ROLE_LABELS[item.role] ?? item.role}
                </span>
                <Link
                  to={formLink(item)}
                  style={{
                    fontSize: "0.85rem",
                    color: "#2563eb",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    fontWeight: 500,
                  }}
                >
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
