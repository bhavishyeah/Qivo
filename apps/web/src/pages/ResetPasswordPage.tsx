import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

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
      <AuthLayout
        title="Password reset"
        subtitle="Your password has been updated. You can now log in with your new password."
      >
        <Link className="btn btn-primary btn-lg auth-submit" to="/login">
          Log in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set new password" subtitle="Choose a strong password for your account.">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="confirm-password">
            Confirm password
          </label>
          <input
            id="confirm-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>

        {error ? (
          <p className="msg msg-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className="btn btn-primary btn-lg auth-submit"
          type="submit"
          disabled={loading || !newPassword || !confirmPassword}
        >
          {loading ? "Resetting..." : "Reset password"}
        </button>
      </form>
    </AuthLayout>
  );
}
