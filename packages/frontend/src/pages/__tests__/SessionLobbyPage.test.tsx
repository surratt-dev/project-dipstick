import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SessionLobbyPage } from "../SessionLobbyPage.js";

// ---------------------------------------------------------------------------
// Tests for SessionLobbyPage
//
// Task 7.1: Access model statement MUST be present in session lobby.
//   Decision 8 requires BOTH team view AND session lobby — "and" not "or".
// Task 7.3: No modal or pop-up triggered by normal user actions (joining lobby).
// Task 7.4: Separate test verifying statement presence in session lobby.
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    session: mockSession,
    loading: false,
    refreshSession: vi.fn(),
  });
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

// ---------------------------------------------------------------------------
// Task 7.1 — Access model statement present in session lobby
// ---------------------------------------------------------------------------
describe("7.1: Access model statement in session lobby", () => {
  it("renders the access model statement in the session lobby", () => {
    renderPage();
    expect(screen.getByTestId("session-lobby-access-model-statement")).toBeInTheDocument();
    expect(screen.getByTestId("session-lobby-access-model-statement")).toHaveTextContent(
      /Your Engineering Manager can see session history but cannot join or observe live sessions/i,
    );
  });

  it("session lobby renders the session info", () => {
    renderPage("sess-abc-123");
    expect(screen.getByTestId("session-lobby")).toBeInTheDocument();
    expect(screen.getByTestId("session-lobby-info")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 7.3 — No modal or pop-up triggered by normal user actions
// The team view test covers the no-modal check for that surface.
// This test covers the session lobby surface.
// ---------------------------------------------------------------------------
describe("7.3: No modal or pop-up in session lobby", () => {
  it("no modal is triggered when loading the session lobby", () => {
    renderPage();
    // No dialog element — the access model statement is inline, not in a modal
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("no acknowledgment flow is triggered — access model statement does not require dismissal", () => {
    renderPage();
    // No button to dismiss/acknowledge the access model statement
    expect(
      screen.queryByRole("button", { name: /acknowledge|dismiss|ok|close/i }),
    ).not.toBeInTheDocument();
  });

  it("statement is findable but not prominent — rendered as static paragraph text", () => {
    renderPage();
    const statement = screen.getByTestId("session-lobby-access-model-statement");
    // Not an alert
    expect(statement).not.toHaveAttribute("role", "alert");
    // Not a dialog
    expect(statement).not.toHaveAttribute("role", "dialog");
    // Not a status banner
    expect(statement).not.toHaveAttribute("role", "status");
  });
});

// ---------------------------------------------------------------------------
// Task 7.4 — Separate test verifying statement is in session lobby
// (This test is independent from the team view statement test — both surfaces
// must be verified by independent tests per task 7.4 requirement)
// ---------------------------------------------------------------------------
describe("7.4: Session lobby has access model statement — independent verification", () => {
  it("session lobby contains the exact access model statement text", () => {
    renderPage();
    // This is an independent test from the team view placement test.
    // Both surfaces (team view in MemberManagement.test.tsx and session lobby
    // here) must be verified by independent tests per Decision 8 requirements.
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
