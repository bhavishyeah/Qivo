import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getToken, api, setToken, ApiRequestError } from "../lib/api";

type UserInfo = { id: string; name: string; email: string };

/**
 * Wraps protected routes. Redirects to /login if not authenticated.
 * Passes user info to children via render prop.
 */
export default function AuthGuard({
  children,
}: {
  children: (user: UserInfo) => React.ReactNode;
}) {
  const location = useLocation();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const token = getToken();
      if (!token) {
        setChecking(false);
        return;
      }

      try {
        const data = await api.get<{ user: UserInfo }>("/api/auth/me");
        setUser(data.user);
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === "UNAUTHENTICATED") {
          setToken(null);
        }
      } finally {
        setChecking(false);
      }
    }

    void checkAuth();
  }, []);

  if (checking) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <div className="skeleton-block" style={{ width: 200, height: 20 }} />
        </div>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children(user)}</>;
}
