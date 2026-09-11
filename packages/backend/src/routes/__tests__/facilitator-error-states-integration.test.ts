import { describe, it, expect, beforeAll } from "vitest";
import { Redis } from "ioredis";
import pg from "pg";
import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Real Postgres / real Redis coverage for the six facilitator live-session
// error states (facilitator-error-states-e2e, design.md D1/D2).
//
// `facilitator-error-states.test.ts` (routes/__tests__/) is the fast, fully
// mocked sibling of this file — 22 tests, `db.query` mocked via `vi.mock`,
// asserting response shapes against a fake DB. That file is unchanged by
// this change and stays exactly as fast as it was.
//
// THIS file proves the same response shapes for Error States 1 (both
// paths), 1a, 1b, and 4 against a REAL Postgres round-trip through the real
// route handlers — no `db.query` mock anywhere in this file. Error State 3
// is proven against its real production trigger (a real committed
// session-state transition, delivered to a real WebSocket subscriber over
// the actual Redis PUBLISH/SUBSCRIBE channel). Error State 2 has its own
// dedicated file (`facilitator-error-state-2-restricted-role.test.ts`,
// design.md D7) because its forced-query-failure mechanism requires
// overriding `DATABASE_URL` for one test, which must not be able to affect
// any other test file's Postgres connection.
//
// Do NOT add a `vi.mock` for `db.js`, `ws-pubsub.js`, `config.js`, or any
// realtime module anywhere in this file — the absence of these mocks is the
// entire point of this change. If a future edit "helpfully" reintroduces
// mocking to speed this suite up, it defeats the reason this file exists.
//
// This file requires a REAL Postgres and REAL Redis (docker compose up —
// see .env.example for the expected local ports: Postgres on 5433, Redis on
// 6380). It self-skips with a clear console message when those services are
// unreachable, rather than failing the suite or silently passing — same
// pattern as `ws-pubsub-integration.test.ts`
// (packages/backend/src/realtime/__tests__/).
//
// Env var fallbacks below match .env.example exactly. Anything importing
// config.ts (transitively: db.js, redis.js, and all realtime/auth modules)
// is dynamically imported below, AFTER these fallbacks are set — config.ts
// calls process.exit(1) at import time if required vars are missing.
//
// File placement (tasks.md 1.1/4.1): this file lives alongside
// facilitator-error-states.test.ts rather than ws-pubsub-integration.test.ts
// — Error States 1/1a/1b/4 (Groups 2 and 3 here) use the plain
// Fastify-`inject()` app-builder pattern facilitator-error-states.test.ts's
// neighbors already establish, and that pattern does more of this file's
// work than the WS-subscriber harness does (which Error State 3 alone
// needs, reused verbatim from ws-pubsub-integration.test.ts).
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] ??= "postgresql://dipstick:dipstick@localhost:5433/dipstick";
process.env["REDIS_URL"] ??= "redis://localhost:6380";
process.env["SESSION_SECRET"] ??= "integration-test-session-secret-32-chars-min";
process.env["OIDC_ISSUER"] ??= "http://localhost:4011";
process.env["OIDC_CLIENT_ID"] ??= "dipstick-local";
process.env["OIDC_CLIENT_SECRET"] ??= "dipstick-local-secret";
process.env["OIDC_REDIRECT_URI"] ??= "http://localhost:3000/auth/callback";
process.env["NODE_ENV"] ??= "test";

const REDIS_URL = process.env["REDIS_URL"]!;
const DATABASE_URL = process.env["DATABASE_URL"]!;
const PROBE_TIMEOUT_MS = 750;

async function isRedisReachable(): Promise<boolean> {
  const client = new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: PROBE_TIMEOUT_MS,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
  });
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

async function isPostgresReachable(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: PROBE_TIMEOUT_MS });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const [redisUp, dbUp] = await Promise.all([isRedisReachable(), isPostgresReachable()]);
const infraAvailable = redisUp && dbUp;

if (!infraAvailable) {
  console.warn(
    `[facilitator-error-states-integration.test.ts] SKIPPED — Redis (${REDIS_URL}: ${redisUp ? "up" : "unreachable"}) and/or ` +
      `Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}: ${dbUp ? "up" : "unreachable"}) not available. ` +
      "Run `docker compose up` (repo root) and re-run this file to exercise these error states against real infra.",
  );
}

// ---------------------------------------------------------------------------
// Dynamic module loader. Unlike ws-pubsub-integration.test.ts's single test
// (which inlines every dynamic import so no binding needs an explicit type
// annotation), this file has a dozen-plus tests sharing the same real
// route/db/realtime modules — repeating five-plus dynamic imports in every
// `it()` would be pure duplication for no correctness benefit. `mods`'s type
// is still inferred entirely from this one function's return value (no
// hand-written `import("module").Type` annotation anywhere), and the import
// still happens at runtime, after the env-var fallbacks above are set, and
// still with no top-level static import of anything config.js-dependent —
// the properties that actually matter are preserved.
// ---------------------------------------------------------------------------
async function loadModules() {
  const { db } = await import("../../db.js");
  const { contentRoutes } = await import("../content.js");
  const { facilitatorSessionRoutes } = await import("../facilitator-sessions.js");
  const { createWsSubscriber } = await import("../../realtime/ws-pubsub.js");
  const { attachWsEventDispatcher } = await import("../../realtime/ws-event-dispatcher.js");
  const { ConnectionRegistry } = await import("../../realtime/connection-registry.js");
  return { db, contentRoutes, facilitatorSessionRoutes, createWsSubscriber, attachWsEventDispatcher, ConnectionRegistry };
}

describe.skipIf(!infraAvailable)("facilitator error states — real Postgres/Redis (facilitator-error-states-e2e)", () => {
  let mods: Awaited<ReturnType<typeof loadModules>>;

  beforeAll(async () => {
    mods = await loadModules();
  });

  // -------------------------------------------------------------------------
  // App builders — mirror facilitator-error-states.test.ts's buildContentApp
  // / buildFacilitatorApp exactly, but registering the REAL route modules
  // (mods.contentRoutes / mods.facilitatorSessionRoutes) loaded above,
  // instead of modules running against a mocked db.js.
  //
  // Per design.md's Non-Goals: the harness establishes request.session =
  // {userId} directly, not a real OIDC/cookie round trip. Building via
  // app.ts's buildApp() would wire @fastify/session + authMiddleware, which
  // requires exactly the real-auth flow this change explicitly scopes out —
  // so these tests build a minimal Fastify() app registering only the route
  // module under test, same as the mocked suite already does.
  // -------------------------------------------------------------------------
  function buildFacilitatorApp(userId: string) {
    const app = Fastify();
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    app.register(mods.facilitatorSessionRoutes);
    return app.ready().then(() => app);
  }

  function buildContentApp(userId: string) {
    const app = Fastify();
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    app.register(mods.contentRoutes);
    return app.ready().then(() => app);
  }

  // -------------------------------------------------------------------------
  // Fixture helpers (raw SQL against the real schema, design.md D4) — insert
  // helpers for the individual rows each test composes differently, plus a
  // cleanup helper. `sessions.id` -> `session_topics` and `session_participants`
  // are FK ON DELETE CASCADE, so deleting the `sessions` row is sufficient to
  // remove its session_topics/session_participants/votes rows; `topics` is
  // NOT cascade-deleted by a `sessions` delete (sessions.current_topic_id
  // references topics with no cascade action), so topics rows are deleted
  // explicitly, after sessions.
  // -------------------------------------------------------------------------
  async function insertUser(
    db: typeof mods.db,
    id: string,
    globalRole: "facilitator" | "engineer" = "facilitator",
  ): Promise<void> {
    await db.query(
      `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
       VALUES ($1, $2, 'test-issuer', 'Integration Test User', $3, $4)`,
      [id, `sub-${id}`, `${id}@example.com`, globalRole],
    );
  }

  async function insertTeam(db: typeof mods.db, id: string, creatorUserId: string, name?: string): Promise<void> {
    await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
      id,
      name ?? `Integration Test Team ${id}`,
      creatorUserId,
    ]);
  }

  async function insertTopic(db: typeof mods.db, id: string, teamId: string, displayOrder = 1): Promise<void> {
    await db.query(
      `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status)
       VALUES ($1, $2, 'Integration Test Topic', 'Integration test prompt?', 'finger', $3, 'active')`,
      [id, teamId, displayOrder],
    );
  }

  async function insertSession(
    db: typeof mods.db,
    id: string,
    teamId: string,
    facilitatorId: string,
    status: string,
    currentTopicId: string | null = null,
  ): Promise<void> {
    await db.query(
      `INSERT INTO sessions (id, team_id, facilitator_id, status, join_token, current_topic_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, teamId, facilitatorId, status, `jtok-${id.slice(0, 8)}`, currentTopicId],
    );
  }

  async function insertSessionTopic(
    db: typeof mods.db,
    sessionId: string,
    topicId: string,
    status: string,
    displayOrder = 1,
  ): Promise<void> {
    // In production, revealed_at is always set in the SAME UPDATE that sets
    // status = 'revealed' (facilitator-sessions.ts's reveal handler:
    // `SET status = 'revealed', revealed_at = NOW()`), so status='revealed'
    // with a NULL revealed_at is a state real code never produces. Fixtures
    // that put a session_topics row directly into 'revealed' (rather than
    // reaching it via the real endpoint) must set revealed_at too, or they
    // engineer a data shape the route handler doesn't defend against because
    // it can't occur for real.
    const revealedAt = status === "revealed" ? new Date() : null;
    await db.query(
      `INSERT INTO session_topics (session_id, topic_id, display_order, topic_name, topic_prompt, vote_type, status, revealed_at)
       VALUES ($1, $2, $3, 'Integration Test Topic', 'Integration test prompt?', 'finger', $4, $5)`,
      [sessionId, topicId, displayOrder, status, revealedAt],
    );
  }

  async function insertMembership(
    db: typeof mods.db,
    teamId: string,
    userId: string,
    role: "participant" | "engineering_manager" = "participant",
  ): Promise<void> {
    await db.query(`INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, $3)`, [
      teamId,
      userId,
      role,
    ]);
  }

  async function cleanup(
    db: typeof mods.db,
    fx: { teamIds: string[]; sessionIds: string[]; topicIds: string[]; userIds: string[] },
  ): Promise<void> {
    // audit_log rows are NOT FK-cascaded (migration 8_audit_log.sql — actor_user_id
    // and team_id are deliberately not foreign keys), so every team that could
    // have had a reveal/advance/complete call against it during this test is
    // cleaned up explicitly here, regardless of whether that particular test
    // actually reached a write.
    for (const teamId of fx.teamIds) {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
    }
    for (const sessionId of fx.sessionIds) {
      // Cascades session_topics, session_participants, votes.
      await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    }
    for (const topicId of fx.topicIds) {
      await db.query(`DELETE FROM topics WHERE id = $1`, [topicId]);
    }
    for (const teamId of fx.teamIds) {
      await db.query(`DELETE FROM team_memberships WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    }
    if (fx.userIds.length > 0) {
      await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [fx.userIds]);
    }
  }

  // ===========================================================================
  // Group 2 (tasks.md 2.2-2.6) — Error State 1 / 1a / 1b: reveal and
  // topics/advance, real Postgres.
  // ===========================================================================
  describe("Error State 1 / 1a / 1b — reveal and topics/advance, real Postgres", () => {
    it("2.2: POST .../reveal — auth failure while session is active returns real 503 recoverable", async () => {
      const db = mods.db;
      const teamId = crypto.randomUUID();
      const sessionFacilitatorId = crypto.randomUUID();
      const requestingUserId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const topicId = crypto.randomUUID();

      try {
        await insertUser(db, sessionFacilitatorId);
        await insertUser(db, requestingUserId);
        await insertTeam(db, teamId, sessionFacilitatorId);
        await insertTopic(db, topicId, teamId);
        // The session's real facilitator is sessionFacilitatorId, NOT the
        // requesting user — this is the authorization failure.
        await insertSession(db, sessionId, teamId, sessionFacilitatorId, "active", topicId);
        await insertSessionTopic(db, sessionId, topicId, "voting");

        const app = await buildFacilitatorApp(requestingUserId);
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/teams/${teamId}/sessions/${sessionId}/reveal`,
        });

        expect(res.statusCode).toBe(503);
        const body = res.json() as { errorState: string; recoverable: boolean; message: string };
        expect(body.errorState).toBe("reveal_failure");
        expect(body.recoverable).toBe(true);
        expect(body.message).toBe("The reveal could not be completed. Your session is still active. Try again.");
      } finally {
        await cleanup(db, {
          teamIds: [teamId],
          sessionIds: [sessionId],
          topicIds: [topicId],
          userIds: [sessionFacilitatorId, requestingUserId],
        });
      }
    }, 15000);

    it("2.3: POST .../reveal — session status not in the active set returns real 409 non-recoverable", async () => {
      const db = mods.db;
      const teamId = crypto.randomUUID();
      const facilitatorId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const topicId = crypto.randomUUID();

      try {
        await insertUser(db, facilitatorId);
        await insertTeam(db, teamId, facilitatorId);
        await insertTopic(db, topicId, teamId);
        // The requesting user IS the facilitator, but the session has already
        // completed — reveal is no longer meaningful.
        await insertSession(db, sessionId, teamId, facilitatorId, "complete", topicId);
        await insertSessionTopic(db, sessionId, topicId, "revealed");

        const app = await buildFacilitatorApp(facilitatorId);
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/teams/${teamId}/sessions/${sessionId}/reveal`,
        });

        expect(res.statusCode).toBe(409);
        const body = res.json() as { errorState: string; recoverable: boolean; message: string };
        expect(body.errorState).toBe("reveal_failure");
        expect(body.recoverable).toBe(false);
        expect(body.message).toBe(
          "This session is no longer in an active state. Please review the session status.",
        );
      } finally {
        await cleanup(db, { teamIds: [teamId], sessionIds: [sessionId], topicIds: [topicId], userIds: [facilitatorId] });
      }
    }, 15000);

    it("2.4: POST .../reveal — already-revealed topic returns the real already_revealed shape, not a failure shape", async () => {
      const db = mods.db;
      const teamId = crypto.randomUUID();
      const facilitatorId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const topicId = crypto.randomUUID();

      try {
        await insertUser(db, facilitatorId);
        await insertTeam(db, teamId, facilitatorId);
        await insertTopic(db, topicId, teamId);
        await insertSession(db, sessionId, teamId, facilitatorId, "active", topicId);
        // Already revealed — the conditional UPDATE the reveal handler runs
        // (WHERE status = 'voting') will affect zero real rows.
        await insertSessionTopic(db, sessionId, topicId, "revealed");

        const app = await buildFacilitatorApp(facilitatorId);
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/teams/${teamId}/sessions/${sessionId}/reveal`,
        });

        expect(res.statusCode).toBe(409);
        const body = res.json() as {
          errorState: string;
          sessionId: string;
          teamId: string;
          sessionTopicId: string;
          revealedAt: string;
        };
        expect(body.errorState).toBe("already_revealed");
        expect(typeof body.revealedAt).toBe("string");
        expect(Number.isNaN(Date.parse(body.revealedAt))).toBe(false);
        expect(body.sessionTopicId.length).toBeGreaterThan(0);
        // No fields resembling a failure/error indicator.
        expect(body).not.toHaveProperty("recoverable");
        expect(body).not.toHaveProperty("message");
      } finally {
        await cleanup(db, { teamIds: [teamId], sessionIds: [sessionId], topicIds: [topicId], userIds: [facilitatorId] });
      }
    }, 15000);

    it("2.5: POST .../topics/advance — current topic still voting returns the real advance_blocked shape", async () => {
      const db = mods.db;
      const teamId = crypto.randomUUID();
      const facilitatorId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const topicId = crypto.randomUUID();

      try {
        await insertUser(db, facilitatorId);
        await insertTeam(db, teamId, facilitatorId);
        await insertTopic(db, topicId, teamId);
        await insertSession(db, sessionId, teamId, facilitatorId, "active", topicId);
        // Current topic is still voting, not revealed — advance must be blocked.
        await insertSessionTopic(db, sessionId, topicId, "voting");

        const app = await buildFacilitatorApp(facilitatorId);
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/teams/${teamId}/sessions/${sessionId}/topics/advance`,
        });

        expect(res.statusCode).toBe(409);
        const body = res.json() as { errorState: string; requiresReveal: boolean };
        expect(body.errorState).toBe("advance_blocked");
        expect(body.requiresReveal).toBe(true);
      } finally {
        await cleanup(db, { teamIds: [teamId], sessionIds: [sessionId], topicIds: [topicId], userIds: [facilitatorId] });
      }
    }, 15000);

    it("2.6: ordering rule — a request that both fails authorization AND would hit already_revealed returns the auth failure", async () => {
      const db = mods.db;
      const teamId = crypto.randomUUID();
      const sessionFacilitatorId = crypto.randomUUID();
      const requestingUserId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const topicId = crypto.randomUUID();

      try {
        await insertUser(db, sessionFacilitatorId);
        await insertUser(db, requestingUserId);
        await insertTeam(db, teamId, sessionFacilitatorId);
        await insertTopic(db, topicId, teamId);
        // Auth fails (requesting user is not the session's facilitator) AND
        // the already-revealed precondition would independently fire, if
        // reached. Per team-content-access/spec.md's ordering rule,
        // authorization runs before either precondition check.
        await insertSession(db, sessionId, teamId, sessionFacilitatorId, "active", topicId);
        await insertSessionTopic(db, sessionId, topicId, "revealed");

        const app = await buildFacilitatorApp(requestingUserId);
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/teams/${teamId}/sessions/${sessionId}/reveal`,
        });

        // The authorization failure (503 recoverable, since the session is
        // still active), NOT the already_revealed precondition response.
        expect(res.statusCode).toBe(503);
        const body = res.json() as { errorState: string; recoverable: boolean };
        expect(body.errorState).toBe("reveal_failure");
        expect(body.recoverable).toBe(true);
      } finally {
        await cleanup(db, {
          teamIds: [teamId],
          sessionIds: [sessionId],
          topicIds: [topicId],
          userIds: [sessionFacilitatorId, requestingUserId],
        });
      }
    }, 15000);
  });

  // ===========================================================================
  // Group 3 (tasks.md 3.2-3.3) — Error State 4: cross-team denial, real Postgres.
  // (Error State 2 / task 3.1 lives in its own dedicated file — design.md D7.)
  // ===========================================================================
  describe("Error State 4 — cross-team denial, real Postgres", () => {
    it("3.2/3.3: facilitator in Team B's active session denied Team A with the session-context message, no Team A identifiers in the raw body", async () => {
      const db = mods.db;
      const facilitatorId = crypto.randomUUID();
      const teamAId = crypto.randomUUID();
      const teamBId = crypto.randomUUID();
      const sessionBId = crypto.randomUUID();
      const topicBId = crypto.randomUUID();
      const teamAName = `Integration Test Team A ${teamAId}`;

      try {
        await insertUser(db, facilitatorId);
        await insertTeam(db, teamAId, facilitatorId, teamAName);
        await insertTeam(db, teamBId, facilitatorId, `Integration Test Team B ${teamBId}`);
        await insertTopic(db, topicBId, teamBId);
        // Facilitator has a real active session for Team B only.
        await insertSession(db, sessionBId, teamBId, facilitatorId, "active", topicBId);
        await insertSessionTopic(db, sessionBId, topicBId, "voting");

        const app = await buildContentApp(facilitatorId);
        const res = await app.inject({
          method: "GET",
          url: `/api/v1/teams/${teamAId}/sessions`,
        });

        expect(res.statusCode).toBe(403);
        const body = res.json() as { error: { message: string } };
        expect(body.error.message).toBe("This data is not available in your current session");
        expect(body.error.message).not.toContain("You do not have access");

        // Task 3.3: raw-response-body non-disclosure check, matching
        // facilitator-error-states.test.ts:707-734's rigor exactly — checked
        // against res.body (the raw string), not only the parsed JSON.
        const rawBody = res.body;
        expect(rawBody).not.toContain(teamAId);
        expect(rawBody).not.toContain(teamAName);
        expect(body.error.message).not.toContain(teamAId);
        expect(body.error.message).not.toContain(teamAName);
        expect(body.error.message).not.toContain("session history");
      } finally {
        await cleanup(db, {
          teamIds: [teamAId, teamBId],
          sessionIds: [sessionBId],
          topicIds: [topicBId],
          userIds: [facilitatorId],
        });
      }
    }, 15000);
  });

  // ===========================================================================
  // Group 4 (tasks.md 4.2-4.7) — Error State 3: real trigger, full
  // HTTP-through-WebSocket stack, and the real facilitator-state banner
  // endpoint.
  //
  // Task 4.6: Error State 3's "system timeout" trigger variant is explicitly
  // out of scope for both tests below. No timeout-driven auto-transition
  // mechanism exists anywhere in this codebase — there is nothing to
  // trigger. This is a separate, unbuilt mechanism, NOT a consequence of
  // GitHub issue #26 or anything this change resolves: issue #26 is fully
  // resolved (all four production-trigger events fire from real, committed
  // code paths), and the timeout variant was simply never built, on any
  // timeline. A future reader should not go looking at issue #26 for
  // something that isn't there.
  // ===========================================================================
  describe("Error State 3 — real trigger, full HTTP-through-WebSocket stack, and the real banner endpoint", () => {
    const noopLogger = {
      warn: () => undefined,
      error: () => undefined,
      info: () => undefined,
      debug: () => undefined,
    };

    it("4.4: POST .../topics/advance (wrap-up entry) delivers session_state_change to a real FACILITATOR subscriber over real Redis", async () => {
      const db = mods.db;
      const teamId = crypto.randomUUID();
      const facilitatorId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const topicId = crypto.randomUUID();
      let subscriber: Redis | undefined;

      try {
        await insertUser(db, facilitatorId);
        await insertTeam(db, teamId, facilitatorId);
        await insertTopic(db, topicId, teamId);
        await insertSession(db, sessionId, teamId, facilitatorId, "active", topicId);
        // Current (only) topic already revealed, no next topic in
        // display_order — advance takes the wrap-up-entry branch.
        await insertSessionTopic(db, sessionId, topicId, "revealed");

        // wrap_up is in evaluateSessionSubscriberAccess's facilitator-path
        // active set, so a facilitator subscriber receives delivery here
        // (design.md D3).
        const registry = new mods.ConnectionRegistry();
        const received: string[] = [];
        const fakeSocket = { readyState: 1, send: (data: string) => received.push(data) };
        registry.register("session", sessionId, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for a `ws` socket
          socket: fakeSocket as any,
          userId: facilitatorId,
          sessionCreatedAt: Date.now(),
          fastifySessionId: "fastify-sess-facilitator",
        });

        subscriber = mods.createWsSubscriber(noopLogger as Parameters<typeof mods.createWsSubscriber>[0]);
        mods.attachWsEventDispatcher(
          subscriber,
          noopLogger as Parameters<typeof mods.attachWsEventDispatcher>[1],
          registry,
        );

        await new Promise((resolve) => setTimeout(resolve, 200));

        const app = await buildFacilitatorApp(facilitatorId);
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/teams/${teamId}/sessions/${sessionId}/topics/advance`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { status: string };
        expect(body.status).toBe("wrap_up");

        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(received).toHaveLength(1);
        // Wire frame shape (ws-event-dispatcher.ts's dispatchSessionStateChange):
        // { eventType, payload } — no top-level sessionId; that field only
        // exists on the internal Redis envelope, not the client-facing message.
        const envelope = JSON.parse(received[0]!) as {
          eventType: string;
          payload: { sessionId: string; previousStatus: string; newStatus: string };
        };
        expect(envelope.eventType).toBe("session_state_change");
        expect(envelope.payload.sessionId).toBe(sessionId);
        expect(envelope.payload.newStatus).toBe("wrap_up");
      } finally {
        await cleanup(db, { teamIds: [teamId], sessionIds: [sessionId], topicIds: [topicId], userIds: [facilitatorId] });
        await subscriber?.quit().catch(() => undefined);
      }
    }, 15000);

    it("4.5: POST .../complete delivers session_state_change to a real PARTICIPANT subscriber over real Redis (facilitator excluded by design)", async () => {
      const db = mods.db;
      const teamId = crypto.randomUUID();
      const facilitatorId = crypto.randomUUID();
      const participantId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const topicId = crypto.randomUUID();
      let subscriber: Redis | undefined;

      try {
        await insertUser(db, facilitatorId);
        await insertUser(db, participantId, "engineer");
        await insertTeam(db, teamId, facilitatorId);
        await insertTopic(db, topicId, teamId);
        await insertMembership(db, teamId, participantId, "participant");
        // complete requires status to be 'wrap_up' (validCompletableStatuses).
        await insertSession(db, sessionId, teamId, facilitatorId, "wrap_up", null);
        await db.query(`INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2)`, [
          sessionId,
          participantId,
        ]);

        // Important — NOT a repeat of 4.4's subscriber setup.
        // evaluateSessionSubscriberAccess's facilitator path only grants when
        // sessions.status IN ('lobby','pre_session','active','wrap_up') —
        // 'complete' is deliberately excluded (design.md D3's authorization
        // asymmetry). A facilitator subscriber would NOT receive delivery for
        // this trigger; that is delivery-time authorization working as
        // designed, not a bug. This test registers a PARTICIPANT subscriber
        // instead, which has no facilitator-path gate.
        const registry = new mods.ConnectionRegistry();
        const received: string[] = [];
        const fakeSocket = { readyState: 1, send: (data: string) => received.push(data) };
        registry.register("session", sessionId, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for a `ws` socket
          socket: fakeSocket as any,
          userId: participantId,
          sessionCreatedAt: Date.now(),
          fastifySessionId: "fastify-sess-participant",
        });

        subscriber = mods.createWsSubscriber(noopLogger as Parameters<typeof mods.createWsSubscriber>[0]);
        mods.attachWsEventDispatcher(
          subscriber,
          noopLogger as Parameters<typeof mods.attachWsEventDispatcher>[1],
          registry,
        );

        await new Promise((resolve) => setTimeout(resolve, 200));

        const app = await buildFacilitatorApp(facilitatorId);
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/teams/${teamId}/sessions/${sessionId}/complete`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { status: string };
        expect(body.status).toBe("complete");

        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(received).toHaveLength(1);
        const envelope = JSON.parse(received[0]!) as {
          eventType: string;
          payload: { sessionId: string; previousStatus: string; newStatus: string };
        };
        expect(envelope.eventType).toBe("session_state_change");
        expect(envelope.payload.sessionId).toBe(sessionId);
        expect(envelope.payload.newStatus).toBe("complete");
      } finally {
        await cleanup(db, {
          teamIds: [teamId],
          sessionIds: [sessionId],
          topicIds: [topicId],
          userIds: [facilitatorId, participantId],
        });
        await subscriber?.quit().catch(() => undefined);
      }
    }, 15000);

    it("4.7: GET .../facilitator-state returns the real banner for wrap_up/complete/abandoned and null for normal states", async () => {
      const db = mods.db;
      const teamId = crypto.randomUUID();
      const facilitatorId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const topicId = crypto.randomUUID();

      try {
        await insertUser(db, facilitatorId);
        await insertTeam(db, teamId, facilitatorId);
        await insertTopic(db, topicId, teamId);
        await insertSession(db, sessionId, teamId, facilitatorId, "active", topicId);

        const app = await buildFacilitatorApp(facilitatorId);

        // "Normal" states: bannerState is null.
        for (const status of ["lobby", "pre_session", "active"]) {
          await db.query(`UPDATE sessions SET status = $1 WHERE id = $2`, [status, sessionId]);
          const res = await app.inject({
            method: "GET",
            url: `/api/v1/teams/${teamId}/sessions/${sessionId}/facilitator-state`,
          });
          expect(res.statusCode).toBe(200);
          const body = res.json() as { currentSessionState: string; bannerState: unknown };
          expect(body.currentSessionState).toBe(status);
          expect(body.bannerState).toBeNull();
        }

        // "Transition" states: bannerState carries the exact spec shape/text.
        // 'abandoned' requires abandoned_at to satisfy
        // sessions_abandoned_has_timestamp's CHECK constraint.
        for (const status of ["wrap_up", "complete", "abandoned"]) {
          if (status === "abandoned") {
            await db.query(`UPDATE sessions SET status = $1, abandoned_at = NOW() WHERE id = $2`, [
              status,
              sessionId,
            ]);
          } else {
            await db.query(`UPDATE sessions SET status = $1 WHERE id = $2`, [status, sessionId]);
          }

          const res = await app.inject({
            method: "GET",
            url: `/api/v1/teams/${teamId}/sessions/${sessionId}/facilitator-state`,
          });
          expect(res.statusCode).toBe(200);
          const body = res.json() as {
            currentSessionState: string;
            bannerState: {
              type: string;
              displayType: string;
              currentSessionState: string;
              message: string;
              action: string;
            } | null;
          };
          expect(body.currentSessionState).toBe(status);
          expect(body.bannerState).not.toBeNull();
          const banner = body.bannerState!;
          expect(banner.type).toBe("session_status_changed");
          expect(banner.displayType).toBe("banner");
          expect(banner.currentSessionState).toBe(status);
          expect(banner.message).toBe(`Session state has changed. ${status}. Resume or review.`);
          expect(banner.action).toBe("Resume or review");
        }
      } finally {
        await cleanup(db, { teamIds: [teamId], sessionIds: [sessionId], topicIds: [topicId], userIds: [facilitatorId] });
      }
    }, 15000);
  });
});
