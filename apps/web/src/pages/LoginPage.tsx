import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiRequestError, setToken } from "../lib/api";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Google Sign-In
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCallback,
      });
      const container = document.getElementById("google-btn");
      if (container) {
        window.google?.accounts.id.renderButton(container, {
          theme: "outline",
          size: "large",
          width: "100%",
          text: "continue_with",
        });
      }
    };
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, []);

  async function handleGoogleCallback(response: { credential: string }) {
    setError("");
    setLoading(true);
    try {
      const data = await api.post<{ token: string }>("/api/auth/google", {
        idToken: response.credential,
      });
      setToken(data.token);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Google sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

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

        {/* Google Sign-In */}
        {import.meta.env.VITE_GOOGLE_CLIENT_ID ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <hr style={{ flex: 1, border: "none", borderTop: "1px solid #e2e8f0" }} />
              <span className="muted" style={{ fontSize: "0.82rem" }}>or</span>
              <hr style={{ flex: 1, border: "none", borderTop: "1px solid #e2e8f0" }} />
            </div>
            <div id="google-btn" style={{ display: "flex", justifyContent: "center" }} />
          </div>
        ) : null}

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
