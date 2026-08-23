import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import type { FormRecord, WorkspaceRecord } from "../types";

type FormWithCount = FormRecord & { responseCount?: number };

type SortOption = "updatedAt" | "createdAt" | "title";
type StatusFilter = "ALL" | "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "CLOSED" | "ARCHIVED";

type FolderRecord = {
  id: string;
  name: string;
  parentId: string | null;
};

type EventRecord = {
  id: string;
  name: string;
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [forms, setForms] = useState<FormWithCount[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters (read folder from URL params)
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [folderFilter, setFolderFilter] = useState<string>(searchParams.get("folder") ?? "ALL");
  const [sortBy, setSortBy] = useState<SortOption>("updatedAt");

  // Folder assignment popup
  const [assigningFolderId, setAssigningFolderId] = useState<string | null>(null);
  const assignRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  // Close folder popup on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (assignRef.current && !assignRef.current.contains(e.target as Node)) {
        setAssigningFolderId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function loadDashboard(wsId?: string) {
    try {
      const wsData = await api.get<{ workspaces: WorkspaceRecord[] }>("/api/workspaces");
      setWorkspaces(wsData.workspaces);

      const workspaceId =
        wsId ??
        wsData.workspaces.find((w) => w.type === "PERSONAL")?.id ??
        wsData.workspaces[0]?.id;

      if (!workspaceId) throw new Error("No workspace found.");
      setActiveWorkspaceId(workspaceId);

      const [formsData, foldersData] = await Promise.all([
        api.get<{ forms: FormRecord[] }>(`/api/forms?workspaceId=${encodeURIComponent(workspaceId)}`),
        api.get<{ folders: FolderRecord[] }>(`/api/folders?workspaceId=${encodeURIComponent(workspaceId)}`),
      ]);

      setForms(formsData.forms);
      setFolders(foldersData.folders);

      // Load events in background
      api.get<{ events: EventRecord[] }>(`/api/events?workspaceId=${encodeURIComponent(workspaceId)}`)
        .then((data) => setEvents(data.events))
        .catch(() => { /* non-critical */ });

      // Load response counts in background
      formsData.forms.forEach((form) => {
        api.get<{ count: number }>(`/api/forms/${form.id}/responses-count`)
          .then((data) => setForms((current) => current.map((f) => f.id === form.id ? { ...f, responseCount: data.count } : f)))
          .catch(() => { /* non-critical */ });
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  async function switchWorkspace(wsId: string) {
    setLoading(true);
    setForms([]);
    setFolders([]);
    setSearch("");
    setStatusFilter("ALL");
    setFolderFilter("ALL");
    await loadDashboard(wsId);
  }

  async function duplicateForm(formId: string) {
    try {
      const data = await api.post<{ form: FormRecord }>(`/api/forms/${formId}/duplicate`);
      setForms((current) => [data.form, ...current]);
    } catch { /* silent */ }
  }

  async function moveToFolder(formId: string, folderId: string | null) {
    try {
      await api.patch(`/api/folders/move-form/${formId}`, { folderId });
      setForms((current) =>
        current.map((f) => f.id === formId ? { ...f, folderId } : f),
      );
      setAssigningFolderId(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to move form.");
    }
  }

  const filteredForms = useMemo(() => {
    let result = [...forms];

    if (statusFilter !== "ALL") result = result.filter((f) => f.status === statusFilter);

    if (folderFilter === "NONE") {
      result = result.filter((f) => !f.folderId);
    } else if (folderFilter !== "ALL") {
      result = result.filter((f) => f.folderId === folderFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) => f.title.toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q),
      );
    }

    result.sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "createdAt") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return result;
  }, [forms, search, statusFilter, folderFilter, sortBy]);

  if (loading) {
    return (
      <main className="dashboard-shell">
        <div className="dashboard-header" style={{ maxWidth: 1180, margin: "0 auto 32px" }}>
          <div className="skeleton-block" style={{ width: 280, height: 48 }} />
          <div className="skeleton-block" style={{ width: 120, height: 40 }} />
        </div>
        <div className="forms-grid" style={{ maxWidth: 1180, margin: "0 auto" }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-block" style={{ width: "40%", height: 18, marginBottom: 14 }} />
              <div className="skeleton-block" style={{ width: "70%", height: 24, marginBottom: 10 }} />
              <div className="skeleton-block" style={{ width: "55%", height: 15, marginBottom: 20 }} />
              <div className="skeleton-block" style={{ width: "30%", height: 13 }} />
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
          <p className="eyebrow">
            {workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? "Workspace"}
          </p>
          <h1>Your forms</h1>
          <p className="muted">
            {forms.length} form{forms.length !== 1 ? "s" : ""}
            {folders.length > 0 ? ` · ${folders.length} folder${folders.length !== 1 ? "s" : ""}` : ""}
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {/* Workspace switcher */}
          {workspaces.length > 1 ? (
            <select
              value={activeWorkspaceId}
              onChange={(e) => void switchWorkspace(e.target.value)}
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "10px 12px",
                background: "#fff",
                fontSize: "0.88rem",
                fontWeight: 600,
              }}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
          ) : null}

          <button
            className="secondary-button"
            type="button"
            onClick={() => navigate("/forms/new")}
            style={{ background: "#2563eb", color: "#fff", border: "none" }}
          >
            + New form
          </button>
        </div>
      </header>

      {error ? (
        <section className="status-card error-card" style={{ maxWidth: 1180, margin: "0 auto 20px" }}>
          <h2>Unable to load dashboard</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {/* Filter bar */}
      <section
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          maxWidth: 1180,
          margin: "0 auto 20px",
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search forms..."
          style={{ flex: 1, minWidth: 180, border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 14px", background: "#fff" }}
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px", background: "#fff" }}
        >
          <option value="ALL">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PENDING_REVIEW">Pending review</option>
          <option value="PUBLISHED">Published</option>
          <option value="CLOSED">Closed</option>
          <option value="ARCHIVED">Archived</option>
        </select>

        {folders.length > 0 ? (
          <select
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
            style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px", background: "#fff" }}
          >
            <option value="ALL">All folders</option>
            <option value="NONE">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>📁 {f.name}</option>
            ))}
          </select>
        ) : null}

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px", background: "#fff" }}
        >
          <option value="updatedAt">Recently updated</option>
          <option value="createdAt">Recently created</option>
          <option value="title">Name (A–Z)</option>
        </select>

        <span className="muted" style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>
          {filteredForms.length} form{filteredForms.length !== 1 ? "s" : ""}
        </span>
      </section>

      {/* Empty states */}
      {!error && forms.length === 0 ? (
        <section className="empty-dashboard">
          <p className="eyebrow">No forms yet</p>
          <h2>Create your first form.</h2>
          <p className="muted">Start with a title and add questions from the editor.</p>
        </section>
      ) : null}

      {!error && forms.length > 0 && filteredForms.length === 0 ? (
        <section className="empty-dashboard">
          <p className="eyebrow">No matches</p>
          <h2>No forms match your filters.</h2>
          <p className="muted">Try adjusting your search or filters.</p>
        </section>
      ) : null}

      {/* Forms grid */}
      <section className="forms-grid">
        {filteredForms.map((form) => {
          const questionCount =
            form.schema?.sections?.reduce((total, s) => total + s.questions.length, 0) ?? 0;

          const folderName = form.folderId
            ? folders.find((f) => f.id === form.folderId)?.name ?? null
            : null;

          const eventName = form.eventId
            ? events.find((e) => e.id === form.eventId)?.name ?? null
            : null;

          return (
            <article className="form-tile" key={form.id}>
              <div className="form-tile-top">
                <span className={`status-pill status-${form.status.toLowerCase()}`}>
                  {form.status.replace(/_/g, " ")}
                </span>
                <span className="muted" style={{ fontSize: "0.78rem" }}>
                  {questionCount}Q
                  {form.responseCount !== undefined ? ` · ${form.responseCount}R` : ""}
                </span>
              </div>

              {/* Folder badge */}
              {folderName ? (
                <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "#2563eb", fontWeight: 700 }}>
                  📁 {folderName}
                </p>
              ) : null}

              {/* Event badge */}
              {eventName ? (
                <p style={{ margin: folderName ? "4px 0 0" : "8px 0 0", fontSize: "0.75rem", color: "#7c3aed", fontWeight: 700 }}>
                  🎪 {eventName}
                </p>
              ) : null}

              <h2 style={{ marginTop: (folderName || eventName) ? 6 : 24 }}>{form.title}</h2>

              <p className="form-tile-description">
                {form.description || "No description provided."}
              </p>

              <p className="muted" style={{ fontSize: "0.8rem" }}>
                Updated {new Date(form.updatedAt).toLocaleDateString()}
              </p>

              <div className="form-tile-actions" style={{ flexWrap: "wrap", gap: 8 }}>
                <Link className="secondary-link" to={`/forms/${form.id}/edit`}>Edit</Link>
                <Link className="secondary-link" to={`/forms/${form.id}/responses`}>Responses</Link>
                <Link className="secondary-link" to={`/forms/${form.id}/share`}>Share</Link>

                {/* Folder assign button */}
                {folders.length > 0 ? (
                  <div style={{ position: "relative" }}>
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => setAssigningFolderId(assigningFolderId === form.id ? null : form.id)}
                    >
                      📁 {folderName ?? "Move"}
                    </button>

                    {assigningFolderId === form.id ? (
                      <div
                        ref={assignRef}
                        style={{
                          position: "absolute",
                          top: "110%",
                          left: 0,
                          zIndex: 20,
                          background: "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 12,
                          boxShadow: "0 8px 32px rgb(0 0 0 / 12%)",
                          minWidth: 200,
                          overflow: "hidden",
                        }}
                      >
                        <button
                          type="button"
                          style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left", border: "none", background: !form.folderId ? "#eff6ff" : "#fff", color: "#475569", fontSize: "0.88rem", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                          onClick={() => void moveToFolder(form.id, null)}
                        >
                          No folder
                        </button>
                        {folders.map((folder) => (
                          <button
                            key={folder.id}
                            type="button"
                            style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left", border: "none", background: form.folderId === folder.id ? "#eff6ff" : "#fff", color: "#475569", fontSize: "0.88rem", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                            onClick={() => void moveToFolder(form.id, folder.id)}
                          >
                            📁 {folder.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => void duplicateForm(form.id)}
                >
                  Duplicate
                </button>

                {form.status === "PUBLISHED" ? (
                  <a
                    className="secondary-button compact"
                    href={`/f/${form.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open ↗
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
