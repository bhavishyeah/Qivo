import { useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api, ApiRequestError, setToken } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

export default function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const inviteToken = new URLSearchParams(location.search).get("invite");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api.post<{ token: string }>("/api/auth/signup", {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      setToken(data.token);
      navigate(
        inviteToken
          ? `/accept-invite?token=${encodeURIComponent(inviteToken)}`
          : "/dashboard",
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to create account.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Create an account"
      subtitle="Start building forms and collecting responses."
      footer={
        <>
          Already have an account?{" "}
          <Link to={inviteToken ? `/login?invite=${inviteToken}` : "/login"}>Log in</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="signup-name">
            Full name
          </label>
          <input
            id="signup-name"
            className="input"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="signup-email">
            Email
          </label>
          <input
            id="signup-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="signup-password">
            Password
          </label>
          <input
            id="signup-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>

        {error ? (
          <p className="msg msg-error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={loading}>
          {loading ? "Creating account..." : "Sign up"}
        </button>
      </form>
    </AuthLayout>
  );
}
