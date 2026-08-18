import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.post("/api/auth/forgot-password", {
        email: email.trim().toLowerCase(),
      });
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to send reset link.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <main className="page-shell">
        <section className="auth-card">
          <p className="eyebrow">Qivo Forms</p>
          <h1>Check your email</h1>
          <p className="muted">
            If an account exists for {email}, we've sent a password reset link. Check
            your inbox and spam folder.
          </p>
          <Link
            className="primary-link"
            to="/login"
            style={{ display: "inline-flex", marginTop: 24 }}
          >
            Back to login
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="auth-card">
        <p className="eyebrow">Qivo Forms</p>
        <h1>Reset password</h1>
        <p className="muted">
          Enter your email address and we'll send you a link to reset your password.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="question-field">
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
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
            disabled={loading || !email.trim()}
          >
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <p className="muted" style={{ marginTop: 20, textAlign: "center" }}>
          <Link className="secondary-link" to="/login">
            Back to login
          </Link>
        </p>
      </section>
    </main>
  );
}
