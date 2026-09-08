import { db } from "../db.js";
import {
  buildFacilitatorQueryResult,
  buildParticipantQueryResult,
  serializeForFacilitator,
  serializeForMemberParticipant,
} from "../content/team-content-serializers.js";
import type {
  SessionSubscriberGrant,
  TeamAccessGrant,
  VoteRevealedPayload,
  SessionStatus,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// vote_revealed payload construction — design.md Decision D4
//
// "The WebSocket handler for vote_revealed calls serializeForFacilitator /
// serializeForMemberParticipant ... to construct the event payload. It does
// not build independent payload-construction logic, even logic that appears
// 'obviously' equivalent."
//
// This module fetches the raw rows for a single live session (the same
// shape content.ts's session-history facilitator/participant queries already
// use, scoped to one session instead of a team's completed-session history)
// and hands them to the exact same builder + serializer functions
// content.ts uses. No independent reveal-gating logic is introduced here —
// the pre-reveal enforcement (topic.revealStatus === 'revealed') lives
// entirely inside serializeForFacilitator / serializeForMemberParticipant,
// untouched.
//
// grant here is a SessionSubscriberGrant (evaluateSessionSubscriberAccess's
// return type), not a TeamAccessGrant — the two are adapted to the exact
// TeamAccessGrant variant shape the serializers require, since the
// serializers only use the grant parameter for its type, never its runtime
// value. This is glue, not logic: no field on the adapted object is
// computed independently of the SessionSubscriberGrant that produced it.
// ---------------------------------------------------------------------------

interface FacilitatorRow {
  topic_id: string;
  topic_name: string;
  reveal_status: string;
  flagged_for_discussion: boolean;
  voter_id: string | null;
  voter_display_name: string | null;
  vote_value: number | null;
}

interface ParticipantRow {
  topic_id: string;
  topic_name: string;
  reveal_status: string;
  flagged_for_discussion: boolean;
  voter_id: string | null;
  vote_value: number | null;
  vote_count: number;
  contains_outlier: boolean;
}

export async function fetchFacilitatorVoteRevealedRows(sessionId: string): Promise<FacilitatorRow[]> {
  const result = await db.query<FacilitatorRow>(
    `SELECT
       st.topic_id,
       st.topic_name,
       st.status AS reveal_status,
       st.flagged_for_discussion,
       v.voter_id,
       u.display_name AS voter_display_name,
       v.vote_value
     FROM session_topics st
     LEFT JOIN votes v ON v.session_topic_id = st.id
     LEFT JOIN users u ON u.id = v.voter_id
     WHERE st.session_id = $1
     ORDER BY st.display_order, u.display_name`,
    [sessionId],
  );
  return result.rows;
}

export async function fetchParticipantVoteRevealedRows(sessionId: string): Promise<ParticipantRow[]> {
  const result = await db.query<ParticipantRow>(
    `SELECT
       st.topic_id,
       st.topic_name,
       st.status AS reveal_status,
       st.flagged_for_discussion,
       v.voter_id,
       v.vote_value,
       COUNT(v.id) OVER (PARTITION BY st.id, v.vote_value)::integer AS vote_count,
       COALESCE(v.is_outlier, false) AS contains_outlier
     FROM session_topics st
     LEFT JOIN votes v ON v.session_topic_id = st.id
     WHERE st.session_id = $1
     ORDER BY st.display_order, v.vote_value`,
    [sessionId],
  );
  return result.rows;
}

export async function buildVoteRevealedPayload(
  grant: Extract<SessionSubscriberGrant, { path: "facilitator" }> | Extract<SessionSubscriberGrant, { path: "participant" }>,
  sessionStatus: SessionStatus,
  /** The subscriber's own userId — needed to identify their own vote (ParticipantContentView.ownVoteValue). */
  subscriberUserId: string,
): Promise<VoteRevealedPayload> {
  if (grant.path === "facilitator") {
    const rows = await fetchFacilitatorVoteRevealedRows(grant.sessionId);
    const result = buildFacilitatorQueryResult(grant.sessionId, sessionStatus, rows);
    const facilitatorGrant: Extract<TeamAccessGrant, { path: "facilitator" }> = {
      path: "facilitator",
      sessionId: grant.sessionId,
      teamId: grant.teamId,
      sessionStatus,
      actorGlobalRole: grant.actorGlobalRole,
    };
    return serializeForFacilitator(facilitatorGrant, result);
  }

  const rows = await fetchParticipantVoteRevealedRows(grant.sessionId);
  const result = buildParticipantQueryResult(grant.sessionId, sessionStatus, subscriberUserId, rows);
  const memberGrant: Extract<TeamAccessGrant, { path: "member"; role: "participant" }> = {
    path: "member",
    role: "participant",
    teamId: grant.teamId,
    actorGlobalRole: grant.actorGlobalRole,
  };
  return serializeForMemberParticipant(memberGrant, result);
}
