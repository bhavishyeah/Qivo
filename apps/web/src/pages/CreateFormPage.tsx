import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import type { FormRecord, WorkspaceRecord } from "../types";

type TemplateInfo = {
  id: string;
  name: string;
  description: string;
  category: string;
  questionCount: number;
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
        const [wsData, templateData] = await Promise.all([
          api.get<{ workspaces: WorkspaceRecord[] }>("/api/workspaces"),
          api.get<{ templates: TemplateInfo[] }>("/api/forms/templates"),
        ]);

        setWorkspaces(wsData.workspaces);
        setTemplates(templateData.templates);

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
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.description} ({t.questionCount} questions)
                  </option>
                ))}
              </select>
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
