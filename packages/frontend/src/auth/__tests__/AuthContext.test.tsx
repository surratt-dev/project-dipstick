import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../AuthContext.js";
import type { AuthSession } from "@dipstick/shared";

const mockSession: AuthSession = {
  user: { id: "u1", displayName: "Alice", email: "alice@test.com" },
  teamMemberships: [{ teamId: "t1", teamName: "Team A", role: "member" }],
  sessionCreatedAt: "2024-01-01T00:00:00Z",
  expiresAt: "2024-01-02T00:00:00Z",
};

function TestConsumer() {
  const { session, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="session">{session ? session.user.displayName : "none"}</span>
    </div>
  );
}

describe("AuthProvider", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });

  it("fetches session and provides it to children", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockSession,
    } as Response);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId("loading").textContent).toBe("true");

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("session").textContent).toBe("Alice");
  });

  it("redirects to /auth/login on 401", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(window.location.href).toBe("/auth/login");
    });
  });

  it("sets loading false on network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("session").textContent).toBe("none");
  });

  it("sets loading false on non-ok non-401 response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("session").textContent).toBe("none");
  });
});

describe("useAuth", () => {
  it("returns default context values when used outside provider", () => {
    render(<TestConsumer />);
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("session").textContent).toBe("none");
  });
});
