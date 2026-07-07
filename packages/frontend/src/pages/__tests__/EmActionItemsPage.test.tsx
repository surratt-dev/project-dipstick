import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EmActionItemsPage } from "../EmActionItemsPage.js";
import type { EmActionItemsResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Tests for EmActionItemsPage (task 5.16)
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
    <MemoryRouter initialEntries={[`/team/${teamId}/em/action-items`]}>
      <Routes>
        <Route path="/team/:teamId/em/action-items" element={<EmActionItemsPage />} />
        <Route path="/team/:teamId/em" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockActionItemsResponse: EmActionItemsResponse = {
  teamId: "team-1",
  actionItems: [
    {
      id: "ai-1",
      teamId: "team-1",
      sessionId: "sess-1",
      description: "Improve code review process to reduce review cycle time",
      status: "open",
      dueDate: null,
      ownerDisplayName: "Alice",
      resolutionNote: null,
      createdAt: "2025-01-15T10:00:00Z",
      updatedAt: "2025-01-15T10:00:00Z",
    },
    {
      id: "ai-2",
      teamId: "team-1",
      sessionId: "sess-2",
      description: "Set up automated deployment pipeline for staging",
      status: "resolved",
      dueDate: null,
      ownerDisplayName: "Bob",
      resolutionNote: "Pipeline deployed and validated in staging environment",
      createdAt: "2025-02-01T10:00:00Z",
      updatedAt: "2025-02-20T10:00:00Z",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(mockActionItemsResponse),
  } as unknown as Response);
});

// ---------------------------------------------------------------------------
// Task 5.16: Action items read-only view
// ---------------------------------------------------------------------------
describe("5.16: EmActionItemsPage — action items read-only view", () => {
  it("renders the action items heading", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-action-items-heading")).toBeInTheDocument();
    });
    expect(screen.getByTestId("em-action-items-heading")).toHaveTextContent("Action Items");
  });

  it("renders action item description (body text visible per Decision 13)", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("action-item-description-ai-1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("action-item-description-ai-1")).toHaveTextContent(
      "Improve code review process to reduce review cycle time",
    );
  });

  it("renders action item status", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("action-item-status-ai-1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("action-item-status-ai-1")).toHaveTextContent("Open");
    expect(screen.getByTestId("action-item-status-ai-2")).toHaveTextContent("Resolved");
  });

  it("renders ownerDisplayName — visible per Q8 resolution and Decision 13", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("action-item-owner-ai-1")).toBeInTheDocument();
    });
    // ownerDisplayName IS shown (Q8/Decision 13 — work-tracking data, not vote attribution)
    expect(screen.getByTestId("action-item-owner-ai-1")).toHaveTextContent("Alice");
    expect(screen.getByTestId("action-item-owner-ai-2")).toHaveTextContent("Bob");
  });

  it("renders resolution note when present", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("action-item-resolution-ai-2")).toBeInTheDocument();
    });
    expect(screen.getByTestId("action-item-resolution-ai-2")).toHaveTextContent(
      "Pipeline deployed and validated in staging environment",
    );
  });

  it("NO write affordances are present — this is a read-only view (task 5.16, Decision 11)", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-action-items-view")).toBeInTheDocument();
    });

    // No create, update, or delete buttons
    expect(screen.queryByRole("button", { name: /add|create|new action/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit|update|save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete|remove/i })).not.toBeInTheDocument();
    // No form fields that would allow editing
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows 403 error state when EM lacks access", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { message: "Forbidden" } }),
    } as unknown as Response);

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-action-items-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("em-action-items-error")).toHaveTextContent(/do not have access/i);
  });

  it("shows empty state when no action items exist", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ teamId: "team-1", actionItems: [] }),
    } as unknown as Response);

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-action-items-empty")).toBeInTheDocument();
    });
  });

  it("fetches from the correct EM action items endpoint", async () => {
    renderPage("team-gamma");
    await waitFor(() => {
      expect(screen.getByTestId("em-action-items-heading")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/teams/team-gamma/em/action-items",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("response shown on screen contains NO voter identity fields (Decision 5 vote attribution boundary)", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("em-action-items-view")).toBeInTheDocument();
    });

    const pageText = document.body.textContent ?? "";
    // No vote values on action items
    expect(pageText).not.toContain("voter_id");
    expect(pageText).not.toContain("ownerId");
    // ownerDisplayName IS present (correct), but ownerId/owner_id must not be
    expect(pageText).not.toContain("owner_id");
  });
});

// ---------------------------------------------------------------------------
// Task 5.17 (partial): Acceptance test — EM views render with correct constraints
// Full 5.17 acceptance test is in EmAcceptanceTest.test.tsx
// ---------------------------------------------------------------------------
describe("5.17: Action items view renders with all field constraints enforced", () => {
  it("all three field types are present: description, status, ownerDisplayName", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("action-item-card-ai-1")).toBeInTheDocument();
    });

    // Description (body text — permitted per Decision 13)
    expect(screen.getByTestId("action-item-description-ai-1")).toBeInTheDocument();
    // Status
    expect(screen.getByTestId("action-item-status-ai-1")).toBeInTheDocument();
    // Owner display name (permitted per Q8/Decision 13)
    expect(screen.getByTestId("action-item-owner-ai-1")).toBeInTheDocument();
  });
});
