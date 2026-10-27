import { useCallback, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api, publicGet, ApiRequestError } from "../lib/api";
import type { InvitePreview } from "../types";

const ROLE_LABELS: Record<InvitePreview["role"], string> = {
  RESPONDER: "respond to",
  EDITOR: "edit",
  VIEWER: "view responses for",
};

export default function AcceptInvitePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token");

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  const redirectByRole = useCallback(
    (role: string, formId: string, slug: string) => {
      if (role === "EDITOR") {
        navigate(`/forms/${formId}/edit`);
      } else if (role === "VIEWER") {
        navigate(`/forms/${formId}/responses`);
      } else {
        navigate(`/f/${slug}`);
      }
    },
    [navigate],
  );

  useEffect(() => {
    async function loadInvite() {
      if (!token) {
        setLoadError("This invite link is missing its token.");
        setLoading(false);
        return;
      }
      try {
        const data = await publicGet<{ invite: InvitePreview }>(
          `/api/invites/${token}`,
        );
        setInvite(data.invite);
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === "INVALID_TOKEN") {
          setLoadError("This invite link is invalid or has expired.");
        } else {
          setLoadError(
            err instanceof ApiRequestError
              ? err.message
              : "Unable to load this invite.",
          );
        }
      } finally {
        setLoading(false);
      }
    }

    void loadInvite();
  }, [token]);

  async function handleAccept() {
    if (!token) return;
    setAccepting(true);
    setAcceptError("");
    try {
      const data = await api.post<{ formId: string; slug: string; role: string }>(
        `/api/invites/${token}/accept`,
      );
      redirectByRole(data.role, data.formId, data.slug);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "FORBIDDEN") {
        setAcceptError(
          "This invite was sent to a different email address. Log in with that address to accept.",
        );
      } else if (err instanceof ApiRequestError && err.code === "INVALID_TOKEN") {
        setAcceptError(
          "This invite link is invalid, expired, or already used.",
        );
      } else {
        setAcceptError(
          err instanceof ApiRequestError
            ? err.message
            : "Unable to accept this invite.",
        );
      }
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading invite...</p>
        </div>
      </main>
    );
  }

  if (loadError || !invite) {
    return (
      <main className="page-shell">
        <div className="status-card error-card">
          <h1>Invite unavailable</h1>
          <p>{loadError || "This invite could not be found."}</p>
        </div>
      </main>
    );
  }

  const alreadyAccepted = invite.status === "ACCEPTED";

  return (
    <main className="page-shell">
      <section className="auth-card" style={{ maxWidth: 520 }}>
        <p className="eyebrow">Form invite</p>

        <h1 style={{ fontSize: "clamp(1.6rem, 4vw, 2.2rem)" }}>
          {invite.formTitle}
        </h1>

        <p className="muted" style={{ marginBottom: 20 }}>
          {invite.inviterName} invited you to {ROLE_LABELS[invite.role]} this
          form on Qivo Forms.
        </p>

        {alreadyAccepted ? (
          <>
            <p
              className="editor-message"
              role="status"
              style={{ marginBottom: 16 }}
            >
              You've already accepted this invite.
            </p>
            <button
              className="submit-button"
              type="button"
              onClick={() => void handleAccept()}
              disabled={accepting}
            >
              {accepting ? "Opening..." : "Open the form"}
            </button>
          </>
        ) : (
          <button
            className="submit-button"
            type="button"
            onClick={() => void handleAccept()}
            disabled={accepting}
          >
            {accepting ? "Accepting..." : "Accept invite"}
          </button>
        )}

        {acceptError ? (
          <p className="submit-error" role="alert" style={{ marginTop: 16 }}>
            {acceptError}
          </p>
        ) : null}
      </section>
    </main>
  );
}
