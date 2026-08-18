import { useCallback, useEffect, useState } from "react";
import { api, ApiRequestError } from "../lib/api";
import type { UserInfo, WorkspaceRecord } from "../types";

type AuthState = {
  user: UserInfo | null;
  workspace: WorkspaceRecord | null;
  loading: boolean;
  error: string;
};

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    workspace: null,
    loading: true,
    error: "",
  });

  const checkAuth = useCallback(async () => {
    try {
      const data = await api.get<{ user: UserInfo }>("/api/auth/me");

      const wsData = await api.get<{ workspaces: WorkspaceRecord[] }>(
        "/api/workspaces",
      );

      const personalWorkspace =
        wsData.workspaces.find((w) => w.type === "PERSONAL") ??
        wsData.workspaces[0] ??
        null;

      setState({
        user: data.user,
        workspace: personalWorkspace,
        loading: false,
        error: "",
      });
    } catch (err) {
      setState({
        user: null,
        workspace: null,
        loading: false,
        error:
          err instanceof ApiRequestError ? err.message : "Auth check failed.",
      });
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Ignore logout errors
    }
    setState({ user: null, workspace: null, loading: false, error: "" });
  }, []);

  return { ...state, checkAuth, logout };
}
