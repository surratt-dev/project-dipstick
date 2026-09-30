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

import { hasCompletedFirstSession } from "../topic-lock-helper.js";

// ---------------------------------------------------------------------------
// hasCompletedFirstSession — topic-customization-lock-and-add-custom-topic,
// design.md Decision 1, tasks.md Task 1.1/1.3.
// ---------------------------------------------------------------------------
describe("hasCompletedFirstSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns false (locked) for a team with zero sessions", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });

    const result = await hasCompletedFirstSession("team-1");

    expect(result).toBe(false);
  });

  it("returns true (unlocked) for a team with one completed session", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });

    const result = await hasCompletedFirstSession("team-1");

    expect(result).toBe(true);
  });

  it("returns false (locked) when the team's only session is abandoned/in-progress, not complete", async () => {
    // The SQL query itself filters on status = 'complete'; this test
    // confirms the helper returns locked when that filtered count is zero,
    // which is what a mocked DB with an abandoned/in-progress-only session
    // set would return.
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });

    const result = await hasCompletedFirstSession("team-1");

    expect(result).toBe(false);
  });

  it("issues a live query scoped to status = 'complete' for the requested team, with no caching", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    await hasCompletedFirstSession("team-1");

    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    const secondCallResult = await hasCompletedFirstSession("team-1");

    // Two calls for the same team each issue their own db.query — no memoized
    // result is returned from a prior call.
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    expect(secondCallResult).toBe(true);

    const [sql, params] = mockDbQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("status = 'complete'");
    expect(sql).toContain("COUNT(*)");
    expect(params).toEqual(["team-1"]);
  });

  it("reflects a just-completed session on the very next call", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    expect(await hasCompletedFirstSession("team-1")).toBe(false);

    // Simulate the team's first session completing between calls.
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    expect(await hasCompletedFirstSession("team-1")).toBe(true);
  });
});
