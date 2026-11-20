import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

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
      <AuthLayout title="Verifying" subtitle="Verifying your email...">
        <div className="skeleton-line skeleton-line-lg" aria-hidden="true" />
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout title="Email verified" subtitle="Your email address has been confirmed. You're all set.">
        <Link className="btn btn-primary btn-lg auth-submit" to="/dashboard">
          Go to dashboard
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Verification failed">
      <p className="auth-status auth-status-error" role="alert">
        {error}
      </p>
      <div className="auth-actions">
        <Link className="btn btn-primary btn-lg auth-submit" to="/login">
          Back to login
        </Link>
      </div>
    </AuthLayout>
  );
}
