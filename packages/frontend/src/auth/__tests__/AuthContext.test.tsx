import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
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

// AuthProvider now calls useNavigate() (persona-login design.md D9), which
// requires a Router ancestor -- every render is wrapped in a MemoryRouter,
// mirroring how App.tsx nests AuthProvider inside BrowserRouter. The
// optional /auth/dev-login route lets tests assert the navigation actually
// landed there.
function renderWithRouter(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/auth/dev-login" element={<div>dev-login-page</div>} />
        <Route
          path="*"
          element={
            <AuthProvider>
              <TestConsumer />
            </AuthProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
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

    renderWithRouter();

    expect(screen.getByTestId("loading").textContent).toBe("true");

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("session").textContent).toBe("Alice");
  });

  it("sets loading false on network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));

    renderWithRouter();

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

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("session").textContent).toBe("none");
  });

  // persona-login design.md D9/tasks.md 5.8: dev-login-options check
  // succeeding within the timeout navigates to /auth/dev-login instead of
  // the immediate hard redirect.
  describe("persona login shortcut gating (401 branch)", () => {
    it("navigates to /auth/dev-login when dev-login-options succeeds", async () => {
      vi.mocked(fetch).mockImplementation((url) => {
        if (url === "/auth/session") {
          return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response);
        }
        if (url === "/auth/dev-login-options") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ options: [] }),
          } as Response);
        }
        throw new Error(`unexpected fetch: ${String(url)}`);
      });

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText("dev-login-page")).toBeInTheDocument();
      });
      // The hard redirect must NOT have fired when the shortcut is available.
      expect(window.location.href).toBe("");
    });

    it("falls through to the hard /auth/login redirect when dev-login-options 404s", async () => {
      vi.mocked(fetch).mockImplementation((url) => {
        if (url === "/auth/session") {
          return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response);
        }
        if (url === "/auth/dev-login-options") {
          return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
        }
        throw new Error(`unexpected fetch: ${String(url)}`);
      });

      renderWithRouter();

      await waitFor(() => {
        expect(window.location.href).toBe("/auth/login");
      });
      expect(screen.queryByText("dev-login-page")).not.toBeInTheDocument();
    });

    it("falls through to the hard /auth/login redirect when dev-login-options times out", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(fetch).mockImplementation((url, init) => {
          if (url === "/auth/session") {
            return Promise.resolve({
              ok: false,
              status: 401,
              json: async () => ({}),
            } as Response);
          }
          if (url === "/auth/dev-login-options") {
            // Never resolves on its own -- rejects only when the
            // AbortController's 300ms timeout fires the signal, matching
            // real fetch's abort behavior.
            const signal = (init as RequestInit | undefined)?.signal;
            return new Promise((_resolve, reject) => {
              signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            }) as Promise<Response>;
          }
          throw new Error(`unexpected fetch: ${String(url)}`);
        });

        renderWithRouter();

        await vi.advanceTimersByTimeAsync(350);

        expect(window.location.href).toBe("/auth/login");
      } finally {
        vi.useRealTimers();
      }
    });

    it("this is the same gate exercised on post-logout landing (design.md D6) -- the SPA re-mounts AuthProvider and re-runs the identical 401 check", async () => {
      // No separate post-logout code path exists in this codebase: SignOutButton
      // hard-navigates to either the IdP end-session URL or "/", both of which
      // reload this SPA fresh. That reload is exactly the scenario the above
      // "navigates to /auth/dev-login" test already covers end-to-end -- this
      // test documents that equivalence rather than re-implementing it.
      vi.mocked(fetch).mockImplementation((url) => {
        if (url === "/auth/session") {
          return Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as Response);
        }
        if (url === "/auth/dev-login-options") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ options: [] }),
          } as Response);
        }
        throw new Error(`unexpected fetch: ${String(url)}`);
      });

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText("dev-login-page")).toBeInTheDocument();
      });
    });
  });
});

describe("useAuth", () => {
  it("returns default context values when used outside provider", () => {
    render(<TestConsumer />);
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("session").textContent).toBe("none");
  });
});
