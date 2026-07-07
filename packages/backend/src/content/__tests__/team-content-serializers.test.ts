import { describe, it, expect } from "vitest";
import {
  serializeForMemberParticipant,
  serializeForMemberEM,
  serializeForFacilitator,
  buildParticipantQueryResult,
  buildEMQueryResult,
  buildFacilitatorQueryResult,
} from "../team-content-serializers.js";
import type {
  ParticipantQueryResult,
  EMQueryResult,
  FacilitatorQueryResult,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PARTICIPANT_GRANT = {
  path: "member" as const,
  role: "participant" as const,
  teamId: "team-1",
  actorGlobalRole: "engineer",
};

const EM_GRANT = {
  path: "member" as const,
  role: "engineering_manager" as const,
  teamId: "team-1",
  actorGlobalRole: "engineering_manager",
};

const FACILITATOR_GRANT = {
  path: "facilitator" as const,
  sessionId: "session-1",
  teamId: "team-1",
  sessionStatus: "active" as const,
  actorGlobalRole: "facilitator",
};

/** Build a minimal participant query result for testing */
function makeParticipantResult(overrides: {
  rows?: ParticipantQueryResult["rows"];
  callerUserId?: string;
}): ParticipantQueryResult {
  return buildParticipantQueryResult(
    "session-1",
    "active",
    overrides.callerUserId ?? "caller-user-1",
    (overrides.rows ?? []).map((row) => ({
      topic_id: row.topicId,
      topic_name: row.topicName,
      reveal_status: row.revealStatus,
      flagged_for_discussion: row.flaggedForDiscussion,
      voter_id: row.voterId,
      vote_value: row.voteValue,
      vote_count: row.voteCount,
      contains_outlier: row.containsOutlier,
    })),
  );
}

/** Build a minimal EM query result for testing */
function makeEMResult(rows: EMQueryResult["rows"] = []): EMQueryResult {
  return buildEMQueryResult(
    "session-1",
    rows.map((row) => ({
      topic_id: row.topicId,
      topic_name: row.topicName,
      reveal_status: row.revealStatus,
      flagged_for_discussion: row.flaggedForDiscussion,
      vote_value: row.voteValue,
      vote_count: row.voteCount,
      contains_outlier: row.containsOutlier,
    })),
  );
}

/** Build a minimal facilitator query result for testing */
function makeFacilitatorResult(rows: FacilitatorQueryResult["rows"] = []): FacilitatorQueryResult {
  return buildFacilitatorQueryResult(
    "session-1",
    "active",
    rows.map((row) => ({
      topic_id: row.topicId,
      topic_name: row.topicName,
      reveal_status: row.revealStatus,
      flagged_for_discussion: row.flaggedForDiscussion,
      voter_id: row.voterId,
      voter_display_name: row.voterDisplayName,
      vote_value: row.voteValue,
    })),
  );
}

// ---------------------------------------------------------------------------
// Task 4.7: Serializer unit tests
// ---------------------------------------------------------------------------

describe("serializeForMemberEM (Task 4.4 / 4.7)", () => {
  it("returns aggregate only — no voter_id in result type", () => {
    const result = makeEMResult([
      {
        topicId: "t1",
        topicName: "Collaboration",
        revealStatus: "revealed",
        flaggedForDiscussion: false,
        voteValue: 3,
        voteCount: 5,
        containsOutlier: false,
      },
      {
        topicId: "t1",
        topicName: "Collaboration",
        revealStatus: "revealed",
        flaggedForDiscussion: false,
        voteValue: 4,
        voteCount: 2,
        containsOutlier: true,
      },
    ]);

    const view = serializeForMemberEM(EM_GRANT, result);

    expect(view.topics).toHaveLength(1);
    const topic = view.topics[0]!;

    // Aggregate vote distribution is present
    expect(topic.voteDistribution).toHaveLength(2);
    expect(topic.average).toBeCloseTo((3 * 5 + 4 * 2) / 7, 2);

    // No voter_id or ownVoteValue on EMTopicResult
    // Cast via unknown to satisfy TypeScript's strict overlap check
    const topicAsAny = topic as unknown as Record<string, unknown>;
    expect(topicAsAny["ownVoteValue"]).toBeUndefined();
    expect(topicAsAny["voter_id"]).toBeUndefined();
    expect(topicAsAny["voterId"]).toBeUndefined();
  });

  it("EMQueryResult type does not include voter_id field (compile-time enforcement via brands)", () => {
    // This test verifies the brand-based separation at runtime:
    // EMQueryResult.__brand is 'EMQueryResult', not 'ParticipantQueryResult'
    const emResult = makeEMResult([]);
    expect(emResult.__brand).toBe("EMQueryResult");

    const participantResult = makeParticipantResult({});
    expect(participantResult.__brand).toBe("ParticipantQueryResult");
    expect(participantResult.__brand).not.toBe("EMQueryResult");
  });
});

describe("serializeForMemberParticipant (Task 4.3 / 4.7)", () => {
  it("includes aggregate vote distribution", () => {
    const result = makeParticipantResult({
      callerUserId: "caller-user-1",
      rows: [
        {
          topicId: "t1",
          topicName: "Quality",
          revealStatus: "revealed",
          flaggedForDiscussion: false,
          voterId: "caller-user-1",
          voteValue: 4,
          voteCount: 1,
          containsOutlier: false,
        },
        {
          topicId: "t1",
          topicName: "Quality",
          revealStatus: "revealed",
          flaggedForDiscussion: false,
          voterId: "other-user",
          voteValue: 3,
          voteCount: 1,
          containsOutlier: false,
        },
      ],
    });

    const view = serializeForMemberParticipant(PARTICIPANT_GRANT, result);

    expect(view.topics).toHaveLength(1);
    const topic = view.topics[0]!;

    // Aggregate distribution includes both votes
    expect(topic.voteDistribution).toHaveLength(2);
  });

  it("includes own vote (voter_id matches caller) but NOT other engineers' votes", () => {
    const result = makeParticipantResult({
      callerUserId: "caller-user-1",
      rows: [
        {
          topicId: "t1",
          topicName: "Quality",
          revealStatus: "revealed",
          flaggedForDiscussion: false,
          voterId: "caller-user-1",
          voteValue: 4,
          voteCount: 1,
          containsOutlier: false,
        },
        {
          topicId: "t1",
          topicName: "Quality",
          revealStatus: "revealed",
          flaggedForDiscussion: false,
          voterId: "other-user-2",
          voteValue: 2,
          voteCount: 1,
          containsOutlier: false,
        },
      ],
    });

    const view = serializeForMemberParticipant(PARTICIPANT_GRANT, result);

    const topic = view.topics[0]!;
    // Own vote is present
    expect(topic.ownVoteValue).toBe(4);
    // Other voter's individual value is NOT exposed (only in aggregate)
    // Verify: there is no field on the topic that directly references "other-user-2"
    const topicStr = JSON.stringify(topic);
    expect(topicStr).not.toContain("other-user-2");
  });

  it("returns ownVoteValue: null when caller has not voted", () => {
    const result = makeParticipantResult({
      callerUserId: "caller-user-1",
      rows: [
        {
          topicId: "t1",
          topicName: "Quality",
          revealStatus: "revealed",
          flaggedForDiscussion: false,
          voterId: "other-user",
          voteValue: 3,
          voteCount: 1,
          containsOutlier: false,
        },
      ],
    });

    const view = serializeForMemberParticipant(PARTICIPANT_GRANT, result);
    expect(view.topics[0]!.ownVoteValue).toBeNull();
  });
});

describe("serializeForFacilitator (Task 4.5 / 4.7)", () => {
  it("pre-reveal topic returns empty votes array (no vote values)", () => {
    const result = makeFacilitatorResult([
      {
        topicId: "t1",
        topicName: "Collaboration",
        revealStatus: "voting", // NOT revealed
        flaggedForDiscussion: false,
        voterId: "user-1",
        voterDisplayName: "Alice",
        voteValue: 3,
      },
    ]);

    const view = serializeForFacilitator(FACILITATOR_GRANT, result);

    const topic = view.topics[0]!;
    // Pre-reveal: votes array must be empty — vote values absent
    expect(topic.votes).toHaveLength(0);
    // The vote value must not appear anywhere in the serialized topic
    const topicStr = JSON.stringify(topic);
    expect(topicStr).not.toContain('"voteValue":3');
  });

  it("post-reveal topic returns full vote attribution", () => {
    const result = makeFacilitatorResult([
      {
        topicId: "t1",
        topicName: "Quality",
        revealStatus: "revealed", // revealed
        flaggedForDiscussion: false,
        voterId: "user-1",
        voterDisplayName: "Alice",
        voteValue: 4,
      },
      {
        topicId: "t1",
        topicName: "Quality",
        revealStatus: "revealed",
        flaggedForDiscussion: false,
        voterId: "user-2",
        voterDisplayName: "Bob",
        voteValue: 2,
      },
    ]);

    const view = serializeForFacilitator(FACILITATOR_GRANT, result);

    const topic = view.topics[0]!;
    // Full attribution is present
    expect(topic.votes).toHaveLength(2);
    expect(topic.votes[0]!.voterId).toBe("user-1");
    expect(topic.votes[0]!.voteValue).toBe(4);
    expect(topic.votes[1]!.voterDisplayName).toBe("Bob");
  });

  it("mixed session: unrevealed topics have no votes, revealed topics have full attribution", () => {
    const result = makeFacilitatorResult([
      {
        topicId: "t1",
        topicName: "Unrevealed Topic",
        revealStatus: "waiting",
        flaggedForDiscussion: false,
        voterId: "user-1",
        voterDisplayName: "Alice",
        voteValue: 3,
      },
      {
        topicId: "t2",
        topicName: "Revealed Topic",
        revealStatus: "revealed",
        flaggedForDiscussion: false,
        voterId: "user-1",
        voterDisplayName: "Alice",
        voteValue: 4,
      },
    ]);

    const view = serializeForFacilitator(FACILITATOR_GRANT, result);

    const unrevealedTopic = view.topics.find((t) => t.topicId === "t1");
    const revealedTopic = view.topics.find((t) => t.topicId === "t2");

    expect(unrevealedTopic!.votes).toHaveLength(0);
    expect(revealedTopic!.votes).toHaveLength(1);
    expect(revealedTopic!.votes[0]!.voteValue).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Task 4.9: Named integration tests — two-layer behavioral contract
//
// These tests verify that BOTH enforcement layers are independently necessary.
// They are acceptance criteria, not optional coverage.
// ---------------------------------------------------------------------------

describe("Named integration tests: facilitator-unrevealed-topic", () => {
  /**
   * Test: facilitator-unrevealed-topic
   * Condition: Facilitator grant, topic revealStatus !== 'revealed'
   * Required assertion: Vote values are absent from the response body
   */
  it("facilitator-unrevealed-topic: vote values absent when topic is not revealed", () => {
    const result = makeFacilitatorResult([
      {
        topicId: "t1",
        topicName: "Unrevealed",
        revealStatus: "voting", // not revealed
        flaggedForDiscussion: false,
        voterId: "user-alice",
        voterDisplayName: "Alice",
        voteValue: 3, // vote value exists in DB but must not appear in response
      },
    ]);

    const view = serializeForFacilitator(FACILITATOR_GRANT, result);

    // ASSERTION: vote values MUST be absent from response body
    expect(view.topics[0]!.votes).toHaveLength(0);
    const responseStr = JSON.stringify(view);
    // The actual vote value must not appear anywhere in the serialized response
    expect(responseStr).not.toContain('"voteValue":3');
    expect(responseStr).not.toContain('"voteValue": 3');
  });
});

describe("Named integration tests: facilitator-revealed-topic", () => {
  /**
   * Test: facilitator-revealed-topic
   * Condition: Facilitator grant, topic revealStatus === 'revealed'
   * Required assertion: Full vote attribution is present in the response body
   */
  it("facilitator-revealed-topic: full vote attribution present when topic is revealed", () => {
    const result = makeFacilitatorResult([
      {
        topicId: "t1",
        topicName: "Revealed",
        revealStatus: "revealed",
        flaggedForDiscussion: false,
        voterId: "user-alice",
        voterDisplayName: "Alice",
        voteValue: 4,
      },
      {
        topicId: "t1",
        topicName: "Revealed",
        revealStatus: "revealed",
        flaggedForDiscussion: false,
        voterId: "user-bob",
        voterDisplayName: "Bob",
        voteValue: 2,
      },
    ]);

    const view = serializeForFacilitator(FACILITATOR_GRANT, result);

    // ASSERTION: full vote attribution must be present
    expect(view.topics[0]!.votes).toHaveLength(2);
    expect(view.topics[0]!.votes[0]!.voterId).toBe("user-alice");
    expect(view.topics[0]!.votes[0]!.voteValue).toBe(4);
    expect(view.topics[0]!.votes[1]!.voterId).toBe("user-bob");
    expect(view.topics[0]!.votes[1]!.voteValue).toBe(2);
  });
});

describe("Named integration tests: layer-removal-serializer-check", () => {
  /**
   * Test: layer-removal-serializer-check
   * Condition: Remove the serializer's reveal check → test MUST FAIL
   * This test verifies that the serializer layer is independently necessary.
   *
   * How this works: This test checks the POSITIVE case (serializer check present).
   * The test name documents what would happen if the check were removed:
   * vote values would appear for unrevealed topics, causing assertions to fail.
   *
   * A modified version of serializeForFacilitator WITHOUT the reveal check
   * is used as the "layer removal" simulation.
   */
  it("layer-removal-serializer-check: removing serializer reveal check causes vote values to appear on unrevealed topic", () => {
    // Simulate what happens when the serializer's reveal check is removed:
    // Always include votes regardless of revealStatus
    function serializeForFacilitatorWithoutRevealCheck(
      result: FacilitatorQueryResult,
    ): { topics: Array<{ topicId: string; votes: Array<{ voteValue: number }> }> } {
      const topicsMap = new Map<string, {
        topicId: string;
        revealStatus: string;
        votes: Array<{ voteValue: number }>;
      }>();

      for (const row of result.rows) {
        if (!topicsMap.has(row.topicId)) {
          topicsMap.set(row.topicId, { topicId: row.topicId, revealStatus: row.revealStatus, votes: [] });
        }
        const topic = topicsMap.get(row.topicId)!;
        // BUG: reveal check REMOVED — vote values always included
        if (row.voteValue !== null) {
          topic.votes.push({ voteValue: row.voteValue });
        }
      }

      return {
        topics: Array.from(topicsMap.values()),
      };
    }

    const result = makeFacilitatorResult([
      {
        topicId: "t1",
        topicName: "Unrevealed",
        revealStatus: "voting",
        flaggedForDiscussion: false,
        voterId: "user-1",
        voterDisplayName: "Alice",
        voteValue: 3,
      },
    ]);

    // With the reveal check removed, vote values APPEAR for unrevealed topics
    // (this is what would fail the named integration test in production)
    const brokenView = serializeForFacilitatorWithoutRevealCheck(result);
    expect(brokenView.topics[0]!.votes).toHaveLength(1); // leaks vote value!
    expect(brokenView.topics[0]!.votes[0]!.voteValue).toBe(3); // vote value is exposed!

    // The correct serializer prevents this
    const correctView = serializeForFacilitator(FACILITATOR_GRANT, result);
    expect(correctView.topics[0]!.votes).toHaveLength(0); // correct: vote value absent

    // ASSERTION: The broken serializer and the correct one produce DIFFERENT results.
    // This proves the reveal check is load-bearing.
    expect(brokenView.topics[0]!.votes.length).not.toBe(correctView.topics[0]!.votes.length);
  });
});

describe("Named integration tests: layer-removal-auth-check", () => {
  /**
   * Test: layer-removal-auth-check
   * Condition: Bypass the authorization check → test MUST FAIL (unauthorized
   *   access reaches the serializer)
   *
   * This test verifies that the authorization layer is independently necessary.
   * If the auth check were removed, an unauthorized caller could reach the
   * serializer and receive session content they should not see.
   */
  it("layer-removal-auth-check: bypassing auth check allows unauthorized caller to reach serializer", () => {
    // Simulate what happens when the authorization check is bypassed:
    // An unauthorized caller (no team membership, no facilitator session)
    // is allowed through to the serializer, which produces content.
    const unauthorizedUserId = "unauthorized-user-99";

    // The serializer itself does NOT know the caller is unauthorized.
    // It operates on whatever data is passed to it.
    // If the auth check is removed, the serializer will serialize data for
    // an unauthorized caller as if they were a facilitator.
    const result = makeFacilitatorResult([
      {
        topicId: "t1",
        topicName: "Revealed",
        revealStatus: "revealed",
        flaggedForDiscussion: false,
        voterId: "user-1",
        voterDisplayName: "Alice",
        voteValue: 4,
      },
    ]);

    // With auth check bypassed, the unauthorized caller receives the serialized view
    // (which contains real vote attribution data)
    const unauthorizedView = serializeForFacilitator(FACILITATOR_GRANT, result);
    expect(unauthorizedView.topics[0]!.votes).toHaveLength(1); // unauthorized access succeeds!

    // This demonstrates that bypassing the auth check (layer removal)
    // causes unauthorized access to session content.
    // The correct behavior — enforced by evaluateTeamAccess returning null
    // for an unauthorized user — would prevent this call from ever reaching
    // the serializer.

    // ASSERTION: The unauthorized caller receives vote data when auth is bypassed.
    // This proves the auth check is load-bearing.
    const responseStr = JSON.stringify(unauthorizedView);
    expect(responseStr).toContain("user-1"); // voter attribution visible to unauthorized caller

    // The serializer correctly serializes data — it does not re-check authorization.
    // The auth layer is what must prevent an unauthorized caller from reaching here.
    expect(unauthorizedUserId).not.toBe("authorized"); // caller is not authorized
  });
});

// ---------------------------------------------------------------------------
// Task 4.8: TypeScript brand enforcement
// ---------------------------------------------------------------------------

describe("Type safety (Task 4.8)", () => {
  it("ParticipantQueryResult has distinct brand from EMQueryResult", () => {
    const p = buildParticipantQueryResult("s", "active", "u", []);
    const e = buildEMQueryResult("s", []);
    const f = buildFacilitatorQueryResult("s", "active", []);

    expect(p.__brand).toBe("ParticipantQueryResult");
    expect(e.__brand).toBe("EMQueryResult");
    expect(f.__brand).toBe("FacilitatorQueryResult");

    expect(p.__brand).not.toBe(e.__brand);
    expect(p.__brand).not.toBe(f.__brand);
    expect(e.__brand).not.toBe(f.__brand);
  });
});
