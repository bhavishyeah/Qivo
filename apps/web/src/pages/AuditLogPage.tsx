import { useEffect, useState } from "react";
import { api, ApiRequestError } from "../lib/api";
import type { WorkspaceRecord } from "../types";
import { PageIcon, type PageIconName } from "../components/PageIcons";
import Select from "../components/Select";

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

const ACTION_ICONS: Record<string, PageIconName> = {
  FORM_CREATED: "edit",
  FORM_PUBLISHED: "send",
  FORM_CLOSED: "lock",
  FORM_DELETED: "trash",
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
        <div className="page-col-md" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="act-skel">
              <div className="skeleton-line act-skel-icon" />
              <div style={{ flex: 1 }}>
                <div className="skeleton-line skeleton-line-lg" style={{ width: "50%", marginBottom: 8 }} />
                <div className="skeleton-line" style={{ width: "30%" }} />
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
          <h1>Audit log</h1>
          <p className="page-sub">Track all actions in this workspace. {total} total entries.</p>
        </div>
        {workspaces.length > 1 ? (
          <Select aria-label="Workspace" fullWidth={false} value={selectedWs} onChange={(v) => void changeWorkspace(v)} options={workspaces.map((ws) => ({ value: ws.id, label: ws.name }))} />
        ) : null}
      </header>

      {error ? (
        <p className="msg msg-error page-col-md" role="alert">
          {error}
        </p>
      ) : null}

      <div className="panel page-col-md">
        {logs.length === 0 ? (
          <div className="panel-empty">
            <h2>No audit entries</h2>
            <p>Actions like creating, publishing, or deleting forms are logged here.</p>
          </div>
        ) : (
          <div>
            {logs.map((entry) => {
              const title = (entry.metadata as { title?: string } | null)?.title ?? entry.entityId ?? "";
              const label = ACTION_LABELS[entry.action] ?? entry.action.toLowerCase().replace(/_/g, " ");
              const icon = ACTION_ICONS[entry.action] ?? "pin";
              return (
                <div key={entry.id} className="act-row">
                  <span className="act-icon">
                    <PageIcon name={icon} />
                  </span>
                  <div className="act-body">
                    <p>
                      <strong>{label}</strong>
                      {title ? <> {"\u2014"} <span className="text-muted">{title as string}</span></> : null}
                    </p>
                    <p className="act-text">
                      {entry.userName} {"\u00B7"} {new Date(entry.createdAt).toLocaleString()} {"\u00B7"} {entry.entityType}
                      {entry.entityId ? ` \u00B7 ${entry.entityId.slice(0, 8)}\u2026` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {total > limit ? (
          <div className="pager">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={offset === 0}
              onClick={() => void loadLogs(selectedWs, Math.max(0, offset - limit))}
            >
              Previous
            </button>
            <span>
              {offset + 1}{"\u2013"}{Math.min(offset + limit, total)} of {total}
            </span>
            <button
              className="btn btn-secondary btn-sm"
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
