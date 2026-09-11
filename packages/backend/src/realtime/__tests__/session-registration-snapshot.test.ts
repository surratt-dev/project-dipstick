import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// buildSessionRegistrationSnapshot — vote-compose-recovery (issue #31),
// design.md Decision D3c, tasks.md task 7.3.
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
      rows: [{ session_status: "lobby", current_topic_id: null, topic_status: null, has_locked_in: false }],
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
          current_topic_id: "topic-A",
          topic_status: "voting",
          has_locked_in: false,
        },
      ],
    });

    const result = await buildSessionRegistrationSnapshot("user-1", "session-1");

    expect(result).toEqual({
      sessionId: "session-1",
      sessionStatus: "active",
      currentTopic: { sessionTopicId: "topic-A", status: "voting" },
      hasLockedInVote: false,
    });
  });

  it("(iii) a vote row for this user present returns hasLockedInVote: true", async () => {
    mockDbQuery.mockResolvedValue({
      rows: [
        {
          session_status: "active",
          current_topic_id: "topic-A",
          topic_status: "voting",
          has_locked_in: true,
        },
      ],
    });

    const result = await buildSessionRegistrationSnapshot("user-1", "session-1");

    expect(result?.hasLockedInVote).toBe(true);
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
          current_topic_id: "topic-A",
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
      rows: [{ session_status: "wrap_up", current_topic_id: null, topic_status: null, has_locked_in: false }],
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
