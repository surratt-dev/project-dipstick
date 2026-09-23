import type { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import { redis } from "../redis.js";
import type {
  WsEventEnvelope,
  VoteReadinessUpdatePayload,
  SessionStateChangePayload,
  VoteRevealedTriggerPayload,
  TopicHistoryUpdatePayload,
  ParticipantJoinedPayload,
  ParticipantLeftPayload,
  ActionItemStatusUpdatedPayload,
  FacilitatorConnectionStatusPayload,
  SessionStatus,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Redis pub/sub wiring for the WebSocket delivery-time authorization layer
//
// websocket-delivery-time-authorization: design.md Decision D2, tasks.md
// task 1.4.
//
// Task boundary vs. task 4.1 (ws-event-dispatcher.ts): THIS FILE owns
// creating and instrumenting the subscriber *connection* (redis.duplicate(),
// the reconnecting/ready structured-log warnings) and the publish-side
// wiring (publishWsEvent + the four typed wrappers below). It does NOT
// implement the message-handling logic that runs when a ws:events message
// arrives — the local-registry lookup, per-candidate authorization check,
// and .send() call are ws-event-dispatcher.ts's responsibility (task 4.1).
// ---------------------------------------------------------------------------

export const WS_EVENTS_CHANNEL = "ws:events";

/**
 * Publish a WebSocket content-access event envelope on the shared
 * `ws:events` Redis channel. Every backend pod's subscriber receives this
 * message and independently decides, per locally-held candidate connection,
 * whether to deliver it (design.md Decision D3) — this function does not
 * decide who receives the event; it only fans the envelope out.
 *
 * PUBLISH is an ordinary Redis command — it does not change the shared
 * `redis` client's connection mode, unlike SUBSCRIBE. The publisher
 * correctly reuses the shared client (design.md Decision D2); only the
 * subscriber requires a dedicated `redis.duplicate()` connection (see
 * createWsSubscriber below).
 */
export async function publishWsEvent(envelope: WsEventEnvelope): Promise<void> {
  await redis.publish(WS_EVENTS_CHANNEL, JSON.stringify(envelope));
}

// ---------------------------------------------------------------------------
// Typed publish wrappers, one per event type.
//
// Publish-after-commit ordering (tasks.md tasks 1.4/7.2/7.3/7.6): every
// caller of these functions MUST invoke them only after the triggering
// action's database transaction has successfully COMMITted — never before
// BEGIN, never between a query and COMMIT. Publishing before a successful
// commit risks notifying a subscriber of a state transition that a
// subsequent statement in the same transaction rolls back, which would
// corrupt this change's core guarantee: no commit, no publish. See
// facilitator-sessions.ts and sessions.ts for the call sites, and
// audit-logger.ts / Decision D7 for the audit-log writes these same
// handlers also perform in the same transaction.
// ---------------------------------------------------------------------------

export async function publishVoteReadinessUpdate(
  sessionId: string,
  payload: VoteReadinessUpdatePayload,
): Promise<void> {
  await publishWsEvent({ eventType: "vote_readiness_update", sessionId, payload });
}

export async function publishSessionStateChange(
  sessionId: string,
  payload: SessionStateChangePayload,
): Promise<void> {
  await publishWsEvent({ eventType: "session_state_change", sessionId, payload });
}

// Wired into the reveal handler
// (packages/backend/src/routes/facilitator-sessions.ts,
// POST /api/v1/teams/:teamId/sessions/:sessionId/reveal) — called after the
// topic reveal-status flip (voting -> revealed) commits
// (session-lifecycle-transitions design.md Decision D2/D3, tasks.md task
// 3.6). GitHub issue #26 is resolved by this change.
export async function publishVoteRevealed(
  sessionId: string,
  payload: VoteRevealedTriggerPayload,
): Promise<void> {
  await publishWsEvent({ eventType: "vote_revealed", sessionId, payload });
}

// Wired into the topic-advance handler
// (packages/backend/src/routes/facilitator-sessions.ts, POST
// /api/v1/teams/:teamId/sessions/:sessionId/topics/advance) — called after a
// topic-to-topic advance or wrap-up-entry transition commits
// (session-lifecycle-transitions design.md Decision D4, tasks.md tasks
// 4.9/4.10). Its real trigger set is topic-to-topic advance only —
// "action item finalization" was a stale framing this change corrects (see
// proposal.md's Out of Scope section); finalization is already satisfied by
// the existing session-complete write. GitHub issue #26 is resolved by this
// change.
export async function publishTopicHistoryUpdate(
  teamId: string,
  payload: TopicHistoryUpdatePayload,
): Promise<void> {
  await publishWsEvent({ eventType: "topic_history_update", teamId, payload });
}

// Wired into the session-scoped WebSocket route's connect/disconnect
// handlers (packages/backend/src/realtime/websocket-routes.ts, GitHub issue
// #94, FR-2.5). Unlike the wrappers above, these are NOT governed by the
// publish-after-commit rule documented above this section — a WebSocket
// connect/disconnect has no backing database transaction to commit before.
// This is a live-connection presence signal, not a durable-state broadcast.
export async function publishParticipantJoined(
  sessionId: string,
  payload: ParticipantJoinedPayload,
): Promise<void> {
  await publishWsEvent({ eventType: "participant_joined", sessionId, payload });
}

export async function publishParticipantLeft(
  sessionId: string,
  payload: ParticipantLeftPayload,
): Promise<void> {
  await publishWsEvent({ eventType: "participant_left", sessionId, payload });
}

// Wired into the action-item status mutation handler
// (packages/backend/src/routes/action-items.ts, PATCH
// /api/v1/action-items/:actionItemId/status) — called after 3.4a's
// transaction commits, only when a session context resolved (design.md
// Decision D7). Per Decision D14, `sessionStatus` is stamped by the caller
// immediately after that commit (the value validated by 3.1c/D11) and
// carried on the envelope only — NOT part of ActionItemStatusUpdatedPayload
// — mirroring publishVoteRevealed's serverTimestamp precedent above, so
// dispatchActionItemStatusUpdated can gate delivery to `pre_session` for
// both grant paths without a per-candidate DB read.
export async function publishActionItemStatusUpdated(
  sessionId: string,
  payload: ActionItemStatusUpdatedPayload,
  sessionStatus: SessionStatus,
): Promise<void> {
  await publishWsEvent({ eventType: "action_item_status_updated", sessionId, payload, sessionStatus });
}

// facilitator-reconnect-indicator: design.md Decision 5. Wired into the SAME
// two websocket-routes.ts call sites that already call
// recordFacilitatorConnectionAudit for "connected"/"disconnected" (issue
// #94) — one fact, two consumers (the existing audit write, this broadcast).
// Mirrors publishParticipantJoined/publishParticipantLeft's shape exactly:
// NOT a direct iteration of the local, per-pod ConnectionRegistry, which
// would silently fail to deliver across pods in any multi-instance
// deployment (a facilitator and a participant have no guarantee of sharing
// a pod). Payload is deliberately minimal — `{ connected }` only, no cause,
// no close code — so the broadcast never discloses which of the three
// possible causes (network drop, STALE_SIGNAL_CLOSE_CODE,
// REAUTH_GRACE_EXPIRED_CLOSE_CODE) produced a disconnect.
export async function publishFacilitatorConnectionStatus(
  sessionId: string,
  payload: FacilitatorConnectionStatusPayload,
): Promise<void> {
  await publishWsEvent({ eventType: "facilitator_connection_status", sessionId, payload });
}

// ---------------------------------------------------------------------------
// "Prior disconnect" shared state (design.md Decision 5's "Prior disconnect"
// paragraph): a single Redis key per session, read-before-write at each of
// websocket-routes.ts's two facilitator connect/disconnect call sites, so
// any pod can tell whether the transition it just observed is actually a
// change from the SESSION's point of view — not derivable from any one
// pod's local ConnectionRegistry memory (a facilitator dropping from pod A
// and reconnecting to pod B leaves pod B with no local record of the prior
// disconnect). Bounded, single-purpose state — not a new registry, not a
// new authorization surface.
// ---------------------------------------------------------------------------

function facilitatorConnectedKey(sessionId: string): string {
  return `facilitator_connected:${sessionId}`;
}

/**
 * Read-before-write. Returns true when this connect/disconnect is an actual
 * transition worth publishing (the flag's previous value differs from
 * `connected`) and updates the flag to `connected`; returns false — and
 * still updates the flag — for a redundant call (e.g. a second facilitator
 * tab connecting while the flag already reads "connected").
 */
export async function recordFacilitatorConnectionTransition(
  sessionId: string,
  connected: boolean,
): Promise<boolean> {
  const key = facilitatorConnectedKey(sessionId);
  const previous = await redis.get(key);
  const wasConnected = previous === "true";
  await redis.set(key, connected ? "true" : "false");
  return wasConnected !== connected;
}

/**
 * Clears the flag when the session leaves `pre_session`/`active` status —
 * the same lifecycle boundary that gates the broadcast itself — so it does
 * not outlive the session it describes. Called from
 * facilitator-sessions.ts's wrap-up-entry transition (the only status
 * transition today that leaves this boundary from the inside).
 */
export async function clearFacilitatorConnectedFlag(sessionId: string): Promise<void> {
  await redis.del(facilitatorConnectedKey(sessionId));
}

// ---------------------------------------------------------------------------
// Subscriber connection
//
// design.md Decision D2 ("Subscriber connection isolation"): the per-pod
// pub/sub subscriber MUST use a connection created via redis.duplicate(),
// NEVER the shared `redis` singleton exported from redis.ts. That singleton
// is a plain ioredis client already used for ordinary commands by three
// other call sites — @fastify/session's Redis-backed store (app.ts), the
// health check (health.ts), and OIDC state (auth.ts). The moment
// .subscribe() is called on an ioredis connection, that connection enters
// subscriber mode, and a connection in subscriber mode can run only
// subscribe/unsubscribe/psubscribe/punsubscribe/ping/quit — every other
// command on that same connection starts throwing. redis.duplicate()
// creates a second TCP connection sharing the original's connection
// options, free to enter subscriber mode without affecting the shared
// client.
//
// Redis pub/sub has no replay (design.md Decision D2): ioredis automatically
// reconnects a dropped connection and automatically re-issues SUBSCRIBE for
// previously-subscribed channels on reconnect — the subscription recovers
// on its own. But any message PUBLISHed while this pod's subscriber
// connection is down is gone, permanently, for this pod. The required
// mitigation is operational visibility, not elimination of the gap: log a
// structured warning on `reconnecting` and `ready` so an operator can
// correlate a "my view went quiet" report with a real reconnect event.
// ---------------------------------------------------------------------------

export function createWsSubscriber(logger: FastifyBaseLogger): Redis {
  const subscriber = redis.duplicate();

  subscriber.on("reconnecting", () => {
    logger.warn(
      { channel: WS_EVENTS_CHANNEL },
      "ws:events Redis subscriber connection reconnecting — any events published during this gap are permanently lost for this pod (Redis pub/sub has no replay)",
    );
  });

  subscriber.on("ready", () => {
    logger.warn(
      { channel: WS_EVENTS_CHANNEL },
      "ws:events Redis subscriber connection ready (re)subscribed",
    );
  });

  subscriber.on("error", (err) => {
    logger.error({ err, channel: WS_EVENTS_CHANNEL }, "ws:events Redis subscriber connection error");
  });

  return subscriber;
}
