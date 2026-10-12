import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, Fixture } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import type { GlobalRole } from "../../auth/role-map.js";
import baseline403 from "./fixtures/topic-002-403-baseline.json";

// ---------------------------------------------------------------------------
// 264-topic-002-audit-non-admin-denials (#264) task 3.1 -- real Postgres
// evidence for TOPIC-002's non-admin denial audit (topic.config_list_denied).
//
// MANDATORY and not substitutable by unit tests (Security A1): the insert is
// an INSERT ... SELECT whose parameters only resolve to the UUID / INET /
// JSONB column types because each one carries an explicit cast. A mocked
// db.query cannot see that. Because the path is fail-open, a missing cast
// would show up only as no row plus a topic.audit_write_failed event while
// the 403 kept working, so every case here asserts the row AND that no
// topic.audit_write_failed event was logged.
//
// The app logs to an in-memory stream so the events can be read back. Do NOT
// add vi.mock for db.js / config.js here.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-002-denial-audit-integration.test.ts");

const OP = "topic.config_list_denied";
const ENDPOINT = "GET /api/v1/teams/:teamId/topics/all";

interface DenialRow {
  operation: string;
  actor_user_id: string;
  actor_global_role: string;
  actor_ip: string;
  team_id: string;
  actor_roles: string[] | null;
  metadata: Record<string, unknown>;
}

describe.skipIf(!infraUp)("TOPIC-002 non-admin denial audit (real Postgres, #264)", () => {
  let mods: Mods;
  let fx: Fixture;
  let lines: Array<Record<string, unknown>>;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    await fx?.cleanup();
  });

  /** TOPIC-002 only, authenticated as userId, logging to memory so audit events can be read. */
  async function appFor(userId: string) {
    lines = [];
    const app = Fastify({
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
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    app.register(mods.contentRoutes);
    await app.ready();
    apps.push(app);
    return app;
  }

  async function getAll(userId: string, teamId: string) {
    return (await appFor(userId)).inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
  }

  async function denialRows(actorUserId: string): Promise<DenialRow[]> {
    return (
      await mods.db.query<DenialRow>(
        `SELECT operation, actor_user_id, actor_global_role, host(actor_ip) AS actor_ip, team_id,
                actor_roles::text[] AS actor_roles, metadata
           FROM audit_log
          WHERE actor_user_id = $1 AND operation = $2`,
        [actorUserId, OP],
      )
    ).rows;
  }

  function eventsNamed(name: string) {
    return lines.filter((l) => l["event"] === name);
  }

  function expect403(res: { statusCode: number; body: string; headers: Record<string, unknown> }, reason: "NOT_A_FACILITATOR" | "FACILITATOR_IS_TEAM_MEMBER") {
    const snap = baseline403[reason];
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toBe(snap.contentType);
    const id = (JSON.parse(res.body) as { error: { correlationId: string } }).error.correlationId;
    expect(res.body.replace(id, baseline403.correlationIdPlaceholder)).toBe(snap.body);
  }

  async function seed() {
    fx = new Fixture(mods.db);
    const owner = await fx.user(["facilitator"]);
    const teamId = await fx.team(owner);
    return { teamId };
  }

  async function user(roles: readonly GlobalRole[]) {
    return fx.user(roles);
  }

  it("a participant (global engineer, participant membership): NOT_A_FACILITATOR, every column", async () => {
    const { teamId } = await seed();
    const caller = await user(["engineer"]);
    await fx.member(teamId, caller, "participant");

    const res = await getAll(caller, teamId);

    expect403(res, "NOT_A_FACILITATOR");
    expect(await denialRows(caller)).toEqual([
      {
        operation: OP,
        actor_user_id: caller,
        actor_global_role: "engineer",
        actor_ip: "127.0.0.1",
        team_id: teamId,
        actor_roles: ["engineer"],
        metadata: { endpoint: ENDPOINT, http_status: 403, reason: "NOT_A_FACILITATOR" },
      },
    ]);
    expect(eventsNamed("topic.audit_write_failed")).toHaveLength(0);
    const denial = eventsNamed(OP);
    expect(denial).toHaveLength(1);
    expect(denial[0]).toMatchObject({ rowWritten: true, actorRoles: ["engineer"], reason: "NOT_A_FACILITATOR" });
  });

  it("a global engineering manager with a participant membership: NOT_A_FACILITATOR, multi-element actor_roles in stored order", async () => {
    const { teamId } = await seed();
    // users_roles_consistent requires strictly descending enum rank, which
    // for these labels is also alphabetical order; a reversed or re-sorted
    // copy is still caught by the toEqual below.
    const roles: readonly GlobalRole[] = ["engineering_manager", "facilitator", "senior_engineer"];
    const caller = await user(roles);
    await fx.member(teamId, caller, "participant");

    const res = await getAll(caller, teamId);

    expect403(res, "NOT_A_FACILITATOR");
    const rows = await denialRows(caller);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      operation: OP,
      actor_user_id: caller,
      actor_global_role: "engineering_manager",
      actor_ip: "127.0.0.1",
      team_id: teamId,
      actor_roles: [...roles],
      metadata: { endpoint: ENDPOINT, http_status: 403, reason: "NOT_A_FACILITATOR" },
    });
    // The stored array in the audit row is the users.roles array, in the same order.
    const stored = await mods.db.query<{ roles: string[] }>(`SELECT roles::text[] AS roles FROM users WHERE id = $1`, [caller]);
    expect(rows[0]!.actor_roles).toEqual(stored.rows[0]!.roles);
    expect(eventsNamed("topic.audit_write_failed")).toHaveLength(0);
  });

  it("a member facilitator: FACILITATOR_IS_TEAM_MEMBER, every column", async () => {
    const { teamId } = await seed();
    const caller = await user(["facilitator", "senior_engineer"]);
    await fx.member(teamId, caller, "participant");

    const res = await getAll(caller, teamId);

    expect403(res, "FACILITATOR_IS_TEAM_MEMBER");
    expect(await denialRows(caller)).toEqual([
      {
        operation: OP,
        actor_user_id: caller,
        actor_global_role: "facilitator",
        actor_ip: "127.0.0.1",
        team_id: teamId,
        actor_roles: ["facilitator", "senior_engineer"],
        metadata: { endpoint: ENDPOINT, http_status: 403, reason: "FACILITATOR_IS_TEAM_MEMBER" },
      },
    ]);
    expect(eventsNamed("topic.audit_write_failed")).toHaveLength(0);
  });

  it("a random valid team id: 403 and a row with that team_id, no failure event", async () => {
    seedOnly();
    const caller = await user(["engineer"]);
    const missingTeamId = randomUUID();

    const res = await getAll(caller, missingTeamId);

    expect403(res, "NOT_A_FACILITATOR");
    const rows = await denialRows(caller);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.team_id).toBe(missingTeamId);
    expect(eventsNamed("topic.audit_write_failed")).toHaveLength(0);
  });

  // #263: authorization precedes the team lookup, so a participant cannot tell
  // an existing team from a non-existent one by the 403 body (code included).
  it("A participant gets the same code for an existing and a non-existent team", async () => {
    const { teamId } = await seed();
    const caller = await user(["engineer"]);
    await fx.member(teamId, caller, "participant");

    const normalise = (r: { body: string }) => {
      const id = (JSON.parse(r.body) as { error: { correlationId: string } }).error.correlationId;
      return r.body.replace(id, baseline403.correlationIdPlaceholder);
    };
    const existing = await getAll(caller, teamId);
    const missing = await getAll(caller, randomUUID());

    expect403(existing, "NOT_A_FACILITATOR");
    expect403(missing, "NOT_A_FACILITATOR");
    expect(normalise(missing)).toBe(normalise(existing));
    expect((missing.json() as { error: { code: string } }).error.code).toBe("NOT_A_FACILITATOR");
  });

  it("a deactivated team: 403 and a row with that team_id, no failure event", async () => {
    const { teamId } = await seed();
    await mods.db.query(`UPDATE teams SET deactivated_at = NOW() WHERE id = $1`, [teamId]);
    const caller = await user(["engineer"]);

    const res = await getAll(caller, teamId);

    expect403(res, "NOT_A_FACILITATOR");
    const rows = await denialRows(caller);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.team_id).toBe(teamId);
    expect(eventsNamed("topic.audit_write_failed")).toHaveLength(0);
  });

  // 0.3 finding: the auth middleware never reads `users`, so a deleted users
  // row with a live session reaches TOPIC-002; this is reachable end to end.
  it("a live session whose users row was deleted: 403 NOT_A_FACILITATOR, row with 'unknown' and NULL actor_roles, no failure event", async () => {
    const { teamId } = await seed();
    const caller = await user(["engineer"]);
    await mods.db.query(`DELETE FROM users WHERE id = $1`, [caller]);

    const res = await getAll(caller, teamId);

    expect403(res, "NOT_A_FACILITATOR");
    expect(await denialRows(caller)).toEqual([
      {
        operation: OP,
        actor_user_id: caller,
        actor_global_role: "unknown",
        actor_ip: "127.0.0.1",
        team_id: teamId,
        actor_roles: null,
        metadata: { endpoint: ENDPOINT, http_status: 403, reason: "NOT_A_FACILITATOR" },
      },
    ]);
    expect(eventsNamed("topic.audit_write_failed")).toHaveLength(0);
    expect(eventsNamed(OP)[0]).toMatchObject({ rowWritten: true, actorRoles: null, actorGlobalRole: "unknown" });
  });

  it("the same caller denied twice writes two rows", async () => {
    const { teamId } = await seed();
    const caller = await user(["engineer"]);
    const app = await appFor(caller);
    await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    expect(await denialRows(caller)).toHaveLength(2);
  });

  it("an admitted non-member facilitator writes no denial row", async () => {
    const { teamId } = await seed();
    const caller = await user(["facilitator"]);
    const res = await getAll(caller, teamId);
    expect(res.statusCode).toBe(200);
    expect(await denialRows(caller)).toHaveLength(0);
  });

  /** For the cases that need a Fixture but no team. */
  function seedOnly() {
    fx = new Fixture(mods.db);
  }
});
