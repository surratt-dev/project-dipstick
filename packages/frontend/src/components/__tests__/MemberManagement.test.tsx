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
import type { TeamMembersResponse } from "@dipstick/shared";

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
//
// Updated for the establish-manager-team-relationship change (Decision 12):
// TeamMembersResponse now uses participants/engineeringManagers split arrays.
//
// The default fixture keeps two members in `participants` — one with
// role: 'participant' (Alice) and one with role: 'engineering_manager'
// (Bob). Bob being in `participants` with EM role is intentional: it tests
// the role selector behavior for an EM-role member in the participants array
// (covering the TEAM-005 demotion path: EM → participant). The API never
// returns an EM in the participants array, but the component renders role
// selectors for anything in `participants`, which is the correct behaviour
// for the existing tests.
//
// For canAssociateManagers tests (task 4.3): a separate fixture below uses
// canAssociateManagers: false with an empty engineeringManagers array to
// test the TEAM-006 escalation path.
// ---------------------------------------------------------------------------
const membersResponseWithAssignRoles: TeamMembersResponse = {
  teamId: "team-1",
  teamName: "Alpha",
  canAssignRoles: true,
  canAssociateManagers: false,
  participants: [
    {
      userId: "u1",
      displayName: "Alice",
      email: "alice@test.com",
      role: "participant",
    },
    {
      userId: "u2",
      displayName: "Bob",
      email: "bob@test.com",
      role: "engineering_manager",
    },
  ],
  engineeringManagers: [],
};

const membersResponseNoAssignRoles: TeamMembersResponse = {
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
    // Bob is in participants with role: 'engineering_manager' — the component
    // renders role-label-u2 for all members in the participants array.
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
      // One selector per member in participants
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
    const updatedMembers: TeamMembersResponse = {
      ...membersResponseWithAssignRoles,
      participants: [
        { ...membersResponseWithAssignRoles.participants[0]!, role: "engineering_manager" },
        membersResponseWithAssignRoles.participants[1]!,
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
    // Bob starts as engineering_manager in participants — his role selector
    // allows changing back to participant (TEAM-005 demotion path).
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
// Task 4.3 (establish-manager-team-relationship):
// User WITHOUT TEAM-006 permission (canAssociateManagers: false) sees
// explanation text and a specific contact path — NOT a grayed-out control.
//
// Decision 1 / Decision 10 escalation requirement:
// "A grayed-out control with no explanation does not meet the requirement.
//  Minimum acceptable text: 'Associating an Engineering Manager requires
//  Application Admin access. Contact your admin to complete this before
//  the session.' The contact path must be specific."
// ---------------------------------------------------------------------------
describe("4.3: TEAM-006 escalation path when canAssociateManagers is false", () => {
  const responseWithoutAssociatePermission: TeamMembersResponse = {
    teamId: "team-1",
    teamName: "Alpha",
    canAssignRoles: false,
    canAssociateManagers: false,
    participants: [
      { userId: "u1", displayName: "Alice", email: "alice@test.com", role: "participant" },
    ],
    engineeringManagers: [],
  };

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseWithoutAssociatePermission),
    } as unknown as Response);
  });

  it("shows explanation text when no EM is associated and canAssociateManagers is false", async () => {
    render(<MemberManagement teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("associate-manager-escalation")).toBeInTheDocument();
    });
  });

  it("shows specific contact path in escalation message, not just a grayed-out control", async () => {
    render(<MemberManagement teamId="team-1" />);

    await waitFor(() => {
      const escalation = screen.getByTestId("associate-manager-escalation");
      // Must explain WHY (Application Admin requirement)
      expect(escalation).toHaveTextContent(/Application Admin/i);
      // Must provide a specific contact path (not just "contact us")
      expect(escalation).toHaveTextContent(/Contact your admin/i);
    });
  });

  it("does NOT render a disabled or grayed-out associate button", async () => {
    render(<MemberManagement teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("associate-manager-escalation")).toBeInTheDocument();
    });

    // No button or control should be present for association when the actor
    // lacks permission — a grayed-out control with no explanation is not acceptable
    // per Decision 1 escalation path constraint.
    const associateButton = screen.queryByRole("button", {
      name: /associate/i,
    });
    expect(associateButton).not.toBeInTheDocument();
  });

  it("does NOT show the TEAM-006 escalation when canAssociateManagers is true (admin path)", async () => {
    const adminResponse: TeamMembersResponse = {
      ...responseWithoutAssociatePermission,
      canAssociateManagers: true,
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(adminResponse),
    } as unknown as Response);

    render(<MemberManagement teamId="team-1" />);

    await waitFor(() => {
      // Admin sees the admin affordance path, not the escalation message
      expect(
        screen.queryByTestId("associate-manager-escalation"),
      ).not.toBeInTheDocument();
    });
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
    // 'participant' must not appear in text content — it's a DB enum value.
    // It may appear as a select option VALUE attribute (which is fine), but
    // not as visible label text. The component maps it to 'Engineer'.
    // Note: the EM section heading uses 'does not attend sessions' (not 'participant')
    // to avoid this check false-firing on the human-readable UI text.
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
// Section 6 (establish-manager-team-relationship):
// Labeled sections in team administration view
// ---------------------------------------------------------------------------
describe("6.1–6.4: Labeled sections — participants vs associated managers", () => {
  it("6.1: renders separate labeled sections for participants and associated managers", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("participants-section-heading")).toBeInTheDocument();
      expect(screen.getByTestId("associated-managers-section")).toBeInTheDocument();
    });
  });

  it("6.2: participants heading clarifies these users will attend and vote", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      const heading = screen.getByTestId("participants-section-heading");
      expect(heading).toHaveTextContent(/Session Participants/i);
      expect(heading).toHaveTextContent(/session invites/i);
    });
  });

  it("6.2: managers section heading clarifies EMs do not attend sessions", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      const heading = screen.getByTestId("associated-managers-heading");
      expect(heading).toHaveTextContent(/Engineering Manager/i);
      // Heading must make clear EMs do NOT attend sessions
      expect(heading).toHaveTextContent(/views history only/i);
    });
  });

  it("6.3: shows incomplete-setup indicator (not an error) when no EM is associated", async () => {
    // Default fixture has engineeringManagers: []
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("no-em-association-indicator")).toBeInTheDocument();
    });
    // Must be a status indicator, not an error alert
    const indicator = screen.getByTestId("no-em-association-indicator");
    expect(indicator).not.toHaveAttribute("role", "alert");
  });

  it("6.4: displays associated EM by display name when an EM is present", async () => {
    const responseWithEM: TeamMembersResponse = {
      teamId: "team-1",
      teamName: "Alpha",
      canAssignRoles: false,
      canAssociateManagers: false,
      participants: [{ userId: "u1", displayName: "Alice", email: "alice@test.com", role: "participant" }],
      engineeringManagers: [{ userId: "u-em", displayName: "Eve EM", email: "eve@test.com", role: "engineering_manager" }],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseWithEM),
    } as unknown as Response);

    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      // Display by name, not userId
      expect(screen.getByTestId("em-display-name-u-em")).toBeInTheDocument();
      expect(screen.getByTestId("em-display-name-u-em")).toHaveTextContent("Eve EM");
    });
    // Must not render the userId as the label
    expect(screen.queryByText("u-em")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 6.5 — Acceptance test: facilitator can identify session invitees without help docs
// ---------------------------------------------------------------------------
describe("6.5: Acceptance — facilitator can identify session invitees without help documentation", () => {
  it("session invitees (participants) and non-invitees (EMs) are unambiguous from section headings alone", async () => {
    const responseWithEM: TeamMembersResponse = {
      teamId: "team-1",
      teamName: "Alpha",
      canAssignRoles: false,
      canAssociateManagers: false,
      participants: [
        { userId: "u1", displayName: "Alice", email: "alice@test.com", role: "participant" },
        { userId: "u2", displayName: "Carol", email: "carol@test.com", role: "participant" },
      ],
      engineeringManagers: [
        { userId: "u3", displayName: "Eve EM", email: "eve@test.com", role: "engineering_manager" },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseWithEM),
    } as unknown as Response);

    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // A new facilitator sees "Session Participants" — unambiguously the people who vote
    expect(screen.getByTestId("participants-section-heading")).toHaveTextContent(
      /Session Participants/i,
    );
    // Alice and Carol are in the participants section
    expect(screen.getByTestId("member-row-u1")).toBeInTheDocument();
    expect(screen.getByTestId("member-row-u2")).toBeInTheDocument();

    // The EM section is clearly labeled and separated
    expect(screen.getByTestId("associated-managers-heading")).toHaveTextContent(
      /Associated Engineering Manager/i,
    );
    // Eve appears in the EM section, not the participants section
    expect(screen.getByTestId("em-row-u3")).toBeInTheDocument();
    expect(screen.queryByTestId("member-row-u3")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 7.1 / 7.2 — Access model statement (findable, not prominent)
// ---------------------------------------------------------------------------
describe("7.1 / 7.2: Access model statement in team view", () => {
  it("renders the access model statement in the team view", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("access-model-statement")).toBeInTheDocument();
    });
    expect(screen.getByTestId("access-model-statement")).toHaveTextContent(
      /Your Engineering Manager can see session history but cannot join or observe live sessions/i,
    );
  });

  it("7.2: access model statement is findable but not in a modal or alert", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("access-model-statement")).toBeInTheDocument();
    });
    const statement = screen.getByTestId("access-model-statement");
    // Not a modal — no dialog role
    expect(statement).not.toHaveAttribute("role", "dialog");
    // Not an alert or status banner
    expect(statement).not.toHaveAttribute("role", "alert");
    expect(statement).not.toHaveAttribute("role", "status");
  });
});

// ---------------------------------------------------------------------------
// Task 7.3 — No modal or pop-up triggered by normal user actions
// ---------------------------------------------------------------------------
describe("7.3: No modal or pop-up from normal user actions", () => {
  it("joining the team view does not trigger a modal or pop-up surfacing the access model statement", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
    // The access model statement is present but not as a dialog/modal
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The statement is inline, not in an alertdialog
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("no acknowledgment flow is triggered — statement does not require user action to dismiss", async () => {
    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("access-model-statement")).toBeInTheDocument();
    });
    // No dismiss or acknowledge button should be present near the statement
    expect(screen.queryByRole("button", { name: /acknowledge|dismiss|ok|close/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Stale AuthContext refresh after role change
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Task 9.5 — End-to-end verification: separate labeled sections across all
//            facilitator-accessible views of the team
//
// Backend contract: verified in e2e-verification.test.ts (participants and
// engineeringManagers are returned as separate arrays, never a flat members array).
// Frontend rendering: this test verifies that the MemberManagement component
// renders those arrays in visually distinct, labeled sections — confirming the
// full path from backend contract to rendered view.
//
// This test is a verification-level check that wraps the section 6 acceptance
// criterion (task 6.5) at a higher integration level. A reader of this test
// should be able to confirm that labeled sections are produced end-to-end.
// ---------------------------------------------------------------------------
describe("9.5: End-to-end verification — separate labeled sections for participants and managers", () => {
  it("component renders distinct sections from the split response shape (backend → view contract)", async () => {
    const splitResponse: TeamMembersResponse = {
      teamId: "team-1",
      teamName: "Alpha",
      canAssignRoles: false,
      canAssociateManagers: false,
      participants: [
        { userId: "p1", displayName: "Alice", email: "alice@test.com", role: "participant" },
        { userId: "p2", displayName: "Bob", email: "bob@test.com", role: "participant" },
      ],
      engineeringManagers: [
        { userId: "em1", displayName: "Carol EM", email: "carol@test.com", role: "engineering_manager" },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(splitResponse),
    } as unknown as Response);

    render(<MemberManagement teamId="team-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("participants-section-heading")).toBeInTheDocument();
    });

    // Participant section is labeled and contains only participants
    const participantsHeading = screen.getByTestId("participants-section-heading");
    expect(participantsHeading).toHaveTextContent(/Session Participants/i);
    expect(screen.getByTestId("member-row-p1")).toBeInTheDocument();
    expect(screen.getByTestId("member-row-p2")).toBeInTheDocument();

    // EM section is labeled separately
    const emHeading = screen.getByTestId("associated-managers-heading");
    expect(emHeading).toHaveTextContent(/Engineering Manager/i);
    expect(screen.getByTestId("em-row-em1")).toBeInTheDocument();
    expect(screen.getByTestId("em-display-name-em1")).toHaveTextContent("Carol EM");

    // Carol is NOT in the participants section
    expect(screen.queryByTestId("member-row-em1")).not.toBeInTheDocument();

    // The two sections are structurally separate (participants-section-heading precedes EM section)
    const allTestIds = Array.from(document.querySelectorAll("[data-testid]")).map(
      (el) => el.getAttribute("data-testid"),
    );
    const participantsIdx = allTestIds.indexOf("participants-section-heading");
    const emSectionIdx = allTestIds.indexOf("associated-managers-section");
    expect(participantsIdx).toBeGreaterThanOrEqual(0);
    expect(emSectionIdx).toBeGreaterThanOrEqual(0);
    // Participants section comes before EM section in the DOM order
    expect(participantsIdx).toBeLessThan(emSectionIdx);
  });
});

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
