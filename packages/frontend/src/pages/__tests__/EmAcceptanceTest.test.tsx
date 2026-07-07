import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EmSessionHistoryPage } from "../EmSessionHistoryPage.js";
import { EmTrendDataPage } from "../EmTrendDataPage.js";
import { EmActionItemsPage } from "../EmActionItemsPage.js";

// ---------------------------------------------------------------------------
// Task 5.17 (full acceptance test):
// EM user can navigate to session history, trend data, and action items views;
// all three views render with correct field constraints enforced;
// no write controls are present in any EM-facing view.
//
// Task 5.9 (acceptance): QA scenario — EM cannot determine individual
// participant's vote for any topic in any session.
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

beforeEach(() => {
  vi.clearAllMocks();
});

// Session history fixture with realistic vote data
const sessionHistoryFixture = {
  teamId: "team-1",
  sessions: [
    {
      sessionId: "sess-1",
      sessionDate: "2025-03-01T09:00:00Z",
      sessionNumber: 5,
      facilitatorName: "Dana Facilitator",
      participantCount: 5,
      topics: [
        {
          topicId: "t-1",
          topicName: "Delivery Confidence",
          voteDistribution: [
            { voteValue: 3, count: 1, containsOutlier: false },
            { voteValue: 4, count: 3, containsOutlier: false },
            { voteValue: 2, count: 1, containsOutlier: true },
          ],
          average: 3.4,
          median: 4.0,
          flaggedForDiscussion: true,
        },
        {
          topicId: "t-2",
          topicName: "Team Collaboration",
          voteDistribution: [{ voteValue: 5, count: 5, containsOutlier: false }],
          average: 5.0,
          median: 5.0,
          flaggedForDiscussion: false,
        },
      ],
    },
  ],
};

const trendDataFixture = {
  teamId: "team-1",
  topics: [
    {
      topicId: "t-1",
      topicName: "Delivery Confidence",
      sessions: [
        { sessionId: "s1", sessionDate: "2025-01-01T00:00:00Z", sessionNumber: 1, average: 3.0, median: 3.0, participantCount: 5 },
        { sessionId: "s2", sessionDate: "2025-02-01T00:00:00Z", sessionNumber: 2, average: 3.5, median: 3.5, participantCount: 5 },
        { sessionId: "s3", sessionDate: "2025-03-01T00:00:00Z", sessionNumber: 3, average: 3.4, median: 4.0, participantCount: 5 },
      ],
      overallAverage: 3.3,
      overallMedian: 3.5,
      trendDirection: 1 as const,
    },
  ],
  dateRangeStart: "2025-01-01T00:00:00Z",
  dateRangeEnd: "2025-03-01T00:00:00Z",
};

const actionItemsFixture = {
  teamId: "team-1",
  actionItems: [
    {
      id: "ai-1",
      teamId: "team-1",
      sessionId: "sess-1",
      description: "Schedule bi-weekly retrospectives to improve delivery",
      status: "in_progress" as const,
      dueDate: null,
      ownerDisplayName: "Frank",
      resolutionNote: null,
      createdAt: "2025-03-01T10:00:00Z",
      updatedAt: "2025-03-01T10:00:00Z",
    },
  ],
};

// ---------------------------------------------------------------------------
// Task 5.17 — Full acceptance test
// ---------------------------------------------------------------------------
describe("5.17: EM views acceptance test", () => {
  it("session history view renders and enforces field constraints", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(sessionHistoryFixture),
    } as unknown as Response);

    render(
      <MemoryRouter initialEntries={["/team/team-1/em/sessions"]}>
        <Routes>
          <Route path="/team/:teamId/em/sessions" element={<EmSessionHistoryPage />} />
          <Route path="/team/:teamId/em" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("em-session-history-view")).toBeInTheDocument();
    });

    // View renders correctly
    expect(screen.getByTestId("em-session-history-heading")).toHaveTextContent("Session History");
    expect(screen.getByTestId("session-card-sess-1")).toBeInTheDocument();

    // Field constraints: facilitator name, participant count (aggregate)
    expect(screen.getByTestId("session-facilitator-sess-1")).toHaveTextContent("Dana Facilitator");
    expect(screen.getByTestId("session-participant-count-sess-1")).toHaveTextContent("5 participants");

    // No write controls
    expect(screen.queryByRole("button", { name: /create|add|edit|delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("trend data view renders and enforces field constraints", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(trendDataFixture),
    } as unknown as Response);

    render(
      <MemoryRouter initialEntries={["/team/team-1/em/trends"]}>
        <Routes>
          <Route path="/team/:teamId/em/trends" element={<EmTrendDataPage />} />
          <Route path="/team/:teamId/em" element={<div>Dashboard</div>} />
          <Route path="/team/:teamId/em/trends/:topicId" element={<div>Topic</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("em-trend-data-view")).toBeInTheDocument();
    });

    // View renders correctly
    expect(screen.getByTestId("em-trend-data-heading")).toHaveTextContent("Trend Data");
    expect(screen.getByTestId("trend-card-t-1")).toBeInTheDocument();

    // Statistical aggregates are present
    expect(screen.getByTestId("trend-avg-t-1")).toBeInTheDocument();
    expect(screen.getByTestId("trend-direction-t-1")).toHaveTextContent(/Improving/i);

    // No write controls
    expect(screen.queryByRole("button", { name: /create|add|edit|delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("action items view renders and enforces field constraints", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(actionItemsFixture),
    } as unknown as Response);

    render(
      <MemoryRouter initialEntries={["/team/team-1/em/action-items"]}>
        <Routes>
          <Route path="/team/:teamId/em/action-items" element={<EmActionItemsPage />} />
          <Route path="/team/:teamId/em" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("em-action-items-view")).toBeInTheDocument();
    });

    // View renders correctly
    expect(screen.getByTestId("em-action-items-heading")).toHaveTextContent("Action Items");
    expect(screen.getByTestId("action-item-card-ai-1")).toBeInTheDocument();

    // Action item body text visible (Decision 13)
    expect(screen.getByTestId("action-item-description-ai-1")).toHaveTextContent(
      "Schedule bi-weekly retrospectives",
    );

    // No write controls — read-only view
    expect(screen.queryByRole("button", { name: /create|add|edit|delete|update/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 5.9 — Acceptance: EM cannot determine individual participant's vote
// ---------------------------------------------------------------------------
describe("5.9: EM acceptance — cannot determine individual participant's vote", () => {
  it("session history response contains no per-participant vote attribution", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(sessionHistoryFixture),
    } as unknown as Response);

    render(
      <MemoryRouter initialEntries={["/team/team-1/em/sessions"]}>
        <Routes>
          <Route path="/team/:teamId/em/sessions" element={<EmSessionHistoryPage />} />
          <Route path="/team/:teamId/em" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("em-session-history-view")).toBeInTheDocument();
    });

    const pageText = document.body.textContent ?? "";

    // Attribution boundary (Decision 5): the session history page must not
    // surface the connection between a specific vote value and the participant
    // who cast it. The rendered page must contain ONLY aggregate information.

    // Vote values ARE shown (aggregate distributions permitted)
    expect(screen.getByTestId("vote-bucket-t-1-4")).toBeInTheDocument(); // 4 × 3

    // But INDIVIDUAL voter identity must never appear
    expect(pageText).not.toContain("voter_id");
    expect(pageText).not.toContain("voterId");

    // Participant count is aggregate (e.g., "5 participants"), not named
    // The test verifies the view shows "5 participants" not individual names
    const participantCountEl = screen.getByTestId("session-participant-count-sess-1");
    expect(participantCountEl).toHaveTextContent(/^\d+ participants?$/);

    // Outlier presence is shown (permitted) but identity is not
    // "↑" marker on the vote bucket shows there is an outlier, but not WHO
    expect(screen.getByTestId("vote-distribution-t-1")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 9.2 — EM cannot join a session (no session join controls in EM views)
// ---------------------------------------------------------------------------
describe("9.2: EM cannot join a session through any EM-facing view", () => {
  it("session history view has no 'join session' control", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(sessionHistoryFixture),
    } as unknown as Response);

    render(
      <MemoryRouter initialEntries={["/team/team-1/em/sessions"]}>
        <Routes>
          <Route path="/team/:teamId/em/sessions" element={<EmSessionHistoryPage />} />
          <Route path="/team/:teamId/em" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("em-session-history-view")).toBeInTheDocument();
    });

    // No join session affordance
    expect(screen.queryByRole("button", { name: /join/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /join session/i })).not.toBeInTheDocument();
  });
});
