import { useState, type FormEvent } from "react";
import { api, ApiRequestError } from "../lib/api";

type UserInfo = { id: string; name: string; email: string };

export default function SettingsPage({ user }: { user: UserInfo }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      await api.post("/api/auth/change-password", {
        currentPassword,
        newPassword,
      });
      setMessage("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to change password.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Settings</h1>
          <p className="muted">Manage your account and preferences.</p>
        </div>
      </header>

      {/* Profile info */}
      <section className="editor-card" style={{ maxWidth: 680, margin: "0 auto 20px" }}>
        <div className="editor-card-header">
          <div>
            <p className="eyebrow">Profile</p>
            <h2>Account information</h2>
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <span className="summary-label">Name</span>
            <p style={{ margin: "4px 0 0", color: "#111827", fontWeight: 600 }}>
              {user.name}
            </p>
          </div>
          <div>
            <span className="summary-label">Email</span>
            <p style={{ margin: "4px 0 0", color: "#111827", fontWeight: 600 }}>
              {user.email}
            </p>
          </div>
        </div>
      </section>

      {/* Change password */}
      <section className="editor-card" style={{ maxWidth: 680, margin: "0 auto" }}>
        <div className="editor-card-header">
          <div>
            <p className="eyebrow">Security</p>
            <h2>Change password</h2>
          </div>
        </div>

        {message ? (
          <p className="editor-message" role="status" style={{ marginBottom: 16 }}>
            {message}
          </p>
        ) : null}

        {error ? (
          <p className="submit-error" role="alert" style={{ marginBottom: 16 }}>
            {error}
          </p>
        ) : null}

        <form onSubmit={handleChangePassword}>
          <div className="question-field">
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>

          <div className="question-field">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          <div className="question-field">
            <label htmlFor="confirm-new-password">Confirm new password</label>
            <input
              id="confirm-new-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          <button
            className="secondary-button"
            type="submit"
            disabled={loading || !currentPassword || !newPassword}
          >
            {loading ? "Changing..." : "Change password"}
          </button>
        </form>
      </section>
    </main>
  );
}
