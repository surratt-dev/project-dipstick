import pg from "pg";
import { SENTINEL_TEAM_ID } from "./real-db.js";

// ---------------------------------------------------------------------------
// Test helpers for tests that mutate (or assert an absolute baseline on) the
// __default_topics__ template -- harden-team-creation-topic-copy (#215)
// design.md D8 and Risks.
//
// withTemplateLock: Vitest runs files in parallel, and several files swap or
// archive template rows. A fixed-key Postgres session-level advisory lock on
// a dedicated client serialises them across worker processes. Tests that only
// CREATE teams do not take it and must derive expectations from an in-test
// snapshot, never from the baseline list.
//
// withDroppedActiveOrderIndex: DROP INDEX takes ACCESS EXCLUSIVE on topics.
// Tests using it run under withTemplateLock, but team-creating tests in other
// files do not take that lock, so they MAY block on the drop or hit the 2 s
// lock_timeout (accepted residual, #215 architect O1). If flakes appear,
// isolate the using file as a separate Vitest project; do not widen the
// timeout.
// ---------------------------------------------------------------------------

/** Fixed advisory-lock key for the template team ("TMPL" in ASCII). */
export const TEMPLATE_LOCK_KEY = 0x544d504c;

function databaseUrl(): string {
  return process.env["DATABASE_URL"] ?? "postgresql://dipstick:dipstick@localhost:5433/dipstick";
}

/**
 * Takes the lock and returns its release function. For a file whose every
 * test needs the lock: acquire in beforeAll, release in afterAll.
 */
export async function acquireTemplateLock(): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [TEMPLATE_LOCK_KEY]);
  } catch (err) {
    await client.end().catch(() => undefined);
    throw err;
  }
  return async () => {
    await client.query("SELECT pg_advisory_unlock($1)", [TEMPLATE_LOCK_KEY]).catch(() => undefined);
    await client.end().catch(() => undefined);
  };
}

export async function withTemplateLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireTemplateLock();
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * Throws unless running under Vitest and the database host is local. Pure, exported for its own test.
 * Keys on VITEST (always set by the runner) rather than NODE_ENV, because CI sets NODE_ENV=development
 * for the whole job.
 */
export function assertSafeToDropIndex(env: NodeJS.ProcessEnv = process.env): void {
  if (!env["VITEST"]) {
    throw new Error("withDroppedActiveOrderIndex refuses to run outside Vitest (VITEST is not set)");
  }
  let host: string;
  try {
    host = new URL(env["DATABASE_URL"] ?? "").hostname;
  } catch {
    throw new Error("withDroppedActiveOrderIndex refuses to run: DATABASE_URL is not a valid URL");
  }
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error("withDroppedActiveOrderIndex refuses to run against a non-local database host");
  }
}

/**
 * On one client: BEGIN, drop topics_team_active_order, run fn(client), always
 * ROLLBACK. Nothing but `client` may be awaited inside fn (no app.inject, no
 * other pool use): the lock window must stay in milliseconds.
 */
export async function withDroppedActiveOrderIndex<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  assertSafeToDropIndex();
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("DROP INDEX topics_team_active_order");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end().catch(() => undefined);
  }
}

export { SENTINEL_TEAM_ID };
