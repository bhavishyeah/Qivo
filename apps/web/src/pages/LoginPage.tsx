import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api, ApiRequestError, setToken } from "../lib/api";
import AuthLayout from "../components/AuthLayout";

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
  const location = useLocation();
  const inviteToken = new URLSearchParams(location.search).get("invite");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleGoogleCallback(response: { credential: string }) {
    setError("");
    setLoading(true);
    try {
      const data = await api.post<{ token: string }>("/api/auth/google", {
        idToken: response.credential,
      });
      setToken(data.token);
      navigate(
        inviteToken
          ? `/accept-invite?token=${encodeURIComponent(inviteToken)}`
          : "/dashboard",
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Google sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  // Google Sign-In. Declared after handleGoogleCallback so the effect doesn't
  // reference it before declaration. Guarded against StrictMode double-mount /
  // double script injection.
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    let script = document.getElementById("google-gsi-script") as HTMLScriptElement | null;
    const alreadyLoaded = Boolean(script);

    function renderGoogleButton() {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCallback,
      });
      const container = document.getElementById("google-btn");
      if (container) {
        container.innerHTML = "";
        window.google?.accounts.id.renderButton(container, {
          theme: "outline",
          size: "large",
          width: Math.min(400, Math.max(200, Math.round(container.getBoundingClientRect().width || 320))),
          text: "continue_with",
        });
      }
    }

    if (alreadyLoaded && window.google) {
      renderGoogleButton();
      return;
    }

    if (!script) {
      script = document.createElement("script");
      script.id = "google-gsi-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = renderGoogleButton;
      document.head.appendChild(script);
    }
    // Intentionally leave the shared GSI script in the DOM across mounts; only
    // the rendered button is reset (above) on re-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api.post<{ token: string }>("/api/auth/login", { email, password });
      setToken(data.token);
      navigate(
        inviteToken
          ? `/accept-invite?token=${encodeURIComponent(inviteToken)}`
          : "/dashboard",
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to log in.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to manage your forms and responses."
      footer={
        <>
          Don't have an account?{" "}
          <Link to={inviteToken ? `/signup?invite=${inviteToken}` : "/signup"}>Sign up</Link>
          <span className="auth-sep" aria-hidden="true">
            /
          </span>
          <Link to="/forgot-password">Forgot password?</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error ? (
          <p className="msg msg-error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={loading}>
          {loading ? "Logging in..." : "Log in"}
        </button>
      </form>

      {/* Google Sign-In */}
      {import.meta.env.VITE_GOOGLE_CLIENT_ID ? (
        <>
          <div className="auth-divider">or</div>
          <div id="google-btn" className="auth-google" />
        </>
      ) : null}
    </AuthLayout>
  );
}
