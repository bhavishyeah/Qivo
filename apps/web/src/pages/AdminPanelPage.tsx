import { useEffect, useState } from "react";
import { api, ApiRequestError } from "../lib/api";
import type { WorkspaceRecord } from "../types";

type StatsData = {
  totalForms: number;
  totalResponses: number;
  totalMembers: number;
  publishedForms: number;
  draftForms: number;
  recentForms: { id: string; title: string; status: string; createdAt: string }[];
};

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case "published":
      return "badge badge-status-published";
    case "pending_review":
      return "badge badge-status-pending";
    case "closed":
      return "badge badge-status-closed";
    case "archived":
      return "badge badge-status-archived";
    default:
      return "badge badge-status-draft";
  }
}

export default function AdminPanelPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWs, setSelectedWs] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- load is a hoisted function declaration, safe to call from the mount effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      const wsData = await api.get<{ workspaces: WorkspaceRecord[] }>("/api/workspaces");
      setWorkspaces(wsData.workspaces);
      const ws = wsData.workspaces.find((w) => w.type === "PERSONAL") ?? wsData.workspaces[0];
      if (ws) {
        setSelectedWs(ws.id);
        await loadStats(ws.id);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load.");
    } finally {
      setLoading(false);
    }
  }

  async function loadStats(wsId: string) {
    try {
      // Single aggregate request: the server computes all counts (previously
      // this fired one /responses-count request per form).
      const data = await api.get<StatsData>(
        `/api/forms/workspace-stats?workspaceId=${encodeURIComponent(wsId)}`,
      );
      setStats(data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load stats.");
    }
  }

  async function switchWorkspace(wsId: string) {
    setSelectedWs(wsId);
    setStats(null);
    setLoading(true);
    await loadStats(wsId);
    setLoading(false);
  }

  if (loading) {
    return (
      <main className="dashboard-shell">
        <div className="page-col" aria-hidden="true">
          <div className="skeleton-line skeleton-line-lg" style={{ width: 280, height: 40, marginBottom: 32 }} />
          <div className="stat-grid">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton-tile">
                <div className="skeleton-line skeleton-line-lg" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="dash-kicker">Admin</p>
          <h1>Dashboard</h1>
          <p className="page-sub">Overview of your workspace activity and usage.</p>
        </div>
        {workspaces.length > 1 ? (
          <select
            className="input input-auto"
            aria-label="Workspace"
            value={selectedWs}
            onChange={(e) => void switchWorkspace(e.target.value)}
          >
            {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
          </select>
        ) : null}
      </header>

      {error ? <p className="msg msg-error page-col" role="alert">{error}</p> : null}

      {stats ? (
        <div className="page-col">
          {/* Stats grid */}
          <section className="stat-grid" aria-label="Workspace totals">
            <StatCard label="Total forms" value={stats.totalForms} />
            <StatCard label="Published" value={stats.publishedForms} />
            <StatCard label="Drafts" value={stats.draftForms} />
            <StatCard label="Responses" value={stats.totalResponses} />
            <StatCard label="Members" value={stats.totalMembers} />
          </section>

          {/* Recent forms */}
          <section className="panel">
            <div className="panel-head">
              <div><p className="dash-kicker">Recent</p><h2>Latest forms</h2></div>
            </div>
            {stats.recentForms.length === 0 ? (
              <p className="text-muted">No forms in this workspace.</p>
            ) : (
              <div className="row-list">
                {stats.recentForms.map((form) => (
                  <div key={form.id} className="row-item">
                    <div className="row-main">
                      <strong className="row-title">{form.title}</strong>
                      <span className={statusBadgeClass(form.status)}>{form.status.replace(/_/g, " ")}</span>
                    </div>
                    <span className="text-subtle">{new Date(form.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <strong className="stat-value">{value}</strong>
      <span className="stat-label">{label}</span>
    </div>
  );
}
