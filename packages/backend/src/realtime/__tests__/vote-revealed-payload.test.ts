import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbQuery = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
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

import { buildVoteRevealedPayload } from "../vote-revealed-payload.js";
import type { FacilitatorContentView, ParticipantContentView } from "@dipstick/shared";

const SESSION_ID = "session-1";
const TEAM_ID = "team-1";

describe("buildVoteRevealedPayload — Decision D4 serializer reuse", () => {
  beforeEach(() => vi.clearAllMocks());

  it("facilitator grant: builds a FacilitatorContentView via serializeForFacilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          topic_id: "topic-1",
          topic_name: "Feature A",
          reveal_status: "revealed",
          flagged_for_discussion: false,
          voter_id: "user-a",
          voter_display_name: "Alice",
          vote_value: 5,
        },
      ],
    });

    const payload = (await buildVoteRevealedPayload(
      { path: "facilitator", sessionId: SESSION_ID, teamId: TEAM_ID, sessionStatus: "active", actorGlobalRole: "facilitator" },
      "active",
      "facilitator-user",
    )) as FacilitatorContentView;

    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.topics).toHaveLength(1);
    expect(payload.topics[0]!.votes).toEqual([
      { voterId: "user-a", voterDisplayName: "Alice", voteValue: 5 },
    ]);
  });

  it("facilitator grant: unrevealed topic has no vote values (serializer-layer enforcement still applies)", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          topic_id: "topic-1",
          topic_name: "Feature A",
          reveal_status: "voting",
          flagged_for_discussion: false,
          voter_id: "user-a",
          voter_display_name: "Alice",
          vote_value: 5,
        },
      ],
    });

    const payload = (await buildVoteRevealedPayload(
      { path: "facilitator", sessionId: SESSION_ID, teamId: TEAM_ID, sessionStatus: "active", actorGlobalRole: "facilitator" },
      "active",
      "facilitator-user",
    )) as FacilitatorContentView;

    expect(payload.topics[0]!.votes).toEqual([]);
  });

  it("participant grant: builds a ParticipantContentView via serializeForMemberParticipant, identifying own vote", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          topic_id: "topic-1",
          topic_name: "Feature A",
          reveal_status: "revealed",
          flagged_for_discussion: false,
          voter_id: "caller-user",
          vote_value: 3,
          vote_count: 1,
          contains_outlier: false,
        },
      ],
    });

    const payload = (await buildVoteRevealedPayload(
      { path: "participant", sessionId: SESSION_ID, teamId: TEAM_ID, actorGlobalRole: "engineer" },
      "active",
      "caller-user",
    )) as ParticipantContentView;

    expect(payload.topics[0]!.ownVoteValue).toBe(3);
    // Participant view never carries other voters' individual attribution
    expect(payload.topics[0]).not.toHaveProperty("votes");
  });

  it("issues exactly one database query per call", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await buildVoteRevealedPayload(
      { path: "facilitator", sessionId: SESSION_ID, teamId: TEAM_ID, sessionStatus: "active", actorGlobalRole: "facilitator" },
      "active",
      "facilitator-user",
    );

    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });
});
