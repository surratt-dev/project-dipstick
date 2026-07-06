import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthSession } from "@dipstick/shared";

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  /**
   * Re-fetches the session from the server. Call this after a role change so
   * that the frontend's AuthContext reflects the updated membership state.
   * Per Decision 4 in design.md: role changes take effect immediately on the
   * next authenticated request; the AuthContext is not authoritative for
   * authorization decisions — the server is. This refresh keeps the UI in
   * sync after a role assignment.
   */
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  refreshSession: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch("/auth/session", {
        credentials: "include",
      });

      if (response.status === 401) {
        // Not authenticated — redirect to login
        window.location.href = "/auth/login";
        return;
      }

      if (response.ok) {
        const data = (await response.json()) as AuthSession;
        setSession(data);
      }
    } catch {
      // Network error — could not reach the backend
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  return (
    <AuthContext.Provider value={{ session, loading, refreshSession: fetchSession }}>
      {children}
    </AuthContext.Provider>
  );
}
