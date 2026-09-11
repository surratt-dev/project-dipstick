import { db } from "../db.js";
import type { SessionRegistrationSnapshotPayload, SessionStatus, SessionTopicStatus } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// buildSessionRegistrationSnapshot — vote-compose-recovery (GitHub issue
// #31), design.md Decision D3c.
//
// Assembles the `session_registration_snapshot` payload sent directly to a
// session-scoped WebSocket connection on every successful registration
// (websocket-routes.ts's `GET /ws/sessions/:sessionId` handler, task 7.4).
// One live database read per call — no cache, matching the no-cache
// principle evaluateSessionSubscriberAccess and the delivery-time
// dispatcher already apply to session-scoped reads.
//
// Composition with evaluateSessionSubscriberAccess (design.md D3d): this
// function performs NO access check of its own. It is only ever called
// after evaluateSessionSubscriberAccess has already granted the calling
// connection access to this session — it piggybacks on an access decision
// already made, it does not make a new one. Its only disclosure beyond what
// that grant already implies is this user's own hasLockedInVote for the
// current topic (self-disclosure only, via voter_id = $2).
// ---------------------------------------------------------------------------

/**
 * Call-site discipline (design.md D3c "Call-site discipline" note): like
 * evaluateSessionSubscriberAccess before it, this function performs no
 * internal provenance check on `userId` — it trusts whatever its caller
 * passes. The non-spoofability of `hasLockedInVote` is therefore a property
 * of the one call site in websocket-routes.ts, not a guarantee this
 * function itself enforces. `userId` MUST be `request.session.userId` —
 * server-derived from the signed, httpOnly, sameSite: strict session
 * cookie, set only at OIDC callback — NEVER a client-supplied value from a
 * query param, header, or message field. A future second call site must
 * uphold this same constraint.
 */
export async function buildSessionRegistrationSnapshot(
  userId: string,
  sessionId: string,
): Promise<SessionRegistrationSnapshotPayload | null> {
  const result = await db.query<{
    session_status: SessionStatus;
    current_topic_id: string | null;
    topic_status: SessionTopicStatus | null;
    has_locked_in: boolean;
  }>(
    `SELECT s.status AS session_status,
            s.current_topic_id,
            st.status AS topic_status,
            (v.id IS NOT NULL) AS has_locked_in
     FROM sessions s
     LEFT JOIN session_topics st ON st.id = s.current_topic_id
     LEFT JOIN votes v ON v.session_topic_id = s.current_topic_id AND v.voter_id = $2
     WHERE s.id = $1`,
    [sessionId, userId],
  );

  if (result.rows.length === 0) {
    // Zero-row case: the session was deleted in the narrow window between
    // the access grant and this read. Caller (websocket-routes.ts) treats
    // this identically to a thrown error — skip the send, do not throw.
    return null;
  }

  const row = result.rows[0]!;

  return {
    sessionId,
    sessionStatus: row.session_status,
    currentTopic:
      row.current_topic_id === null
        ? null
        : { sessionTopicId: row.current_topic_id, status: row.topic_status! },
    hasLockedInVote: row.has_locked_in,
  };
}
