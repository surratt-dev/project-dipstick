import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { resolveJoinLandingPath } from "../join-landing-path.js";

const TEAM_ID = "team-uuid-1";
const SESSION_ID = "session-uuid-1";

describe("resolveJoinLandingPath", () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  it.each(["lobby", "pre_session", "active"] as const)(
    "routes to /session/:sessionId when the most recent session is %s",
    async (status) => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: SESSION_ID, status }] });

      const path = await resolveJoinLandingPath(TEAM_ID);

      expect(path).toBe(`/session/${SESSION_ID}`);
    },
  );

  it.each(["draft", "wrap_up", "complete", "abandoned"] as const)(
    "routes to /team/:teamId when the most recent session is %s",
    async (status) => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: SESSION_ID, status }] });

      const path = await resolveJoinLandingPath(TEAM_ID);

      expect(path).toBe(`/team/${TEAM_ID}`);
    },
  );

  it("routes to /team/:teamId when no session exists for the team", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const path = await resolveJoinLandingPath(TEAM_ID);

    expect(path).toBe(`/team/${TEAM_ID}`);
  });
});
