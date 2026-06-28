import type { ReactNode } from "react";
import { useAuth } from "./AuthContext.js";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!session) {
    return null; // AuthContext will redirect to login
  }

  return <>{children}</>;
}
