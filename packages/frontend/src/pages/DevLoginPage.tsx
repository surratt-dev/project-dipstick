import { useEffect, useState, type CSSProperties } from "react";
import type { DevLoginOption } from "@dipstick/shared";

// persona-login design.md D7: deliberately unpolished scaffolding -- looking
// obviously like scaffolding is the point, so nobody mistakes this for a
// pattern worth carrying into a real environment. Shares no navigation
// chrome or styling with any authenticated application screen (task 5.3).
const BANNER_STYLE: CSSProperties = {
  width: "100%",
  backgroundColor: "#f5c400",
  color: "#000",
  padding: "0.75rem 1rem",
  fontWeight: "bold",
  textAlign: "center",
  fontFamily: "monospace",
  boxSizing: "border-box",
};

const CONTAINER_STYLE: CSSProperties = {
  fontFamily: "monospace",
  maxWidth: "480px",
  margin: "2rem auto",
  padding: "0 1rem",
};

const BUTTON_STYLE: CSSProperties = {
  display: "block",
  width: "100%",
  padding: "0.75rem",
  marginBottom: "0.75rem",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "monospace",
  fontSize: "1rem",
  textDecoration: "none",
  color: "#000",
  backgroundColor: "#eee",
  border: "1px solid #999",
  boxSizing: "border-box",
};

export function DevLoginPage() {
  const [options, setOptions] = useState<DevLoginOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/auth/dev-login-options", { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("dev-login-options unavailable");
        return response.json() as Promise<{ options: DevLoginOption[] }>;
      })
      .then((data) => {
        if (!cancelled) setOptions(data.options);
      })
      .catch(() => {
        // The shortcut is no longer available (e.g. this URL was navigated
        // to directly after the environment changed) -- fall back to the
        // same manual sign-in path AuthContext uses on any gate failure.
        if (!cancelled) window.location.href = "/auth/login";
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div style={BANNER_STYLE}>LOCAL DEV ONLY &mdash; PERSONA LOGIN</div>
      <div style={CONTAINER_STYLE}>
        {options?.map((option) => (
          <a
            key={option.accountId}
            href={`/auth/login?loginHint=${encodeURIComponent(option.accountId)}`}
            style={BUTTON_STYLE}
          >
            <div>
              {option.seeded ? `${option.roleLabel} (${option.accountId})` : option.accountId}
            </div>
            {!option.seeded && (
              <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                Role not seeded &mdash; signs in as a default user, not a Facilitator. Single
                identity; does not test cross-team facilitation (see docs).
              </div>
            )}
          </a>
        ))}

        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          Each button starts a normal sign-in. To run multiple personas at once, use separate
          browser profiles or incognito windows.
        </p>

        <p>
          <a href="/auth/login">Sign in manually</a>
        </p>
      </div>
    </div>
  );
}
