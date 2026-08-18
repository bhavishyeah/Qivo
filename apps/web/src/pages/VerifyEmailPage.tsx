import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function verify() {
      if (!token) {
        setError("Verification token is missing.");
        setLoading(false);
        return;
      }

      try {
        await api.post("/api/auth/verify-email", { token });
        setSuccess(true);
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : "Unable to verify email.",
        );
      } finally {
        setLoading(false);
      }
    }

    void verify();
  }, [token]);

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Verifying your email...</p>
        </div>
      </main>
    );
  }

  if (success) {
    return (
      <main className="page-shell">
        <section className="status-card success-card">
          <p className="eyebrow">Qivo Forms</p>
          <h1>Email verified</h1>
          <p>Your email address has been confirmed. You're all set.</p>
          <Link
            className="primary-link"
            to="/dashboard"
            style={{ display: "inline-flex", marginTop: 24 }}
          >
            Go to dashboard
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="status-card error-card">
        <p className="eyebrow">Qivo Forms</p>
        <h1>Verification failed</h1>
        <p>{error}</p>
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
