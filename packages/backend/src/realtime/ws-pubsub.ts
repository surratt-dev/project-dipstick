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
