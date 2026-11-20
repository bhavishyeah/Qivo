import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

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
      <AuthLayout
        title="Check your email"
        subtitle={`If an account exists for ${email}, we've sent a password reset link. Check your inbox and spam folder.`}
      >
        <Link className="btn btn-primary btn-lg auth-submit" to="/login">
          Back to login
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset password"
      subtitle="Enter your email address and we'll send you a link to reset your password."
      footer={<Link to="/login">Back to login</Link>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="forgot-email">
            Email
          </label>
          <input
            id="forgot-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
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
          disabled={loading || !email.trim()}
        >
          {loading ? "Sending..." : "Send reset link"}
        </button>
      </form>
    </AuthLayout>
  );
}
