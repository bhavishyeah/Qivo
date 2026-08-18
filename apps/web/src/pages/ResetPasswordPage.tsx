import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (!token) {
      setError("Reset token is missing. Please use the link from your email.");
      return;
    }

    setLoading(true);

    try {
      await api.post("/api/auth/reset-password", {
        token,
        newPassword,
      });
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to reset password.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <main className="page-shell">
        <section className="auth-card">
          <p className="eyebrow">Qivo Forms</p>
          <h1>Password reset</h1>
          <p className="muted">
            Your password has been updated. You can now log in with your new password.
          </p>
          <Link
            className="primary-link"
            to="/login"
            style={{ display: "inline-flex", marginTop: 24 }}
          >
            Log in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="auth-card">
        <p className="eyebrow">Qivo Forms</p>
        <h1>Set new password</h1>
        <p className="muted">Choose a strong password for your account.</p>

        <form onSubmit={handleSubmit} noValidate>
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
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          {error ? (
            <p className="submit-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="submit-button"
            type="submit"
            disabled={loading || !newPassword || !confirmPassword}
          >
            {loading ? "Resetting..." : "Reset password"}
          </button>
        </form>
      </section>
    </main>
  );
}
