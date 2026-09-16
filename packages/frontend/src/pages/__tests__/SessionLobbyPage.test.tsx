import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
    expect(screen.getByTestId("session-lobby-info")).toBeInTheDocument();
    expect(screen.queryByTestId("start-session-button")).not.toBeInTheDocument();
  });

  it("409 with currentSessionStatus 'lobby' and isFacilitator: true -> shows the Start Session control", async () => {
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: true });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("start-session-button")).toBeInTheDocument());
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
    mockFetchOnce(409, { currentSessionStatus: "lobby", isFacilitator: false });
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
