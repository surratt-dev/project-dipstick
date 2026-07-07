import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EmTrendDataPage } from "../EmTrendDataPage.js";
import type { EmTrendResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Tests for EmTrendDataPage (task 5.15)
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
    <MemoryRouter initialEntries={[`/team/${teamId}/em/trends`]}>
      <Routes>
        <Route path="/team/:teamId/em/trends" element={<EmTrendDataPage />} />
        <Route path="/team/:teamId/em" element={<div>Dashboard</div>} />
        <Route path="/team/:teamId/em/trends/:topicId" element={<div>Topic Detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockTrendResponse: EmTrendResponse = {
  teamId: "team-1",
  topics: [
    {
      topicId: "topic-quality",
      topicName: "Code Quality",
      sessions: [
        {
          sessionId: "sess-1",
          sessionDate: "2025-01-01T00:00:00Z",
          sessionNumber: 1,
          average: 3.5,
          median: 3.5,
          participantCount: 4,
        },
        {
          sessionId: "sess-2",
          sessionDate: "2025-02-01T00:00:00Z",
          sessionNumber: 2,
          average: 4.0,
          median: 4.0,
          participantCount: 4,
        },
        {
          sessionId: "sess-3",
          sessionDate: "2025-03-01T00:00:00Z",
          sessionNumber: 3,
          average: 4.5,
          median: 4.5,
          participantCount: 4,
        },
      ],
      overallAverage: 4.0,
      overallMedian: 4.0,
      trendDirection: 1,
    },
  ],
  dateRangeStart: "2025-01-01T00:00:00Z",
  dateRangeEnd: "2025-03-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(mockTrendResponse),
  } as unknown as Response);
});

// ---------------------------------------------------------------------------
// Task 5.15: Trend data view renders with statistical aggregates only
// ---------------------------------------------------------------------------
describe("5.15: EmTrendDataPage — trend data view", () => {
  it("renders the trend data heading", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-trend-data-heading")).toBeInTheDocument();
    });
    expect(screen.getByTestId("em-trend-data-heading")).toHaveTextContent("Trend Data");
  });

  it("renders topic trend cards with statistical aggregates", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("trend-card-topic-quality")).toBeInTheDocument();
    });

    // Aggregate stats — average and median
    expect(screen.getByTestId("trend-avg-topic-quality")).toHaveTextContent("4.00");
    expect(screen.getByTestId("trend-median-topic-quality")).toHaveTextContent("4");
  });

  it("renders trend direction without participant labels", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("trend-direction-topic-quality")).toBeInTheDocument();
    });
    // Trend direction — statistical summary without individual participant labels
    expect(screen.getByTestId("trend-direction-topic-quality")).toHaveTextContent(/Improving/i);
  });

  it("response contains NO vote-attributing fields (Decision 5)", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("trend-card-topic-quality")).toBeInTheDocument();
    });

    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("voter_id");
    expect(pageText).not.toContain("voterId");
    // Session data points show participant COUNT, not individual names
    expect(screen.getByTestId("session-data-points-topic-quality")).toBeInTheDocument();
    // Text contains "4 participants" (aggregate count) but no voter names
    expect(
      screen.getByTestId("session-data-points-topic-quality"),
    ).toHaveTextContent(/4 participants/i);
  });

  it("shows 403 error state when EM lacks access", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { message: "Forbidden" } }),
    } as unknown as Response);

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-trend-data-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("em-trend-data-error")).toHaveTextContent(/do not have access/i);
  });

  it("shows empty state when no trend data is available", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          teamId: "team-1",
          topics: [],
          dateRangeStart: null,
          dateRangeEnd: null,
        }),
    } as unknown as Response);

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-trend-data-empty")).toBeInTheDocument();
    });
  });

  it("fetches from the correct EM trends endpoint", async () => {
    renderPage("team-beta");
    await waitFor(() => {
      expect(screen.getByTestId("em-trend-data-heading")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/teams/team-beta/em/trends",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
