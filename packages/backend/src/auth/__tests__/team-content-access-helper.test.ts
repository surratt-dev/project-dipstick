import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
  },
}));

vi.mock("../../config.js", () => ({
  config: {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "test",
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test",
  },
}));

import { evaluateTeamAccess } from "../team-content-access-helper.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Set up mock for the initial user+membership query. */
function mockUserQuery(globalRole: string, membershipRole: string | null) {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: globalRole, membership_role: membershipRole }],
  });
}

/** Set up mock for facilitator session query returning a session. */
function mockFacilitatorSession(sessionId: string, sessionStatus: string) {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ session_id: sessionId, session_status: sessionStatus }],
  });
}

/** Set up mock for facilitator session query returning no sessions. */
function mockNoFacilitatorSession() {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

/** Set up mock for user query returning no rows (user not found). */
function mockUserNotFound() {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

const USER_ID = "user-uuid-1";
const TEAM_ID = "team-uuid-1";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluateTeamAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  // -------------------------------------------------------------------------
  // User not found
  // -------------------------------------------------------------------------

  it("returns null when user is not found", async () => {
    mockUserNotFound();

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toBeNull();
    // Only one DB query should have been made
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Application Admin (Path 0)
  // -------------------------------------------------------------------------

  it("returns admin grant for application_admin regardless of membership", async () => {
    mockUserQuery("application_admin", null);

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toEqual({
      path: "admin",
      actorGlobalRole: "application_admin",
    });
    // Should NOT make a second DB query for facilitator sessions
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("returns admin grant for application_admin even when they have a membership row", async () => {
    // Application Admins may also be team members; admin path takes priority
    mockUserQuery("application_admin", "participant");

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toEqual({
      path: "admin",
      actorGlobalRole: "application_admin",
    });
  });

  // -------------------------------------------------------------------------
  // Path 1: Team Member (participant)
  // -------------------------------------------------------------------------

  it("returns member grant with role=participant for a participant member", async () => {
    mockUserQuery("engineer", "participant");

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toEqual({
      path: "member",
      role: "participant",
      teamId: TEAM_ID,
      actorGlobalRole: "engineer",
    });
    // Should NOT make a second DB query for facilitator sessions
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("returns null for a removed member (membership_role is null after removed_at filter)", async () => {
    // The SQL filters on removed_at IS NULL, so a removed member returns
    // membership_role = null from the LEFT JOIN
    mockUserQuery("engineer", null);
    // No membership — check facilitator path
    mockNoFacilitatorSession();

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toBeNull();
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Path 2: Engineering Manager (dual-check)
  // -------------------------------------------------------------------------

  it("returns member grant with role=engineering_manager for EM member (dual-check)", async () => {
    // Both global_role AND membership_role are engineering_manager — satisfies
    // the dual-check pattern from session-participation spec
    mockUserQuery("engineering_manager", "engineering_manager");

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toEqual({
      path: "member",
      role: "engineering_manager",
      teamId: TEAM_ID,
      actorGlobalRole: "engineering_manager",
    });
  });

  it("returns EM content profile for user with global_role=engineer but membership_role=engineering_manager", async () => {
    // Acceptance criterion from proposal.md: a user with diverged roles must
    // be served the EM content shape (aggregate only). The membership_role governs.
    mockUserQuery("engineer", "engineering_manager");

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toEqual({
      path: "member",
      role: "engineering_manager",
      teamId: TEAM_ID,
      actorGlobalRole: "engineer",
    });
  });

  // -------------------------------------------------------------------------
  // Path 3: Active Session Facilitator
  // -------------------------------------------------------------------------

  it("returns facilitator grant for a user with an active session (status=active)", async () => {
    mockUserQuery("facilitator", null); // not a team member
    mockFacilitatorSession("session-1", "active");

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toEqual({
      path: "facilitator",
      sessionId: "session-1",
      teamId: TEAM_ID,
      sessionStatus: "active",
      actorGlobalRole: "facilitator",
    });
  });

  it("returns facilitator grant for a session in lobby status", async () => {
    mockUserQuery("facilitator", null);
    mockFacilitatorSession("session-2", "lobby");

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toMatchObject({ path: "facilitator", sessionStatus: "lobby" });
  });

  it("returns facilitator grant for a draft session within 24 hours", async () => {
    // The SQL check handles the 24-hour window inline
    mockUserQuery("facilitator", null);
    mockFacilitatorSession("session-3", "draft");

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toMatchObject({
      path: "facilitator",
      sessionId: "session-3",
      sessionStatus: "draft",
    });
  });

  it("returns null for a draft session older than 24 hours (lazy expiry)", async () => {
    // The SQL check fails when created_at + 24h <= NOW() for draft sessions.
    // The mock simulates what the DB returns: no matching session.
    mockUserQuery("facilitator", null);
    mockNoFacilitatorSession(); // SQL condition excluded the old draft

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toBeNull();
  });

  it("returns facilitator grant within the grace window (complete session, expires_at > NOW())", async () => {
    mockUserQuery("facilitator", null);
    mockFacilitatorSession("session-4", "complete");

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toMatchObject({
      path: "facilitator",
      sessionId: "session-4",
      sessionStatus: "complete",
    });
  });

  it("returns null when complete session grace window has expired (expires_at <= NOW())", async () => {
    // The SQL check fails when facilitator_access_expires_at <= NOW().
    mockUserQuery("facilitator", null);
    mockNoFacilitatorSession(); // SQL excluded the expired session

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toBeNull();
  });

  // -------------------------------------------------------------------------
  // No matching path
  // -------------------------------------------------------------------------

  it("returns null for a user with no relationship to the team", async () => {
    mockUserQuery("engineer", null); // no membership
    mockNoFacilitatorSession(); // not a facilitator

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    expect(grant).toBeNull();
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Live DB reads (no cache) — verified by call count per invocation
  // -------------------------------------------------------------------------

  it("executes live DB reads on every call (no shared cache between calls)", async () => {
    // First call
    mockUserQuery("engineer", "participant");
    await evaluateTeamAccess(USER_ID, TEAM_ID);

    // Second call to the same user/team MUST make another DB query
    mockUserQuery("engineer", "participant");
    await evaluateTeamAccess(USER_ID, TEAM_ID);

    // Two calls → two user-query calls (and no shared state from the first call)
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Return type is null, not false or a boolean
  // -------------------------------------------------------------------------

  it("returns null (not false) when no path matches", async () => {
    mockUserQuery("engineer", null);
    mockNoFacilitatorSession();

    const grant = await evaluateTeamAccess(USER_ID, TEAM_ID);

    // Strict null check — a falsy result that is not null would fail this
    expect(grant).toBeNull();
    expect(grant).not.toBe(false);
    expect(grant).not.toBe(undefined);
  });
});
