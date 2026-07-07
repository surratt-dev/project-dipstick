import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EmSessionHistoryPage } from "../EmSessionHistoryPage.js";
import type { EmSessionHistoryResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Tests for EmSessionHistoryPage (task 5.14)
// ---------------------------------------------------------------------------

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: vi.fn().mockReturnValue({
    session: {
      user: { id: "em-user-1", displayName: "Eve EM", email: "eve@test.com" },
      teamMemberships: [{ teamId: "team-1", teamName: "Alpha", role: "engineering_manager" }],
      sessionCreatedAt: "",
      expiresAt: "",
    },
    loading: false,
    refreshSession: vi.fn(),
  }),
}));

function renderPage(teamId = "team-1") {
  return render(
    <MemoryRouter initialEntries={[`/team/${teamId}/em/sessions`]}>
      <Routes>
        <Route path="/team/:teamId/em/sessions" element={<EmSessionHistoryPage />} />
        <Route path="/team/:teamId/em" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockHistoryResponse: EmSessionHistoryResponse = {
  teamId: "team-1",
  sessions: [
    {
      sessionId: "sess-1",
      sessionDate: "2025-01-15T10:00:00Z",
      sessionNumber: 1,
      facilitatorName: "Alice Facilitator",
      participantCount: 4,
      topics: [
        {
          topicId: "topic-1",
          topicName: "Delivery Confidence",
          voteDistribution: [
            { voteValue: 3, count: 2, containsOutlier: false },
            { voteValue: 5, count: 2, containsOutlier: true },
          ],
          average: 4.0,
          median: 4.0,
          flaggedForDiscussion: false,
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(mockHistoryResponse),
  } as unknown as Response);
});

// ---------------------------------------------------------------------------
// Task 5.14: Session history view renders with field constraints
// ---------------------------------------------------------------------------
describe("5.14: EmSessionHistoryPage — session history view", () => {
  it("renders the session history heading", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-session-history-heading")).toBeInTheDocument();
    });
    expect(screen.getByTestId("em-session-history-heading")).toHaveTextContent("Session History");
  });

  it("renders session cards with permitted fields", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("session-card-sess-1")).toBeInTheDocument();
    });

    // Permitted: session date, facilitator name, aggregate participant count
    expect(screen.getByTestId("session-facilitator-sess-1")).toHaveTextContent(
      "Alice Facilitator",
    );
    expect(screen.getByTestId("session-participant-count-sess-1")).toHaveTextContent("4 participants");
  });

  it("renders aggregate vote distribution — no voter identity", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("vote-distribution-topic-1")).toBeInTheDocument();
    });

    // Bucket: "3 × 2" and "5 × 2" — aggregate distribution
    expect(screen.getByTestId("vote-bucket-topic-1-3")).toHaveTextContent("3 × 2");
    expect(screen.getByTestId("vote-bucket-topic-1-5")).toHaveTextContent("5 × 2");
  });

  it("response body shown on screen contains NO vote-attributing fields (Decision 5)", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("session-card-sess-1")).toBeInTheDocument();
    });

    // The rendered page text must not contain any voter-identifying fields
    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("voter_id");
    expect(pageText).not.toContain("voterId");
    // The voter identity must not appear anywhere
    expect(pageText).not.toMatch(/voter[_\s]?id/i);
  });

  it("shows 403 error state when EM lacks team association", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { message: "Forbidden" } }),
    } as unknown as Response);

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-session-history-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("em-session-history-error")).toHaveTextContent(
      /do not have access/i,
    );
  });

  it("shows empty state when no completed sessions exist", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ teamId: "team-1", sessions: [] }),
    } as unknown as Response);

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-session-history-empty")).toBeInTheDocument();
    });
  });

  it("fetches from the correct EM session history endpoint", async () => {
    renderPage("team-alpha");
    await waitFor(() => {
      expect(screen.getByTestId("em-session-history-heading")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/teams/team-alpha/em/sessions",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
