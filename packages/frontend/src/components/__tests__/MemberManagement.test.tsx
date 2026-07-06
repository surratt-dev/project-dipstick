import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemberManagement } from "../MemberManagement.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../../auth/AuthContext.js";

const mockRefreshSession = vi.fn().mockResolvedValue(undefined);

// Default mock: authenticated, no-op refreshSession
function mockAuthAs(overrides: { refreshSession?: typeof mockRefreshSession } = {}) {
  vi.mocked(useAuth).mockReturnValue({
    session: {
      user: { id: "actor-1", displayName: "Actor", email: "actor@test.com" },
      teamMemberships: [],
      sessionCreatedAt: "",
      expiresAt: "",
    },
    loading: false,
    refreshSession: overrides.refreshSession ?? mockRefreshSession,
  });
}

// ---------------------------------------------------------------------------
// Shared member list response fixtures
// ---------------------------------------------------------------------------
const membersResponseWithAssignRoles = {
  teamId: "team-1",
  teamName: "Alpha",
  canAssignRoles: true,
  members: [
    {
      userId: "u1",
      displayName: "Alice",
      email: "alice@test.com",
      role: "participant" as const,
    },
    {
      userId: "u2",
      displayName: "Bob",
      email: "bob@test.com",
      role: "engineering_manager" as const,
    },
  ],
};

const membersResponseNoAssignRoles = {
  ...membersResponseWithAssignRoles,
  canAssignRoles: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthAs();
  // Default fetch mock — GET returns member list with canAssignRoles:true
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(membersResponseWithAssignRoles),
  } as unknown as Response);
});

// ---------------------------------------------------------------------------
// Task 5.1 — member list renders role labels without drill-downs
// ---------------------------------------------------------------------------
describe("5.1: Member list shows role labels in list view", () => {
  it("renders all members with their current role labels visible", async () => {
    render(<MemberManagement teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    // Task 5.8 / Decision 8: database values must NOT appear as visible labels
    expect(screen.queryByText("participant")).not.toBeInTheDocument();
    expect(screen.queryByText("engineering_manager")).not.toBeInTheDocument();

    // Human-readable labels ARE present
    expect(screen.getAllByText(/Engineer/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Engineering Manager/).length).toBeGreaterThan(0);
  });

  it("shows 'Engineer' for membership_role=participant", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      const aliceLabel = screen.getByTestId("role-label-u1");
      expect(aliceLabel).toHaveTextContent("Engineer");
      expect(aliceLabel).not.toHaveTextContent("participant");
    });
  });

  it("shows 'Engineering Manager' for membership_role=engineering_manager", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      const bobLabel = screen.getByTestId("role-label-u2");
      expect(bobLabel).toHaveTextContent("Engineering Manager");
      expect(bobLabel).not.toHaveTextContent("engineering_manager");
    });
  });
});

// ---------------------------------------------------------------------------
// Task 5.2 — role selector has exactly two options; Facilitator not present
// ---------------------------------------------------------------------------
describe("5.2: Role selector has exactly two options, no Facilitator", () => {
  it("renders a role selector with exactly two options for each member", async () => {
    render(<MemberManagement teamId="team-1" />);

    await waitFor(() => {
      const selects = screen.getAllByRole("combobox");
      // One selector per member
      expect(selects).toHaveLength(2);

      for (const sel of selects) {
        const options = sel.querySelectorAll("option");
        expect(options).toHaveLength(2);
      }
    });
  });

  it("7.8: does not include 'Facilitator' in the role selector under any condition", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.queryByText(/Facilitator/i)).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Task 5.3 — inline role descriptions
// ---------------------------------------------------------------------------
describe("5.3 / 7.10: Inline role descriptions appear in the role selector", () => {
  it("shows 'Engineer — participates in session voting' option", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      const engineerOption = options.find((o) =>
        o.textContent?.includes("Engineer — participates in session voting"),
      );
      expect(engineerOption).toBeDefined();
    });
  });

  it("shows 'Engineering Manager — can view session history; will not vote' option", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      const emOption = options.find((o) =>
        o.textContent?.includes(
          "Engineering Manager — can view session history; will not vote",
        ),
      );
      expect(emOption).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Task 5.4 / 5.5 — two-step confirmation when 422 returned
// ---------------------------------------------------------------------------
describe("5.4 / 5.5: Two-step confirmation flow for zero-participant case", () => {
  it("displays zero-participant warning BEFORE applying the change when server returns 422", async () => {
    // First fetch (GET members) succeeds; second (PATCH) returns 422
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(membersResponseWithAssignRoles),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ requiresConfirmation: true }),
      } as unknown as Response);

    render(<MemberManagement teamId="team-1" />);

    // Open the selector for Alice (currently participant) and change to EM
    await waitFor(() => {
      expect(screen.getByTestId("role-select-u1")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("role-select-u1"), {
      target: { value: "engineering_manager" },
    });

    // Warning appears before confirmation
    await waitFor(() => {
      expect(
        screen.getByTestId("zero-participant-warning-u1"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        /This change will leave Alpha with no Engineers\. A session cannot start without at least one Engineer\. You can still make this change\./i,
      ),
    ).toBeInTheDocument();
  });

  it("resubmits with confirmedZeroParticipant: true when actor confirms", async () => {
    // Updated members list for the reload after successful change
    const updatedMembers = {
      ...membersResponseWithAssignRoles,
      members: [
        { ...membersResponseWithAssignRoles.members[0], role: "engineering_manager" as const },
        membersResponseWithAssignRoles.members[1],
      ],
    };

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(membersResponseWithAssignRoles),
      } as unknown as Response)
      // PATCH — first attempt returns 422
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ requiresConfirmation: true }),
      } as unknown as Response)
      // PATCH — second attempt (confirmed) returns 200
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            member: {
              userId: "u1",
              displayName: "Alice",
              email: "alice@test.com",
              role: "engineering_manager",
            },
          }),
      } as unknown as Response)
      // GET reload after success
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(updatedMembers),
      } as unknown as Response);

    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("role-select-u1")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("role-select-u1"), {
      target: { value: "engineering_manager" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("zero-participant-warning-u1")).toBeInTheDocument();
    });

    // Actor confirms
    fireEvent.click(screen.getByTestId("confirm-zero-participant-u1"));

    await waitFor(() => {
      const patchCall = (vi.mocked(global.fetch).mock.calls as Parameters<typeof fetch>[][][]).find(
        (args) => {
          const init = args[1] as RequestInit | undefined;
          return (
            (args[0] as string).includes("/role") &&
            init?.method === "PATCH" &&
            typeof init.body === "string" &&
            (JSON.parse(init.body) as Record<string, unknown>).confirmedZeroParticipant === true
          );
        },
      );
      expect(patchCall).toBeDefined();
    });
  });

  it("does NOT resubmit when actor cancels the warning", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(membersResponseWithAssignRoles),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ requiresConfirmation: true }),
      } as unknown as Response);

    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("role-select-u1")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("role-select-u1"), {
      target: { value: "engineering_manager" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("zero-participant-warning-u1")).toBeInTheDocument();
    });

    // Actor cancels
    fireEvent.click(screen.getByTestId("cancel-zero-participant-u1"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("zero-participant-warning-u1"),
      ).not.toBeInTheDocument();
    });

    // Exactly 2 fetch calls total (GET + 1st PATCH) — no 3rd PATCH
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Task 5.6 — plain-language confirmation after successful role change
// ---------------------------------------------------------------------------
describe("5.6: Plain-language confirmation after successful role change", () => {
  it("shows '[Name] is now an Engineering Manager for this team' after promotion", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(membersResponseWithAssignRoles),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            member: {
              userId: "u1",
              displayName: "Alice",
              email: "alice@test.com",
              role: "engineering_manager",
            },
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(membersResponseWithAssignRoles),
      } as unknown as Response);

    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("role-select-u1")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("role-select-u1"), {
      target: { value: "engineering_manager" },
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Alice is now an Engineering Manager for this team\./i),
      ).toBeInTheDocument();
    });
  });

  it("shows '[Name] is now an Engineer for this team' after demotion", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(membersResponseWithAssignRoles),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            member: {
              userId: "u2",
              displayName: "Bob",
              email: "bob@test.com",
              role: "participant",
            },
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(membersResponseWithAssignRoles),
      } as unknown as Response);

    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("role-select-u2")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("role-select-u2"), {
      target: { value: "participant" },
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Bob is now an Engineer for this team\./i),
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Task 5.7 — escalation path when canAssignRoles: false (Decision 3 Option A)
// A grayed-out control with no explanation is NOT acceptable.
// ---------------------------------------------------------------------------
describe("5.7: Escalation message when canAssignRoles is false", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(membersResponseNoAssignRoles),
    } as unknown as Response);
  });

  it("shows plain-language escalation explanation, not a grayed-out control", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("escalation-message")).toBeInTheDocument();
    });
    expect(screen.getByTestId("escalation-message")).toHaveTextContent(
      /Only an Application Admin or an Engineering Manager for this team can change roles/i,
    );
  });

  it("does not render role selectors when canAssignRoles is false", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("escalation-message")).toBeInTheDocument();
    });
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task 5.8 — vocabulary mapping: DB values never appear as visible labels
// ---------------------------------------------------------------------------
describe("5.8: Database enum values never appear as visible labels", () => {
  it("does not render 'participant' as a visible label anywhere in the view", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
    // 'participant' must not appear in text content — it's a DB value
    // (It may appear as an option VALUE attribute, which is fine, but not as label text)
    const allText = document.body.textContent ?? "";
    expect(allText).not.toContain("participant");
  });

  it("does not render 'engineering_manager' as a visible label anywhere in the view", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });
    const allText = document.body.textContent ?? "";
    expect(allText).not.toContain("engineering_manager");
  });
});

// ---------------------------------------------------------------------------
// Stale AuthContext refresh after role change
// ---------------------------------------------------------------------------
describe("AuthContext is refreshed after a successful role change", () => {
  it("calls refreshSession after a successful PATCH", async () => {
    const refreshSession = vi.fn().mockResolvedValue(undefined);
    mockAuthAs({ refreshSession });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(membersResponseWithAssignRoles),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            member: {
              userId: "u1",
              displayName: "Alice",
              email: "alice@test.com",
              role: "engineering_manager",
            },
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(membersResponseWithAssignRoles),
      } as unknown as Response);

    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("role-select-u1")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("role-select-u1"), {
      target: { value: "engineering_manager" },
    });

    await waitFor(() => {
      expect(refreshSession).toHaveBeenCalledOnce();
    });
  });
});
