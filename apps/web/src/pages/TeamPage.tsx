import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import type { WorkspaceRecord } from "../types";

type Member = {
  id: string;
  role: string;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
  };
};

export default function TeamPage() {
  const navigate = useNavigate();

  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "EDITOR" | "VIEWER">(
    "EDITOR",
  );
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const wsData = await api.get<{ workspaces: WorkspaceRecord[] }>(
          "/api/workspaces",
        );
        setWorkspaces(wsData.workspaces);

        // Default to first team workspace, or first workspace
        const teamWs = wsData.workspaces.find((w) => w.type === "TEAM");
        const defaultWs = teamWs ?? wsData.workspaces[0];
        if (defaultWs) {
          setSelectedWorkspace(defaultWs.id);
          await loadMembers(defaultWs.id);
        }
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

  async function loadMembers(workspaceId: string) {
    try {
      const data = await api.get<{ members: Member[] }>(
        `/api/members?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      setMembers(data.members);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to load members.",
      );
    }
  }

  async function handleWorkspaceChange(wsId: string) {
    setSelectedWorkspace(wsId);
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
      setMessage(`Invited ${inviteEmail} as ${inviteRole}.`);
      setInviteEmail("");
      await loadMembers(selectedWorkspace);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to invite member.",
      );
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string) {
    if (!selectedWorkspace) return;
    setError("");
    setMessage("");

    try {
      await api.delete(
        `/api/members/${memberId}?workspaceId=${encodeURIComponent(selectedWorkspace)}`,
      );
      setMessage("Member removed.");
      await loadMembers(selectedWorkspace);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to remove member.",
      );
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
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to update role.",
      );
    }
  }

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading team...</p>
        </div>
      </main>
    );
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
          <p className="eyebrow">Team</p>
          <h1>Workspace members</h1>
          <p className="muted">Manage who has access to this workspace.</p>
        </div>
      </header>

      {workspaces.length > 1 ? (
        <div style={{ maxWidth: 980, margin: "0 auto 20px" }}>
          <select
            value={selectedWorkspace}
            onChange={(e) => void handleWorkspaceChange(e.target.value)}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "10px 14px",
              background: "#fff",
            }}
          >
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name} ({ws.type})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {message ? (
        <p
          className="editor-message"
          role="status"
          style={{ maxWidth: 980, margin: "0 auto 18px" }}
        >
          {message}
        </p>
      ) : null}

      {error ? (
        <p
          className="submit-error"
          role="alert"
          style={{ maxWidth: 980, margin: "0 auto 18px" }}
        >
          {error}
        </p>
      ) : null}

      {/* Invite form */}
      <section
        className="editor-card"
        style={{ maxWidth: 980, margin: "0 auto 20px" }}
      >
        <div className="editor-card-header">
          <div>
            <p className="eyebrow">Invite</p>
            <h2>Add a team member</h2>
          </div>
        </div>

        <form
          onSubmit={handleInvite}
          style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <label
              htmlFor="invite-email"
              style={{
                display: "block",
                marginBottom: 7,
                fontWeight: 750,
                fontSize: "0.86rem",
              }}
            >
              Email address
            </label>
            <input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
              required
              style={{
                width: "100%",
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="invite-role"
              style={{
                display: "block",
                marginBottom: 7,
                fontWeight: 750,
                fontSize: "0.86rem",
              }}
            >
              Role
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as "ADMIN" | "EDITOR" | "VIEWER")
              }
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              <option value="ADMIN">Admin</option>
              <option value="EDITOR">Editor</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>

          <button
            className="secondary-button"
            type="submit"
            disabled={inviting || !inviteEmail.trim()}
          >
            {inviting ? "Inviting..." : "Invite"}
          </button>
        </form>
      </section>

      {/* Members list */}
      <section
        className="editor-card"
        style={{ maxWidth: 980, margin: "0 auto" }}
      >
        <div className="editor-card-header">
          <div>
            <p className="eyebrow">Members</p>
            <h2>{members.length} members</h2>
          </div>
        </div>

        <div className="editor-question-list">
          {members.map((member) => (
            <article
              className="editor-question"
              key={member.id}
              style={{ gridTemplateColumns: "1fr auto" }}
            >
              <div>
                <strong style={{ color: "#111827" }}>{member.user.name}</strong>
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  {member.user.email}
                </p>
                <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.78rem" }}>
                  Joined {new Date(member.joinedAt).toLocaleDateString()}
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                {member.role === "OWNER" ? (
                  <span className="status-pill" style={{ background: "#dbeafe", color: "#1d4ed8" }}>
                    OWNER
                  </span>
                ) : (
                  <>
                    <select
                      value={member.role}
                      onChange={(e) =>
                        void handleRoleChange(member.id, e.target.value)
                      }
                      style={{
                        border: "1px solid #cbd5e1",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: "0.85rem",
                      }}
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="EDITOR">Editor</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => void handleRemove(member.id)}
                      style={{ fontSize: "0.82rem" }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
