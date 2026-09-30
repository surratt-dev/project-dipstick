import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TopicManagementPage } from "../TopicManagementPage.js";
import type { GetAllTopicsResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// TopicManagementPage — remove-topic, design.md Decision 10, tasks.md Task 9.7.
// Extended by re-add-removed-topic, design.md Decision 5, tasks.md Section 6.
// ---------------------------------------------------------------------------

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: vi.fn().mockReturnValue({
    session: {
      user: { id: "facilitator-1", displayName: "Marcus", email: "marcus@test.com" },
      teamMemberships: [],
      sessionCreatedAt: "",
      expiresAt: "",
    },
    loading: false,
    refreshSession: vi.fn(),
  }),
}));

function renderPage(teamId = "team-1") {
  return render(
    <MemoryRouter initialEntries={[`/team/${teamId}/topics`]}>
      <Routes>
        <Route path="/team/:teamId/topics" element={<TopicManagementPage />} />
        <Route path="/team/:teamId" element={<div>Team Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const baseTopicsResponse: GetAllTopicsResponse = {
  teamId: "team-1",
  teamName: "Platform Squad",
  isCustomizationLocked: false,
  active: [
    {
      topicId: "topic-1",
      name: "Pairing Effectiveness",
      prompt: "How effective is pairing?",
      voteType: "finger",
      displayOrder: 0,
      isDefault: false,
      firstSessionDescription: null,
      teamAnnotation: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      topicId: "topic-2",
      name: "Pipeline",
      prompt: "Confidence in the pipeline",
      voteType: "roman",
      displayOrder: 1,
      isDefault: true,
      firstSessionDescription: "Rate deployment confidence.",
      teamAnnotation: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  archived: [
    {
      topicId: "topic-old",
      name: "Old Topic",
      prompt: "An old prompt",
      voteType: "finger",
      isDefault: false,
      archivedAt: "2026-08-01T12:00:00.000Z",
      archivedBy: { userId: "user-9", displayName: "Priya Nair" },
      restoredAt: null,
      restoredBy: null,
    },
  ],
  defaultTopicsNotActive: [],
};

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Task 9.2 — active topic list with prompt, vote type, and remove action
// ---------------------------------------------------------------------------
describe("active topic list", () => {
  it("renders each active topic's prompt, vote type, and description, with a Remove action", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockFetchResponse(baseTopicsResponse));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Pairing Effectiveness")).toBeInTheDocument();
    });

    expect(screen.getByText("How effective is pairing?")).toBeInTheDocument();
    expect(screen.getByText(/Finger Voting/)).toBeInTheDocument();
    expect(screen.getByText("Rate deployment confidence.")).toBeInTheDocument();
    expect(screen.getByTestId("remove-topic-topic-1")).toBeInTheDocument();
    expect(screen.getByTestId("remove-topic-topic-2")).toBeInTheDocument();
  });

  it("does not show the Remove action when the team's customization lock is active", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ ...baseTopicsResponse, isCustomizationLocked: true }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Pairing Effectiveness")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("remove-topic-topic-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("customization-lock-notice")).toBeInTheDocument();
  });

  it("shows an access-denied state, not the topic list, for a 403 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({}, 403));

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("topic-management-error")).toBeInTheDocument();
    });

    expect(screen.queryByText("Pairing Effectiveness")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 9.3 — confirmation flow naming both topic and team, escalating in place
// ---------------------------------------------------------------------------
describe("remove confirmation flow", () => {
  it("names both the topic and the team, and states historical data is retained, before any request is sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(baseTopicsResponse));
    global.fetch = fetchMock;

    renderPage();
    await waitFor(() => screen.getByTestId("remove-topic-topic-1"));

    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));

    const heading = screen.getByTestId("remove-topic-dialog-heading");
    expect(heading.textContent).toContain("Pairing Effectiveness");
    expect(heading.textContent).toContain("Platform Squad");
    expect(screen.getByText(/historical data will be retained/)).toBeInTheDocument();

    // Only the initial GET has run — no DELETE sent until explicit confirm.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancelling the confirmation makes no request and the topic remains active", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(baseTopicsResponse));
    global.fetch = fetchMock;

    renderPage();
    await waitFor(() => screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("cancel-remove-topic-1"));

    expect(screen.queryByTestId("remove-topic-dialog")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Pairing Effectiveness")).toBeInTheDocument();
  });

  it("confirming with no open action items archives immediately and refreshes the list", async () => {
    const refreshedResponse: GetAllTopicsResponse = {
      ...baseTopicsResponse,
      active: baseTopicsResponse.active.filter((t) => t.topicId !== "topic-1"),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(baseTopicsResponse)) // initial GET
      .mockResolvedValueOnce(
        mockFetchResponse({ topicId: "topic-1", status: "archived", archivedAt: "2026-09-30T00:00:00.000Z" }),
      ) // DELETE (no confirm)
      .mockResolvedValueOnce(mockFetchResponse(refreshedResponse)); // refresh GET
    global.fetch = fetchMock;

    renderPage();
    await waitFor(() => screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("confirm-remove-topic-1"));

    await waitFor(() => {
      expect(screen.queryByText("Pairing Effectiveness")).not.toBeInTheDocument();
    });

    const deleteCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(deleteCall[0]).toBe("/api/v1/teams/team-1/topics/topic-1");
    expect(deleteCall[1].method).toBe("DELETE");
  });

  it("escalates the same dialog in place with the open-action-item warning, not a second dialog", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(baseTopicsResponse)) // initial GET
      .mockResolvedValueOnce(
        mockFetchResponse({
          requiresConfirmation: true,
          reason: "openActionItems",
          openActionItemCount: 2,
          openActionItems: [
            { actionItemId: "ai-1", description: "Fix the flaky test" },
            { actionItemId: "ai-2", description: "Update the runbook" },
          ],
          message: "2 open action items will stay open, but nothing will remind anyone about them going forward.",
        }),
      );
    global.fetch = fetchMock;

    renderPage();
    await waitFor(() => screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("confirm-remove-topic-1"));

    await waitFor(() => {
      expect(screen.getByTestId("open-action-items-warning-heading")).toBeInTheDocument();
    });

    // Exactly one dialog element on screen — the same one, in place.
    expect(screen.getAllByTestId("remove-topic-dialog")).toHaveLength(1);
    expect(screen.getByText("Fix the flaky test")).toBeInTheDocument();
    expect(screen.getByText("Update the runbook")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-archive-anyway-topic-1")).toBeInTheDocument();
  });

  it("a second confirmation sends the request with confirm=true and archives on success", async () => {
    const refreshedResponse: GetAllTopicsResponse = {
      ...baseTopicsResponse,
      active: baseTopicsResponse.active.filter((t) => t.topicId !== "topic-1"),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(baseTopicsResponse)) // initial GET
      .mockResolvedValueOnce(
        mockFetchResponse({
          requiresConfirmation: true,
          reason: "openActionItems",
          openActionItemCount: 1,
          openActionItems: [{ actionItemId: "ai-1", description: "Still open" }],
          message: "1 open action item will stay open.",
        }),
      ) // first DELETE
      .mockResolvedValueOnce(
        mockFetchResponse({ topicId: "topic-1", status: "archived", archivedAt: "2026-09-30T00:00:00.000Z" }),
      ) // second DELETE (confirm=true)
      .mockResolvedValueOnce(mockFetchResponse(refreshedResponse)); // refresh GET
    global.fetch = fetchMock;

    renderPage();
    await waitFor(() => screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("confirm-remove-topic-1"));
    await waitFor(() => screen.getByTestId("confirm-archive-anyway-topic-1"));
    fireEvent.click(screen.getByTestId("confirm-archive-anyway-topic-1"));

    await waitFor(() => {
      expect(screen.queryByText("Pairing Effectiveness")).not.toBeInTheDocument();
    });

    const secondDeleteCall = fetchMock.mock.calls[2] as [string];
    expect(secondDeleteCall[0]).toBe("/api/v1/teams/team-1/topics/topic-1?confirm=true");
  });
});

// ---------------------------------------------------------------------------
// Task 9.4 — hard block on removing the last active topic
// ---------------------------------------------------------------------------
describe("last-active-topic block", () => {
  it("shows a specific, clear message and the topic remains listed", async () => {
    const singleTopicResponse: GetAllTopicsResponse = {
      ...baseTopicsResponse,
      active: [baseTopicsResponse.active[0]!],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(singleTopicResponse)) // initial GET
      .mockResolvedValueOnce(
        mockFetchResponse(
          {
            error: {
              category: "precondition_failed",
              code: "TOPIC_LAST_ACTIVE",
              message: "This is the team's last active topic.",
              correlationId: "corr-1",
            },
          },
          409,
        ),
      );
    global.fetch = fetchMock;

    renderPage();
    await waitFor(() => screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("remove-topic-topic-1"));
    fireEvent.click(screen.getByTestId("confirm-remove-topic-1"));

    await waitFor(() => {
      expect(screen.getByTestId("last-active-blocked-topic-1")).toBeInTheDocument();
    });

    expect(screen.getByTestId("last-active-blocked-topic-1").textContent).toContain(
      "At least one active topic must remain",
    );
    expect(screen.getByText("Pairing Effectiveness")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 9.5 — archived-topics view with provenance
// ---------------------------------------------------------------------------
describe("archived topics view", () => {
  it("shows who archived each topic and when", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockFetchResponse(baseTopicsResponse));

    renderPage();
    await waitFor(() => screen.getByTestId("toggle-archived-topics"));
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    await waitFor(() => {
      expect(screen.getByTestId("archived-provenance-topic-old")).toBeInTheDocument();
    });

    const provenanceText = screen.getByTestId("archived-provenance-topic-old").textContent ?? "";
    expect(provenanceText).toContain("Priya Nair");
  });

  it("shows an empty state when there are no archived topics", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({ ...baseTopicsResponse, archived: [] }));

    renderPage();
    await waitFor(() => screen.getByTestId("toggle-archived-topics"));
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    await waitFor(() => {
      expect(screen.getByTestId("archived-topics-empty")).toBeInTheDocument();
    });

    // Task 6.6 — no restore action rendered when the archived list is empty.
    expect(screen.queryByTestId(/^restore-topic-/)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Task 6.1b/6.1c — restoredAt/restoredBy provenance line
  // -------------------------------------------------------------------------
  it("renders a second provenance line when restoredAt/restoredBy are present on an archived row", async () => {
    const restoredResponse: GetAllTopicsResponse = {
      ...baseTopicsResponse,
      archived: [
        {
          ...baseTopicsResponse.archived[0]!,
          restoredAt: "2026-09-15T09:00:00.000Z",
          restoredBy: { userId: "user-4", displayName: "Marcus Oyelaran" },
        },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue(mockFetchResponse(restoredResponse));

    renderPage();
    await waitFor(() => screen.getByTestId("toggle-archived-topics"));
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    await waitFor(() => {
      expect(screen.getByTestId("restored-provenance-topic-old")).toBeInTheDocument();
    });
    expect(screen.getByTestId("restored-provenance-topic-old").textContent).toContain("Marcus Oyelaran");
  });

  it("renders no second provenance line when a topic has never been restored", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockFetchResponse(baseTopicsResponse));

    renderPage();
    await waitFor(() => screen.getByTestId("toggle-archived-topics"));
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    await waitFor(() => {
      expect(screen.getByTestId("archived-provenance-topic-old")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("restored-provenance-topic-old")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 6.2-6.5 — restore confirmation flow
// ---------------------------------------------------------------------------
describe("restore confirmation flow", () => {
  it("names both the topic and the team before any request is sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(baseTopicsResponse));
    global.fetch = fetchMock;

    renderPage();
    await waitFor(() => screen.getByTestId("toggle-archived-topics"));
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    await waitFor(() => screen.getByTestId("restore-topic-topic-old"));
    fireEvent.click(screen.getByTestId("restore-topic-topic-old"));

    const heading = screen.getByTestId("restore-topic-dialog-heading");
    expect(heading.textContent).toContain("Old Topic");
    expect(heading.textContent).toContain("Platform Squad");
    expect(heading.textContent).toContain("Historical data will be restored");

    // Only the initial GET has run — no POST sent until explicit confirm.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancelling sends no request and leaves the topic in the archived list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(baseTopicsResponse));
    global.fetch = fetchMock;

    renderPage();
    await waitFor(() => screen.getByTestId("toggle-archived-topics"));
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    await waitFor(() => screen.getByTestId("restore-topic-topic-old"));
    fireEvent.click(screen.getByTestId("restore-topic-topic-old"));
    fireEvent.click(screen.getByTestId("cancel-restore-topic-old"));

    expect(screen.queryByTestId("restore-topic-dialog")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Old Topic")).toBeInTheDocument();
  });

  it("confirming restores the topic: it disappears from archived and appears in active", async () => {
    const refreshedResponse: GetAllTopicsResponse = {
      ...baseTopicsResponse,
      active: [
        ...baseTopicsResponse.active,
        {
          topicId: "topic-old",
          name: "Old Topic",
          prompt: "An old prompt",
          voteType: "finger",
          displayOrder: 2,
          isDefault: false,
          firstSessionDescription: null,
          teamAnnotation: null,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-09-30T00:00:00.000Z",
        },
      ],
      archived: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(baseTopicsResponse)) // initial GET
      .mockResolvedValueOnce(
        mockFetchResponse({
          topicId: "topic-old",
          name: "Old Topic",
          status: "active",
          displayOrder: 2,
          restoredAt: "2026-09-30T00:00:00.000Z",
        }),
      ) // POST restore
      .mockResolvedValueOnce(mockFetchResponse(refreshedResponse)); // refresh GET
    global.fetch = fetchMock;

    renderPage();
    await waitFor(() => screen.getByTestId("toggle-archived-topics"));
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    await waitFor(() => screen.getByTestId("restore-topic-topic-old"));
    fireEvent.click(screen.getByTestId("restore-topic-topic-old"));
    fireEvent.click(screen.getByTestId("confirm-restore-topic-old"));

    await waitFor(() => {
      expect(screen.queryByTestId("archived-topic-row-topic-old")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("topic-row-topic-old")).toBeInTheDocument();

    const restoreCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(restoreCall[0]).toBe("/api/v1/teams/team-1/topics/topic-old/restore");
    expect(restoreCall[1].method).toBe("POST");
  });
});
