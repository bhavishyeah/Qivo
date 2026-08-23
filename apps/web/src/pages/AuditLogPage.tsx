import { useEffect, useState } from "react";
import { api, ApiRequestError } from "../lib/api";
import type { WorkspaceRecord } from "../types";

type AuditEntry = {
  id: string;
  workspaceId: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  FORM_CREATED: "created a form",
  FORM_PUBLISHED: "published a form",
  FORM_CLOSED: "closed a form",
  FORM_DELETED: "deleted a form",
};

const ACTION_ICONS: Record<string, string> = {
  FORM_CREATED: "📝",
  FORM_PUBLISHED: "🚀",
  FORM_CLOSED: "🔒",
  FORM_DELETED: "🗑️",
};

export default function AuditLogPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWs, setSelectedWs] = useState("");
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const limit = 30;

  useEffect(() => {
    async function init() {
      try {
        const wsData = await api.get<{ workspaces: WorkspaceRecord[] }>("/api/workspaces");
        setWorkspaces(wsData.workspaces);
        const ws = wsData.workspaces.find((w) => w.type === "PERSONAL") ?? wsData.workspaces[0];
        if (ws) {
          setSelectedWs(ws.id);
          await loadLogs(ws.id, 0);
        }
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "Unable to load.");
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, []);

  async function loadLogs(wsId: string, off: number) {
    try {
      const data = await api.get<{ logs: AuditEntry[]; total: number }>(
        `/api/audit?workspaceId=${encodeURIComponent(wsId)}&limit=${limit}&offset=${off}`,
      );
      setLogs(data.logs);
      setTotal(data.total);
      setOffset(off);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load audit logs.");
    }
  }

  async function changeWorkspace(wsId: string) {
    setSelectedWs(wsId);
    setError("");
    setLoading(true);
    await loadLogs(wsId, 0);
    setLoading(false);
  }

  if (loading) {
    return (
      <main className="dashboard-shell">
        <div style={{ maxWidth: 780, margin: "0 auto" }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "16px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div className="skeleton-block" style={{ width: 36, height: 36, borderRadius: "50%" }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton-block" style={{ width: "50%", height: 16, marginBottom: 8 }} />
                <div className="skeleton-block" style={{ width: "30%", height: 12 }} />
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
          <h1>Audit log</h1>
          <p className="muted">Track all actions in this workspace. {total} total entries.</p>
        </div>

        {workspaces.length > 1 ? (
          <select
            value={selectedWs}
            onChange={(e) => void changeWorkspace(e.target.value)}
            style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px", background: "#fff" }}
          >
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </select>
        ) : null}
      </header>

      {error ? (
        <p className="submit-error" role="alert" style={{ maxWidth: 780, margin: "0 auto 18px" }}>
          {error}
        </p>
      ) : null}

      <div className="editor-card" style={{ maxWidth: 780, margin: "0 auto" }}>
        {logs.length === 0 ? (
          <div className="empty-state" style={{ padding: "32px 0", textAlign: "center" }}>
            <p style={{ fontSize: "2rem", margin: "0 0 12px" }}>📋</p>
            <h2>No audit entries</h2>
            <p className="muted">Actions like creating, publishing, or deleting forms are logged here.</p>
          </div>
        ) : (
          <div>
            {logs.map((entry) => {
              const title = (entry.metadata as any)?.title ?? entry.entityId ?? "";
              const label = ACTION_LABELS[entry.action] ?? entry.action.toLowerCase().replace(/_/g, " ");
              const icon = ACTION_ICONS[entry.action] ?? "📌";

              return (
                <div
                  key={entry.id}
                  style={{
                    display: "flex",
                    gap: 14,
                    padding: "14px 4px",
                    borderBottom: "1px solid #f1f5f9",
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: "#f8fafc",
                      display: "grid",
                      placeItems: "center",
                      fontSize: "1rem",
                      flexShrink: 0,
                    }}
                  >
                    {icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, color: "#1e293b", fontSize: "0.9rem" }}>
                      <strong>{label}</strong>
                      {title ? <> — <span style={{ color: "#475569" }}>{title as string}</span></> : null}
                    </p>
                    <p style={{ margin: "2px 0 0", color: "#94a3b8", fontSize: "0.78rem" }}>
                      {entry.userName} · {new Date(entry.createdAt).toLocaleString()} · {entry.entityType}
                      {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}…` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {total > limit ? (
          <div className="pagination-controls" style={{ marginTop: 16 }}>
            <button
              className="secondary-button compact"
              type="button"
              disabled={offset === 0}
              onClick={() => void loadLogs(selectedWs, Math.max(0, offset - limit))}
            >
              Previous
            </button>
            <span className="muted">
              {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <button
              className="secondary-button compact"
              type="button"
              disabled={offset + limit >= total}
              onClick={() => void loadLogs(selectedWs, offset + limit)}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
