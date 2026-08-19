import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiRequestError, setToken } from "../lib/api";

export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api.post<{ token: string }>("/api/auth/login", { email, password });
      setToken(data.token);
      navigate("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to log in.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="auth-card">
        <p className="eyebrow">Qivo Forms</p>

        <h1>Welcome back</h1>

        <p className="muted">Log in to manage your forms and responses.</p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="question-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="question-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error ? (
            <p className="submit-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="submit-button" type="submit" disabled={loading}>
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>

        <p className="muted" style={{ marginTop: 20, textAlign: "center" }}>
          Don't have an account?{" "}
          <Link className="secondary-link" to="/signup">
            Sign up
          </Link>
          {" · "}
          <Link className="secondary-link" to="/forgot-password">
            Forgot password?
          </Link>
        </p>
      </section>
    </main>
  );
}
