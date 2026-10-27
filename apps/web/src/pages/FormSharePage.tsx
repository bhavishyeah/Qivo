import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { api, ApiRequestError } from "../lib/api";
import type { FormRecord, FormShare, FormShareRole } from "../types";

const SHARE_ROLE_DESCRIPTIONS: Record<FormShareRole, string> = {
  RESPONDER: "Gets the public form link by email.",
  EDITOR: "Can edit this form.",
  VIEWER: "Can view this form's responses.",
};

export default function FormSharePage() {
  const { formId } = useParams<{ formId: string }>();

  const [form, setForm] = useState<FormRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Per-form sharing (invite card + shares list)
  const [shares, setShares] = useState<FormShare[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<FormShareRole>("RESPONDER");
  const [inviting, setInviting] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [shareError, setShareError] = useState("");

  const canvasRef = useRef<HTMLDivElement>(null);

  const publicUrl = form ? `${window.location.origin}/f/${form.slug}` : "";
  const displayUrl = form
    ? `${window.location.origin}/f/${form.slug}/display`
    : "";

  useEffect(() => {
    async function loadForm() {
      if (!formId) {
        setError("Form ID is missing.");
        setLoading(false);
        return;
      }

      try {
        const data = await api.get<{ form: FormRecord }>(
          `/api/forms/${formId}`,
        );
        setForm(data.form);

        // Load existing shares. Only editors may list; a 403 here is benign
        // (the user can still view the page and the public link) — surface it
        // as a note instead of breaking the page.
        try {
          const shareData = await api.get<{ shares: FormShare[] }>(
            `/api/forms/${formId}/shares`,
          );
          setShares(shareData.shares);
        } catch (shareErr) {
          if (
            shareErr instanceof ApiRequestError &&
            shareErr.code === "FORBIDDEN"
          ) {
            setShareError(
              "You don't have permission to manage sharing for this form.",
            );
          } else {
            setShareError(
              shareErr instanceof ApiRequestError
                ? shareErr.message
                : "Unable to load shares.",
            );
          }
        }
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : "Unable to load form.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadForm();
  }, [formId]);

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

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = publicUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [publicUrl]);

  function downloadPng() {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current.querySelector("canvas");
    if (!canvas) return;

    const link = document.createElement("a");
    link.download = `${form?.title ?? "form"}-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function downloadSvg() {
    if (!canvasRef.current) return;
    // We use a hidden SVG render for download
    const svgElement = document.getElementById("qr-svg-download");
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `${form?.title ?? "form"}-qr.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
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

  if (error || !form) {
    return (
      <main className="page-shell">
        <div className="status-card error-card">
          <h1>Unable to load form</h1>
          <p>{error || "Form not found."}</p>
        </div>
      </main>
    );
  }

  const isPublished = form.status === "PUBLISHED";

  return (
    <main className="page-shell">
      <section className="auth-card" style={{ maxWidth: 640 }}>
        <p className="eyebrow">Share & QR</p>

        <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>
          {form.title}
        </h1>

        {!isPublished ? (
          <div
            className="submit-error"
            style={{ marginBottom: 24, background: "#fef3c7", color: "#92400e" }}
          >
            This form is not published yet. Publish it from the editor to make
            the public link and QR code active.
          </div>
        ) : null}

        <div style={{ marginBottom: 28 }}>
          <label
            style={{
              display: "block",
              marginBottom: 8,
              fontWeight: 750,
              color: "#1e293b",
            }}
          >
            Public link
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="text"
              readOnly
              value={publicUrl}
              style={{
                flex: 1,
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "12px 14px",
                background: "#f8fafc",
                color: "#334155",
              }}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyLink()}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            marginBottom: 28,
            padding: 28,
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            background: "#ffffff",
          }}
        >
          <QRCodeSVG
            value={publicUrl}
            size={220}
            level="H"
            bgColor="#ffffff"
            fgColor="#0f172a"
          />

          {/* Hidden canvas for PNG download */}
          <div ref={canvasRef} style={{ display: "none" }}>
            <QRCodeCanvas value={publicUrl} size={1024} level="H" />
          </div>

          {/* Hidden SVG for SVG download */}
          <div style={{ display: "none" }}>
            <QRCodeSVG
              id="qr-svg-download"
              value={publicUrl}
              size={1024}
              level="H"
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 28,
          }}
        >
          <button
            className="secondary-button"
            type="button"
            onClick={downloadPng}
          >
            Download PNG
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={downloadSvg}
          >
            Download SVG
          </button>
          <Link className="secondary-button" to={displayUrl} target="_blank">
            Display mode
          </Link>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="secondary-link" to={`/forms/${formId}/edit`}>
            ← Back to editor
          </Link>
          <Link className="secondary-link" to="/dashboard">
            Dashboard
          </Link>
        </div>
      </section>

      {/* Per-form sharing & email invites */}
      <section className="auth-card" style={{ maxWidth: 640, marginTop: 24 }}>
        <p className="eyebrow">Invite people</p>
        <h2 style={{ fontSize: "clamp(1.3rem, 3vw, 1.7rem)", marginBottom: 6 }}>
          Share this form
        </h2>
        <p className="muted" style={{ marginBottom: 20, fontSize: "0.9rem" }}>
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

        <form
          onSubmit={handleSendInvite}
          style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 24 }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <label
              htmlFor="share-email"
              style={{ display: "block", marginBottom: 7, fontWeight: 750, fontSize: "0.86rem" }}
            >
              Email address
            </label>
            <input
              id="share-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="person@example.com"
              required
              style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }}
            />
          </div>
          <div>
            <label
              htmlFor="share-role"
              style={{ display: "block", marginBottom: 7, fontWeight: 750, fontSize: "0.86rem" }}
            >
              Role
            </label>
            <select
              id="share-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as FormShareRole)}
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }}
            >
              <option value="RESPONDER">Responder</option>
              <option value="EDITOR">Editor</option>
              <option value="VIEWER">Viewer</option>
            </select>
            <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "#94a3b8", maxWidth: 240 }}>
              {SHARE_ROLE_DESCRIPTIONS[inviteRole]}
            </p>
          </div>
          <button className="secondary-button" type="submit" disabled={inviting || !inviteEmail.trim()}>
            {inviting ? "Sending..." : "Send invite"}
          </button>
        </form>

        <h3 style={{ fontSize: "0.95rem", fontWeight: 750, color: "#1e293b", marginBottom: 12 }}>
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
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ color: "#111827", display: "block" }}>{label}</strong>
                    {share.user ? (
                      <span style={{ color: "#64748b", fontSize: "0.82rem" }}>
                        {share.user.email}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className="status-pill"
                    style={{ background: "#eef2ff", color: "#4338ca" }}
                  >
                    {share.role}
                  </span>
                  <span
                    className="status-pill"
                    style={
                      share.status === "ACCEPTED"
                        ? { background: "#dcfce7", color: "#166534" }
                        : { background: "#fef3c7", color: "#92400e" }
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
    </main>
  );
}
