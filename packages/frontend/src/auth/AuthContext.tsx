import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import type { AuthSession } from "@dipstick/shared";

// persona-login design.md D3: bounds the extra /auth/dev-login-options
// round-trip so production sign-in is never made to wait on it. A same-origin
// call that either says "no" instantly (production, no I/O) or sits in the
// local dev stack; anything slower is itself a signal something's wrong.
const DEV_LOGIN_OPTIONS_TIMEOUT_MS = 300;

// persona-login design.md D9: AuthContext's job stays "decide where to
// navigate on 401" -- it does not render the landing page itself. A timeout
// is treated identically to a 404 response (fail open to the existing
// redirect) in every environment, not only production.
async function devLoginShortcutAvailable(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEV_LOGIN_OPTIONS_TIMEOUT_MS);
  try {
    const response = await fetch("/auth/dev-login-options", {
      credentials: "include",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

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
  const navigate = useNavigate();

  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch("/auth/session", {
        credentials: "include",
      });

      if (response.status === 401) {
        // Not authenticated. Checked identically here (initial load) and
        // after logout, since a post-logout redirect always lands back on
        // this same SPA entry point and re-runs fetchSession (design.md D6:
        // one gate, not a second independently-maintained determination).
        if (await devLoginShortcutAvailable()) {
          navigate("/auth/dev-login");
          return;
        }
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
  }, [navigate]);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  return (
    <AuthContext.Provider value={{ session, loading, refreshSession: fetchSession }}>
      {children}
    </AuthContext.Provider>
  );
}
