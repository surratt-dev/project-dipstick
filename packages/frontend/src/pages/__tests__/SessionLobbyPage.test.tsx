import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { REAUTH_GRACE_EXPIRED_CLOSE_CODE } from "@dipstick/shared";
import { SessionLobbyPage } from "../SessionLobbyPage.js";
import { FakeWebSocket } from "../../realtime/__tests__/fake-websocket.js";

// ---------------------------------------------------------------------------
// Tests for SessionLobbyPage
//
// pre-session-action-item-review, tasks.md Section 4: session-status
// awareness (fetch + branch off GET .../action-items-review, WebSocket
// subscription established before/concurrently with the fetch, Start
// Session control).
//
// Task 7.1/7.3/7.4 (enforce-access-control-on-team-content, carried forward):
// Access model statement MUST be present in the session lobby. These tests
// are adapted to the new async, fetch-driven page — the statement now shows
// once the page has resolved into any branch where the participant has
// standing on the session (not no-access/error).
// ---------------------------------------------------------------------------

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../components/SignOutButton.js", () => ({
  SignOutButton: () => <button>Sign out mock</button>,
}));

import { useAuth } from "../../auth/AuthContext.js";

const mockSession = {
  user: { id: "u1", displayName: "Alice", email: "alice@test.com" },
  teamMemberships: [{ teamId: "t1", teamName: "Alpha", role: "participant" as const }],
  sessionCreatedAt: "",
  expiresAt: "",
};

let lastSocket: FakeWebSocket | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    session: mockSession,
    loading: false,
    refreshSession: vi.fn(),
  });

  global.fetch = vi.fn();

  lastSocket = undefined;
  vi.stubGlobal(
    "WebSocket",
    vi.fn(() => {
      lastSocket = new FakeWebSocket();
      return lastSocket;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage(sessionId = "sess-1") {
  return render(
    <MemoryRouter initialEntries={[`/session/${sessionId}`]}>
      <Routes>
        <Route path="/session/:sessionId" element={<SessionLobbyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockFetchOnce(status: number, body: unknown): void {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as Response);
}

const SESSION_EXPIRED_BODY = {
  error: { category: "session_expired", message: "Your session has expired. Please sign in again.", correlationId: "corr-1" },
};

function mockSessionExpiredFetchOnce(): void {
  mockFetchOnce(401, SESSION_EXPIRED_BODY);
}

// ---------------------------------------------------------------------------
// Task 4.1 — WebSocket subscription established alongside the initial fetch
// ---------------------------------------------------------------------------
describe("4.1: WebSocket subscription established before/concurrently with the initial fetch", () => {
  it("connects a session WebSocket on mount, before the fetch necessarily resolves", () => {
    global.fetch = vi.fn(() => new Promise(() => {})); // never resolves
    renderPage("sess-42");
    expect(lastSocket).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Task 4.2 — branch off the review endpoint's response
// ---------------------------------------------------------------------------
describe("4.2: branching off GET .../action-items-review", () => {
  it("200 -> renders the pre_session review with the fetched data", async () => {
    mockFetchOnce(200, {
      actionItems: [
        {
          actionItemId: "ai-1",
          description: "Fix flaky test",
          ownerUserId: "user-1",
          ownerDisplayName: "Alice",
          status: "open",
          originatingSessionId: "session-old-1",
          originatingSessionNumber: 3,
          stalenessLevel: "none",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      isFacilitator: false,
    });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("pre-session-review")).toBeInTheDocument());
    expect(screen.getByTestId("review-action-item-ai-1")).toHaveTextContent("Fix flaky test");
  });

  it("409 with currentSessionStatus 'lobby' -> renders the lobby waiting branch", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: false });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("session-lobby-waiting")).toBeInTheDocument());
    // session-lobby-routing-gap design.md D5/task 4.2: non-facilitator copy
    // is now session-lobby-waiting-message, not the raw-sessionId
    // session-lobby-info (facilitator-only, see the next test).
    expect(screen.getByTestId("session-lobby-waiting-message")).toBeInTheDocument();
    expect(screen.queryByTestId("session-lobby-info")).not.toBeInTheDocument();
    expect(screen.queryByTestId("start-session-button")).not.toBeInTheDocument();
  });

  it("409 with currentSessionStatus 'lobby' and isFacilitator: true -> shows the Start Session control", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: true });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("start-session-button")).toBeInTheDocument());
  });

  // session-lobby-routing-gap, design.md D5/tasks.md 4.4: non-facilitator
  // waiting copy drops the raw sessionId and reassures the participant.
  it("4.4: non-facilitator waiting copy on the lobby branch contains no raw sessionId and includes the reassurance line", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: false });

    renderPage("sess-abc-123");

    await waitFor(() => expect(screen.getByTestId("session-lobby-waiting-message")).toBeInTheDocument());
    const message = screen.getByTestId("session-lobby-waiting-message");
    expect(message.textContent).not.toContain("sess-abc-123");
    expect(message.textContent).toMatch(/facilitator will start the session shortly/i);
  });

  it("409 with any other currentSessionStatus -> leaves the page (no review data shown)", async () => {
    mockFetchOnce(409, { currentSessionStatus: "active", isFacilitator: false });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("session-lobby-left")).toBeInTheDocument());
    expect(screen.queryByTestId("pre-session-review")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-lobby-waiting")).not.toBeInTheDocument();
  });

  it("404 -> existing no-access handling", async () => {
    mockFetchOnce(404, { error: { category: "not_found", message: "Session not found.", correlationId: "x" } });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("session-lobby-no-access")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Task 4.3 — GET failure error state
// ---------------------------------------------------------------------------
describe("4.3: review GET failure renders an explicit error state with retry", () => {
  it("network error shows the error state, not a blank screen", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network down"));

    renderPage();

    await waitFor(() => expect(screen.getByTestId("session-lobby-review-error")).toBeInTheDocument());
    expect(screen.getByTestId("session-lobby-review-retry")).toBeInTheDocument();
  });

  it("5xx response shows the error state", async () => {
    mockFetchOnce(500, {});

    renderPage();

    await waitFor(() => expect(screen.getByTestId("session-lobby-review-error")).toBeInTheDocument());
  });

  it("retry re-issues the fetch and can recover into the pre_session branch", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network down"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("session-lobby-review-error")).toBeInTheDocument());

    mockFetchOnce(200, { actionItems: [], isFacilitator: false });
    fireEvent.click(screen.getByTestId("session-lobby-review-retry"));

    await waitFor(() => expect(screen.getByTestId("pre-session-review-empty")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Task 4.5/4.6 — Start Session control
// ---------------------------------------------------------------------------
describe("4.5/4.6: Start Session control", () => {
  it("calls POST /api/v1/sessions/:sessionId/start when clicked", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: true });
    renderPage("sess-1");
    await waitFor(() => expect(screen.getByTestId("start-session-button")).toBeInTheDocument());

    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
    fireEvent.click(screen.getByTestId("start-session-button"));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/sessions/sess-1/start",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows inline retry and stays on lobby when Start Session fails", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: true });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("start-session-button")).toBeInTheDocument());

    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 409, json: () => Promise.resolve({}) } as Response);
    fireEvent.click(screen.getByTestId("start-session-button"));

    await waitFor(() => expect(screen.getByTestId("start-session-error")).toBeInTheDocument());
    expect(screen.getByTestId("session-lobby-waiting")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 4.7 — session_state_change re-branches the page
// ---------------------------------------------------------------------------
describe("4.7: receiving session_state_change re-branches via a re-fetch", () => {
  it("moves from lobby to pre_session after the WS event, by re-fetching the same endpoint", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: true });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("session-lobby-waiting")).toBeInTheDocument());

    mockFetchOnce(200, { actionItems: [], isFacilitator: true });
    act(() => {
      lastSocket?.emitMessage({
        eventType: "session_state_change",
        payload: {
          sessionId: "sess-1",
          teamId: "team-1",
          previousStatus: "lobby",
          newStatus: "pre_session",
          changedAt: "2026-09-15T00:00:00Z",
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId("pre-session-review-empty")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Task 7.1 — Access model statement present in session lobby (Decision 8,
// enforce-access-control-on-team-content — carried forward unmodified by
// this change)
// ---------------------------------------------------------------------------
describe("7.1: Access model statement in session lobby", () => {
  it("renders the access model statement once the page resolves into the lobby branch", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: false });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("session-lobby-access-model-statement")).toBeInTheDocument());
    expect(screen.getByTestId("session-lobby-access-model-statement")).toHaveTextContent(
      /Your Engineering Manager can see session history but cannot join or observe live sessions/i,
    );
  });

  it("also renders the access model statement in the pre_session branch", async () => {
    mockFetchOnce(200, { actionItems: [], isFacilitator: false });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("session-lobby-access-model-statement")).toBeInTheDocument());
  });

  it("session lobby renders the session info once in the lobby branch", async () => {
    // session-lobby-routing-gap design.md D5/task 4.2: session-lobby-info
    // (which shows the raw sessionId) is now facilitator-only.
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: true });
    renderPage("sess-abc-123");

    await waitFor(() => expect(screen.getByTestId("session-lobby")).toBeInTheDocument());
    expect(screen.getByTestId("session-lobby-info")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 7.3 — No modal or pop-up triggered by normal user actions
// ---------------------------------------------------------------------------
describe("7.3: No modal or pop-up in session lobby", () => {
  it("no modal is triggered when loading the session lobby", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: false });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("session-lobby-waiting")).toBeInTheDocument());

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("no acknowledgment flow is triggered — access model statement does not require dismissal", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: false });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("session-lobby-access-model-statement")).toBeInTheDocument());

    expect(
      screen.queryByRole("button", { name: /acknowledge|dismiss|ok|close/i }),
    ).not.toBeInTheDocument();
  });

  it("statement is findable but not prominent — rendered as static paragraph text", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: false });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("session-lobby-access-model-statement")).toBeInTheDocument());

    const statement = screen.getByTestId("session-lobby-access-model-statement");
    expect(statement).not.toHaveAttribute("role", "alert");
    expect(statement).not.toHaveAttribute("role", "dialog");
    expect(statement).not.toHaveAttribute("role", "status");
  });
});

// ---------------------------------------------------------------------------
// Task 7.4 — Independent verification + no-session render
// ---------------------------------------------------------------------------
describe("7.4: Session lobby has access model statement — independent verification", () => {
  it("session lobby contains the exact access model statement text", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: false });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("session-lobby-access-model-statement")).toBeInTheDocument());

    const statement = screen.getByTestId("session-lobby-access-model-statement");
    expect(statement.textContent).toContain(
      "Your Engineering Manager can see session history but cannot join or observe live sessions",
    );
  });

  it("renders null when no session is active", () => {
    vi.mocked(useAuth).mockReturnValue({
      session: null,
      loading: false,
      refreshSession: vi.fn(),
    });

    const { container } = renderPage();
    expect(container.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Task 6.4 / 6.7 — no EM affordance, no cross-team/comparison UI (structural
// confirmation at the page level; per-item detail is covered by
// PreSessionActionItemReview's own test suite)
// ---------------------------------------------------------------------------
describe("6.4: no Start Session or advance control is rendered for a non-facilitator", () => {
  it("lobby branch renders no Start Session control for a non-facilitator", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: false });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("session-lobby-waiting")).toBeInTheDocument());
    expect(screen.queryByTestId("start-session-button")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// http-session-expiry-reauth-parity, tasks.md 3.0-3.8, design.md Decisions
// 1a and 2. Covers the shared reauth-required gate: the three fetch-driven
// signal sources on this page and the WS-driven `useConnectionHealth` state,
// their role/returnTo values, and the idempotency rule between them.
// ---------------------------------------------------------------------------
describe("3.5-3.8: reauth-required parity (http-session-expiry-reauth-parity)", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", { writable: true, value: originalLocation });
  });

  function stubLocation(pathname: string, search = ""): void {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, pathname, search, href: "" },
    });
  }

  function mockAuth(canFacilitateSessions: boolean): void {
    vi.mocked(useAuth).mockReturnValue({
      session: { ...mockSession, canFacilitateSessions },
      loading: false,
      refreshSession: vi.fn(),
    });
  }

  describe("3.6: fetch-response session-expiry on each call site", () => {
    it("action-items-review GET: renders the treatment with role=facilitator when canFacilitateSessions is true", async () => {
      mockAuth(true);
      stubLocation("/session/sess-1", "?x=1");
      mockSessionExpiredFetchOnce();
      renderPage("sess-1");

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByRole("alert").textContent).not.toMatch(/vote you haven't submitted/i);

      fireEvent.click(screen.getByRole("button", { name: /log in again/i }));
      expect(window.location.href).toBe(
        `/auth/login?returnTo=${encodeURIComponent("/session/sess-1?x=1")}`,
      );
    });

    it("action-items-review GET: renders the treatment with role=participant when canFacilitateSessions is false", async () => {
      mockAuth(false);
      mockSessionExpiredFetchOnce();
      renderPage("sess-1");

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByRole("alert").textContent).toMatch(/vote you haven't submitted/i);
    });

    it("action-items-review GET: a non-session-expiry 401 leaves the existing generic-error path, not the treatment", async () => {
      mockAuth(false);
      mockFetchOnce(401, { error: { category: "provider_unavailable", message: "x" } });
      renderPage("sess-1");

      await waitFor(() => expect(screen.getByTestId("session-lobby-review-error")).toBeInTheDocument());
      expect(screen.queryByRole("alert", { name: /log in again/i })).not.toBeInTheDocument();
    });

    it("start POST: renders the treatment with role=facilitator", async () => {
      mockAuth(true);
      mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: true });
      renderPage("sess-1");
      await waitFor(() => expect(screen.getByTestId("start-session-button")).toBeInTheDocument());

      mockSessionExpiredFetchOnce();
      fireEvent.click(screen.getByTestId("start-session-button"));

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByRole("alert").textContent).not.toMatch(/vote you haven't submitted/i);
      expect(screen.queryByTestId("start-session-error")).not.toBeInTheDocument();
    });

    it("start POST: a non-session-expiry failure derives its message from the response body", async () => {
      mockAuth(true);
      mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: true });
      renderPage("sess-1");
      await waitFor(() => expect(screen.getByTestId("start-session-button")).toBeInTheDocument());

      mockFetchOnce(500, { error: { message: "Server is unavailable." } });
      fireEvent.click(screen.getByTestId("start-session-button"));

      await waitFor(() => expect(screen.getByTestId("start-session-error")).toHaveTextContent("Server is unavailable."));
    });

    it("begin-voting POST: renders the treatment with role=facilitator", async () => {
      mockAuth(true);
      mockFetchOnce(200, {
        actionItems: [
          {
            actionItemId: "ai-1",
            description: "Fix flaky test",
            ownerUserId: "user-1",
            ownerDisplayName: "Alice",
            status: "open",
            originatingSessionId: "session-old-1",
            originatingSessionNumber: 3,
            stalenessLevel: "none",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
        isFacilitator: true,
      });
      renderPage("sess-1");
      await waitFor(() => expect(screen.getByTestId("begin-first-topic-button")).toBeInTheDocument());

      mockSessionExpiredFetchOnce();
      fireEvent.click(screen.getByTestId("begin-first-topic-button"));

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByRole("alert").textContent).not.toMatch(/vote you haven't submitted/i);
      expect(screen.queryByTestId("begin-first-topic-error")).not.toBeInTheDocument();
    });
  });

  describe("3.7: the WS-driven signal alone", () => {
    it("renders the treatment when useConnectionHealth's state transitions to reauth-required, with role following the canFacilitateSessions proxy", async () => {
      mockAuth(true);
      global.fetch = vi.fn(() => new Promise(() => {})); // GET never resolves
      renderPage("sess-1");

      await waitFor(() => expect(lastSocket).toBeDefined());
      act(() => {
        lastSocket?.emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
      });

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByRole("alert").textContent).not.toMatch(/vote you haven't submitted/i);
    });
  });

  describe("3.5/3.8: idempotency — first signal wins, second is a no-op", () => {
    it("WS signal first, then a fetch session-expiry — only one treatment, using the first signal's role/returnTo", async () => {
      mockAuth(false);
      stubLocation("/session/sess-1", "");
      mockSessionExpiredFetchOnce();
      renderPage("sess-1");

      await waitFor(() => expect(lastSocket).toBeDefined());
      act(() => {
        lastSocket?.emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
      });

      await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
      // The fetch's own session-expiry response has already resolved (or will
      // resolve) — it must not add a second treatment or alter the first.
      await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    });

    it("a start/begin-voting 401 first, then the WS close — only one treatment on screen", async () => {
      mockAuth(true);
      mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: true });
      renderPage("sess-1");
      await waitFor(() => expect(screen.getByTestId("start-session-button")).toBeInTheDocument());

      mockSessionExpiredFetchOnce();
      fireEvent.click(screen.getByTestId("start-session-button"));
      await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));

      act(() => {
        lastSocket?.emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
      });

      expect(screen.getAllByRole("alert")).toHaveLength(1);
    });
  });
});
