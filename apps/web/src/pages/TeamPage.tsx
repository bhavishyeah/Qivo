import { useEffect, useState, type FormEvent } from "react";
import { api, ApiRequestError } from "../lib/api";
import type { WorkspaceRecord } from "../types";

type Member = {
  id: string;
  role: string;
  joinedAt: string;
  user: { id: string; name: string; email: string; avatarUrl?: string | null };
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  ADMIN: "Can manage forms, invite members, and approve content.",
  EDITOR: "Can create and edit forms, view responses.",
  VIEWER: "Can view forms and responses but cannot edit.",
};

const ROLE_COLORS: Record<string, string> = {
  OWNER: "#1d4ed8",
  ADMIN: "#7c3aed",
  EDITOR: "#0891b2",
  VIEWER: "#64748b",
};

export default function TeamPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("");
  const [selectedWsData, setSelectedWsData] = useState<WorkspaceRecord | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Invite
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "EDITOR" | "VIEWER">("EDITOR");
  const [inviting, setInviting] = useState(false);

  // Create workspace
  const [showCreateWs, setShowCreateWs] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);

  // Rename workspace
  const [showRename, setShowRename] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const wsData = await api.get<{ workspaces: WorkspaceRecord[] }>("/api/workspaces");
      setWorkspaces(wsData.workspaces);

      const teamWs = wsData.workspaces.find((w) => w.type === "TEAM");
      const defaultWs = teamWs ?? wsData.workspaces[0];
      if (defaultWs) {
        setSelectedWorkspace(defaultWs.id);
        setSelectedWsData(defaultWs);
        await loadMembers(defaultWs.id);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers(workspaceId: string) {
    try {
      const data = await api.get<{ members: Member[] }>(
        `/api/members?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      setMembers(data.members);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load members.");
    }
  }

  async function handleWorkspaceChange(wsId: string) {
    setSelectedWorkspace(wsId);
    const ws = workspaces.find((w) => w.id === wsId) ?? null;
    setSelectedWsData(ws);
    setError("");
    setMessage("");
    await loadMembers(wsId);
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inviteEmail.trim() || !selectedWorkspace) return;
    setInviting(true);
    setError("");
    setMessage("");
    try {
      await api.post(
        `/api/members/invite?workspaceId=${encodeURIComponent(selectedWorkspace)}`,
        { email: inviteEmail.trim().toLowerCase(), role: inviteRole },
      );
      setMessage(`Invited ${inviteEmail} as ${inviteRole}. They can now log in and access this workspace.`);
      setInviteEmail("");
      await loadMembers(selectedWorkspace);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to invite member.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string, memberName: string) {
    if (!selectedWorkspace) return;
    if (!confirm(`Remove ${memberName} from this workspace?`)) return;
    setError("");
    setMessage("");
    try {
      await api.delete(`/api/members/${memberId}?workspaceId=${encodeURIComponent(selectedWorkspace)}`);
      setMessage(`${memberName} removed.`);
      await loadMembers(selectedWorkspace);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to remove member.");
    }
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    if (!selectedWorkspace) return;
    setError("");
    setMessage("");
    try {
      await api.patch(
        `/api/members/${memberId}/role?workspaceId=${encodeURIComponent(selectedWorkspace)}`,
        { role: newRole },
      );
      setMessage("Role updated.");
      await loadMembers(selectedWorkspace);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to update role.");
    }
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newWsName.trim()) return;
    setCreatingWs(true);
    setError("");
    setMessage("");
    try {
      const data = await api.post<{ workspace: WorkspaceRecord }>("/api/workspaces", {
        name: newWsName.trim(),
      });
      const newWs = data.workspace;
      setWorkspaces((current) => [...current, newWs]);
      setSelectedWorkspace(newWs.id);
      setSelectedWsData(newWs);
      setNewWsName("");
      setShowCreateWs(false);
      setMessage(`Workspace "${newWs.name}" created.`);
      await loadMembers(newWs.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to create workspace.");
    } finally {
      setCreatingWs(false);
    }
  }

  async function handleRenameWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameName.trim() || !selectedWorkspace) return;
    setRenaming(true);
    setError("");
    setMessage("");
    try {
      const data = await api.patch<{ workspace: WorkspaceRecord }>(
        `/api/workspaces/${selectedWorkspace}`,
        { name: renameName.trim() },
      );
      setWorkspaces((current) =>
        current.map((w) => w.id === selectedWorkspace ? { ...w, name: data.workspace.name } : w),
      );
      setSelectedWsData((prev) => prev ? { ...prev, name: data.workspace.name } : prev);
      setShowRename(false);
      setRenameName("");
      setMessage(`Workspace renamed to "${data.workspace.name}".`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to rename workspace.");
    } finally {
      setRenaming(false);
    }
  }

  if (loading) {
    return (
      <main className="dashboard-shell">
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          {[1, 2].map((i) => (
            <div key={i} className="editor-card" style={{ marginBottom: 16 }}>
              <div className="skeleton-block" style={{ width: "40%", height: 24, marginBottom: 12 }} />
              <div className="skeleton-block" style={{ width: "60%", height: 16 }} />
            </div>
          ))}
        </div>
      </main>
    );
  }

  const currentUserRole = members.find((m) => selectedWsData?.role === m.role)?.role ?? selectedWsData?.role ?? "";
  const canManage = currentUserRole === "OWNER" || currentUserRole === "ADMIN";

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Team</p>
          <h1>
            {selectedWsData?.name ?? "Workspace"}
            <span
              className="status-pill"
              style={{
                marginLeft: 12,
                verticalAlign: "middle",
                background: "#f1f5f9",
                color: "#64748b",
                fontSize: "0.65rem",
              }}
            >
              {selectedWsData?.type}
            </span>
          </h1>
          <p className="muted">
            {members.length} member{members.length !== 1 ? "s" : ""} · Your role:{" "}
            <strong style={{ color: ROLE_COLORS[selectedWsData?.role ?? ""] ?? "#64748b" }}>
              {selectedWsData?.role}
            </strong>
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {canManage && selectedWsData?.type === "TEAM" ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => { setShowRename(true); setRenameName(selectedWsData?.name ?? ""); }}
            >
              Rename
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            style={{ background: "#2563eb", color: "#fff", border: "none" }}
            onClick={() => setShowCreateWs((v) => !v)}
          >
            {showCreateWs ? "Cancel" : "+ New workspace"}
          </button>
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

      {/* Workspace switcher */}
      {workspaces.length > 1 ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 20px" }}>
          <div className="editor-card-header">
            <div><p className="eyebrow">Switch</p><h2>Your workspaces</h2></div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => void handleWorkspaceChange(ws.id)}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: ws.id === selectedWorkspace ? "2px solid #2563eb" : "1px solid #e2e8f0",
                  background: ws.id === selectedWorkspace ? "#eff6ff" : "#f8fafc",
                  color: ws.id === selectedWorkspace ? "#1d4ed8" : "#475569",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.88rem",
                }}
              >
                {ws.name}
                <span style={{ marginLeft: 8, fontSize: "0.72rem", opacity: 0.7 }}>
                  {ws.type} · {ws.role}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Create workspace */}
      {showCreateWs ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 20px", background: "#eff6ff", border: "1px solid #bfdbfe" }}>
          <div className="editor-card-header">
            <div><p className="eyebrow">New team workspace</p><h2>Create workspace</h2></div>
          </div>
          <form onSubmit={handleCreateWorkspace} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: "block", marginBottom: 7, fontWeight: 750, fontSize: "0.86rem" }}>Workspace name</label>
              <input
                type="text"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="e.g. ITM Events Team"
                required
                autoFocus
                style={{ width: "100%", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 12px" }}
              />
            </div>
            <button className="secondary-button" type="submit" disabled={creatingWs || !newWsName.trim()}>
              {creatingWs ? "Creating..." : "Create"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Rename workspace */}
      {showRename ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 20px" }}>
          <div className="editor-card-header">
            <div><p className="eyebrow">Rename</p><h2>Rename workspace</h2></div>
            <button className="back-button inline-button" type="button" onClick={() => setShowRename(false)}>Cancel</button>
          </div>
          <form onSubmit={handleRenameWorkspace} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <input
                type="text"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                required
                autoFocus
                style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }}
              />
            </div>
            <button className="secondary-button" type="submit" disabled={renaming || !renameName.trim()}>
              {renaming ? "Saving..." : "Save"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Invite form */}
      {canManage ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 20px" }}>
          <div className="editor-card-header">
            <div><p className="eyebrow">Invite</p><h2>Add a member</h2></div>
          </div>
          <p className="muted" style={{ marginBottom: 16, fontSize: "0.88rem" }}>
            The person must already have a Qivo account. They'll get access immediately.
          </p>
          <form onSubmit={handleInvite} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="invite-email" style={{ display: "block", marginBottom: 7, fontWeight: 750, fontSize: "0.86rem" }}>Email address</label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                required
                style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }}
              />
            </div>
            <div>
              <label htmlFor="invite-role" style={{ display: "block", marginBottom: 7, fontWeight: 750, fontSize: "0.86rem" }}>Role</label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "ADMIN" | "EDITOR" | "VIEWER")}
                style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }}
              >
                <option value="ADMIN">Admin</option>
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "#94a3b8", maxWidth: 240 }}>
                {ROLE_DESCRIPTIONS[inviteRole]}
              </p>
            </div>
            <button className="secondary-button" type="submit" disabled={inviting || !inviteEmail.trim()}>
              {inviting ? "Inviting..." : "Invite"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Members list */}
      <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto" }}>
        <div className="editor-card-header">
          <div><p className="eyebrow">Members</p><h2>{members.length} members</h2></div>
        </div>

        {members.length === 0 ? (
          <p className="muted" style={{ padding: "16px 0" }}>No members yet.</p>
        ) : (
          <div className="team-member-list">
            {members.map((member) => (
              <div key={member.id} className="team-member-row">
                {/* Avatar */}
                <div className="team-member-avatar">
                  {member.user.name.slice(0, 1).toUpperCase()}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ color: "#111827", display: "block" }}>{member.user.name}</strong>
                  <span style={{ color: "#64748b", fontSize: "0.84rem" }}>{member.user.email}</span>
                  <span style={{ color: "#94a3b8", fontSize: "0.76rem", display: "block", marginTop: 2 }}>
                    Joined {new Date(member.joinedAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Role + actions */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  {member.role === "OWNER" ? (
                    <span
                      className="status-pill"
                      style={{ background: "#dbeafe", color: ROLE_COLORS["OWNER"] }}
                    >
                      OWNER
                    </span>
                  ) : canManage ? (
                    <>
                      <select
                        value={member.role}
                        onChange={(e) => void handleRoleChange(member.id, e.target.value)}
                        style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", fontSize: "0.85rem", background: "#f8fafc" }}
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="EDITOR">Editor</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => void handleRemove(member.id, member.user.name)}
                        style={{ fontSize: "0.8rem", padding: "6px 10px" }}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span
                      className="status-pill"
                      style={{ color: ROLE_COLORS[member.role] ?? "#64748b", background: "#f1f5f9" }}
                    >
                      {member.role}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
