import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import { answerableQuestions } from "../lib/questionKinds";
import PopoverMenu from "../components/PopoverMenu";
import Tooltip from "../components/Tooltip";
import { EmptyState, ErrorState, SkeletonTile } from "../components/States";
import { useToast } from "../components/Toast";
import { folderTone } from "../lib/folderTone";
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
  const toast = useToast();

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

  function retryLoad() {
    setError("");
    setLoading(true);
    void loadDashboard(activeWorkspaceId || undefined);
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
      toast.show(`Saved "${name.trim()}" as a template.`);
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
        <div className="dashboard-header" aria-busy="true">
          <div className="skeleton-line skeleton-line-lg" style={{ width: 200, height: 36 }} />
          <div className="skeleton-line" style={{ width: 110, height: 36 }} />
        </div>
        <div className="dash-layout">
          <div className="dash-grid" style={{ gridColumn: "1 / -1" }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <SkeletonTile key={i} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  const hasFolders = folders.length > 0;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="dash-kicker">
            {workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? "Workspace"}
          </p>
          <h1>Your forms</h1>
          <p className="dash-count">
            {forms.length} form{forms.length !== 1 ? "s" : ""}
            {folders.length > 0 ? ` \u00B7 ${folders.length} folder${folders.length !== 1 ? "s" : ""}` : ""}
          </p>
        </div>

        <div className="dash-header-actions">
          {/* Workspace switcher */}
          {workspaces.length > 1 ? (
            <select
              className="dash-select"
              aria-label="Workspace"
              value={activeWorkspaceId}
              onChange={(e) => void switchWorkspace(e.target.value)}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
          ) : null}

          <button className="btn btn-primary" type="button" onClick={() => navigate("/forms/new")}>
            + New form
          </button>
        </div>
      </header>

      {error ? (
        <div style={{ maxWidth: "var(--container)", margin: "0 auto var(--space-4)" }}>
          <ErrorState title="Unable to load dashboard" message={error} onRetry={retryLoad} />
        </div>
      ) : null}

      <div className="dash-layout">
        {hasFolders ? (
          <nav className="folder-rail" aria-label="Folders">
            <p className="folder-rail-title">Folders</p>
            <button type="button" className="folder-rail-item" aria-current={folderFilter === "ALL" ? "true" : undefined} onClick={() => setFolderFilter("ALL")}>
              <span className="folder-dot folder-dot-none" aria-hidden="true" />
              <span>All forms</span>
            </button>
            <button type="button" className="folder-rail-item" aria-current={folderFilter === "NONE" ? "true" : undefined} onClick={() => setFolderFilter("NONE")}>
              <span className="folder-dot folder-dot-none" aria-hidden="true" />
              <span>No folder</span>
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                className="folder-rail-item"
                aria-current={folderFilter === f.id ? "true" : undefined}
                onClick={() => setFolderFilter(f.id)}
              >
                <span className={`folder-dot folder-dot-${folderTone(f.id)}`} aria-hidden="true" />
                <span>{f.name}</span>
              </button>
            ))}
          </nav>
        ) : null}

        <div style={hasFolders ? undefined : { gridColumn: "1 / -1" }}>
          {/* Filter bar */}
          <section className="dash-filters" aria-label="Filters">
            <div className="dash-search">
              <input
                className="dash-input"
                type="search"
                aria-label="Search forms"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search forms..."
              />
            </div>

            <select
              className="dash-select"
              aria-label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="ALL">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_REVIEW">Pending review</option>
              <option value="PUBLISHED">Published</option>
              <option value="CLOSED">Closed</option>
              <option value="ARCHIVED">Archived</option>
            </select>

            <select
              className="dash-select"
              aria-label="Sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
            >
              <option value="updatedAt">Recently updated</option>
              <option value="createdAt">Recently created</option>
              <option value="title">Name (A{"\u2013"}Z)</option>
            </select>

            <span className="dash-count" style={{ margin: 0, whiteSpace: "nowrap" }}>
              {filteredForms.length} form{filteredForms.length !== 1 ? "s" : ""}
            </span>
          </section>

          {/* Empty states */}
          {!error && forms.length === 0 ? (
            <EmptyState
              art
              title="Create your first form"
              body="Start with a title, add questions in the editor, then share the link."
              action={
                <button className="btn btn-primary btn-lg" type="button" onClick={() => navigate("/forms/new")}>
                  + New form
                </button>
              }
            />
          ) : null}

          {!error && forms.length > 0 && filteredForms.length === 0 ? (
            <EmptyState title="No forms match your filters" body="Try adjusting your search or filters." />
          ) : null}

          {/* Forms grid */}
          <section className="dash-grid" aria-label="Forms">
            {filteredForms.map((form) => {
              const questionCount =
                form.schema?.sections?.reduce(
                  (total, s) => total + answerableQuestions(s.questions).length,
                  0,
                ) ?? 0;

              const folderName = form.folderId
                ? folders.find((f) => f.id === form.folderId)?.name ?? null
                : null;

              const eventName = form.eventId
                ? events.find((e) => e.id === form.eventId)?.name ?? null
                : null;

              const statusKey = form.status.toLowerCase();

              return (
                <article className={`form-card form-card-${statusKey}`} key={form.id}>
                  <div className="form-card-meta">
                    <span className={`badge badge-status-${statusKey === "pending_review" ? "pending" : statusKey}`}>
                      {form.status.replace(/_/g, " ")}
                    </span>
                    {folderName ? <span className="badge badge-tag" title="Folder">{folderName}</span> : null}
                    {eventName ? <span className="badge badge-tag" title="Event">{eventName}</span> : null}
                    <span className="form-card-counts">
                      {questionCount}Q
                      {form.responseCount !== undefined ? ` \u00B7 ${form.responseCount}R` : ""}
                    </span>
                  </div>

                  <h2 className="form-card-title">
                    <Link className="form-card-link" to={`/forms/${form.id}/edit`}>{form.title}</Link>
                  </h2>

                  {form.description ? <p className="form-card-desc">{form.description}</p> : null}

                  <div className="form-card-foot">
                    <p className="form-card-date">
                      Updated {new Date(form.updatedAt).toLocaleDateString()}
                    </p>
                    <Tooltip text="Responses">
                      <Link
                        className="form-card-icon"
                        to={`/forms/${form.id}/responses`}
                        aria-label={`Responses for ${form.title}`}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 3v18h18" />
                          <path d="M8 16v-5M13 16V7M18 16v-8" />
                        </svg>
                      </Link>
                    </Tooltip>
                    <Tooltip text="Share">
                      <Link
                        className="form-card-icon"
                        to={`/forms/${form.id}/share`}
                        aria-label={`Share ${form.title}`}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="18" cy="5" r="3" />
                          <circle cx="6" cy="12" r="3" />
                          <circle cx="18" cy="19" r="3" />
                          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                        </svg>
                      </Link>
                    </Tooltip>
                    <span className="form-card-menu">
                      <PopoverMenu
                        label={`More actions for ${form.title}`}
                        triggerClassName="form-card-icon"
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
        </div>
      </div>      {assigningFolderId ? (
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
                      <span className={`folder-dot folder-dot-${folderTone(folder.id)}`} aria-hidden="true" /> {folder.name}
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
