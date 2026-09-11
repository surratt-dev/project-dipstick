import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import websocketPlugin from "@fastify/websocket";
import { registerOriginCheck } from "./origin-check.js";
import { connectionRegistry, safeSend, type RegisteredConnection } from "./connection-registry.js";
import { ABSOLUTE_LIFETIME_MS } from "../auth/middleware.js";
import { evaluateSessionSubscriberAccess } from "../auth/session-subscriber-access-helper.js";
import { evaluateTeamAccess } from "../auth/team-content-access-helper.js";
import { createWsSubscriber, publishParticipantJoined, publishParticipantLeft } from "./ws-pubsub.js";
import { attachWsEventDispatcher } from "./ws-event-dispatcher.js";
import { STALE_SIGNAL_CLOSE_CODE } from "./staleness-signal.js";
import type { SessionData } from "../auth/session-store.js";
import { scheduleReauthorizationSweep, resolveActorGlobalRole, resolveTeamIdForAudit } from "./connection-reauthorization.js";
import {
  scheduleTokenRefreshMonitor,
  consumeGraceRecoveryMarker,
  recordConnectionRecoveredAudit,
} from "./connection-token-refresh.js";
import { buildSessionRegistrationSnapshot } from "./session-registration-snapshot.js";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";

// ---------------------------------------------------------------------------
// WebSocket route registration
//
// websocket-delivery-time-authorization: design.md Decision D1 (transport),
// Migration Plan step 3, tasks.md tasks 1.2, 1.2a, 3.2, 3.6.
//
// Three-check-point model (per the delta spec / proposal.md):
//   1. Connection-time authentication: the WS upgrade handshake runs inside
//      Fastify's normal request lifecycle, so request.session is resolved
//      and validated by authMiddleware's existing onRequest hook (app.ts)
//      before this route handler ever runs — no new authentication
//      mechanism (Decision D1). registerOriginCheck (Decision D9) runs
//      before that, on the same onRequest chain.
//   2. Subscription-time early rejection: this route handler runs an
//      authorization check ONCE, immediately after the upgrade completes,
//      and closes the connection immediately if it fails, before ever
//      adding it to the local registry. This is an ADDITIVE safeguard — it
//      saves a doomed connection from occupying a registry slot — and is
//      NOT a substitute for delivery-time checks.
//   3. Delivery-time checks: ws-event-dispatcher.ts, run independently on
//      every push, for as long as the connection is registered.
//
// Two routes, matching the registry's two scopes:
//   GET /ws/sessions/:sessionId  — session-scoped events (vote_readiness_update,
//                                   session_state_change, vote_revealed)
//   GET /ws/teams/:teamId/events — team-scoped event (topic_history_update)
// ---------------------------------------------------------------------------

// Both the subscription-time rejection and the scheduled absolute-lifetime
// force-close use the SAME close code (staleness-signal.ts's
// STALE_SIGNAL_CLOSE_CODE), not two distinct codes. This is required by
// design.md's non-goal ("Disclosing the cause of revocation to the affected
// connection") and tasks.md task 9.2: if "rejected as unauthorized" and
// "force-closed at the 90-minute absolute lifetime" used different close
// codes, a client could distinguish the two just by inspecting the close
// event, which is exactly the surveillance-adjacent disclosure this change
// must not introduce. See staleness-signal.ts for the full rationale.
const CLOSE_UNAUTHORIZED = STALE_SIGNAL_CLOSE_CODE;
const CLOSE_FORCE_EXPIRED = STALE_SIGNAL_CLOSE_CODE;

export async function registerWebSocketRoutes(app: FastifyInstance): Promise<void> {
  // Decision D9: Origin check MUST run before request.session is consulted.
  // authMiddleware (app.ts) is registered on `app` immediately after this
  // call, so this hook — added first — runs first in the onRequest chain.
  registerOriginCheck(app);

  await app.register(websocketPlugin);

  const subscriber = createWsSubscriber(app.log);
  attachWsEventDispatcher(subscriber, app.log);

  app.addHook("onClose", async () => {
    await subscriber.quit().catch(() => undefined);
  });

  app.get<{ Params: { sessionId: string } }>(
    "/ws/sessions/:sessionId",
    { websocket: true },
    (socket, request) => {
      const session = request.session as unknown as SessionData;
      const { sessionId } = request.params;

      void (async () => {
        // Subscription-time early rejection (additive safeguard).
        const grant = await evaluateSessionSubscriberAccess(session.userId, sessionId);
        if (grant === null) {
          socket.close(CLOSE_UNAUTHORIZED);
          return;
        }

        const sessionCreatedAt = new Date(session.sessionCreatedAt).getTime();
        const conn: RegisteredConnection = {
          socket,
          userId: session.userId,
          sessionCreatedAt,
          fastifySessionId: request.session.sessionId,
        };

        connectionRegistry.register("session", sessionId, conn);
        // FR-2.5 (GitHub issue #94): remember which grant path this
        // connection registered under so disconnect-time cleanup below can
        // decide what to publish/audit without a second live grant read.
        conn.subscriberPath = grant.path;
        scheduleForceClose(conn, sessionCreatedAt, () => {
          connectionRegistry.deregister("session", sessionId, conn);
        });
        // websocket-connection-reauthorization (SEC-25/26): design.md
        // Decisions D2, D3.
        scheduleReauthorizationSweep(conn, "session", sessionId, connectionRegistry, request.log);
        scheduleTokenRefreshMonitor(conn, "session", sessionId, connectionRegistry, request.log);
        await checkAndRecordGraceRecovery(session.userId, "session", sessionId, request.log);

        // vote-compose-recovery (issue #31): design.md Decision D3c's
        // "Ordering and failure containment" note. MUST run strictly after
        // the three calls above — never before or interleaved between them,
        // since those schedule/record the SEC-25/26 timers and grace-
        // recovery flag this connection depends on for the rest of its
        // lifetime, and this change's own new fallible DB read must never
        // be positioned where a failure in it could prevent them from
        // running.
        await sendSessionRegistrationSnapshot(session.userId, sessionId, conn, request.log);

        // FR-2.5 (GitHub issue #94): notify the facilitator this participant
        // joined the session lobby. Never fires for the facilitator's own
        // connection — see recordFacilitatorConnectionAudit below for that
        // (ops/audit trail only, not a client-facing event).
        if (grant.path === "participant") {
          publishParticipantJoined(sessionId, {
            sessionId,
            userId: session.userId,
            joinedAt: new Date().toISOString(),
          }).catch((err: unknown) => {
            request.log.warn({ err, sessionId }, "participant_joined: failed to publish, skipping");
          });
        } else {
          recordFacilitatorConnectionAudit(session.userId, sessionId, "connected", request.log);
        }

        // "close" and "error" can both fire for the same socket (e.g. an
        // abrupt teardown); guarded so participant_left/the facilitator
        // disconnect audit fire at most once per connection, matching
        // connectionRegistry.deregister's own idempotent Set.delete.
        let didCleanup = false;
        const cleanup = () => {
          if (didCleanup) return;
          didCleanup = true;
          connectionRegistry.deregister("session", sessionId, conn);
          if (conn.subscriberPath === "participant") {
            publishParticipantLeft(sessionId, {
              sessionId,
              userId: session.userId,
              leftAt: new Date().toISOString(),
            }).catch((err: unknown) => {
              request.log.warn({ err, sessionId }, "participant_left: failed to publish, skipping");
            });
          } else if (conn.subscriberPath === "facilitator") {
            recordFacilitatorConnectionAudit(session.userId, sessionId, "disconnected", request.log);
          }
        };
        socket.on("close", cleanup);
        socket.on("error", cleanup);
      })();
    },
  );

  app.get<{ Params: { teamId: string } }>(
    "/ws/teams/:teamId/events",
    { websocket: true },
    (socket, request) => {
      const session = request.session as unknown as SessionData;
      const { teamId } = request.params;

      void (async () => {
        // Subscription-time early rejection. Mirrors the delivery-time rule
        // for topic_history_update: an admin-path grant does not qualify.
        const grant = await evaluateTeamAccess(session.userId, teamId);
        if (grant === null || grant.path === "admin") {
          socket.close(CLOSE_UNAUTHORIZED);
          return;
        }

        const sessionCreatedAt = new Date(session.sessionCreatedAt).getTime();
        const conn: RegisteredConnection = {
          socket,
          userId: session.userId,
          sessionCreatedAt,
          fastifySessionId: request.session.sessionId,
        };

        connectionRegistry.register("team", teamId, conn);
        scheduleForceClose(conn, sessionCreatedAt, () => {
          connectionRegistry.deregister("team", teamId, conn);
        });
        // websocket-connection-reauthorization (SEC-25/26): design.md
        // Decisions D2, D3.
        scheduleReauthorizationSweep(conn, "team", teamId, connectionRegistry, request.log);
        scheduleTokenRefreshMonitor(conn, "team", teamId, connectionRegistry, request.log);
        await checkAndRecordGraceRecovery(session.userId, "team", teamId, request.log);

        const cleanup = () => connectionRegistry.deregister("team", teamId, conn);
        socket.on("close", cleanup);
        socket.on("error", cleanup);
      })();
    },
  );
}

// ---------------------------------------------------------------------------
// websocket-connection-reauthorization (SEC-26): design.md Decisions D4/D9,
// tasks.md task 4.4 (marker consumption) + task 5.1 (audit write) —
// implemented together at this single registration-time call site per
// those tasks' own coordination note: splitting marker consumption from
// its audit write across separately-landed changes risks a connection that
// silently consumes the recovery marker with no audit trail ever written.
// ---------------------------------------------------------------------------
async function checkAndRecordGraceRecovery(
  userId: string,
  scope: "session" | "team",
  id: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const wasGraceRecovery = await consumeGraceRecoveryMarker(userId);
  if (wasGraceRecovery) {
    await recordConnectionRecoveredAudit(userId, scope, id, log);
  }
}

// ---------------------------------------------------------------------------
// GitHub issue #94: ops/audit trail for the active facilitator's own
// session-scoped WebSocket connect/disconnect. NOT part of FR-2.5's
// client-facing participant_joined/participant_left events (those never
// fire for the facilitator's own connection) — this is "the system should
// know if the facilitator dropped," addressed as an audit_log row, never
// surfaced to any facilitator-visible read endpoint. Mirrors
// recordConnectionRecoveredAudit above exactly. Fire-and-forget from the
// caller; failures are logged here and never propagate to the connection
// lifecycle.
// ---------------------------------------------------------------------------
async function recordFacilitatorConnectionAudit(
  userId: string,
  sessionId: string,
  event: "connected" | "disconnected",
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const [actorGlobalRole, teamId] = await Promise.all([
      resolveActorGlobalRole(userId),
      resolveTeamIdForAudit("session", sessionId),
    ]);
    const operation = event === "connected" ? "session.facilitator_connected" : "session.facilitator_disconnected";

    await db.query(
      `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, NULL, $3, $4, $5)`,
      [userId, actorGlobalRole, operation, teamId, JSON.stringify({ scope: "session", scopeId: sessionId })],
    );

    emitAuditEvent(log, operation, {
      actorUserId: userId,
      actorGlobalRole,
      scope: "session",
      scopeId: sessionId,
      teamId,
    });
  } catch (err) {
    log.warn({ err, sessionId, event }, "facilitator connection audit: failed to write, skipping");
  }
}

// ---------------------------------------------------------------------------
// vote-compose-recovery (issue #31): design.md Decision D3c's "Ordering and
// failure containment" note, tasks.md task 7.4.
//
// This is a deliberate silent-discard-shaped failure mode, not an
// oversight: on any failure — a DB error, or buildSessionRegistrationSnapshot
// returning null for the zero-row race case — this logs at `warn` and sends
// no session_registration_snapshot message at all. It never throws past
// this point, never surfaces as an unhandled promise rejection, and never
// closes or otherwise degrades the connection. restoreDraft (the frontend
// consumer, packages/frontend/src/realtime/voteDraft.ts) already never
// applies a value before a registration payload arrives, so "no snapshot
// arrives this registration" degrades to "this tab's draft, if any, is not
// restored this load" — the same discard-by-default posture that module
// applies everywhere else.
//
// No audit_log row is written here (design.md Decision D3e): this is a
// passive read of state the participant already has standing to see, not
// an auditable action like vote submission, reveal, or topic advance.
// ---------------------------------------------------------------------------
async function sendSessionRegistrationSnapshot(
  userId: string,
  sessionId: string,
  conn: RegisteredConnection,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const payload = await buildSessionRegistrationSnapshot(userId, sessionId);
    if (payload === null) {
      log.warn({ sessionId }, "session_registration_snapshot: no matching session row, skipping send");
      return;
    }
    safeSend(
      connectionRegistry,
      "session",
      sessionId,
      conn,
      JSON.stringify({ eventType: "session_registration_snapshot", payload }),
    );
  } catch (err) {
    log.warn({ err, sessionId }, "session_registration_snapshot: failed to build/send, skipping");
  }
}

// ---------------------------------------------------------------------------
// Scheduled 90-minute force-close (design.md Decision D8's compensating
// control, task 3.6): a connection that never receives another event is
// still eventually closed, rather than left open indefinitely. This is
// separate from — and does not substitute for — the delivery-time rejection
// in ws-event-dispatcher.ts's isConnectionExpired check, which only runs
// when an event is actually pushed.
// ---------------------------------------------------------------------------
export function scheduleForceClose(
  conn: RegisteredConnection,
  sessionCreatedAt: number,
  onExpire: () => void,
): void {
  const remaining = ABSOLUTE_LIFETIME_MS - (Date.now() - sessionCreatedAt);
  const delay = Math.max(remaining, 0);

  conn.forceCloseTimer = setTimeout(() => {
    onExpire();
    if (conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.close(CLOSE_FORCE_EXPIRED);
    }
  }, delay);
}
