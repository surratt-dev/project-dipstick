import type { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import { WS_EVENTS_CHANNEL } from "./ws-pubsub.js";
import {
  connectionRegistry,
  isPastAbsoluteLifetime,
  safeSend,
  type ConnectionRegistry,
  type RegisteredConnection,
} from "./connection-registry.js";
import { evaluateSessionSubscriberAccess } from "../auth/session-subscriber-access-helper.js";
import { evaluateTeamAccess } from "../auth/team-content-access-helper.js";
import { buildVoteRevealedPayload } from "./vote-revealed-payload.js";
import type { WsEventEnvelope, WsClientMessage } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// ws-event-dispatcher — the per-message-handler logic for the ws:events
// Redis subscription (design.md Decision D3, tasks.md task 4.1)
//
// Task boundary vs. task 1.4 (ws-pubsub.ts): ws-pubsub.ts creates and
// instruments the subscriber *connection*. THIS FILE implements the
// message-handling logic that runs when a message arrives on it: the local
// registry lookup, the per-candidate authorization check, and the .send()
// call.
//
// THE CENTRAL RULE (design.md Decision D3, restated here because this is
// the file where a well-intentioned implementation could silently regress):
// the authorization check for each locally-held candidate connection runs
// INSIDE this message handler, INDIVIDUALLY per candidate socket,
// IMMEDIATELY before that socket's .send() call. Never before, never
// cached, never batched across recipients without a per-recipient check.
// The tell in code review: is evaluateSessionSubscriberAccess /
// evaluateTeamAccess called inside the per-message handler, once per
// candidate socket, EVERY SINGLE TIME a message arrives — or is it called
// once at subscribe time with the result cached? The second shape compiles
// and passes a naive test. It is wrong.
//
// Per-pod concurrency model (Decision D3): recipient authorization checks
// for local candidates of the SAME event run CONCURRENTLY (Promise.all),
// not serially — worst-case local fan-out width is single digits per this
// application's own small-team session design.
// ---------------------------------------------------------------------------

export function attachWsEventDispatcher(
  subscriber: Redis,
  logger: FastifyBaseLogger,
  registry: ConnectionRegistry = connectionRegistry,
): void {
  subscriber.subscribe(WS_EVENTS_CHANNEL).catch((err: unknown) => {
    logger.error({ err }, "failed to subscribe to ws:events");
  });

  subscriber.on("message", (channel: string, message: string) => {
    if (channel !== WS_EVENTS_CHANNEL) return;
    void handleIncomingMessage(message, logger, registry);
  });
}

export async function handleIncomingMessage(
  raw: string,
  logger: FastifyBaseLogger,
  registry: ConnectionRegistry,
): Promise<void> {
  let envelope: WsEventEnvelope;
  try {
    envelope = JSON.parse(raw) as WsEventEnvelope;
  } catch (err) {
    logger.warn({ err }, "discarding malformed ws:events message");
    return;
  }

  switch (envelope.eventType) {
    case "vote_readiness_update":
      return dispatchVoteReadinessUpdate(envelope, registry, logger);
    case "session_state_change":
      return dispatchSessionStateChange(envelope, registry, logger);
    case "vote_revealed":
      return dispatchVoteRevealed(envelope, registry, logger);
    case "topic_history_update":
      return dispatchTopicHistoryUpdate(envelope, registry, logger);
    default: {
      // Exhaustiveness guard — a new WsEventType added to the shared union
      // without a corresponding dispatch case fails here at runtime (and,
      // if the switch above stops being exhaustive, at compile time via the
      // `never` assignment below).
      const _exhaustive: never = envelope;
      logger.warn({ envelope: _exhaustive }, "unrecognized ws:events eventType");
    }
  }
}

/** Reject a candidate whose connection has exceeded the 90-minute absolute lifetime (Decision D8). */
function isConnectionExpired(conn: RegisteredConnection, logger: FastifyBaseLogger): boolean {
  if (isPastAbsoluteLifetime(conn)) {
    logger.info(
      { userId: conn.userId },
      "ws delivery rejected: connection past absolute lifetime (SEC-25/26 compensating control)",
    );
    return true;
  }
  return false;
}

function sendClientMessage(
  registry: ConnectionRegistry,
  scope: "session" | "team",
  id: string,
  conn: RegisteredConnection,
  message: WsClientMessage,
): void {
  safeSend(registry, scope, id, conn, JSON.stringify(message));
}

// ---------------------------------------------------------------------------
// vote_readiness_update — task 4.2
//
// Delivered ONLY to the active facilitator for this session, while the
// session is in a status where readiness signals are meaningful
// (pre_session or active). Payload carries identity + readiness only —
// never a vote value (task 5.7 verifies this at the type/unit level).
// ---------------------------------------------------------------------------
async function dispatchVoteReadinessUpdate(
  envelope: Extract<WsEventEnvelope, { eventType: "vote_readiness_update" }>,
  registry: ConnectionRegistry,
  logger: FastifyBaseLogger,
): Promise<void> {
  const candidates = registry.candidates("session", envelope.sessionId);
  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map(async (conn) => {
      if (isConnectionExpired(conn, logger)) return;

      const grant = await evaluateSessionSubscriberAccess(conn.userId, envelope.sessionId);
      if (
        grant?.path === "facilitator" &&
        (grant.sessionStatus === "pre_session" || grant.sessionStatus === "active")
      ) {
        sendClientMessage(registry, "session", envelope.sessionId, conn, {
          eventType: "vote_readiness_update",
          payload: envelope.payload,
        });
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// session_state_change — task 4.3
//
// Delivered to an active participant OR the active facilitator for this
// session, via evaluateSessionSubscriberAccess.
// ---------------------------------------------------------------------------
async function dispatchSessionStateChange(
  envelope: Extract<WsEventEnvelope, { eventType: "session_state_change" }>,
  registry: ConnectionRegistry,
  logger: FastifyBaseLogger,
): Promise<void> {
  const candidates = registry.candidates("session", envelope.sessionId);
  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map(async (conn) => {
      if (isConnectionExpired(conn, logger)) return;

      const grant = await evaluateSessionSubscriberAccess(conn.userId, envelope.sessionId);
      if (grant !== null) {
        sendClientMessage(registry, "session", envelope.sessionId, conn, {
          eventType: "session_state_change",
          payload: envelope.payload,
        });
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// vote_revealed — task 4.4
//
// Delivered to any subscriber holding a valid participant or facilitator
// grant for this session. The payload is NOT taken from the envelope
// (which carries only a minimal trigger — see VoteRevealedTriggerPayload)
// — it is constructed per-recipient, at delivery time, by
// buildVoteRevealedPayload calling serializeForFacilitator /
// serializeForMemberParticipant (design.md Decision D4). No independent
// payload-construction or reveal-gating logic lives in this function.
//
// Real end-to-end firing wired by session-lifecycle-transitions (GitHub
// issue #26 resolved): the reveal endpoint (packages/backend/src/routes/
// facilitator-sessions.ts, POST .../reveal) now commits the voting ->
// revealed transition and publishes this event after that transaction
// commits.
// ---------------------------------------------------------------------------
async function dispatchVoteRevealed(
  envelope: Extract<WsEventEnvelope, { eventType: "vote_revealed" }>,
  registry: ConnectionRegistry,
  logger: FastifyBaseLogger,
): Promise<void> {
  const candidates = registry.candidates("session", envelope.sessionId);
  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map(async (conn) => {
      if (isConnectionExpired(conn, logger)) return;

      const grant = await evaluateSessionSubscriberAccess(conn.userId, envelope.sessionId);
      if (grant === null) return;

      const payload = await buildVoteRevealedPayload(grant, envelope.payload.sessionStatus, conn.userId);
      sendClientMessage(registry, "session", envelope.sessionId, conn, {
        eventType: "vote_revealed",
        payload,
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// topic_history_update — task 4.5
//
// Calls evaluateTeamAccess(userId, teamId) verbatim; delivers to `member`
// OR `facilitator` grant paths; EXPLICITLY REJECTS an `admin`-path grant —
// this is the one place in this change where an Application Admin's
// otherwise-uniform grant must NOT translate into delivery (design.md
// Decision D2/D3, corrected during Design-stage review to match the delta
// spec and the content.ts HTTP precedent, which deny only `admin` and
// proceed identically for `member` and `facilitator`).
//
// Real end-to-end firing wired by session-lifecycle-transitions (GitHub
// issue #26 resolved): SESSION-012 (packages/backend/src/routes/
// facilitator-sessions.ts, POST .../topics/advance) publishes this event
// after its transaction commits, for both the topic-to-topic branch and the
// wrap-up-entry branch. This event's real trigger set is topic-to-topic
// advance only — "action item finalization" was a stale framing corrected
// by session-lifecycle-transitions (proposal.md's Out of Scope section):
// action_items has no finalized/finalized_at column, and finalization is
// already satisfied by the existing session-complete write (SESSION-006).
// No new write was needed for it.
// ---------------------------------------------------------------------------
async function dispatchTopicHistoryUpdate(
  envelope: Extract<WsEventEnvelope, { eventType: "topic_history_update" }>,
  registry: ConnectionRegistry,
  logger: FastifyBaseLogger,
): Promise<void> {
  const candidates = registry.candidates("team", envelope.teamId);
  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map(async (conn) => {
      if (isConnectionExpired(conn, logger)) return;

      const grant = await evaluateTeamAccess(conn.userId, envelope.teamId);
      if (grant === null) return;

      // Explicit admin-path rejection (Decision D2). This holds even when
      // the same user is ALSO, separately, a team member or facilitator —
      // evaluateTeamAccess's precedence order returns only the admin grant
      // for an application_admin caller, so there is no "other path" to
      // fall back to here; this IS the correct, documented trade-off
      // (design.md Decision D2's "dual-role admin+member" note).
      if (grant.path === "admin") {
        logger.info(
          { userId: conn.userId, teamId: envelope.teamId },
          "topic_history_update delivery rejected: admin-path grant",
        );
        return;
      }

      sendClientMessage(registry, "team", envelope.teamId, conn, {
        eventType: "topic_history_update",
        payload: envelope.payload,
      });
    }),
  );
}
