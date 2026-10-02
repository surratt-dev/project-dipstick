import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// buildSessionRegistrationSnapshot — vote-compose-recovery (issue #31),
// design.md Decision D3c, tasks.md task 7.3. Fixtures use the query's
// session_topic_id alias (session-topics-snapshot-at-creation R5 fix); the
// real-Postgres counterpart is registration-snapshot-integration.test.ts.
// ---------------------------------------------------------------------------

const mockDbQuery = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
vi.mock("../../config.js", () => ({
  config: { DATABASE_URL: "postgres://test", REDIS_URL: "redis://test", SESSION_SECRET: "test", NODE_ENV: "test" },
}));

import { buildSessionRegistrationSnapshot } from "../session-registration-snapshot.js";

describe("buildSessionRegistrationSnapshot (design.md Decision D3c, task 7.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(i) session in lobby/pre_session with no current topic returns currentTopic: null", async () => {
    mockDbQuery.mockResolvedValue({
      rows: [{ session_status: "lobby", session_topic_id: null, topic_status: null, has_locked_in: false }],
    });

    const result = await buildSessionRegistrationSnapshot("user-1", "session-1");

    expect(result).toEqual({
      sessionId: "session-1",
      sessionStatus: "lobby",
      currentTopic: null,
      hasLockedInVote: false,
    });
  });

  it("(ii) session active with current topic voting and no vote row for this user returns hasLockedInVote: false", async () => {
    mockDbQuery.mockResolvedValue({
      rows: [
        {
          session_status: "active",
          session_topic_id: "st-A",
          topic_status: "voting",
          has_locked_in: false,
        },
      ],
    });

    const result = await buildSessionRegistrationSnapshot("user-1", "session-1");

    expect(result).toEqual({
      sessionId: "session-1",
      sessionStatus: "active",
      currentTopic: { sessionTopicId: "st-A", status: "voting" },
      hasLockedInVote: false,
    });
  });

  it("(iii) a vote row for this user present returns hasLockedInVote: true", async () => {
    mockDbQuery.mockResolvedValue({
      rows: [
        {
          session_status: "active",
          session_topic_id: "st-A",
          topic_status: "voting",
          has_locked_in: true,
        },
      ],
    });

    const result = await buildSessionRegistrationSnapshot("user-1", "session-1");

    expect(result?.hasLockedInVote).toBe(true);
    expect(result?.currentTopic).toEqual({ sessionTopicId: "st-A", status: "voting" });
  });

  it("(iii-b) resolves the current row in the topics.id id-space and returns its session_topics.id (session-topics-snapshot-at-creation design.md Decision 8)", async () => {
    mockDbQuery.mockResolvedValue({
      rows: [{ session_status: "active", session_topic_id: "st-A", topic_status: "voting", has_locked_in: true }],
    });

    await buildSessionRegistrationSnapshot("user-1", "session-1");

    const [sql] = mockDbQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("st.session_id = s.id AND st.topic_id = s.current_topic_id");
    expect(sql).toContain("v.session_topic_id = st.id");
    expect(sql).toContain("st.id AS session_topic_id");
  });

  it("(iv) is scoped to voter_id = userId — another user's vote row for the same topic does not affect this user's hasLockedInVote (self-disclosure only, design.md D3d)", async () => {
    // The query itself performs the voter_id scoping (LEFT JOIN votes ...
    // AND v.voter_id = $2) — assert the call is parameterized with the
    // connecting userId as the second bind param, and that a row reporting
    // false (as it would for a user with no matching vote row, regardless
    // of another user's vote existing) is passed through unchanged.
    mockDbQuery.mockResolvedValue({
      rows: [
        {
          session_status: "active",
          session_topic_id: "st-A",
          topic_status: "voting",
          has_locked_in: false,
        },
      ],
    });

    await buildSessionRegistrationSnapshot("user-requesting", "session-1");

    expect(mockDbQuery).toHaveBeenCalledWith(expect.any(String), ["session-1", "user-requesting"]);
    const [sql] = mockDbQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("v.voter_id = $2");
  });

  it("(v) session in wrap_up returns currentTopic: null", async () => {
    mockDbQuery.mockResolvedValue({
      rows: [{ session_status: "wrap_up", session_topic_id: null, topic_status: null, has_locked_in: false }],
    });

    const result = await buildSessionRegistrationSnapshot("user-1", "session-1");

    expect(result).toEqual({
      sessionId: "session-1",
      sessionStatus: "wrap_up",
      currentTopic: null,
      hasLockedInVote: false,
    });
  });

  it("(vi) no matching session row returns null", async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });

    const result = await buildSessionRegistrationSnapshot("user-1", "session-deleted");

    expect(result).toBeNull();
  });
});
