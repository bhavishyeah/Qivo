import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import PopoverMenu from "../components/PopoverMenu";
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
  const [templateNotice, setTemplateNotice] = useState("");

  // Filters (read folder from URL params)
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [folderFilter, setFolderFilter] = useState<string>(searchParams.get("folder") ?? "ALL");
  const [sortBy, setSortBy] = useState<SortOption>("updatedAt");

  // Folder assignment dialog (opened from the card kebab menu)
  const [assigningFolderId, setAssigningFolderId] = useState<string | null>(null);
  const assignRef = useRef<HTMLDivElement>(null);
  const assignReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  function openFolderDialog(formId: string) {
    assignReturnFocusRef.current = document.activeElement as HTMLElement | null;
    setAssigningFolderId(formId);
  }

  function closeFolderDialog() {
    setAssigningFolderId(null);
    assignReturnFocusRef.current?.focus();
  }

  // Folder dialog: focus first option, close on Escape or outside pointer down
  useEffect(() => {
    if (!assigningFolderId) return;
    assignRef.current?.querySelector<HTMLElement>("button")?.focus();
    function handlePointer(e: PointerEvent) {
      if (assignRef.current && !assignRef.current.contains(e.target as Node)) {
        closeFolderDialog();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeFolderDialog();
    }
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [assigningFolderId]);

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

  // Save a form as a reusable custom template. Unlike duplicate (which inserts a
  // visible card), this produces no visible change on the dashboard, so success
  // needs an explicit, transient confirmation via the shared banner area.
  async function saveAsTemplate(formId: string, formTitle: string) {
    const name = window.prompt("Template name", formTitle);
    if (name === null) return; // cancelled — no request, no message.

    try {
      await api.post(`/api/forms/${formId}/save-as-template`, { name: name.trim() });
      setError("");
      setTemplateNotice(`Saved "${name.trim()}" as a template.`);
      window.setTimeout(() => setTemplateNotice(""), 4000);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to save template.");
    }
  }

  async function moveToFolder(formId: string, folderId: string | null) {
    try {
      await api.patch(`/api/folders/move-form/${formId}`, { folderId });
      setForms((current) =>
        current.map((f) => f.id === formId ? { ...f, folderId } : f),
      );
      closeFolderDialog();
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

      {templateNotice ? (
        <section className="status-card" style={{ maxWidth: 1180, margin: "0 auto 20px" }} role="status">
          <p>{templateNotice}</p>
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
                <span className="muted form-tile-counts">
                  {questionCount}Q
                  {form.responseCount !== undefined ? ` \u00B7 ${form.responseCount}R` : ""}
                </span>
                {folderName ? (
                  <span className="form-tile-badge" title="Folder">{"\uD83D\uDCC1"} {folderName}</span>
                ) : null}
                {eventName ? (
                  <span className="form-tile-badge" title="Event">{"\uD83C\uDFAA"} {eventName}</span>
                ) : null}
              </div>

              <h2>
                <Link className="form-tile-link" to={`/forms/${form.id}/edit`}>{form.title}</Link>
              </h2>

              {form.description ? <p className="form-tile-description">{form.description}</p> : null}

              <p className="muted form-tile-date">
                Updated {new Date(form.updatedAt).toLocaleDateString()}
              </p>

              <div className="form-tile-actions">
                <Link
                  className="form-tile-icon-button"
                  to={`/forms/${form.id}/responses`}
                  aria-label={`Responses for ${form.title}`}
                  title="Responses"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 3v18h18" />
                    <path d="M8 16v-5M13 16V7M18 16v-8" />
                  </svg>
                </Link>
                <Link
                  className="form-tile-icon-button"
                  to={`/forms/${form.id}/share`}
                  aria-label={`Share ${form.title}`}
                  title="Share"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                  </svg>
                </Link>
                <span className="form-tile-menu">
                  <PopoverMenu
                    label={`More actions for ${form.title}`}
                    triggerClassName="form-tile-icon-button"
                    trigger={
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                        <circle cx="12" cy="5" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="12" cy="19" r="1.8" />
                      </svg>
                    }
                    items={[
                      { id: "edit", label: "Edit", href: `/forms/${form.id}/edit` },
                      {
                        id: "open",
                        label: "Open public form",
                        href: `/f/${form.slug}`,
                        external: true,
                        hidden: form.status !== "PUBLISHED",
                      },
                      { id: "duplicate", label: "Duplicate", onSelect: () => void duplicateForm(form.id) },
                      {
                        id: "move",
                        label: "Move to folder",
                        hidden: folders.length === 0,
                        onSelect: () => openFolderDialog(form.id),
                      },
                      {
                        id: "template",
                        label: "Save as template",
                        onSelect: () => void saveAsTemplate(form.id, form.title),
                      },
                    ]}
                  />
                </span>
              </div>
            </article>
          );
        })}
      </section>
      {assigningFolderId ? (
        <div className="folder-dialog-backdrop">
          <div ref={assignRef} className="folder-dialog" role="dialog" aria-modal="true" aria-label="Move to folder">
            <p className="folder-dialog-title">Move to folder</p>
            {(() => {
              const target = forms.find((f) => f.id === assigningFolderId);
              return (
                <>
                  <button
                    type="button"
                    className={`folder-dialog-option${!target?.folderId ? " is-current" : ""}`}
                    aria-current={!target?.folderId ? "true" : undefined}
                    onClick={() => void moveToFolder(assigningFolderId, null)}
                  >
                    No folder
                  </button>
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className={`folder-dialog-option${target?.folderId === folder.id ? " is-current" : ""}`}
                      aria-current={target?.folderId === folder.id ? "true" : undefined}
                      onClick={() => void moveToFolder(assigningFolderId, folder.id)}
                    >
                      {"\uD83D\uDCC1"} {folder.name}
                    </button>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </main>
  );
}
