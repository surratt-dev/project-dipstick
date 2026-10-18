import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, Fixture, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) tasks.md 2.2(e) -- real Postgres evidence
// for the NEW callers of the extracted fail-open audit helper
// (auth/fail-open-topic-audit.ts): recordDenial and recordFailure
// (auth/assign-defaults-audit.ts). TOPIC-002's caller of the same helper is
// proven by topic-002-denial-audit-integration.test.ts, which stays
// untouched.
//
// MANDATORY and not substitutable by unit tests: the insert is an
// INSERT ... SELECT whose parameters only resolve to the UUID / INET / JSONB
// column types because each carries an explicit cast, and the path is
// fail-open, so a missing cast would show up only as no row plus a
// topic.audit_write_failed event. Every case asserts the row AND that no
// topic.audit_write_failed event was logged (except the failure case, which
// asserts it was). Do NOT add vi.mock for db.js / config.js here.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "assign-defaults-audit-integration.test.ts");

interface Row {
  operation: string;
  actor_user_id: string;
  actor_global_role: string;
  actor_ip: string;
  team_id: string;
  actor_roles: string[] | null;
  metadata: Record<string, unknown>;
}

const ENDPOINT = "POST /api/v1/teams/:teamId/topics/assign-defaults";

describe.skipIf(!infraUp)("assign-defaults denial and failure audit rows (real Postgres, #200 2.2)", () => {
  let mods: Mods;
  let fx: Fixture;
  let lines: Array<Record<string, unknown>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    await app?.close();
    await fx?.cleanup();
  });

  afterAll(async () => {
    await mods?.redis.quit();
  });

  async function logger() {
    lines = [];
    app = Fastify({
      logger: {
        level: "info",
        stream: {
          write(chunk: string) {
            try {
              lines.push(JSON.parse(chunk) as Record<string, unknown>);
            } catch {
              /* not a JSON log line */
            }
          },
        },
      },
    });
    await app.ready();
    return app.log;
  }

  async function rows(actorUserId: string, operation: string): Promise<Row[]> {
    return (
      await mods.db.query<Row>(
        `SELECT operation, actor_user_id, actor_global_role, host(actor_ip) AS actor_ip, team_id,
                actor_roles::text[] AS actor_roles, metadata
           FROM audit_log WHERE actor_user_id = $1 AND operation = $2`,
        [actorUserId, operation],
      )
    ).rows;
  }

  const events = (name: string) => lines.filter((l) => l["event"] === name);

  it("recordDenial writes one row with every column and the stored role set", async () => {
    const { recordDenial } = await import("../../auth/assign-defaults-audit.js");
    fx = new Fixture(mods.db);
    const caller = await fx.user(["facilitator"]);
    const teamId = randomUUID(); // a nonexistent team: no foreign key, still recordable
    const correlationId = randomUUID();

    await recordDenial({
      log: await logger(),
      actorUserId: caller,
      actorGlobalRole: "facilitator",
      actorIp: "10.1.2.3",
      teamId,
      correlationId,
    });

    expect(await rows(caller, "topic.defaults_assign_denied")).toEqual([
      {
        operation: "topic.defaults_assign_denied",
        actor_user_id: caller,
        actor_global_role: "facilitator",
        actor_ip: "10.1.2.3",
        team_id: teamId,
        actor_roles: ["facilitator"],
        metadata: { endpoint: ENDPOINT, http_status: 403, reason: "NOT_AN_ADMIN", correlation_id: correlationId },
      },
    ]);
    expect(events("topic.audit_write_failed")).toHaveLength(0);
    expect(events("topic.defaults_assign_denied")).toHaveLength(1);
    await mods.db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
  });

  it("recordDenial for a caller with no users row: role 'unknown', actor_roles NULL", async () => {
    const { recordDenial } = await import("../../auth/assign-defaults-audit.js");
    fx = new Fixture(mods.db);
    const ghost = randomUUID();
    const teamId = randomUUID();

    await recordDenial({
      log: await logger(),
      actorUserId: ghost,
      actorGlobalRole: null,
      actorIp: "127.0.0.1",
      teamId,
      correlationId: randomUUID(),
    });

    const [row] = await rows(ghost, "topic.defaults_assign_denied");
    expect(row).toMatchObject({ actor_global_role: "unknown", actor_roles: null });
    expect(events("topic.audit_write_failed")).toHaveLength(0);
    await mods.db.query(`DELETE FROM audit_log WHERE actor_user_id = $1`, [ghost]);
  });

  it("recordFailure writes one row with the failure metadata and no template id", async () => {
    const { recordFailure } = await import("../../auth/assign-defaults-audit.js");
    fx = new Fixture(mods.db);
    const admin = await fx.user(["application_admin"]);
    const owner = await fx.user("facilitator");
    const teamId = await fx.team(owner);
    const correlationId = randomUUID();

    await recordFailure({
      log: await logger(),
      actorUserId: admin,
      actorGlobalRole: "application_admin",
      actorIp: "10.9.8.7",
      teamId,
      reason: "DEFAULT_TOPICS_UNAVAILABLE",
      correlationId,
    });

    const [row] = await rows(admin, "topic.defaults_assign_failed");
    expect(row).toEqual({
      operation: "topic.defaults_assign_failed",
      actor_user_id: admin,
      actor_global_role: "application_admin",
      actor_ip: "10.9.8.7",
      team_id: teamId,
      actor_roles: ["application_admin"],
      metadata: {
        endpoint: ENDPOINT,
        http_status: 500,
        reason: "DEFAULT_TOPICS_UNAVAILABLE",
        correlation_id: correlationId,
      },
    });
    expect(JSON.stringify(row?.metadata)).not.toContain(SENTINEL_TEAM_ID);
    expect(events("topic.audit_write_failed")).toHaveLength(0);
  });

  it("a failed insert is swallowed: no row, no throw, only the log-only topic.audit_write_failed", async () => {
    const { recordDenial } = await import("../../auth/assign-defaults-audit.js");
    fx = new Fixture(mods.db);
    const caller = await fx.user(["facilitator"]);

    // An unparseable address fails the ::inet cast inside the insert.
    await expect(
      recordDenial({
        log: await logger(),
        actorUserId: caller,
        actorGlobalRole: "facilitator",
        actorIp: "not-an-ip",
        teamId: randomUUID(),
        correlationId: randomUUID(),
      }),
    ).resolves.toBeUndefined();

    expect(await rows(caller, "topic.defaults_assign_denied")).toHaveLength(0);
    const failed = events("topic.audit_write_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      operation: "topic.defaults_assign_denied",
      endpoint: ENDPOINT,
      reason: "NOT_AN_ADMIN",
      stage: "audit_insert",
      failureMode: "error",
      errorCode: "22P02",
    });
    // The event still records the denial, with rowWritten false.
    expect(events("topic.defaults_assign_denied")[0]).toMatchObject({ rowWritten: false, actorRoles: null });
  });
});
