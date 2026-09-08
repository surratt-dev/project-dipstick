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

import { evaluateSessionSubscriberAccess } from "../session-subscriber-access-helper.js";

const USER_ID = "user-uuid-1";
const SESSION_ID = "session-uuid-1";
const TEAM_ID = "team-uuid-1";

interface Row {
  session_id: string;
  team_id: string;
  facilitator_id: string;
  session_status: string;
  global_role: string;
  participant_row_id: string | null;
  membership_role: string | null;
  membership_removed_at: Date | null;
  membership_exists: boolean;
}

function baseRow(overrides: Partial<Row>): Row {
  return {
    session_id: SESSION_ID,
    team_id: TEAM_ID,
    facilitator_id: "someone-else",
    session_status: "active",
    global_role: "engineer",
    participant_row_id: null,
    membership_role: null,
    membership_removed_at: null,
    membership_exists: false,
    ...overrides,
  };
}

function mockRow(overrides: Partial<Row>) {
  mockDbQuery.mockResolvedValueOnce({ rows: [baseRow(overrides)] });
}

function mockNoRows() {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

describe("evaluateSessionSubscriberAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when the session or user is not found", async () => {
    mockNoRows();

    const grant = await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);

    expect(grant).toBeNull();
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Path 3: Active facilitator
  // -------------------------------------------------------------------------

  it.each(["lobby", "pre_session", "active", "wrap_up"])(
    "returns facilitator grant when the subscriber is the facilitator and status is '%s'",
    async (status) => {
      mockRow({ facilitator_id: USER_ID, session_status: status, global_role: "facilitator" });

      const grant = await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);

      expect(grant).toEqual({
        path: "facilitator",
        sessionId: SESSION_ID,
        teamId: TEAM_ID,
        sessionStatus: status,
        actorGlobalRole: "facilitator",
      });
    },
  );

  it.each(["draft", "complete", "abandoned"])(
    "does not return a facilitator grant when status is '%s' (not a live facilitator status)",
    async (status) => {
      mockRow({ facilitator_id: USER_ID, session_status: status, global_role: "facilitator" });

      const grant = await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);

      expect(grant).toBeNull();
    },
  );

  // -------------------------------------------------------------------------
  // Path 1: Active participant
  // -------------------------------------------------------------------------

  it("returns participant grant for an active participant with an active membership", async () => {
    mockRow({
      participant_row_id: "participant-row-1",
      membership_exists: true,
      membership_removed_at: null,
    });

    const grant = await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);

    expect(grant).toEqual({
      path: "participant",
      sessionId: SESSION_ID,
      teamId: TEAM_ID,
      actorGlobalRole: "engineer",
    });
  });

  // ---------------------------------------------------------------------------
  // EM-promotion exclusion — base spec (websocket-session-authorization),
  // inherited unmodified by this change: "Role change from participant to
  // engineering_manager revokes live session event access." A
  // session_participants row is NOT deleted on promotion (votes already
  // locked in are preserved), so the row's existence alone must not be
  // sufficient once the promotion happens mid-connection.
  // ---------------------------------------------------------------------------

  it("returns null when team_memberships.role is promoted to engineering_manager, even with a live session_participants row", async () => {
    mockRow({
      participant_row_id: "participant-row-1",
      membership_exists: true,
      membership_removed_at: null,
      membership_role: "engineering_manager",
    });

    const grant = await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);

    expect(grant).toBeNull();
  });

  it("returns null when users.global_role is engineering_manager, even with a live session_participants row and a participant membership role", async () => {
    mockRow({
      participant_row_id: "participant-row-1",
      membership_exists: true,
      membership_removed_at: null,
      membership_role: "participant",
      global_role: "engineering_manager",
    });

    const grant = await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);

    expect(grant).toBeNull();
  });

  it("returns null for a removed member (removed_at is set), even with a session_participants row", async () => {
    mockRow({
      participant_row_id: "participant-row-1",
      membership_exists: true,
      membership_removed_at: new Date(),
    });

    const grant = await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);

    expect(grant).toBeNull();
  });

  it("returns null for a non-member (no session_participants row, no membership)", async () => {
    mockRow({
      participant_row_id: null,
      membership_exists: false,
      membership_removed_at: null,
    });

    const grant = await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);

    expect(grant).toBeNull();
  });

  it("returns null for someone with a session_participants row but no team membership at all", async () => {
    // Defensive case: session_participants row exists but team_memberships
    // join found nothing (membership_exists is false). Should not happen in
    // practice (participants are always team members), but the helper must
    // not grant access on the participant row alone.
    mockRow({
      participant_row_id: "participant-row-1",
      membership_exists: false,
      membership_removed_at: null,
    });

    const grant = await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);

    expect(grant).toBeNull();
  });

  it("does not treat a facilitator of a different session as an active facilitator here", async () => {
    // facilitator_id set to someone else — subscriber has no participant row either
    mockRow({ facilitator_id: "another-user", session_status: "active" });

    const grant = await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);

    expect(grant).toBeNull();
  });

  it("makes exactly one database round-trip per call (no caching)", async () => {
    mockRow({ participant_row_id: "p1", membership_exists: true });

    await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);

    mockRow({ participant_row_id: "p1", membership_exists: true });
    await evaluateSessionSubscriberAccess(USER_ID, SESSION_ID);
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });
});
