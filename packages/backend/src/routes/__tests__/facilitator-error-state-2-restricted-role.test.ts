import { describe, it, expect } from "vitest";
import { Redis } from "ioredis";
import pg from "pg";
import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Error State 2 — real forced query failure via a dedicated, permission-
// restricted Postgres role (facilitator-error-states-e2e, design.md D7).
//
// This test is deliberately isolated in its own file, separate from
// facilitator-error-states-integration.test.ts and every other test in this
// change. It overrides process.env["DATABASE_URL"] for its one test, and
// db.js reads DATABASE_URL from config.js once at module import time — so
// this override must not be able to affect any other test file's Postgres
// connection. Vitest's default per-file module isolation is what makes this
// safe (a fresh module registry per test file), but this file also
// explicitly captures and restores the original DATABASE_URL value in a
// finally block as a second, independent safeguard, rather than relying
// solely on assumed test-runner process isolation.
//
// Why a dedicated role, not a REVOKE against the app's own `dipstick`
// connection role (design.md D7): the app connects as `dipstick`
// (.env.example / docker-compose.yml / .github/workflows/integration.yml
// all set POSTGRES_USER: dipstick), and the official postgres Docker image
// grants that user full superuser privileges by default. Postgres
// superusers bypass every privilege check unconditionally — a REVOKE
// against `dipstick` would silently no-op, and this test would falsely pass
// against a broken assertion. Instead, a dedicated role
// (dipstick_restricted_probe) is created by this test, granted SELECT on
// exactly users/team_memberships/sessions (what evaluateTeamAccess's
// facilitator path reads) and deliberately NOT session_topics (or anything
// else buildSessionHistoryQuery's facilitator branch joins) — so
// authorization succeeds for real, and the session-history query then fails
// for real with a genuine Postgres permission error, landing in content.ts's
// existing catch block exactly as Error State 2 requires. No route handler
// change, no mocking.
//
// Do NOT add a `vi.mock` for `db.js` or `config.js` in this file — the
// entire point of this test is a real permission failure against a real
// Postgres connection.
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
// Captured BEFORE any override below — this is always the ordinary
// `dipstick` superuser connection string, used for the reachability probe
// and for every fixture read/write in this file (the restricted role has no
// write privileges at all; it exists solely to make the one query under
// test fail).
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

// Probed against the normal `dipstick` connection, before any override happens.
const [redisUp, dbUp] = await Promise.all([isRedisReachable(), isPostgresReachable()]);
const infraAvailable = redisUp && dbUp;

if (!infraAvailable) {
  console.warn(
    `[facilitator-error-state-2-restricted-role.test.ts] SKIPPED — Redis (${REDIS_URL}: ${redisUp ? "up" : "unreachable"}) and/or ` +
      `Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}: ${dbUp ? "up" : "unreachable"}) not available. ` +
      "Run `docker compose up` (repo root) and re-run this file to exercise the real forced-permission-failure path.",
  );
}

const RESTRICTED_ROLE = "dipstick_restricted_probe";
const RESTRICTED_ROLE_PASSWORD = "integration-test-restricted-probe-pw";

function restrictedRoleConnectionString(): string {
  const url = new URL(DATABASE_URL);
  url.username = RESTRICTED_ROLE;
  url.password = RESTRICTED_ROLE_PASSWORD;
  return url.toString();
}

/**
 * DROP ROLE alone fails with "cannot be dropped because some objects depend
 * on it" once the role has been GRANTed any privilege — Postgres records
 * those as ACL dependencies (pg_shdepend) and does not implicitly revoke
 * them on DROP ROLE. DROP OWNED BY clears both privileges granted TO the
 * role and anything it owns (this role owns nothing, but the GRANT SELECT
 * statements below still create the dependency). Guarded by a pg_roles
 * existence check first, since DROP OWNED BY itself errors if the role does
 * not exist — unlike DROP ROLE IF EXISTS, there is no DROP OWNED BY IF EXISTS.
 */
async function dropRestrictedRoleIfExists(pool: pg.Pool): Promise<void> {
  const existing = await pool.query<{ rolname: string }>(`SELECT rolname FROM pg_roles WHERE rolname = $1`, [
    RESTRICTED_ROLE,
  ]);
  if (existing.rows.length === 0) return;
  await pool.query(`DROP OWNED BY ${RESTRICTED_ROLE}`);
  await pool.query(`DROP ROLE ${RESTRICTED_ROLE}`);
}

describe.skipIf(!infraAvailable)(
  "Error State 2 — restricted-role forced query failure, real Postgres (facilitator-error-states-e2e, design.md D7)",
  () => {
    it("GET .../sessions — session-history query fails for real under a permission-restricted role, landing in content.ts's Error State 2 branch", async () => {
      const originalDatabaseUrl = process.env["DATABASE_URL"];

      // Fixture connection: always the ordinary `dipstick` superuser pool,
      // via a direct pg.Pool — NOT the app's db.js singleton, whose
      // connection string this test is about to override for the one call
      // under test.
      const fixturePool = new pg.Pool({ connectionString: DATABASE_URL });

      const teamId = crypto.randomUUID();
      const facilitatorId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const topicId = crypto.randomUUID();

      try {
        // Step 1 (design.md D7 / tasks.md 3.1.1): defensive DROP (self-heals
        // a prior crashed run), then CREATE, the dedicated restricted role,
        // scoped to exactly users/team_memberships/sessions.
        await dropRestrictedRoleIfExists(fixturePool);
        await fixturePool.query(
          `CREATE ROLE ${RESTRICTED_ROLE} LOGIN PASSWORD '${RESTRICTED_ROLE_PASSWORD}' NOSUPERUSER`,
        );
        await fixturePool.query(`GRANT CONNECT ON DATABASE dipstick TO ${RESTRICTED_ROLE}`);
        await fixturePool.query(`GRANT USAGE ON SCHEMA public TO ${RESTRICTED_ROLE}`);
        await fixturePool.query(`GRANT SELECT ON users, team_memberships, sessions TO ${RESTRICTED_ROLE}`);
        // Deliberately no GRANT on session_topics (or votes, or any other
        // table buildSessionHistoryQuery's facilitator branch joins).

        // Step 2: fixture rows, via the ordinary dipstick connection.
        // Authorization must succeed for real (grant.path === "facilitator",
        // isFacilitatorInActiveSession(grant) true) — this is NOT an
        // authorization-denial test; a non-matching membership/session row
        // would instead produce Error State 4 via denyNullGrant, a different
        // mechanism entirely (design.md D7's note; content.ts's try/catch
        // only reaches the Error State 2 branch after authorization already
        // succeeded).
        await fixturePool.query(
          `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
           VALUES ($1, $2, 'test-issuer', 'Integration Test Facilitator', $3, 'facilitator')`,
          [facilitatorId, `sub-${facilitatorId}`, `${facilitatorId}@example.com`],
        );
        await fixturePool.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
          teamId,
          `Integration Test Team ${teamId}`,
          facilitatorId,
        ]);
        await fixturePool.query(
          `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status)
           VALUES ($1, $2, 'Integration Test Topic', 'Integration test prompt?', 'finger', 1, 'active')`,
          [topicId, teamId],
        );
        await fixturePool.query(
          `INSERT INTO sessions (id, team_id, facilitator_id, status, join_token, current_topic_id)
           VALUES ($1, $2, $3, 'active', $4, $5)`,
          [sessionId, teamId, facilitatorId, `jtok-${sessionId.slice(0, 8)}`, topicId],
        );
        await fixturePool.query(
          `INSERT INTO session_topics (session_id, topic_id, display_order, topic_name, topic_prompt, vote_type, status)
           VALUES ($1, $2, 1, 'Integration Test Topic', 'Integration test prompt?', 'finger', 'voting')`,
          [sessionId, topicId],
        );

        // Step 3: override DATABASE_URL, then dynamically import content.js
        // (transitively db.js/config.js) fresh, so the app-under-test's db
        // singleton connects as the restricted role. Fastify() + contentRoutes
        // are built directly (not via app.ts's buildApp()) — matching this
        // whole change's Non-Goal that authentication is established
        // directly via request.session, not a real OIDC/cookie flow
        // (design.md Non-Goals); buildApp() wires @fastify/session +
        // authMiddleware, which is out of scope here and would require a
        // real authenticated session this change deliberately does not
        // exercise.
        process.env["DATABASE_URL"] = restrictedRoleConnectionString();

        const { contentRoutes } = await import("../content.js");

        const app = Fastify();
        app.decorateRequest("session", null);
        app.addHook("onRequest", async (request) => {
          (request as unknown as Record<string, unknown>).session = { userId: facilitatorId };
        });
        app.register(contentRoutes);
        await app.ready();

        // Step 4: the real HTTP call. evaluateTeamAccess (reads
        // users/team_memberships/sessions) succeeds for real;
        // buildSessionHistoryQuery's facilitator branch (joins session_topics)
        // fails for real with Postgres's own permission error, landing in
        // content.ts's existing catch block.
        const res = await app.inject({
          method: "GET",
          url: `/api/v1/teams/${teamId}/sessions`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.statusCode).not.toBe(403);
        const body = res.json() as {
          errorState: string;
          message: string;
          sessions: unknown[];
          sessionActive: boolean;
        };
        expect(body.errorState).toBe("historical_data_unavailable");
        expect(body.message).toBe("Historical data is temporarily unavailable. Your session is still active.");
        expect(body.sessions).toEqual([]);
        expect(body.sessionActive).toBe(true);
      } finally {
        // Step 5 (design.md D7 / tasks.md 3.1.5): restore DATABASE_URL first,
        // then clean up via the dipstick superuser connection. This test only
        // calls GET, which writes no audit_log row, so no audit_log cleanup
        // is needed here (unlike the reveal/advance/complete-triggering
        // tests elsewhere in this change).
        process.env["DATABASE_URL"] = originalDatabaseUrl;

        await fixturePool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
        await fixturePool.query(`DELETE FROM topics WHERE id = $1`, [topicId]);
        await fixturePool.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
        await fixturePool.query(`DELETE FROM users WHERE id = $1`, [facilitatorId]);
        await dropRestrictedRoleIfExists(fixturePool);
        await fixturePool.end().catch(() => undefined);
      }
    }, 15000);

    it("leaves no dipstick_restricted_probe role behind after teardown (tasks.md 7.1 verification)", async () => {
      const pool = new pg.Pool({ connectionString: DATABASE_URL });
      try {
        const result = await pool.query<{ rolname: string }>(`SELECT rolname FROM pg_roles WHERE rolname = $1`, [
          RESTRICTED_ROLE,
        ]);
        expect(result.rows).toHaveLength(0);
      } finally {
        await pool.end().catch(() => undefined);
      }
    });
  },
);
