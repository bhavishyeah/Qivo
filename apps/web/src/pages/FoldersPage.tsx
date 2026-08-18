import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import type { WorkspaceRecord } from "../types";

type FolderRecord = {
  id: string;
  name: string;
  parentId: string | null;
  workspaceId: string;
  createdAt: string;
  _count: { forms: number };
};

export default function FoldersPage() {
  const navigate = useNavigate();

  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Create folder state
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const wsData = await api.get<{ workspaces: WorkspaceRecord[] }>(
          "/api/workspaces",
        );
        const ws =
          wsData.workspaces.find((w) => w.type === "PERSONAL") ??
          wsData.workspaces[0];

        if (!ws) {
          setError("No workspace found.");
          setLoading(false);
          return;
        }

        setWorkspaceId(ws.id);
        await loadFolders(ws.id);
      } catch (err) {
        setError(
          err instanceof ApiRequestError ? err.message : "Unable to load.",
        );
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function loadFolders(wsId: string) {
    const data = await api.get<{ folders: FolderRecord[] }>(
      `/api/folders?workspaceId=${encodeURIComponent(wsId)}`,
    );
    setFolders(data.folders);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newFolderName.trim() || !workspaceId) return;

    setCreating(true);
    setError("");
    setMessage("");

    try {
      await api.post("/api/folders", {
        workspaceId,
        name: newFolderName.trim(),
      });
      setNewFolderName("");
      setMessage("Folder created.");
      await loadFolders(workspaceId);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to create folder.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(folderId: string) {
    if (!renameValue.trim()) return;
    setError("");
    setMessage("");

    try {
      await api.patch(`/api/folders/${folderId}`, { name: renameValue.trim() });
      setRenamingId(null);
      setRenameValue("");
      setMessage("Folder renamed.");
      await loadFolders(workspaceId);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to rename folder.",
      );
    }
  }

  async function handleDelete(folderId: string) {
    setError("");
    setMessage("");

    try {
      await api.delete(`/api/folders/${folderId}`);
      setMessage("Folder deleted. Forms moved to root.");
      await loadFolders(workspaceId);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to delete folder.",
      );
    }
  }

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading folders...</p>
        </div>
      </main>
    );
  }

  // Build tree structure
  const rootFolders = folders.filter((f) => !f.parentId);
  const childMap = new Map<string, FolderRecord[]>();
  for (const folder of folders) {
    if (folder.parentId) {
      const siblings = childMap.get(folder.parentId) ?? [];
      siblings.push(folder);
      childMap.set(folder.parentId, siblings);
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <button
            className="back-button"
            type="button"
            onClick={() => navigate("/dashboard")}
          >
            ← Dashboard
          </button>
          <p className="eyebrow">Organization</p>
          <h1>Folders</h1>
          <p className="muted">Organize your forms into folders.</p>
        </div>
      </header>

      {message ? (
        <p className="editor-message" role="status" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="submit-error" role="alert" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
          {error}
        </p>
      ) : null}

      {/* Create folder */}
      <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 20px" }}>
        <form
          onSubmit={handleCreate}
          style={{ display: "flex", gap: 12, alignItems: "end" }}
        >
          <div style={{ flex: 1 }}>
            <label
              htmlFor="new-folder-name"
              style={{ display: "block", marginBottom: 7, fontWeight: 750, fontSize: "0.86rem" }}
            >
              New folder
            </label>
            <input
              id="new-folder-name"
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Orientation 2026"
              required
              style={{
                width: "100%",
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            />
          </div>
          <button
            className="secondary-button"
            type="submit"
            disabled={creating || !newFolderName.trim()}
          >
            {creating ? "Creating..." : "Create folder"}
          </button>
        </form>
      </section>

      {/* Folder list */}
      <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto" }}>
        <div className="editor-card-header">
          <div>
            <p className="eyebrow">All folders</p>
            <h2>{folders.length} folders</h2>
          </div>
        </div>

        {folders.length === 0 ? (
          <p className="empty-state">
            No folders yet. Create one to organize your forms.
          </p>
        ) : (
          <div className="editor-question-list">
            {rootFolders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                children={childMap.get(folder.id) ?? []}
                renamingId={renamingId}
                renameValue={renameValue}
                onStartRename={(id, name) => {
                  setRenamingId(id);
                  setRenameValue(name);
                }}
                onRenameChange={setRenameValue}
                onRename={handleRename}
                onCancelRename={() => setRenamingId(null)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function FolderItem({
  folder,
  children,
  renamingId,
  renameValue,
  onStartRename,
  onRenameChange,
  onRename,
  onCancelRename,
  onDelete,
}: {
  folder: FolderRecord;
  children: FolderRecord[];
  renamingId: string | null;
  renameValue: string;
  onStartRename: (id: string, name: string) => void;
  onRenameChange: (value: string) => void;
  onRename: (id: string) => void;
  onCancelRename: () => void;
  onDelete: (id: string) => void;
}) {
  const isRenaming = renamingId === folder.id;

  return (
    <div>
      <article
        className="editor-question"
        style={{ gridTemplateColumns: "1fr auto" }}
      >
        <div>
          {isRenaming ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => onRenameChange(e.target.value)}
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  padding: "6px 10px",
                }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onRename(folder.id);
                  if (e.key === "Escape") onCancelRename();
                }}
              />
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => void onRename(folder.id)}
              >
                Save
              </button>
              <button
                className="back-button inline-button"
                type="button"
                onClick={onCancelRename}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <strong style={{ color: "#111827" }}>📁 {folder.name}</strong>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.82rem" }}>
                {folder._count.forms} form{folder._count.forms === 1 ? "" : "s"}
              </p>
            </>
          )}
        </div>

        {!isRenaming ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => onStartRename(folder.id, folder.name)}
            >
              Rename
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={() => void onDelete(folder.id)}
              style={{ fontSize: "0.82rem" }}
            >
              Delete
            </button>
          </div>
        ) : null}
      </article>

      {children.length > 0 ? (
        <div style={{ marginLeft: 28 }}>
          {children.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              children={[]}
              renamingId={renamingId}
              renameValue={renameValue}
              onStartRename={onStartRename}
              onRenameChange={onRenameChange}
              onRename={onRename}
              onCancelRename={onCancelRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
