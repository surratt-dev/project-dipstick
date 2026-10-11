import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import pg from "pg";
import Fastify, { type FastifyInstance, type RouteOptions } from "fastify";
import { DEFAULT_TOPICS_TEAM_ID } from "../../../sessions/default-topics.js";
import type { GlobalRole } from "../../../auth/role-map.js";

// ---------------------------------------------------------------------------
// Shared real-Postgres test harness — session-topics-snapshot-at-creation
// (#175).
//
// Same conventions as every other *-integration.test.ts in this directory
// (env var fallbacks matching .env.example, a reachability probe, dynamic
// post-fallback imports, NO db.js/config.js mocking), pulled into one place
// for the several real-DB files this change adds.
//
// REQUIRE_DB rule (design.md "Verification approach", tasks.md 1.4): each
// file keeps describe.skipIf(!infraUp) so ci.yml (no Postgres) skips cleanly,
// and calls requireInfraOrThrow() at module top so integration.yml (which
// sets REQUIRE_DB=1) fails instead of silently skipping.
//
// Not a *.test.ts file, so vitest never collects it, and coverage excludes
// __tests__/.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] ??= "postgresql://dipstick:dipstick@localhost:5433/dipstick";
process.env["REDIS_URL"] ??= "redis://localhost:6380";
process.env["SESSION_SECRET"] ??= "integration-test-session-secret-32-chars-min";
process.env["OIDC_ISSUER"] ??= "http://localhost:4011";
process.env["OIDC_CLIENT_ID"] ??= "dipstick-local";
process.env["OIDC_CLIENT_SECRET"] ??= "dipstick-local-secret";
process.env["OIDC_REDIRECT_URI"] ??= "http://localhost:3000/auth/callback";
process.env["NODE_ENV"] ??= "test";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const REDIS_URL = process.env["REDIS_URL"]!;
const PROBE_TIMEOUT_MS = 750;

// The production template-team constant, not a copy, so the harness cannot
// drift from the template the code reads (architect review N2).
export const SENTINEL_TEAM_ID = DEFAULT_TOPICS_TEAM_ID;

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

/** Postgres and Redis (the state-transition handlers publish after commit). */
export async function probeInfra(): Promise<boolean> {
  const [dbUp, redisUp] = await Promise.all([isPostgresReachable(), isRedisReachable()]);
  return dbUp && redisUp;
}

/**
 * Throws when infra is unreachable and REQUIRE_DB is set (integration.yml);
 * otherwise warns, and the caller's describe.skipIf skips.
 */
export function requireInfraOrThrow(infraUp: boolean, fileName: string): void {
  if (infraUp) return;
  if (process.env["REQUIRE_DB"]) {
    throw new Error(`[${fileName}] Postgres required in the integration lane (REQUIRE_DB is set) but unreachable.`);
  }
  console.warn(
    `[${fileName}] SKIPPED — Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}) and/or Redis (${REDIS_URL}) not reachable. ` +
      "Run `docker compose up` (repo root) and re-run this file.",
  );
}

export async function loadModules() {
  const { db } = await import("../../../db.js");
  const { facilitatorSessionRoutes } = await import("../../facilitator-sessions.js");
  const { topicRoutes } = await import("../../topics.js");
  const { contentRoutes } = await import("../../content.js");
  const { sessionRoutes } = await import("../../sessions.js");
  const snapshot = await import("../../../sessions/session-topic-snapshot.js");
  const { buildSessionRegistrationSnapshot } = await import("../../../realtime/session-registration-snapshot.js");
  const { registerRoutes } = await import("../../register-routes.js");
  const { redis } = await import("../../../redis.js");
  return {
    db,
    facilitatorSessionRoutes,
    topicRoutes,
    contentRoutes,
    sessionRoutes,
    snapshot,
    buildSessionRegistrationSnapshot,
    registerRoutes,
    redis,
  };
}

export type Mods = Awaited<ReturnType<typeof loadModules>>;
export type Db = Mods["db"];

/** A Fastify app with every route plugin this change touches, authenticated as userId. */
export async function buildApp(
  mods: Mods,
  userId: string,
  opts: { keepTopicWriteBudget?: boolean } = {},
): Promise<FastifyInstance> {
  // #184 5.4b: a fresh topic-write budget for this actor, so reruns never
  // inherit one. Tests that pre-seed the actor's windows pass
  // keepTopicWriteBudget and seed AFTER building the app or before with it.
  if (!opts.keepTopicWriteBudget) await resetTopicWriteBudget(userId);
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(mods.facilitatorSessionRoutes);
  app.register(mods.topicRoutes);
  app.register(mods.contentRoutes);
  app.register(mods.sessionRoutes);
  await app.ready();
  return app;
}

/**
 * Every HTTP route buildApp() (app.ts) registers, through the same
 * registerRoutes(), authenticated as userId -- without app.ts's session
 * store, helmet, auth middleware or WebSocket layer (#188 design.md D4).
 * onRoute, when given, is registered before any route so it sees all of them.
 *
 * extraRoutes (template-team-not-usable #214 tasks.md 5.1): registered after
 * registerRoutes(), in the same root context, so they inherit its error
 * handler and the onRoute hook sees them. Used by the structural template
 * test's probe self-test.
 */
export async function buildFullApp(
  mods: Mods,
  userId: string,
  onRoute?: (route: RouteOptions) => void,
  opts: { keepTopicWriteBudget?: boolean; extraRoutes?: (app: FastifyInstance) => void } = {},
): Promise<FastifyInstance> {
  if (!opts.keepTopicWriteBudget) await resetTopicWriteBudget(userId); // #184 5.4b
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  if (onRoute) app.addHook("onRoute", onRoute);
  await mods.registerRoutes(app);
  opts.extraRoutes?.(app);
  await app.ready();
  return app;
}

/**
 * Every HTTP route, with NO authenticated user, behind app.ts's real auth
 * middleware (template-team-not-usable #214 tasks.md 3.3/5.2: "an
 * unauthenticated caller gets 401 and no audit row"). The middleware answers
 * 401 for every non-public route before any handler runs.
 */
export async function buildUnauthenticatedFullApp(mods: Mods): Promise<FastifyInstance> {
  const { authMiddleware } = await import("../../../auth/middleware.js");
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = {};
  });
  await authMiddleware(app);
  await mods.registerRoutes(app);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Fixture builders. Every id is a fresh UUID, so parallel files never collide;
// each fixture tracks what it created and cleanup() removes it in FK order.
// ---------------------------------------------------------------------------

export class Fixture {
  readonly teamIds: string[] = [];
  readonly userIds: string[] = [];

  constructor(private readonly db: Db) {}

  /**
   * A user row. A string keeps the pre-#245 behaviour (global_role only; the
   * migration 21 legacy-writer shim fills roles = {global_role}). An array is
   * the full role set, highest precedence first (store-idp-role-set D1/D3):
   * it is written to users.roles and global_role is its first element, so the
   * row passes users_roles_consistent exactly as the sign-in upsert's would.
   */
  async user(roleOrRoles: string | readonly GlobalRole[] = "facilitator"): Promise<string> {
    const id =
      typeof roleOrRoles === "string"
        ? await insertUser(this.db, { globalRole: roleOrRoles })
        : await insertUser(this.db, { roles: roleOrRoles });
    this.userIds.push(id);
    return id;
  }

  /** Replaces a user's role set; global_role becomes roles[0], in one statement. */
  async setRoles(id: string, roles: readonly GlobalRole[]): Promise<void> {
    await setUserRoles(this.db, id, roles);
  }

  async team(creatorId: string): Promise<string> {
    const id = randomUUID();
    await this.db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
      id,
      `Snapshot Test Team ${id}`,
      creatorId,
    ]);
    this.teamIds.push(id);
    return id;
  }

  /**
   * An active team_memberships row (cleaned up with the team). role defaults
   * to participant, the column default (#208 tasks.md 1.1).
   */
  async member(
    teamId: string,
    userId: string,
    role: "participant" | "engineering_manager" = "participant",
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, $3::membership_role)`,
      [teamId, userId, role],
    );
  }

  /** Records a team created through the API (POST /teams) for cleanup. */
  track(teamId: string): void {
    this.teamIds.push(teamId);
  }

  async topic(
    teamId: string,
    opts: {
      name?: string;
      prompt?: string;
      displayOrder: number;
      status?: "active" | "archived";
      annotation?: string | null;
      voteType?: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, team_annotation, archived_at)
       VALUES ($1, $2, $3, $4, $5::vote_type, $6, $7::topic_status, false, $8,
               CASE WHEN $7::text = 'archived' THEN NOW() END)`,
      [
        id,
        teamId,
        opts.name ?? `Topic ${opts.displayOrder} ${id.slice(-4)}`,
        opts.prompt ?? `Prompt ${opts.displayOrder}?`,
        opts.voteType ?? "finger",
        opts.displayOrder,
        opts.status ?? "active",
        opts.annotation ?? null,
      ],
    );
    return id;
  }

  async session(
    teamId: string,
    facilitatorId: string,
    status: string,
    opts: { createdAt?: string; isFirst?: boolean } = {},
  ): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO sessions
         (id, team_id, facilitator_id, status, is_first_session, session_number, created_at,
          completed_at, abandoned_at, facilitator_access_expires_at)
       VALUES ($1, $2, $3, $4::session_status, $5, 1, COALESCE($6::timestamptz, NOW()),
               CASE WHEN $4::text = 'complete' THEN NOW() END,
               CASE WHEN $4::text = 'abandoned' THEN NOW() END,
               CASE WHEN $4::text = 'complete' THEN NOW() + INTERVAL '30 minutes' END)`,
      [id, teamId, facilitatorId, status, opts.isFirst ?? false, opts.createdAt ?? null],
    );
    return id;
  }

  /** A completed session lifts the topic-customization lock. */
  async unlock(teamId: string, facilitatorId: string): Promise<string> {
    return this.session(teamId, facilitatorId, "complete", { isFirst: true });
  }

  async cleanup(): Promise<void> {
    const { db } = this;
    for (const teamId of this.teamIds) {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM join_links WHERE team_id = $1`, [teamId]);
      // session_topics and votes cascade from sessions; topics after them.
      await db.query(`UPDATE sessions SET current_topic_id = NULL WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM team_memberships WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    }
    await resetTopicWriteBudget(...this.userIds); // #184 5.4b: no stray limiter keys
    for (const userId of this.userIds) {
      await db.query(`DELETE FROM audit_log WHERE actor_user_id = $1`, [userId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
    this.teamIds.length = 0;
    this.userIds.length = 0;
  }
}

// ---------------------------------------------------------------------------
// store-idp-role-set (#245) design D3: the one way new tests create users
// with a role set. Fixture.user / Fixture.setRoles wrap these; insertUser is
// exported for files that do not use Fixture (the caller then deletes the
// row itself). No helper can write an invalid row on purpose: negative CHECK
// tests use raw SQL in a rolled-back transaction.
// ---------------------------------------------------------------------------

type QueryRunner = Pick<Db, "query">;

export async function insertUser(
  db: QueryRunner,
  opts: {
    /** Full role set, highest precedence first; global_role = roles[0]. */
    roles?: readonly GlobalRole[];
    /** Pre-#245 shape: global_role only (the shim fills roles). Ignored when roles is given. */
    globalRole?: string;
    id?: string;
    oidcSubject?: string;
    oidcIssuer?: string;
    displayName?: string;
    email?: string;
  } = {},
): Promise<string> {
  const id = opts.id ?? randomUUID();
  const subject = opts.oidcSubject ?? `sub-${id}`;
  const issuer = opts.oidcIssuer ?? "test-issuer";
  const displayName = opts.displayName ?? `Snapshot Test ${id.slice(-6)}`;
  const email = opts.email ?? `${id}@example.com`;
  if (opts.roles !== undefined) {
    await db.query(
      `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role, roles)
       VALUES ($1, $2, $3, $4, $5, $6, $7::user_role[])`,
      [id, subject, issuer, displayName, email, opts.roles[0], [...opts.roles]],
    );
  } else {
    await db.query(
      `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, subject, issuer, displayName, email, opts.globalRole ?? "facilitator"],
    );
  }
  return id;
}

/** Updates users.roles and users.global_role (= roles[0]) in one statement. */
export async function setUserRoles(db: QueryRunner, id: string, roles: readonly GlobalRole[]): Promise<void> {
  await db.query(`UPDATE users SET global_role = $2, roles = $3::user_role[], updated_at = NOW() WHERE id = $1`, [
    id,
    roles[0],
    [...roles],
  ]);
}

export interface SessionTopicRow {
  id: string;
  topic_id: string;
  display_order: number;
  topic_name: string;
  topic_prompt: string;
  vote_type: string;
  topic_annotation: string | null;
  status: string;
}

export async function sessionTopicRows(db: Db, sessionId: string): Promise<SessionTopicRow[]> {
  return (
    await db.query<SessionTopicRow>(
      `SELECT id, topic_id, display_order, topic_name, topic_prompt, vote_type, topic_annotation, status
       FROM session_topics WHERE session_id = $1 ORDER BY display_order`,
      [sessionId],
    )
  ).rows;
}

export async function activeTopicIdsInOrder(db: Db, teamId: string): Promise<string[]> {
  return (
    await db.query<{ id: string }>(
      `SELECT id FROM topics WHERE team_id = $1 AND status = 'active' ORDER BY display_order, id`,
      [teamId],
    )
  ).rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// withTeamLockGate — genuine concurrency, using the team lock as the gate
// (design.md "Verification approach", tasks.md 2.4).
//
// Promise.all of two short requests does not guarantee overlap, and no
// test-only hook is added to production code. Instead a dedicated client
// takes the team lock with the PRODUCTION key (LOCK_TEAM_TOPICS_SQL), fire()
// starts the concurrent requests, and the helper polls pg_locks until
// `waiters` other backends are waiting (granted = false) on that advisory
// lock, then commits and awaits the requests. A timeout fails the test
// rather than letting it pass without overlap.
// ---------------------------------------------------------------------------

export async function withTeamLockGate<T>(
  mods: Mods,
  teamId: string,
  fire: () => Promise<T>[],
  opts: { waiters?: number; timeoutMs?: number } = {},
): Promise<T[]> {
  const waiters = opts.waiters ?? 2;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const gate = await mods.db.connect();
  let pending: Promise<T>[] = [];
  try {
    await gate.query("BEGIN");
    await gate.query(mods.snapshot.LOCK_TEAM_TOPICS_SQL, [teamId]);
    const { rows } = await gate.query<{ key: number }>(
      `SELECT ${mods.snapshot.TEAM_TOPICS_LOCK_KEY_SQL} AS key`,
      [teamId],
    );
    const key = rows[0]!.key;

    // Attach no-op handlers now so an early rejection is not reported as
    // unhandled while we poll; the real results are awaited below.
    pending = fire();
    for (const p of pending) p.catch(() => undefined);

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // pg_advisory_xact_lock(bigint) stores the key's high 32 bits in classid
      // and the low 32 bits in objid (objsubid = 1). hashtext() yields an
      // int4, sign-extended to bigint, so classid is 0 or 4294967295.
      const waiting = await mods.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_locks
          WHERE locktype = 'advisory' AND granted = false AND objsubid = 1
            AND objid = ($1::bigint & 4294967295)::oid`,
        [key],
      );
      if ((waiting.rows[0]?.n ?? 0) >= waiters) break;
      if (Date.now() > deadline) {
        throw new Error(`withTeamLockGate: timed out waiting for ${waiters} backend(s) to queue on the team lock`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    await gate.query("COMMIT");
  } catch (err) {
    await gate.query("ROLLBACK").catch(() => undefined);
    gate.release();
    await Promise.allSettled(pending);
    throw err;
  }
  gate.release();
  return Promise.all(pending);
}

// ---------------------------------------------------------------------------
// withTeamLockGateStaged — harden-topic-write-endpoints (#184) tasks 3.6-3.8.
//
// Like withTeamLockGate, but fires the requests one at a time: request i+1 is
// started only after request i is queued on the team lock. Postgres grants a
// contended advisory lock in queue order, so once the gate commits the
// requests run in exactly the order given. That lets a test pin WHICH
// operation ran first and observe that the second waited for it.
//
// The gate takes the lock with the production key on the canonical
// (lowercase) teamId. A request whose path used another letter case only
// counts as a waiter if it hashes to the same key -- which is the L1 property
// these tests prove. If it did not, the poll below times out and the test
// fails rather than passing without overlap.
// ---------------------------------------------------------------------------

async function teamLockWaiters(mods: Mods, key: number): Promise<number> {
  const waiting = await mods.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_locks
      WHERE locktype = 'advisory' AND granted = false AND objsubid = 1
        AND objid = ($1::bigint & 4294967295)::oid`,
    [key],
  );
  return waiting.rows[0]?.n ?? 0;
}

export async function withTeamLockGateStaged<T>(
  mods: Mods,
  teamId: string,
  fires: Array<() => Promise<T>>,
  opts: { timeoutMs?: number } = {},
): Promise<T[]> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const gate = await mods.db.connect();
  const pending: Promise<T>[] = [];
  try {
    await gate.query("BEGIN");
    await gate.query(mods.snapshot.LOCK_TEAM_TOPICS_SQL, [teamId]);
    const { rows } = await gate.query<{ key: number }>(
      `SELECT ${mods.snapshot.TEAM_TOPICS_LOCK_KEY_SQL} AS key`,
      [teamId],
    );
    const key = rows[0]!.key;

    for (const [index, fire] of fires.entries()) {
      const p = fire();
      p.catch(() => undefined);
      pending.push(p);
      const deadline = Date.now() + timeoutMs;
      while ((await teamLockWaiters(mods, key)) < index + 1) {
        if (Date.now() > deadline) {
          throw new Error(
            `withTeamLockGateStaged: timed out waiting for request ${index + 1} to queue on the team lock`,
          );
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    await gate.query("COMMIT");
  } catch (err) {
    await gate.query("ROLLBACK").catch(() => undefined);
    gate.release();
    await Promise.allSettled(pending);
    throw err;
  }
  gate.release();
  return Promise.all(pending);
}

// ---------------------------------------------------------------------------
// resetTopicWriteBudget — harden-topic-write-endpoints (#184) task 5.4b.
//
// Topic writes now go through a Redis-backed per-actor budget whose daily
// window lives 24 h in the docker compose Redis. Integration files that use
// fixed actor ids would otherwise accumulate budget across local reruns until
// unrelated tests see 429s. This deletes all four of the actor's topic-write
// keys (burst, daily and both breach markers). Keys come from the production
// key function, so the helper cannot drift from the limiter.
// ---------------------------------------------------------------------------
export async function resetTopicWriteBudget(...userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const { redis } = await import("../../../redis.js");
  const { topicWriteRateLimitKeys } = await import("../../topic-write-rate-limit.js");
  const keys = userIds.flatMap((id) => Object.values(topicWriteRateLimitKeys(id)));
  await redis.del(...keys);
}

/**
 * Pre-seeds an actor's topic-write windows with ZADD (#184 Decision 13: route
 * tests pre-seed instead of sending hundreds of requests). Each score is one
 * counted request at that time (ms). Sets the window TTLs as an admit would.
 */
export async function seedTopicWriteWindows(
  userId: string,
  windows: { burst?: number[]; daily?: number[] },
): Promise<void> {
  const { redis } = await import("../../../redis.js");
  const { topicWriteRateLimitKeys, TOPIC_WRITE_LIMITS } = await import("../../topic-write-rate-limit.js");
  const keys = topicWriteRateLimitKeys(userId);
  const pipeline = redis.pipeline();
  for (const [key, scores, ttl] of [
    [keys.burst, windows.burst ?? [], TOPIC_WRITE_LIMITS.burst.windowMs],
    [keys.daily, windows.daily ?? [], TOPIC_WRITE_LIMITS.daily.windowMs],
  ] as const) {
    if (scores.length === 0) continue;
    scores.forEach((score, i) => pipeline.zadd(key, score, `seed-${score}-${i}-${randomUUID()}`));
    pipeline.pexpire(key, ttl);
  }
  await pipeline.exec();
}

/** An actor over both limits: `n` entries (default the limit) one second ago in both windows. */
export async function seedOverBudget(userId: string, opts: { burst?: number; daily?: number } = {}): Promise<void> {
  const { TOPIC_WRITE_LIMITS } = await import("../../topic-write-rate-limit.js");
  const at = Date.now() - 1_000;
  const burst = opts.burst ?? TOPIC_WRITE_LIMITS.burst.limit;
  const daily = opts.daily ?? Math.max(burst, 0);
  await seedTopicWriteWindows(userId, {
    burst: Array.from({ length: burst }, () => at),
    daily: Array.from({ length: daily }, () => at),
  });
}

/** ZCARD and PTTL of an actor's two topic-write windows, plus whether each breach marker exists. */
export async function topicWriteWindowState(userId: string) {
  const { redis } = await import("../../../redis.js");
  const { topicWriteRateLimitKeys } = await import("../../topic-write-rate-limit.js");
  const keys = topicWriteRateLimitKeys(userId);
  const [burst, daily, burstTtl, dailyTtl, burstMarker, dailyMarker] = await Promise.all([
    redis.zcard(keys.burst),
    redis.zcard(keys.daily),
    redis.pttl(keys.burst),
    redis.pttl(keys.daily),
    redis.exists(keys.burstMarker),
    redis.exists(keys.dailyMarker),
  ]);
  return { burst, daily, burstTtl, dailyTtl, burstMarker: burstMarker === 1, dailyMarker: dailyMarker === 1 };
}
