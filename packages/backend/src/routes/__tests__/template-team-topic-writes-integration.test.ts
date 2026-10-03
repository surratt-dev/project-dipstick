import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance, HTTPMethods, LightMyRequestResponse } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, buildApp, Fixture, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import type { Mods, Db } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// reject-template-team-topic-writes (#188) — real-Postgres coverage,
// design.md D5, tasks.md 4.1-4.3.
//
// Every request body here is HARMLESS: it would fail a later check even if
// the template guard were missing (TOPIC-003 an empty name -> 422; 004/005/
// 007 a random topicId -> topic 404; 006 a mismatched id set -> 409 STALE).
// A guard regression therefore shows up as a wrong status code, and the
// shared template is never mutated, so this file takes no snapshot.
//
// Never fx.track(SENTINEL_TEAM_ID): Fixture.cleanup() would delete the
// template's topics, sessions and team row. Sentinel sessions and sentinel
// membership rows are inserted and deleted by id in each test's own
// try/finally. Every audit assertion is scoped by a per-row fixture actor and
// the database clock, because other files write template-denial rows too.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-team-topic-writes-integration.test.ts");

interface EndpointCase {
  label: string;
  method: HTTPMethods;
  endpoint: string;
  attemptedOperation: string;
  admitsAdmin: boolean;
  url: (teamId: string) => string;
  harmlessBody: () => object | undefined;
}

const ENDPOINTS: EndpointCase[] = [
  {
    label: "TOPIC-003",
    method: "POST",
    endpoint: "POST /api/v1/teams/:teamId/topics",
    attemptedOperation: "topic.custom_added",
    admitsAdmin: true,
    url: (t) => `/api/v1/teams/${t}/topics`,
    harmlessBody: () => ({ name: "", prompt: "Harmless?", voteType: "finger" }),
  },
  {
    label: "TOPIC-004",
    method: "DELETE",
    endpoint: "DELETE /api/v1/teams/:teamId/topics/:topicId",
    attemptedOperation: "topic.archived",
    admitsAdmin: true,
    url: (t) => `/api/v1/teams/${t}/topics/${randomUUID()}?confirm=true`,
    harmlessBody: () => undefined,
  },
  {
    label: "TOPIC-005",
    method: "POST",
    endpoint: "POST /api/v1/teams/:teamId/topics/:topicId/restore",
    attemptedOperation: "topic.restored",
    admitsAdmin: true,
    url: (t) => `/api/v1/teams/${t}/topics/${randomUUID()}/restore`,
    harmlessBody: () => ({}),
  },
  {
    label: "TOPIC-006",
    method: "PUT",
    endpoint: "PUT /api/v1/teams/:teamId/topics/order",
    attemptedOperation: "topic.reordered",
    admitsAdmin: true,
    url: (t) => `/api/v1/teams/${t}/topics/order`,
    harmlessBody: () => ({ orderedTopicIds: [randomUUID()] }),
  },
  {
    label: "TOPIC-007",
    method: "PUT",
    endpoint: "PUT /api/v1/teams/:teamId/topics/:topicId/annotation",
    attemptedOperation: "topic.annotation_updated",
    admitsAdmin: false,
    url: (t) => `/api/v1/teams/${t}/topics/${randomUUID()}/annotation`,
    harmlessBody: () => ({ annotation: "Harmless" }),
  },
];

const SUCCESS_OPERATIONS = ENDPOINTS.map((e) => e.attemptedOperation);

async function dbNow(db: Db): Promise<Date> {
  return (await db.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;
}

interface AuditRow {
  operation: string;
  team_id: string | null;
  actor_global_role: string | null;
  actor_ip: string | null;
  metadata: Record<string, unknown>;
}

async function auditRowsSince(db: Db, actorUserId: string, since: Date): Promise<AuditRow[]> {
  return (
    await db.query<AuditRow>(
      `SELECT operation, team_id, actor_global_role, actor_ip, metadata FROM audit_log
        WHERE actor_user_id = $1 AND "timestamp" >= $2 ORDER BY "timestamp", id`,
      [actorUserId, since],
    )
  ).rows;
}

async function templateDenialCount(db: Db, actorUserId: string, since: Date, endpoint: string): Promise<number> {
  return (
    await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE operation = 'topic.write_denied_template'
          AND actor_user_id = $1 AND "timestamp" >= $2 AND metadata->>'endpoint' = $3`,
      [actorUserId, since, endpoint],
    )
  ).rows[0]!.n;
}

function send(app: FastifyInstance, ep: EndpointCase, teamId: string): Promise<LightMyRequestResponse> {
  const body = ep.harmlessBody();
  return app.inject({ method: ep.method, url: ep.url(teamId), ...(body === undefined ? {} : { payload: body }) });
}

function comparable(res: LightMyRequestResponse) {
  const headers: Record<string, unknown> = { ...res.headers };
  delete headers["date"];
  const parsed = res.json() as { error: Record<string, unknown> };
  const error = { ...parsed.error };
  delete error["correlationId"];
  return { status: res.statusCode, headers, body: { ...parsed, error } };
}

async function insertSentinelSession(db: Db, facilitatorId: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at)
     VALUES ($1, $2, $3, 'complete', false, 1, NOW())`,
    [id, SENTINEL_TEAM_ID, facilitatorId],
  );
  return id;
}

async function insertSentinelMembership(db: Db, userId: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO team_memberships (team_id, user_id) VALUES ($1, $2) RETURNING id`,
      [SENTINEL_TEAM_ID, userId],
    )
  ).rows[0]!.id;
}

describe.skipIf(!infraUp)("template team rejects team-scoped topic writes — real Postgres (#188)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    await fx.cleanup();
  });

  afterAll(async () => {
    await mods?.redis.quit();
  });

  async function appFor(userId: string): Promise<FastifyInstance> {
    const app = await buildApp(mods, userId);
    apps.push(app);
    return app;
  }

  // -------------------------------------------------------------------------
  // 4.1 — one table: endpoints x {locked, unlocked} x {facilitator, admin}
  // -------------------------------------------------------------------------
  const rows = ENDPOINTS.flatMap((ep) =>
    (["locked", "unlocked"] as const).flatMap((lock) =>
      (ep.admitsAdmin ? (["facilitator", "application_admin"] as const) : (["facilitator"] as const)).map(
        (role) => ({ ep, lock, role }),
      ),
    ),
  );

  it.each(rows.map((r) => [`${r.ep.label} ${r.lock} ${r.role}`, r] as const))(
    "4.1 %s: same response as a nonexistent team, exactly one template-denial row",
    async (_label, { ep, lock, role }) => {
      const { db } = mods;
      const actor = await fx.user(role);
      const app = await appFor(actor);
      // "locked" = this row inserts no completed sentinel session. Another
      // file may unlock the template meanwhile; the guard makes that moot.
      const sessionId = lock === "unlocked" ? await insertSentinelSession(db, actor) : undefined;
      try {
        const since = await dbNow(db);
        const template = await send(app, ep, SENTINEL_TEAM_ID);
        const missing = await send(app, ep, randomUUID());

        expect(template.statusCode).toBe(404);
        expect(template.json().error.code).toBe("TEAM_NOT_FOUND");
        expect(comparable(template)).toEqual(comparable(missing));

        expect(await templateDenialCount(db, actor, since, ep.endpoint)).toBe(1);
        // Every audit row this actor produced: the template denial only -- no
        // lock-denial row, no success row, nothing for the missing team.
        const audit = await auditRowsSince(db, actor, since);
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
          operation: "topic.write_denied_template",
          team_id: SENTINEL_TEAM_ID,
          actor_global_role: role,
        });
        expect(audit[0]!.actor_ip).not.toBeNull();
        expect(audit[0]!.metadata).toEqual({ endpoint: ep.endpoint, attempted_operation: ep.attemptedOperation });
        expect(SUCCESS_OPERATIONS).not.toContain(audit[0]!.operation);
      } finally {
        if (sessionId) await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      }
    },
  );

  // -------------------------------------------------------------------------
  // 4.2 — 403s, sentinel memberships, and a real team
  // -------------------------------------------------------------------------
  it.each(ENDPOINTS.map((ep) => [ep.label, ep] as const))(
    "4.2 %s: an engineer gets 403 NOT_A_FACILITATOR on the template, with no template-denial row",
    async (_label, ep) => {
      const { db } = mods;
      const engineer = await fx.user("engineer");
      const since = await dbNow(db);

      const res = await send(await appFor(engineer), ep, SENTINEL_TEAM_ID);

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
      expect(await templateDenialCount(db, engineer, since, ep.endpoint)).toBe(0);
    },
  );

  it("4.2 TOPIC-007: an application admin gets 403 on the template, with no template-denial row (FR-8.7)", async () => {
    const { db } = mods;
    const admin = await fx.user("application_admin");
    const ep = ENDPOINTS[4]!;
    const since = await dbNow(db);

    const res = await send(await appFor(admin), ep, SENTINEL_TEAM_ID);

    expect(res.statusCode).toBe(403);
    expect(await templateDenialCount(db, admin, since, ep.endpoint)).toBe(0);
  });

  it("4.2: with another user's sentinel membership, a facilitator still gets 404 on every endpoint", async () => {
    const { db } = mods;
    const other = await fx.user("engineer");
    const facilitator = await fx.user("facilitator");
    const app = await appFor(facilitator);
    const membershipId = await insertSentinelMembership(db, other);
    try {
      for (const ep of ENDPOINTS) {
        const since = await dbNow(db);
        const res = await send(app, ep, SENTINEL_TEAM_ID);
        expect(res.statusCode, ep.label).toBe(404);
        expect(res.json().error.code, ep.label).toBe("TEAM_NOT_FOUND");
        expect(await templateDenialCount(db, facilitator, since, ep.endpoint), ep.label).toBe(1);
      }
    } finally {
      await db.query(`DELETE FROM team_memberships WHERE id = $1`, [membershipId]);
    }
  });

  it("4.2: a facilitator holding a sentinel membership gets 403 FACILITATOR_IS_TEAM_MEMBER and no template-denial row; an admin member gets 404 on 003-006", async () => {
    const { db } = mods;
    const facilitator = await fx.user("facilitator");
    const admin = await fx.user("application_admin");
    const facApp = await appFor(facilitator);
    const adminApp = await appFor(admin);
    const membershipIds = [await insertSentinelMembership(db, facilitator), await insertSentinelMembership(db, admin)];
    try {
      for (const ep of ENDPOINTS) {
        const since = await dbNow(db);
        const res = await send(facApp, ep, SENTINEL_TEAM_ID);
        expect(res.statusCode, ep.label).toBe(403);
        expect(res.json().error.code, ep.label).toBe("FACILITATOR_IS_TEAM_MEMBER");
        expect(await templateDenialCount(db, facilitator, since, ep.endpoint), ep.label).toBe(0);
      }
      for (const ep of ENDPOINTS.filter((e) => e.admitsAdmin)) {
        const res = await send(adminApp, ep, SENTINEL_TEAM_ID);
        expect(res.statusCode, ep.label).toBe(404);
        expect(res.json().error.code, ep.label).toBe("TEAM_NOT_FOUND");
      }
    } finally {
      await db.query(`DELETE FROM team_memberships WHERE id = ANY($1::uuid[])`, [membershipIds]);
    }
  });

  it("4.2: on an unlocked real team, a default topic archives and restores (200/200) with topic.archived and topic.restored rows", async () => {
    const { db } = mods;
    const creator = await fx.user("facilitator");
    const facilitator = await fx.user("facilitator");
    const teamId = await fx.team(creator);
    await fx.unlock(teamId, creator);
    await fx.topic(teamId, { displayOrder: 1 });
    const defaultTopicId = await fx.topic(teamId, { displayOrder: 2 });
    await db.query(`UPDATE topics SET is_default = true WHERE id = $1`, [defaultTopicId]);
    const app = await appFor(facilitator);
    const since = await dbNow(db);

    const archived = await app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${defaultTopicId}` });
    expect(archived.statusCode).toBe(200);
    const restored = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${defaultTopicId}/restore` });
    expect(restored.statusCode).toBe(200);

    const audit = await auditRowsSince(db, facilitator, since);
    expect(audit.map((row) => row.operation)).toEqual(["topic.archived", "topic.restored"]);
  });

  // -------------------------------------------------------------------------
  // 4.3 — reads of the template are unaffected
  // -------------------------------------------------------------------------
  it("4.3: TOPIC-001 (a member) reads the template's active rows in order; /topics/all is 200 with canAddTopics and a lock flag that follows the lock", async () => {
    const { db } = mods;
    const member = await fx.user("engineer");
    const facilitator = await fx.user("facilitator");
    const membershipId = await insertSentinelMembership(db, member);
    let sessionId: string | undefined;
    try {
      const list = await (await appFor(member)).inject({ method: "GET", url: `/api/v1/teams/${SENTINEL_TEAM_ID}/topics` });
      expect(list.statusCode).toBe(200);
      const expected = (
        await db.query<{ id: string }>(
          `SELECT id FROM topics WHERE team_id = $1 AND status = 'active' ORDER BY display_order`,
          [SENTINEL_TEAM_ID],
        )
      ).rows.map((row) => row.id);
      expect((list.json().topics as Array<{ id: string }>).map((t) => t.id)).toEqual(expected);

      const facApp = await appFor(facilitator);
      sessionId = await insertSentinelSession(db, facilitator);
      const all = await facApp.inject({ method: "GET", url: `/api/v1/teams/${SENTINEL_TEAM_ID}/topics/all` });
      expect(all.statusCode).toBe(200);
      expect(all.json()).toMatchObject({ canAddTopics: true, isCustomizationLocked: false });
    } finally {
      if (sessionId) await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      await db.query(`DELETE FROM team_memberships WHERE id = $1`, [membershipId]);
    }
  });
});
