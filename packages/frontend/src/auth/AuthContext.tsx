import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthSession } from "@dipstick/shared";

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSession() {
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
    }

    void fetchSession();
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
