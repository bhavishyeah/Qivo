import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiRequestError } from "../lib/api";
import Select from "./Select";
import type { FormShare, FormShareRole } from "../types";

// eslint-disable-next-line react-refresh/only-export-components -- shared constant/helper kept next to its component; moving it would change module layout
export const SHARE_ROLE_DESCRIPTIONS: Record<FormShareRole, string> = {
  RESPONDER: "Gets the public form link by email.",
  EDITOR: "Can edit this form.",
  VIEWER: "Can view this form's responses.",
};

/**
 * Invite people to a form and manage who has access. Used on the Share page
 * and in the editor's "Invite people" dialog.
 */
export function InvitePeople({ formId, embedded = false }: { formId: string; embedded?: boolean }) {
  const [shares, setShares] = useState<FormShare[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<FormShareRole>("RESPONDER");
  const [inviting, setInviting] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [shareError, setShareError] = useState("");

  const reloadShares = useCallback(async () => {
    if (!formId) return;
    try {
      const shareData = await api.get<{ shares: FormShare[] }>(
        `/api/forms/${formId}/shares`,
      );
      setShares(shareData.shares);
    } catch (err) {
      setShareError(
        err instanceof ApiRequestError ? err.message : "Unable to load shares.",
      );
    }
  }, [formId]);

  async function handleSendInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formId || !inviteEmail.trim()) return;
    setInviting(true);
    setShareError("");
    setShareMessage("");
    const email = inviteEmail.trim().toLowerCase();
    try {
      const data = await api.post<{ share: FormShare }>(
        `/api/forms/${formId}/shares`,
        { email, role: inviteRole },
      );
      setShareMessage(
        data.share.status === "PENDING"
          ? `Invited ${email} as ${inviteRole.toLowerCase()}. We emailed them a sign-up link.`
          : `Invited ${email} as ${inviteRole.toLowerCase()}.`,
      );
      setInviteEmail("");
      await reloadShares();
    } catch (err) {
      setShareError(
        err instanceof ApiRequestError ? err.message : "Unable to send invite.",
      );
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(shareId: string, label: string) {
    if (!formId) return;
    if (!confirm(`Revoke access for ${label}?`)) return;
    setShareError("");
    setShareMessage("");
    try {
      await api.delete(`/api/forms/${formId}/shares/${shareId}`);
      setShareMessage("Share revoked.");
      await reloadShares();
    } catch (err) {
      setShareError(
        err instanceof ApiRequestError ? err.message : "Unable to revoke share.",
      );
    }
  }


  useEffect(() => {
    void (async () => {
      try {
        const shareData = await api.get<{ shares: FormShare[] }>(`/api/forms/${formId}/shares`);
        setShares(shareData.shares);
      } catch (shareErr) {
        setShareError(
          shareErr instanceof ApiRequestError && shareErr.code === "FORBIDDEN"
            ? "You don't have permission to manage sharing for this form."
            : shareErr instanceof ApiRequestError
              ? shareErr.message
              : "Unable to load shares.",
        );
      }
    })();
  }, [formId]);

  return (
      <section className={embedded ? "invite-people is-embedded" : "auth-card"} style={embedded ? undefined : { width: "min(100%, 640px)", maxWidth: 640, marginTop: 24 }}>
        {embedded ? null : (
          <>
            <p className="eyebrow">Invite people</p>
            <h2 style={{ fontSize: "clamp(1.3rem, 3vw, 1.7rem)", marginBottom: 6 }}>
              Share this form
            </h2>
          </>
        )}
        <p className="muted invite-intro">
          Email the form to a responder, or give an editor/viewer access to this
          form only. New people get a sign-up link; existing Qivo users are added
          right away.
        </p>
        {shareMessage ? (
          <p className="editor-message" role="status" style={{ marginBottom: 16 }}>
            {shareMessage}
          </p>
        ) : null}

        {shareError ? (
          <p className="submit-error" role="alert" style={{ marginBottom: 16 }}>
            {shareError}
          </p>
        ) : null}

        <form onSubmit={handleSendInvite} className="invite-form">
          <div className="invite-field">
            <label htmlFor="share-email">Email address</label>
            <input
              id="share-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="person@example.com"
              required
              className="invite-input"
            />
          </div>
          <div className="invite-field">
            <label htmlFor="share-role">Role</label>
            <Select id="share-role" value={inviteRole} onChange={(v) => setInviteRole(v as FormShareRole)} options={[{ value: "RESPONDER", label: "Responder" }, { value: "EDITOR", label: "Editor" }, { value: "VIEWER", label: "Viewer" }]} />
          </div>
          <button className="secondary-button invite-send" type="submit" disabled={inviting || !inviteEmail.trim()}>
            {inviting ? "Sending..." : "Send invite"}
          </button>
          <p className="invite-help">{SHARE_ROLE_DESCRIPTIONS[inviteRole]}</p>
        </form>

        <h3 className="invite-access-title">
          People with access
        </h3>
        {shares.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.88rem" }}>
            No one has been invited to this form yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {shares.map((share) => {
              const label = share.user ? share.user.name : share.email;
              return (
                <div
                  key={share.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    background: "var(--color-surface-sunken)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ color: "var(--color-text)", display: "block" }}>{label}</strong>
                    {share.user ? (
                      <span style={{ color: "var(--color-text-subtle)", fontSize: "0.82rem" }}>
                        {share.user.email}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className="status-pill"
                    style={{ background: "var(--status-tag-bg)", color: "var(--status-tag-fg)" }}
                  >
                    {share.role}
                  </span>
                  <span
                    className="status-pill"
                    style={
                      share.status === "ACCEPTED"
                        ? { background: "var(--color-success-tint)", color: "var(--color-success-text)" }
                        : { background: "var(--color-warning-tint)", color: "var(--color-warning-text)" }
                    }
                  >
                    {share.status === "ACCEPTED" ? "Accepted" : "Pending"}
                  </span>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => void handleRevoke(share.id, label)}
                    style={{ fontSize: "0.8rem", padding: "6px 10px" }}
                  >
                    Revoke
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
  );
}