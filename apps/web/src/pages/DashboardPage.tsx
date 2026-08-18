import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import type { FormRecord, WorkspaceRecord } from "../types";

type SortOption = "updatedAt" | "createdAt" | "title";
type StatusFilter = "ALL" | "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "CLOSED" | "ARCHIVED";

export default function DashboardPage() {
  const navigate = useNavigate();

  const [forms, setForms] = useState<FormRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("updatedAt");
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const wsData = await api.get<{ workspaces: WorkspaceRecord[] }>(
          "/api/workspaces",
        );

        const workspaceId =
          wsData.workspaces.find((w) => w.type === "PERSONAL")?.id ??
          wsData.workspaces[0]?.id;

        if (!workspaceId) {
          throw new Error("No workspace found.");
        }

        const formsData = await api.get<{ forms: FormRecord[] }>(
          `/api/forms?workspaceId=${encodeURIComponent(workspaceId)}`,
        );

        setForms(formsData.forms);

        // Fetch unread notification count
        try {
          const notifData = await api.get<{ count: number }>(
            "/api/notifications/unread-count",
          );
          setUnreadCount(notifData.count);
        } catch {
          // Non-critical
        }
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : "Unable to load dashboard.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadDashboard();
  }, []);

  async function duplicateForm(formId: string) {
    try {
      const data = await api.post<{ form: FormRecord }>(
        `/api/forms/${formId}/duplicate`,
      );
      setForms((current) => [data.form, ...current]);
    } catch {
      // Silently fail
    }
  }

  // Apply search, filter, sort
  const filteredForms = useMemo(() => {
    let result = [...forms];

    // Status filter
    if (statusFilter !== "ALL") {
      result = result.filter((f) => f.status === statusFilter);
    }

    // Search
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (f) =>
          f.title.toLowerCase().includes(query) ||
          (f.description ?? "").toLowerCase().includes(query),
      );
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === "title") {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === "createdAt") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return result;
  }, [forms, search, statusFilter, sortBy]);

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading dashboard...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Your forms</h1>
          <p className="muted">Create and manage your Qivo forms.</p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            className="secondary-button"
            to="/notifications"
            style={{ position: "relative" }}
          >
            Notifications
            {unreadCount > 0 ? (
              <span
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#ef4444",
                  color: "#fff",
                  fontSize: "0.7rem",
                  fontWeight: 800,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </Link>
          <Link className="secondary-button" to="/folders">
            Folders
          </Link>
          <Link className="secondary-button" to="/team">
            Team
          </Link>
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
        <section className="status-card error-card">
          <h2>Unable to load dashboard</h2>
          <p>{error}</p>
          <Link className="primary-link" to="/login">
            Return to login
          </Link>
        </section>
      ) : null}

      {/* Search, filter, sort bar */}
      {!error ? (
        <section
          style={{
            display: "flex",
            gap: 12,
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
            style={{
              flex: 1,
              minWidth: 200,
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "10px 14px",
              background: "#fff",
            }}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "10px 12px",
              background: "#fff",
            }}
          >
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING_REVIEW">Pending review</option>
            <option value="PUBLISHED">Published</option>
            <option value="CLOSED">Closed</option>
            <option value="ARCHIVED">Archived</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "10px 12px",
              background: "#fff",
            }}
          >
            <option value="updatedAt">Recently updated</option>
            <option value="createdAt">Recently created</option>
            <option value="title">Name (A–Z)</option>
          </select>

          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {filteredForms.length} form{filteredForms.length === 1 ? "" : "s"}
          </span>
        </section>
      ) : null}

      {!error && filteredForms.length === 0 && forms.length === 0 ? (
        <section className="empty-dashboard">
          <p className="eyebrow">No forms yet</p>
          <h2>Create your first form.</h2>
          <p className="muted">
            Start with a title and add questions from the editor.
          </p>
        </section>
      ) : null}

      {!error && filteredForms.length === 0 && forms.length > 0 ? (
        <section className="empty-dashboard">
          <p className="eyebrow">No matches</p>
          <h2>No forms match your filters.</h2>
          <p className="muted">Try adjusting your search or status filter.</p>
        </section>
      ) : null}

      <section className="forms-grid">
        {filteredForms.map((form) => {
          const questionCount =
            form.schema?.sections?.reduce(
              (total, section) => total + section.questions.length,
              0,
            ) ?? 0;

          return (
            <article className="form-tile" key={form.id}>
              <div className="form-tile-top">
                <span
                  className={`status-pill status-${form.status.toLowerCase()}`}
                >
                  {form.status.replace(/_/g, " ")}
                </span>
                <span className="muted">
                  {questionCount} question{questionCount === 1 ? "" : "s"}
                </span>
              </div>

              <h2>{form.title}</h2>

              <p className="form-tile-description">
                {form.description || "No description provided."}
              </p>

              <p className="muted">
                Updated {new Date(form.updatedAt).toLocaleDateString()}
              </p>

              <div className="form-tile-actions">
                <Link className="secondary-link" to={`/forms/${form.id}/edit`}>
                  Edit
                </Link>
                <Link
                  className="secondary-link"
                  to={`/forms/${form.id}/responses`}
                >
                  Responses
                </Link>
                <Link
                  className="secondary-link"
                  to={`/forms/${form.id}/share`}
                >
                  Share / QR
                </Link>
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
                    Open form
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
