import { describe, it, expect } from "vitest";
import { Redis } from "ioredis";
import pg from "pg";

// ---------------------------------------------------------------------------
// Real Redis pub/sub-hop integration test
//
// tasks.md task 5.2 / design.md Decision D6 item 5:
//   "Write an integration test that exercises the actual Redis pub/sub hop
//   (not just an in-process call): subscribe a connection, revoke
//   team_memberships.removed_at mid-connection, publish an event on the
//   channel via Redis PUBLISH (not a direct in-process function call), and
//   assert nothing is delivered. This is the test that catches the
//   subscription-time-caching drift named in Decision D3 — an in-process-
//   only test would not exercise the actual dequeue/re-check path and would
//   not catch that regression."
//
// This test requires a REAL Postgres and REAL Redis (docker-compose up —
// see .env.example for the expected local ports: Postgres on 5433, Redis
// on 6380). It is NOT reachable from a sandboxed environment without those
// services running, so it self-skips with a clear console message rather
// than failing the suite or (worse) silently passing. Every unit-level
// dispatcher test in ws-event-dispatcher.test.ts already covers this same
// authorization logic in-process; THIS test's unique job is proving the
// actual dequeue-from-Redis path re-runs the check, which an in-process
// call can never prove.
//
// Env var fallbacks below match .env.example exactly. Anything importing
// config.ts (transitively: db.js, redis.js, and all realtime/auth modules)
// is dynamically imported inside beforeAll, AFTER these fallbacks are set —
// config.ts calls process.exit(1) at import time if required vars are
// missing, so those imports must not happen at module-top-level in an
// environment where a real .env was never sourced.
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
    `[ws-pubsub-integration.test.ts] SKIPPED — Redis (${REDIS_URL}: ${redisUp ? "up" : "unreachable"}) and/or ` +
      `Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}: ${dbUp ? "up" : "unreachable"}) not available. ` +
      "Run `docker compose up` (repo root) and re-run this file to exercise the real pub/sub hop.",
  );
}

describe.skipIf(!infraAvailable)("real Redis pub/sub hop — delivery-time revocation (task 5.2)", () => {
  // All dynamic imports and fixtures live inside the single test below
  // (rather than beforeAll/afterAll with pre-declared `let` variables) so
  // every binding's type is inferred directly from the dynamic import
  // expression — no `import("module").Type` type annotations needed
  // anywhere in this file (these modules must be imported dynamically,
  // AFTER the env-var fallbacks above are set, since importing them
  // transitively loads config.ts, which calls process.exit(1) at import
  // time if required vars are missing).
  it("delivers session_state_change to an active participant, then stops delivering after removed_at is set — via the REAL Redis PUBLISH/SUBSCRIBE path", async () => {
    const { db } = await import("../../db.js");
    const { publishSessionStateChange, createWsSubscriber } = await import("../ws-pubsub.js");
    const { attachWsEventDispatcher } = await import("../ws-event-dispatcher.js");
    const { ConnectionRegistry } = await import("../connection-registry.js");

    const teamId = crypto.randomUUID();
    const facilitatorUserId = crypto.randomUUID();
    const participantUserId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const noopLogger = {
      warn: () => undefined,
      error: () => undefined,
      info: () => undefined,
      debug: () => undefined,
    };
    let subscriber: Redis | undefined;

    try {
      // Fixtures: a facilitator user, a participant user, a team, an active
      // membership for the participant, and a live session.
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Test Facilitator', 'facilitator@example.com', 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`],
      );
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Test Participant', 'participant@example.com', 'engineer')`,
        [participantUserId, `sub-${participantUserId}`],
      );
      await db.query(
        `INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`,
        [teamId, `Integration Test Team ${teamId}`, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'participant')`,
        [teamId, participantUserId],
      );
      await db.query(
        `INSERT INTO sessions (id, team_id, facilitator_id, status, join_token)
         VALUES ($1, $2, $3, 'active', $4)`,
        [sessionId, teamId, facilitatorUserId, `jtok-${sessionId.slice(0, 8)}`],
      );
      await db.query(
        `INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2)`,
        [sessionId, participantUserId],
      );

      const registry = new ConnectionRegistry();
      const received: string[] = [];
      const fakeSocket = {
        readyState: 1,
        send: (data: string) => received.push(data),
      };
      registry.register("session", sessionId, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for a `ws` socket
        socket: fakeSocket as any,
        userId: participantUserId,
        sessionCreatedAt: Date.now(),
      });

      subscriber = createWsSubscriber(noopLogger as Parameters<typeof createWsSubscriber>[0]);
      attachWsEventDispatcher(
        subscriber,
        noopLogger as Parameters<typeof attachWsEventDispatcher>[1],
        registry,
      );

      // Give ioredis a moment to complete the SUBSCRIBE handshake before we PUBLISH.
      await new Promise((resolve) => setTimeout(resolve, 200));

      // First PUBLISH — real Redis round trip. Participant is still active.
      await publishSessionStateChange(sessionId, {
        sessionId,
        teamId,
        previousStatus: "lobby",
        newStatus: "active",
        changedAt: new Date().toISOString(),
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(received).toHaveLength(1);

      // Revoke mid-connection: set team_memberships.removed_at directly via
      // SQL (this is the "someone else removed them from the team"
      // scenario — no application route needs to exist for this to be a
      // valid revocation).
      await db.query(`UPDATE team_memberships SET removed_at = NOW() WHERE team_id = $1 AND user_id = $2`, [
        teamId,
        participantUserId,
      ]);

      // Second PUBLISH — real Redis round trip again. The dispatcher's
      // per-message handler MUST re-run evaluateSessionSubscriberAccess
      // against the database and find the connection no longer authorized.
      // If this implementation had regressed to subscription-time caching
      // (Decision D3's named drift risk), this second push would still be
      // delivered — this is exactly the case an in-process-only test
      // cannot catch, because it never actually dequeues from Redis.
      await publishSessionStateChange(sessionId, {
        sessionId,
        teamId,
        previousStatus: "active",
        newStatus: "wrap_up",
        changedAt: new Date().toISOString(),
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(received).toHaveLength(1); // still just the first — second was correctly denied
    } finally {
      await db.query(`DELETE FROM session_participants WHERE session_id = $1`, [sessionId]);
      await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      await db.query(`DELETE FROM team_memberships WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id IN ($1, $2)`, [facilitatorUserId, participantUserId]);
      await subscriber?.quit().catch(() => undefined);
    }
  }, 15000);
});
