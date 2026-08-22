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

export default function AdminPanelPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWs, setSelectedWs] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
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
      // Fetch forms, members, and compute stats
      const [formsData, membersData] = await Promise.all([
        api.get<{ forms: { id: string; title: string; status: string; createdAt: string }[] }>(`/api/forms?workspaceId=${encodeURIComponent(wsId)}`),
        api.get<{ members: { id: string }[] }>(`/api/members?workspaceId=${encodeURIComponent(wsId)}`),
      ]);

      const forms = formsData.forms;
      const published = forms.filter((f) => f.status === "PUBLISHED").length;
      const drafts = forms.filter((f) => f.status === "DRAFT").length;

      // Get total response count
      let totalResponses = 0;
      // Only count first 20 forms to avoid too many requests
      const topForms = forms.slice(0, 20);
      const counts = await Promise.all(
        topForms.map((f) =>
          api.get<{ count: number }>(`/api/forms/${f.id}/responses-count`).catch(() => ({ count: 0 }))
        )
      );
      totalResponses = counts.reduce((sum, c) => sum + c.count, 0);

      setStats({
        totalForms: forms.length,
        totalResponses,
        totalMembers: membersData.members.length,
        publishedForms: published,
        draftForms: drafts,
        recentForms: forms.slice(0, 10),
      });
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
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <div className="skeleton-block" style={{ width: 280, height: 48, marginBottom: 32 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton-card"><div className="skeleton-block" style={{ height: 60 }} /></div>)}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Dashboard</h1>
          <p className="muted">Overview of your workspace activity and usage.</p>
        </div>

        {workspaces.length > 1 ? (
          <select
            value={selectedWs}
            onChange={(e) => void switchWorkspace(e.target.value)}
            style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px", background: "#fff" }}
          >
            {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
          </select>
        ) : null}
      </header>

      {error ? <p className="submit-error" role="alert" style={{ maxWidth: 980, margin: "0 auto 18px" }}>{error}</p> : null}

      {stats ? (
        <>
          {/* Stats grid */}
          <section style={{ maxWidth: 980, margin: "0 auto 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            <StatCard label="Total Forms" value={stats.totalForms} icon="📋" />
            <StatCard label="Published" value={stats.publishedForms} icon="🚀" />
            <StatCard label="Drafts" value={stats.draftForms} icon="📝" />
            <StatCard label="Total Responses" value={stats.totalResponses} icon="📊" />
            <StatCard label="Team Members" value={stats.totalMembers} icon="👥" />
          </section>

          {/* Recent forms */}
          <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto" }}>
            <div className="editor-card-header">
              <div><p className="eyebrow">Recent</p><h2>Latest forms</h2></div>
            </div>

            {stats.recentForms.length === 0 ? (
              <p className="muted" style={{ padding: "16px 0" }}>No forms in this workspace.</p>
            ) : (
              <div className="editor-question-list">
                {stats.recentForms.map((form) => (
                  <div key={form.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0" }}>
                    <div>
                      <strong style={{ color: "#111827" }}>{form.title}</strong>
                      <span className={`status-pill status-${form.status.toLowerCase()}`} style={{ marginLeft: 10, fontSize: "0.65rem" }}>{form.status.replace(/_/g, " ")}</span>
                    </div>
                    <span className="muted" style={{ fontSize: "0.78rem" }}>{new Date(form.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "24px 20px", textAlign: "center" }}>
      <span style={{ fontSize: "1.6rem", display: "block", marginBottom: 8 }}>{icon}</span>
      <strong style={{ fontSize: "1.8rem", color: "#111827", display: "block" }}>{value}</strong>
      <span style={{ color: "#64748b", fontSize: "0.82rem" }}>{label}</span>
    </div>
  );
}
