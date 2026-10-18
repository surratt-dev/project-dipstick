import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Fixture, SENTINEL_TEAM_ID, buildFullApp, loadModules, resetTopicWriteBudget, type Db, type Mods } from "./real-db.js";
// Imported after real-db so its environment defaults are set before config.js loads.
import { MAINTENANCE_AUDIT_OPERATIONS } from "../../../sessions/default-topic-validation.js";
import { acquireTemplateLock } from "./template-lock.js";
import { snapshotTemplate, type TemplateSnapshot } from "./template-snapshot.js";

// ---------------------------------------------------------------------------
// Test hygiene for every test that WRITES the default-topic template through
// the maintenance endpoints -- admin-default-topic-maintenance (#216)
// design.md E6 "Test isolation", tasks.md 2.1.
//
// A maintenance test must:
//   - hold the cross-process template lock (acquireTemplateLock) for each test;
//   - restore the template after each test from a snapshot taken by the shared
//     snapshot helper (snapshotTemplate), in one transaction: positions and
//     status by negate-then-set (the shared restoreTemplate's two-step), the
//     text and archive columns that restoreTemplate deliberately does not
//     touch, and removal of every row the test added. It does NOT call
//     restoreTemplate itself: that also rewrites the annotation columns from
//     the snapshot, which maintenance never changes and which other lock-free
//     test files may be using concurrently (design deviation, see tasks.md);
//   - delete the maintenance audit rows it created, selected with
//     `operation = ANY(MAINTENANCE_AUDIT_OPERATIONS)` (never LIKE), so the
//     invariants test's baseline check (f) is not permanently disabled in a
//     shared CI database;
//   - FAIL in afterEach if any such row is left.
// The delete helper refuses to run against anything but the local test
// database. (The check keys on VITEST and a local host, not NODE_ENV: the
// integration lane sets NODE_ENV=development for the whole job.)
// ---------------------------------------------------------------------------

/** Throws unless running under Vitest against the local database. Pure, exported for its own test. */
export function assertSafeTestDatabase(env: NodeJS.ProcessEnv = process.env): void {
  if (!env["VITEST"]) {
    throw new Error("maintenance test cleanup refuses to run outside Vitest (VITEST is not set)");
  }
  let url: URL;
  try {
    url = new URL(env["DATABASE_URL"] ?? "");
  } catch {
    throw new Error("maintenance test cleanup refuses to run: DATABASE_URL is not a valid URL");
  }
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("maintenance test cleanup refuses to run against a non-local database host");
  }
  const dbName = url.pathname.replace(/^\//, "");
  if (!/^dipstick(_test)?$/.test(dbName)) {
    throw new Error(`maintenance test cleanup refuses to run against database "${dbName}" (not the test database)`);
  }
}

/** Deletes maintenance audit rows for the template created at or after `since`. Returns how many. */
export async function deleteMaintenanceAuditRows(db: Pick<Db, "query">, since: Date): Promise<number> {
  assertSafeTestDatabase();
  const result = await db.query(
    `DELETE FROM audit_log WHERE team_id = $1 AND operation = ANY($2::text[]) AND "timestamp" >= $3`,
    [SENTINEL_TEAM_ID, [...MAINTENANCE_AUDIT_OPERATIONS], since],
  );
  return result.rowCount ?? 0;
}

export async function countMaintenanceAuditRows(db: Pick<Db, "query">, since: Date): Promise<number> {
  const result = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM audit_log WHERE team_id = $1 AND operation = ANY($2::text[]) AND "timestamp" >= $3`,
    [SENTINEL_TEAM_ID, [...MAINTENANCE_AUDIT_OPERATIONS], since],
  );
  return Number(result.rows[0]!.n);
}

interface FullTemplateRow {
  id: string;
  name: string;
  prompt: string;
  display_order: number;
  status: string;
  first_session_description: string | null;
  archived_at: Date | null;
  archived_by: string | null;
  restored_at: Date | null;
  restored_by: string | null;
  updated_at: Date;
}

/**
 * The columns the maintenance operations can change, per template row. The
 * annotation columns are deliberately not captured or restored: no
 * maintenance operation touches them, and other (lock-free) test files may
 * legitimately be working with them concurrently.
 */
async function fullTemplateRows(db: Db): Promise<Map<string, FullTemplateRow>> {
  const rows = (
    await db.query<FullTemplateRow>(
      `SELECT id, name, prompt, display_order, status, first_session_description,
              archived_at, archived_by, restored_at, restored_by, updated_at
         FROM topics WHERE team_id = $1`,
      [SENTINEL_TEAM_ID],
    )
  ).rows;
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Restores the template in ONE transaction (all or nothing, so a failure cannot
 * leave the shared database half-restored): removes the rows this test added,
 * then positions and status by negate-then-set (the same two-step the shared
 * snapshot helper's restoreTemplate uses), then the text and archive columns.
 * Only rows this test created are deleted and only the maintenance-changed
 * columns are written.
 */
async function restoreWholeTemplate(
  db: Db,
  snap: TemplateSnapshot,
  full: Map<string, FullTemplateRow>,
  startedAt: Date,
): Promise<void> {
  assertSafeTestDatabase();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const ids = [...full.keys()];
    await client.query(
      `DELETE FROM topics WHERE team_id = $1 AND created_at >= $2 AND NOT (id = ANY($3::uuid[]))`,
      [SENTINEL_TEAM_ID, startedAt, ids],
    );
    await client.query(`UPDATE topics SET display_order = -display_order - 1 WHERE team_id = $1 AND id = ANY($2::uuid[])`, [
      SENTINEL_TEAM_ID,
      ids,
    ]);
    for (const row of full.values()) {
      await client.query(
        `UPDATE topics
            SET name = $2, prompt = $3, display_order = $4, status = $5::topic_status,
                first_session_description = $6, archived_at = $7, archived_by = $8,
                restored_at = $9, restored_by = $10, updated_at = $11
          WHERE id = $1`,
        [
          row.id,
          row.name,
          row.prompt,
          row.display_order,
          row.status,
          row.first_session_description,
          row.archived_at,
          row.archived_by,
          row.restored_at,
          row.restored_by,
          row.updated_at,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  void snap;
}

/** Generous: waiting for the shared template lock can take as long as the other lock-holding files. */
const LOCK_WAIT_TIMEOUT_MS = 240_000;

/**
 * Makes app.inject send the default-topics mutation-control header (X-Requested-With: dipstick) on
 * mutating requests to the admin family unless the request sets that header itself. Tests of the
 * control use appFor(userId, { control: false }).
 */
export function withMutationControl(app: FastifyInstance): void {
  const original = app.inject.bind(app) as (...a: unknown[]) => unknown;
  (app as unknown as { inject: unknown }).inject = (...args: unknown[]) => {
    const opts = args[0];
    if (opts && typeof opts === "object") {
      const o = opts as { method?: string; url?: string; headers?: Record<string, string> };
      const mutating = o.method !== undefined && o.method !== "GET";
      if (mutating && typeof o.url === "string" && o.url.startsWith("/api/v1/admin/default-topics")) {
        const headers = { "x-requested-with": "dipstick", ...(o.headers ?? {}) };
        return original({ ...o, headers }, ...args.slice(1));
      }
    }
    return original(...args);
  };
}

export interface MaintenanceHarness {
  readonly mods: Mods;
  readonly fx: Fixture;
  /** A Fastify app with every route, authenticated as userId (budget reset). */
  appFor(userId: string, opts?: { control?: boolean }): Promise<FastifyInstance>;
  /** The pre-test snapshot of the template (taken in beforeEach). */
  snapshot(): TemplateSnapshot;
  /** When the current test started, by the database clock. */
  startedAt(): Date;
}

/**
 * Registers the hooks (call at describe level). All maintenance tests run
 * under acquireTemplateLock(), restore the template after each test, delete
 * the maintenance audit rows they created and fail if any remain.
 */
export function useMaintenanceTemplate(): MaintenanceHarness {
  let mods: Mods;
  let fx: Fixture;
  let release: (() => Promise<void>) | undefined;
  let snap: TemplateSnapshot;
  let full: Map<string, FullTemplateRow>;
  let started: Date;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
  });

  // The template lock is held per TEST, not per file: it is one mutex shared by every
  // template-mutating file, and a maintenance file holds it for many seconds (each request
  // pays the timing floor), which would starve the other files past their hook timeout.
  // Waiting for the lock can take a while for the same reason, hence the generous timeout.
  beforeEach(async () => {
    release = await acquireTemplateLock();
    started = (await mods.db.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;
    snap = await snapshotTemplate(mods.db);
    full = await fullTemplateRows(mods.db);
  }, LOCK_WAIT_TIMEOUT_MS);

  afterEach(async () => {
    try {
      for (const app of apps.splice(0)) await app.close().catch(() => undefined);
      await restoreWholeTemplate(mods.db, snap, full, started);
      await deleteMaintenanceAuditRows(mods.db, started);
      const remaining = await countMaintenanceAuditRows(mods.db, started);
      if (remaining !== 0) {
        throw new Error(`${remaining} maintenance audit row(s) remain after the test; the invariants baseline check would be disabled`);
      }
    } finally {
      await release?.();
      release = undefined;
    }
  }, LOCK_WAIT_TIMEOUT_MS);

  afterAll(async () => {
    await fx?.cleanup();
    await mods?.redis.quit();
  }, LOCK_WAIT_TIMEOUT_MS);

  return {
    get mods() {
      return mods;
    },
    get fx() {
      return fx;
    },
    async appFor(userId: string, opts: { control?: boolean } = {}) {
      const app = await buildFullApp(mods, userId);
      if (opts.control !== false) withMutationControl(app);
      apps.push(app);
      return app;
    },
    snapshot: () => snap,
    startedAt: () => started,
  };
}

/**
 * Users with differing global_role and team membership (the shared authorization fixture):
 * an administrator on no team, an administrator who is a member of a team, a facilitator who is a
 * member of that team, a non-member facilitator, an engineering manager and a senior engineer.
 */
export async function createActors(fx: Fixture) {
  const admin = await fx.user("application_admin");
  const adminOnTeam = await fx.user("application_admin");
  const memberFacilitator = await fx.user("facilitator");
  const nonMemberFacilitator = await fx.user("facilitator");
  const engineeringManager = await fx.user("engineering_manager");
  const seniorEngineer = await fx.user("senior_engineer");
  const team = await fx.team(memberFacilitator);
  await fx.member(team, memberFacilitator);
  await fx.member(team, adminOnTeam);
  return { admin, adminOnTeam, memberFacilitator, nonMemberFacilitator, engineeringManager, seniorEngineer, team };
}

/** A logging Fastify app that records pino lines, authenticated as userId. */
export interface LogLine {
  level: number;
  msg?: string;
  event?: string;
  [key: string]: unknown;
}

export async function buildLoggedFullApp(
  mods: Mods,
  userId: string,
  lines: LogLine[],
): Promise<FastifyInstance> {
  await resetTopicWriteBudget(userId);
  const app = Fastify({
    logger: { level: "info", stream: { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) } },
  });
  app.decorateRequest("session", null as never);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  await mods.registerRoutes(app);
  await app.ready();
  return app;
}

/**
 * The shared position assertion (tasks.md 4.7): the template's active default
 * positions are exactly 1..N and unique. Called after every maintenance
 * operation in the operation tests. Returns the active ids in position order.
 */
export async function expectActivePositionsDense(db: Pick<Db, "query">): Promise<string[]> {
  const { expect } = await import("vitest");
  const rows = (
    await db.query<{ id: string; display_order: number }>(
      `SELECT id, display_order FROM topics
        WHERE team_id = $1 AND status = 'active' AND is_default = true
        ORDER BY display_order, id`,
      [SENTINEL_TEAM_ID],
    )
  ).rows;
  expect(rows.map((r) => r.display_order)).toEqual(rows.map((_, i) => i + 1));
  return rows.map((r) => r.id);
}

/** Sets the template's active default positions directly (negate-then-set), e.g. to create a gap. */
export async function setTemplatePositions(db: Db, orders: Array<[id: string, order: number]>): Promise<void> {
  await db.query(`UPDATE topics SET display_order = -display_order - 1000 WHERE id = ANY($1::uuid[])`, [
    orders.map(([id]) => id),
  ]);
  for (const [id, order] of orders) {
    await db.query(`UPDATE topics SET display_order = $2 WHERE id = $1`, [id, order]);
  }
}
