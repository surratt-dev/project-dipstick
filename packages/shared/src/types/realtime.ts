import type { SessionStatus } from "./session.js";
import type { ParticipantContentView, FacilitatorContentView } from "./team-content-views.js";

// ---------------------------------------------------------------------------
// WebSocket delivery-time authorization — shared event/envelope types
//
// websocket-delivery-time-authorization: design.md Decision D2 (channel
// topology) and tasks.md task 1.5 (payload shapes for the three events that
// do not inherit their shape from the existing team-content serializers).
//
// A single Redis channel (`ws:events`) carries all four event types for
// every team and session. Each published message is a JSON envelope:
//   { eventType, sessionId?, teamId?, payload }
// Session-scoped events carry sessionId; the team-scoped event carries
// teamId. This file defines the concrete payload shape for each eventType,
// replacing the `payload: unknown` placeholder named in design.md.
// ---------------------------------------------------------------------------

export type WsEventType =
  | "vote_readiness_update"
  | "session_state_change"
  | "vote_revealed"
  | "topic_history_update";

/**
 * vote_readiness_update payload — pushed to the facilitator's connection when
 * a participant locks in their vote. Task 4.2 / 5.7: readiness signal only.
 * The vote value MUST NOT appear anywhere in this shape.
 */
export interface VoteReadinessUpdatePayload {
  sessionId: string;
  sessionTopicId: string;
  /** The participant who just locked in — identity only, never their vote value. */
  voterId: string;
  readyAt: string; // ISO 8601
}

/**
 * session_state_change payload — pushed to session participants and the
 * facilitator when session status transitions (lobby advance, session close,
 * and — once GitHub issue #26 lands — topic advance).
 */
export interface SessionStateChangePayload {
  sessionId: string;
  teamId: string;
  previousStatus: SessionStatus;
  newStatus: SessionStatus;
  changedAt: string; // ISO 8601
}

/**
 * vote_revealed payload — the grant-path-specific content view produced by
 * the existing team-content serializers (design.md Decision D4). No
 * independent payload shape is defined here; the WebSocket handler calls
 * serializeForFacilitator / serializeForMemberParticipant and sends the
 * result verbatim.
 *
 * This is the shape delivered to an individual CLIENT connection (the wire
 * frame — see WsClientMessage below). It is grant-path-specific: a
 * facilitator and a participant receiving the "same" reveal event receive
 * different shapes, by design (Decision D4 / the pre-reveal serializer
 * boundary). It is NOT the shape published on the internal Redis
 * `ws:events` channel — see VoteRevealedTriggerPayload for that.
 */
export type VoteRevealedPayload = ParticipantContentView | FacilitatorContentView;

/**
 * vote_revealed's internal Redis pub/sub payload (design.md Decision D2's
 * envelope). Deliberately minimal — a trigger notice, not the vote data
 * itself. The per-recipient, grant-path-specific VoteRevealedPayload is
 * constructed at delivery time, per candidate connection, by calling
 * serializeForFacilitator / serializeForMemberParticipant against a live
 * database read (design.md Decision D4) — not by replaying a payload that
 * was serialized once at publish time for an unknown audience. This keeps
 * the pre-reveal serializer boundary intact per-recipient (a facilitator
 * and a participant subscribed to the same session must never be able to
 * derive each other's view from a shared published payload) and avoids
 * carrying revealed vote values across the shared Redis channel at all.
 */
export interface VoteRevealedTriggerPayload {
  sessionId: string;
  sessionStatus: SessionStatus;
}

/**
 * topic_history_update payload — pushed to team event-stream subscribers
 * when historical session data changes (e.g., an action item is finalized
 * during wrap-up, or a topic advances). No vote values ever appear here —
 * this event announces that historical data changed, it does not carry
 * vote content itself.
 */
export interface TopicHistoryUpdatePayload {
  teamId: string;
  updateType: "action_item_finalized" | "topic_advanced";
  sessionId: string;
  topicId?: string;
  actionItemId?: string;
  updatedAt: string; // ISO 8601
}

export type WsEventPayloadFor<E extends WsEventType> = E extends "vote_readiness_update"
  ? VoteReadinessUpdatePayload
  : E extends "session_state_change"
    ? SessionStateChangePayload
    : E extends "vote_revealed"
      ? VoteRevealedTriggerPayload
      : E extends "topic_history_update"
        ? TopicHistoryUpdatePayload
        : never;

/**
 * The envelope published on the single `ws:events` Redis channel
 * (design.md Decision D2). Session-scoped events carry sessionId; the
 * team-scoped event (topic_history_update) carries teamId.
 *
 * Note on vote_revealed: this envelope's payload is the minimal
 * VoteRevealedTriggerPayload, not the grant-path-specific
 * VoteRevealedPayload a client ultimately receives — see
 * VoteRevealedTriggerPayload's own comment for why.
 */
export type WsEventEnvelope =
  | {
      eventType: "vote_readiness_update";
      sessionId: string;
      payload: VoteReadinessUpdatePayload;
    }
  | {
      eventType: "session_state_change";
      sessionId: string;
      payload: SessionStateChangePayload;
    }
  | {
      eventType: "vote_revealed";
      sessionId: string;
      payload: VoteRevealedTriggerPayload;
    }
  | {
      eventType: "topic_history_update";
      teamId: string;
      payload: TopicHistoryUpdatePayload;
    };

/**
 * The wire frame delivered to an individual client connection (`.send()`'s
 * argument, JSON-stringified). Distinct from WsEventEnvelope: the envelope
 * is the internal, cross-pod Redis pub/sub message; this is what a specific,
 * already-authorized connection actually receives. For vote_revealed, this
 * carries the grant-path-specific VoteRevealedPayload constructed at
 * delivery time for that one recipient — never the internal trigger.
 */
export type WsClientMessage =
  | { eventType: "vote_readiness_update"; payload: VoteReadinessUpdatePayload }
  | { eventType: "session_state_change"; payload: SessionStateChangePayload }
  | { eventType: "vote_revealed"; payload: VoteRevealedPayload }
  | { eventType: "topic_history_update"; payload: TopicHistoryUpdatePayload };
