import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import type { FormRecord, WorkspaceRecord } from "../types";

type TemplateInfo = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  questionCount: number;
  custom: boolean;
};

export default function CreateFormPage() {
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadWorkspaces() {
      try {
        const wsData = await api.get<{ workspaces: WorkspaceRecord[] }>(
          "/api/workspaces",
        );

        setWorkspaces(wsData.workspaces);

        const personal = wsData.workspaces.find((w) => w.type === "PERSONAL");
        if (personal) {
          setWorkspaceId(personal.id);
        } else if (wsData.workspaces.length > 0) {
          setWorkspaceId(wsData.workspaces[0].id);
        }
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : "Unable to load workspaces.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadWorkspaces();
  }, []);

  // Templates are workspace-aware (built-ins + the workspace's custom
  // templates), so the fetch is keyed on workspaceId. Guard against the empty
  // first-render id, which would 400 with INVALID_WORKSPACE_ID.
  useEffect(() => {
    if (!workspaceId) return;

    async function loadTemplates(wsId: string) {
      try {
        const data = await api.get<{ templates: TemplateInfo[] }>(
          `/api/forms/templates?workspaceId=${encodeURIComponent(wsId)}`,
        );
        setTemplates(data.templates);
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : "Unable to load templates.",
        );
      }
    }

    void loadTemplates(workspaceId);
  }, [workspaceId]);

  async function handleDeleteTemplate(templateId: string) {
    try {
      await api.delete(`/api/forms/templates/${encodeURIComponent(templateId)}`);
      setTemplates((current) => current.filter((t) => t.id !== templateId));
      setSelectedTemplate((current) => (current === templateId ? "" : current));
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to delete template.",
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || !workspaceId) return;

    setCreating(true);
    setError("");

    try {
      const endpoint = selectedTemplate
        ? "/api/forms/from-template"
        : "/api/forms";

      const payload = {
        workspaceId,
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(selectedTemplate ? { templateId: selectedTemplate } : {}),
      };

      const data = await api.post<{ form: FormRecord }>(endpoint, payload);

      navigate(`/forms/${data.form.id}/edit`);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to create form.",
      );
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading...</p>
        </div>
      </main>
    );
  }

  const builtInTemplates = templates.filter((t) => !t.custom);
  const customTemplates = templates.filter((t) => t.custom);

  return (
    <main className="page-shell">
      <section className="auth-card">
        <p className="eyebrow">New form</p>

        <h1>Create a form</h1>

        <p className="muted">Give your form a title and start adding questions.</p>

        <form onSubmit={handleSubmit} noValidate>
          {workspaces.length > 1 ? (
            <div className="question-field">
              <label htmlFor="create-workspace">Workspace</label>
              <select
                id="create-workspace"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: 12,
                  padding: "13px 14px",
                  background: "#ffffff",
                }}
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="question-field">
            <label htmlFor="create-title">Form title</label>
            <input
              id="create-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Orientation Feedback"
              required
              autoFocus
            />
          </div>

          <div className="question-field">
            <label htmlFor="create-description">
              Description <span className="muted">(optional)</span>
            </label>
            <textarea
              id="create-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this form for?"
              rows={3}
            />
          </div>

          {error ? (
            <p className="submit-error" role="alert">
              {error}
            </p>
          ) : null}

          {/* Template picker */}
          {templates.length > 0 ? (
            <div className="question-field">
              <label htmlFor="template-select">
                Start from a template <span className="muted">(optional)</span>
              </label>
              <select
                id="template-select"
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: 12,
                  padding: "13px 14px",
                  background: "#ffffff",
                }}
              >
                <option value="">Blank form</option>
                {builtInTemplates.length > 0 ? (
                  <optgroup label="Templates">
                    {builtInTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.description} ({t.questionCount} questions)
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {customTemplates.length > 0 ? (
                  <optgroup label="Your workspace templates">
                    {customTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.description ? ` — ${t.description}` : ""} ({t.questionCount} questions)
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
          ) : null}

          {/* Manage custom templates: lightweight delete list */}
          {customTemplates.length > 0 ? (
            <div className="question-field">
              <label>Your workspace templates</label>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {customTemplates.map((t) => (
                  <li
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "8px 12px",
                    }}
                  >
                    <span style={{ fontSize: "0.9rem" }}>
                      {t.name}{" "}
                      <span className="muted">({t.questionCount} questions)</span>
                    </span>
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => void handleDeleteTemplate(t.id)}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <button
            className="submit-button"
            type="submit"
            disabled={creating || !title.trim()}
          >
            {creating ? "Creating..." : "Create form"}
          </button>
        </form>
      </section>
    </main>
  );
}
