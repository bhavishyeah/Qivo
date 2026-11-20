import { useEffect, useState, type FormEvent } from "react";
import { api, ApiRequestError } from "../lib/api";
import Select, { type SelectOption } from "../components/Select";
import type { WorkspaceRecord } from "../types";

type Member = {
  id: string;
  role: string;
  joinedAt: string;
  user: { id: string; name: string; email: string; avatarUrl?: string | null };
};

const ROLE_OPTIONS: SelectOption[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "EDITOR", label: "Editor" },
  { value: "VIEWER", label: "Viewer" },
];
const ROLE_DESCRIPTIONS: Record<string, string> = {
  ADMIN: "Can manage forms, invite members, and approve content.",
  EDITOR: "Can create and edit forms, view responses.",
  VIEWER: "Can view forms and responses but cannot edit.",
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

  // Branding
  const [showBranding, setShowBranding] = useState(false);
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [savingBrand, setSavingBrand] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- load is a hoisted function declaration, safe to call from the mount effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        setBrandLogoUrl(defaultWs.logoUrl ?? "");
        setBrandColor(defaultWs.primaryColor ?? "");
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
    setBrandLogoUrl(ws?.logoUrl ?? "");
    setBrandColor(ws?.primaryColor ?? "");
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

  async function handleSaveBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspace) return;
    setSavingBrand(true); setError(""); setMessage("");
    try {
      const nextLogoUrl = brandLogoUrl.trim() || null;
      const nextColor = brandColor.trim() || null;
      await api.patch(`/api/workspaces/${selectedWorkspace}/branding`, {
        logoUrl: nextLogoUrl,
        primaryColor: nextColor,
      });
      // Keep local state in sync so the editor + preview reflect saved values.
      setWorkspaces((current) =>
        current.map((w) =>
          w.id === selectedWorkspace
            ? { ...w, logoUrl: nextLogoUrl, primaryColor: nextColor }
            : w,
        ),
      );
      setSelectedWsData((current) =>
        current && current.id === selectedWorkspace
          ? { ...current, logoUrl: nextLogoUrl, primaryColor: nextColor }
          : current,
      );
      setShowBranding(false);
      setMessage("Branding updated! It will appear on your public forms.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to update branding.");
    } finally {
      setSavingBrand(false);
    }
  }

  if (loading) {
    return (
      <main className="dashboard-shell">
        <div className="page-col" aria-hidden="true">
          {[1, 2].map((i) => (
            <div key={i} className="skeleton-tile" style={{ marginBottom: 16 }}>
              <div className="skeleton-line skeleton-line-lg" style={{ width: "40%" }} />
              <div className="skeleton-line" style={{ width: "60%" }} />
            </div>
          ))}
        </div>
      </main>
    );
  }

  // selectedWsData.role is the CURRENT user's role in this workspace (set by
  // the /workspaces endpoint), so derive permissions from it directly rather
  // than matching a member by role-equality.
  const currentUserRole = selectedWsData?.role ?? "";
  const canManage = currentUserRole === "OWNER" || currentUserRole === "ADMIN";

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="dash-kicker">Team</p>
          <h1>
            {selectedWsData?.name ?? "Workspace"}
            <span className="badge page-title-chip">{selectedWsData?.type}</span>
          </h1>
          <p className="page-sub">
            {members.length} member{members.length !== 1 ? "s" : ""} {"\u00B7"} Your role:{" "}
            <strong>{selectedWsData?.role}</strong>
          </p>
        </div>

        <div className="page-header-actions">
          {canManage && selectedWsData?.type === "TEAM" ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setShowRename(true); setRenameName(selectedWsData?.name ?? ""); }}
            >
              Rename
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowBranding((v) => !v)}
            >
              {showBranding ? "Cancel" : "Branding"}
            </button>
          ) : null}
          <button
            type="button"
            className={`btn ${showCreateWs ? "btn-secondary" : "btn-primary"}`}
            onClick={() => setShowCreateWs((v) => !v)}
          >
            {showCreateWs ? "Cancel" : "+ New workspace"}
          </button>
        </div>
      </header>

      {message ? (
        <p className="msg msg-ok page-col" role="status">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="msg msg-error page-col" role="alert">
          {error}
        </p>
      ) : null}

      {/* Workspace switcher */}
      {workspaces.length > 1 ? (
        <section className="panel page-col">
          <div className="panel-head">
            <div><p className="dash-kicker">Switch</p><h2>Your workspaces</h2></div>
          </div>
          <div className="ws-switch">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                className="ws-chip"
                aria-pressed={ws.id === selectedWorkspace}
                onClick={() => void handleWorkspaceChange(ws.id)}
              >
                {ws.name}
                <small>
                  {ws.type} {"\u00B7"} {ws.role}
                </small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Create workspace */}
      {showCreateWs ? (
        <section className="panel panel-tint page-col">
          <div className="panel-head">
            <div><p className="dash-kicker">New team workspace</p><h2>Create workspace</h2></div>
          </div>
          <form onSubmit={handleCreateWorkspace} className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="new-ws-name">Workspace name</label>
              <input
                id="new-ws-name"
                className="input"
                type="text"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="e.g. ITM Events Team"
                required
                autoFocus
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={creatingWs || !newWsName.trim()}>
              {creatingWs ? "Creating..." : "Create"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Rename workspace */}
      {showRename ? (
        <section className="panel page-col">
          <div className="panel-head">
            <div><p className="dash-kicker">Rename</p><h2>Rename workspace</h2></div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowRename(false)}>Cancel</button>
          </div>
          <form onSubmit={handleRenameWorkspace} className="field-row">
            <div className="field">
              <input
                className="input"
                type="text"
                aria-label="Workspace name"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={renaming || !renameName.trim()}>
              {renaming ? "Saving..." : "Save"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Branding */}
      {showBranding ? (
        <section className="panel page-col">
          <div className="panel-head">
            <div><p className="dash-kicker">Branding</p><h2>Public form appearance</h2></div>
          </div>
          <p className="text-muted" style={{ marginTop: 0 }}>
            Your workspace name, logo, and accent color appear on all public forms.
          </p>
          <form onSubmit={handleSaveBranding} className="form-stack">
            <div className="field">
              <label className="field-label" htmlFor="brand-logo">Logo URL (optional)</label>
              <input id="brand-logo" className="input" type="url" value={brandLogoUrl} onChange={(e) => setBrandLogoUrl(e.target.value)} placeholder="https://example.com/logo.png" />
              <small className="field-help">Direct URL to your logo image. 200px wide recommended.</small>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="brand-color">Accent color (optional)</label>
              <div className="field-row">
                <input className="input input-color" type="color" aria-label="Pick accent color" value={brandColor || "#2563eb"} onChange={(e) => setBrandColor(e.target.value)} />
                <input id="brand-color" className="input input-mono" type="text" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} placeholder="#2563eb" />
              </div>
              <small className="field-help">Used for buttons and links on your public forms.</small>
            </div>

            {/* Live preview: mirrors how branding appears on a public form */}
            <div className="field">
              <span className="field-label">Preview</span>
              <div className="brand-preview">
                <div className="brand-preview-head">
                  {brandLogoUrl.trim() ? (
                    <img
                      className="brand-preview-logo"
                      src={brandLogoUrl.trim()}
                      alt="Logo preview"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : null}
                  <span className="brand-preview-name" style={{ color: brandColor.trim() || "#2563eb" }}>
                    {selectedWsData?.name ?? "Your workspace"}
                  </span>
                </div>
                <p className="brand-preview-text">
                  Sample form question {"\u2014"} this is how respondents see your form.
                </p>
                <span
                  className="brand-preview-btn"
                  style={{ background: brandColor.trim() || "#2563eb", color: "white" }}
                >
                  Submit
                </span>
              </div>
              <small className="field-help">Updates live as you edit. Logo hides if the URL can't load.</small>
            </div>

            <div>
              <button className="btn btn-primary" type="submit" disabled={savingBrand}>
                {savingBrand ? "Saving..." : "Save branding"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {/* Invite form */}
      {canManage ? (
        <section className="panel page-col">
          <div className="panel-head">
            <div><p className="dash-kicker">Invite</p><h2>Add a member</h2></div>
          </div>
          <p className="text-muted" style={{ marginTop: 0 }}>
            The person must already have a Qivo account. They'll get access immediately.
          </p>
          <form onSubmit={handleInvite} className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="invite-email">Email address</label>
              <input
                id="invite-email"
                className="input"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                required
              />
            </div>
            <div className="field field-fixed">
              <label className="field-label" htmlFor="invite-role">Role</label>
              <Select id="invite-role" fullWidth={false} value={inviteRole} onChange={(v) => setInviteRole(v as "ADMIN" | "EDITOR" | "VIEWER")} options={ROLE_OPTIONS} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={inviting || !inviteEmail.trim()}>
              {inviting ? "Inviting..." : "Invite"}
            </button>
          </form>
          <p className="field-help" style={{ marginTop: 8 }}>
            {ROLE_DESCRIPTIONS[inviteRole]}
          </p>
        </section>
      ) : null}

      {/* Members list */}
      <section className="panel page-col">
        <div className="panel-head">
          <div><p className="dash-kicker">Members</p><h2>{members.length} members</h2></div>
        </div>

        {members.length === 0 ? (
          <p className="text-muted">No members yet.</p>
        ) : (
          <div className="member-list">
            {members.map((member) => (
              <div key={member.id} className="member-row">
                <div className="member-avatar" aria-hidden="true">
                  {member.user.name.slice(0, 1).toUpperCase()}
                </div>

                <div className="member-info">
                  <strong className="member-name">{member.user.name}</strong>
                  <span className="member-email">{member.user.email}</span>
                  <span className="member-joined">
                    Joined {new Date(member.joinedAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="member-actions">
                  {member.role === "OWNER" ? (
                    <span className="badge badge-status-published">OWNER</span>
                  ) : canManage ? (
                    <>
                      <Select size="sm" fullWidth={false} aria-label={`Role for ${member.user.name}`} value={member.role} onChange={(v) => void handleRoleChange(member.id, v)} options={ROLE_OPTIONS} />
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        onClick={() => void handleRemove(member.id, member.user.name)}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="badge badge-status-draft">{member.role}</span>
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
