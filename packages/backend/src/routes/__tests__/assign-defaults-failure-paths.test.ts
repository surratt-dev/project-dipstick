import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { probeInfra, requireInfraOrThrow, loadModules, Fixture, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { snapshotTemplate, restoreTemplate, assertTemplateUnchanged } from "./helpers/template-snapshot.js";
import type { TemplateSnapshot } from "./helpers/template-snapshot.js";
import {
  ASSIGN_ENDPOINT,
  ASSIGN_PATH,
  auditRows,
  buildLoggedApp,
  holdTemplateLockPerTest,
  resetDenialAuditBudget,
  teamTopicRows,
  zeroTopicTeam,
} from "./helpers/assign-defaults.js";
import type { LoggedApp } from "./helpers/assign-defaults.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) tasks.md 3.1 / 3.3: the failure paths of
// assign-defaults against real Postgres and Redis. Faults are injected by
// spying on the shared pool / Redis client (no production seam is added), so
// rollback, lock release and the fail-open audit rows are proven on real
// transactions. The empty-template case archives the template's active
// defaults, so the file holds the template lock and restores the template
// after every test (each test holds the template lock).
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "assign-defaults-failure-paths.test.ts");

const SQL_TEXT_CANARY = "SECRET_SQL_TEXT_DO_NOT_LEAK";

describe.skipIf(!infraUp)("assign-defaults failure paths (real Postgres, #200)", () => {
  let mods: Mods;
  let fx: Fixture;
  let snap: TemplateSnapshot | undefined;
  const apps: LoggedApp[] = [];

  holdTemplateLockPerTest();

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const a of apps.splice(0)) await a.app.close();
    if (snap) await restoreTemplate(mods.db, snap);
    snap = undefined;
    if (fx) await resetDenialAuditBudget(mods, ...fx.userIds);
    await fx?.cleanup();
  });

  afterAll(async () => {
    await mods?.redis.quit();
  });

  async function as(userId: string): Promise<LoggedApp> {
    const logged = await buildLoggedApp(mods, userId);
    apps.push(logged);
    return logged;
  }

  const errorOf = (res: { json: () => unknown }) =>
    (res.json() as { error: { category: string; code?: string; message: string; correlationId: string } }).error;

  /**
   * Wraps pool.connect so a transaction client's query fails for statements
   * matching `fail`. Only the promise form is wrapped: pg's own Pool.query
   * calls connect(callback) internally and must reach the real one.
   */
  function failClientQuery(fail: (sql: string, params: unknown[] | undefined) => boolean): void {
    const realConnect = mods.db.connect.bind(mods.db) as (...args: unknown[]) => Promise<PoolClient>;
    vi.spyOn(mods.db, "connect").mockImplementation(((...connectArgs: unknown[]) => {
      if (connectArgs.length > 0) return realConnect(...connectArgs);
      return realConnect().then((client) => {
        const realQuery = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        const patched = (...args: unknown[]) => {
          const sql = typeof args[0] === "string" ? args[0] : "";
          const params = Array.isArray(args[1]) ? (args[1] as unknown[]) : undefined;
          if (fail(sql, params)) {
            return Promise.reject(Object.assign(new Error(`insert or update violates ${SQL_TEXT_CANARY}`), { code: "23505" }));
          }
          return realQuery(...args);
        };
        // A pooled client is reused: undo the patch when this one is released.
        const realRelease = client.release.bind(client) as (err?: Error | boolean) => void;
        (client as unknown as { query: unknown }).query = patched;
        (client as unknown as { release: unknown }).release = (err?: Error | boolean) => {
          (client as unknown as { query: unknown }).query = realQuery;
          (client as unknown as { release: unknown }).release = realRelease;
          realRelease(err);
        };
        return client;
      });
    }) as never);
  }

  /** The advisory lock the route takes is free once the request is over (a new connection can take it). */
  async function topicLockIsFree(teamId: string): Promise<boolean> {
    const probe = await mods.db.connect();
    try {
      await probe.query("BEGIN");
      const { rows } = await probe.query<{ ok: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtext($1::uuid::text)) AS ok`, [teamId]);
      return rows[0]!.ok;
    } finally {
      await probe.query("ROLLBACK").catch(() => undefined);
      probe.release();
    }
  }

  // -------------------------------------------------------------------------
  // Unrelated faults: the generic 500, rollback, lock released
  // -------------------------------------------------------------------------
  it("a forced topic-insert error: 500 ASSIGN_DEFAULTS_FAILED, rolled back, lock released, no database text", async () => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    const admin = await fx.user("application_admin");
    const logged = await as(admin);
    failClientQuery((sql) => /INSERT INTO topics/.test(sql));

    const res = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

    expect(res.statusCode).toBe(500);
    expect(errorOf(res)).toMatchObject({ category: "internal_error", code: "ASSIGN_DEFAULTS_FAILED" });
    expect(res.body).not.toContain(SQL_TEXT_CANARY);
    expect(res.body).not.toContain("23505");
    expect(await teamTopicRows(mods, teamId)).toHaveLength(0);
    expect(await auditRows(mods, { teamId, operation: "topic.defaults_assigned" })).toHaveLength(0);
    expect(await auditRows(mods, { teamId, operation: "topic.defaults_assign_failed" })).toHaveLength(0);
    expect(await topicLockIsFree(teamId)).toBe(true);
    // The error is logged server-side with the response's correlation id.
    const errorLog = logged.lines.find((l) => l.level === 50 && l["correlationId"] === errorOf(res).correlationId);
    expect(errorLog).toBeDefined();
  });

  it("a failed success-path audit insert rolls the topics back and answers the same generic 500", async () => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    const admin = await fx.user("application_admin");
    const logged = await as(admin);
    failClientQuery((sql, params) => /INSERT INTO audit_log/.test(sql) && params?.[3] === "topic.defaults_assigned");

    const res = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

    expect(res.statusCode).toBe(500);
    expect(errorOf(res).code).toBe("ASSIGN_DEFAULTS_FAILED");
    expect(res.body).not.toContain(SQL_TEXT_CANARY);
    expect(await teamTopicRows(mods, teamId)).toHaveLength(0);
    expect(await topicLockIsFree(teamId)).toBe(true);
    expect(logged.events("topic.defaults_assigned")).toHaveLength(0);
  });

  it("a 409 releases the lock too", async () => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    await fx.topic(teamId, { displayOrder: 1 });
    const admin = await fx.user("application_admin");

    const res = await (await as(admin)).app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

    expect(res.statusCode).toBe(409);
    expect(await topicLockIsFree(teamId)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Empty template (AC 4)
  // -------------------------------------------------------------------------
  describe("an empty template", () => {
    async function emptyTheTemplate(): Promise<void> {
      snap = await snapshotTemplate(mods.db);
      await mods.db.query(
        `UPDATE topics SET status = 'archived', archived_at = now()
          WHERE team_id = $1 AND is_default = true AND status = 'active'`,
        [SENTINEL_TEAM_ID],
      );
    }

    it("500 DEFAULT_TOPICS_UNAVAILABLE with the settled sentence; nothing persisted; template id only in the server log; one failure row", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx, { archived: 1 });
      const admin = await fx.user("application_admin");
      const logged = await as(admin);
      await emptyTheTemplate();

      const res = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

      expect(res.statusCode).toBe(500);
      const error = errorOf(res);
      expect(error).toMatchObject({ category: "internal_error", code: "DEFAULT_TOPICS_UNAVAILABLE" });
      expect(error.message).toBe(
        'The default topic template is empty or unavailable, so nothing was assigned. An operator needs to fix the default topic template (see "Zero-topic teams" in the deployment runbook, docs/deployment.md), then try again.',
      );
      expect(error.correlationId).toBeTruthy();
      expect(res.body).not.toContain(SENTINEL_TEAM_ID);

      // Rolled back: the team still has only its archived row, no success row.
      expect((await teamTopicRows(mods, teamId)).map((r) => r.status)).toEqual(["archived"]);
      expect(await auditRows(mods, { teamId, operation: "topic.defaults_assigned" })).toHaveLength(0);
      expect(await topicLockIsFree(teamId)).toBe(true);

      // The error-level log names the template id and the correlation id.
      const errorLog = logged.lines.find((l) => l.level === 50 && l["templateTeamId"] === SENTINEL_TEAM_ID);
      expect(errorLog).toBeDefined();
      expect(errorLog!["correlationId"]).toBe(error.correlationId);

      // One fail-open failure row, written after the rollback, no template id or text.
      const rows = await auditRows(mods, { teamId, operation: "topic.defaults_assign_failed" });
      expect(rows).toEqual([
        {
          operation: "topic.defaults_assign_failed",
          actor_user_id: admin,
          actor_global_role: "application_admin",
          actor_ip: "127.0.0.1",
          team_id: teamId,
          actor_roles: ["application_admin"],
          metadata: {
            endpoint: ASSIGN_ENDPOINT,
            http_status: 500,
            reason: "DEFAULT_TOPICS_UNAVAILABLE",
            correlation_id: error.correlationId,
          },
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain(SENTINEL_TEAM_ID);
      expect(logged.events("topic.defaults_assign_failed")).toHaveLength(1);
      expect(logged.events("topic.audit_write_failed")).toHaveLength(0);
    });

    it("a failed failure-row insert leaves the 500 and emits only the log-only topic.audit_write_failed", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await fx.user("application_admin");
      const logged = await as(admin);
      await emptyTheTemplate();
      const realQuery = mods.db.query.bind(mods.db) as (...args: unknown[]) => Promise<unknown>;
      vi.spyOn(mods.db, "query").mockImplementation(((...args: unknown[]) => {
        const params = args[1] as unknown[] | undefined;
        if (typeof args[0] === "string" && /INSERT INTO audit_log/.test(args[0]) && params?.[3] === "topic.defaults_assign_failed") {
          return Promise.reject(Object.assign(new Error(SQL_TEXT_CANARY), { code: "XX000" }));
        }
        return realQuery(...args);
      }) as never);

      const res = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

      expect(res.statusCode).toBe(500);
      expect(errorOf(res).code).toBe("DEFAULT_TOPICS_UNAVAILABLE");
      expect(await auditRows(mods, { teamId, operation: "topic.defaults_assign_failed" })).toHaveLength(0);
      const failed = logged.events("topic.audit_write_failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        operation: "topic.defaults_assign_failed",
        endpoint: ASSIGN_ENDPOINT,
        reason: "DEFAULT_TOPICS_UNAVAILABLE",
        stage: "audit_insert",
        errorCode: "XX000",
      });
      expect(JSON.stringify(failed[0])).not.toContain(SQL_TEXT_CANARY);
    });

    it("the template is not modified by the failed attempt", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await fx.user("application_admin");
      await emptyTheTemplate();
      const emptied = await snapshotTemplate(mods.db);

      await (await as(admin)).app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

      await assertTemplateUnchanged(mods.db, emptied);
    });
  });

  // -------------------------------------------------------------------------
  // Denial audit failures and the Redis outage (3.3 "limiter interaction")
  // -------------------------------------------------------------------------
  it("a failed denial insert leaves the 403 and emits only the log-only topic.audit_write_failed", async () => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    const caller = await fx.user("facilitator");
    const logged = await as(caller);
    const realQuery = mods.db.query.bind(mods.db) as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(mods.db, "query").mockImplementation(((...args: unknown[]) => {
      const params = args[1] as unknown[] | undefined;
      if (typeof args[0] === "string" && /INSERT INTO audit_log/.test(args[0]) && params?.[3] === "topic.defaults_assign_denied") {
        return Promise.reject(Object.assign(new Error(SQL_TEXT_CANARY), { code: "XX000" }));
      }
      return realQuery(...args);
    }) as never);

    const res = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe("NOT_AN_ADMIN");
    expect(await auditRows(mods, { actorUserId: caller, operation: "topic.defaults_assign_denied" })).toHaveLength(0);
    const failed = logged.events("topic.audit_write_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ operation: "topic.defaults_assign_denied", reason: "NOT_AN_ADMIN", errorCode: "XX000" });
    expect(JSON.stringify(failed[0])).not.toContain(SQL_TEXT_CANARY);
  });

  it("Redis down: an admin gets the topic-write limiter's fail-closed 503; a non-admin still gets 403 with no row and a limiter_error suppression event", async () => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    const admin = await fx.user("application_admin");
    const caller = await fx.user("facilitator");
    const adminApp = await as(admin);
    const callerApp = await as(caller);
    vi.spyOn(mods.redis, "eval").mockImplementation((() => Promise.reject(new Error("ECONNREFUSED"))) as never);

    const adminRes = await adminApp.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });
    const callerRes = await callerApp.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

    expect(adminRes.statusCode).toBe(503);
    expect(errorOf(adminRes)).toMatchObject({ category: "service_unavailable", code: "TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE" });
    expect(await teamTopicRows(mods, teamId)).toHaveLength(0);
    expect(callerRes.statusCode).toBe(403);
    expect(errorOf(callerRes).code).toBe("NOT_AN_ADMIN");
    // A denial during an outage leaves no audit row (documented in the runbook).
    expect(await auditRows(mods, { actorUserId: caller, operation: "topic.defaults_assign_denied" })).toHaveLength(0);
    const suppressed = callerApp.events("topic.denial_audit_suppressed");
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]).toMatchObject({ actorUserId: caller, endpoint: ASSIGN_ENDPOINT, reason: "limiter_error" });
    expect(callerApp.events("topic.defaults_assign_denied")).toHaveLength(0);
  });

  it("an engineering manager caller (a different non-admin class) and a ghost caller both honour the same bound per actor", async () => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    const em = await fx.user("engineering_manager");
    const ghost = randomUUID();
    const emApp = await as(em);
    const ghostApp = await as(ghost);

    for (let i = 0; i < 11; i += 1) await emApp.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });
    await ghostApp.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

    // The bound is per actor: the EM's 11th is suppressed, the ghost's first is not.
    expect(await auditRows(mods, { actorUserId: em, operation: "topic.defaults_assign_denied" })).toHaveLength(10);
    expect(await auditRows(mods, { actorUserId: ghost, operation: "topic.defaults_assign_denied" })).toHaveLength(1);
    await resetDenialAuditBudget(mods, ghost);
    await mods.db.query(`DELETE FROM audit_log WHERE actor_user_id = $1`, [ghost]);
  });
});
