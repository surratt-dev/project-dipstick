import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, buildApp, Fixture } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import type { GlobalRole } from "../../auth/role-map.js";

// ---------------------------------------------------------------------------
// 232-topic-002-admin-read-audit-no-manager (#232) tasks 5.1 / 5.2, as
// amended by 208-member-admin-topic-writes (#208) — real Postgres evidence
// for TOPIC-002's administrator arm:
//
//   - every application_admin is admitted whatever their membership on the
//     team (#208 reverses #232's no-manager rule): an admin with an active
//     engineering_manager membership gets 200 with the team's definitions,
//     and no admin.topic_config_denied row is written, and
//   - the durable, text-free admin.topic_config_accessed row, recording the
//     raw membership_role, with actor_roles read from users.roles via
//     roles::text[] (the only proof that the cast decodes to an array in
//     real Postgres).
//
// A separate file (not a describe in topic-annotation-integration) so the
// HARD-rule evidence is findable by name and a later edit to the annotation
// suite cannot weaken it. Do NOT add vi.mock for db.js / config.js here.
//
// Every user is created through Fixture.user([...roles]), which writes
// users.roles explicitly (never relying on migration 21's legacy-fill
// trigger, which follow-up F1 drops). Fixture.cleanup() also deletes
// audit_log rows by actor_user_id, so the nonexistent-team row is removed.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-002-admin-audit-integration.test.ts");

const ACTIVE_DEFINITION = "Topic002-active-definition-sentinel-4417";
const ARCHIVED_DEFINITION = "Topic002-archived-definition-sentinel-9903";
const ACTIVE_NAME = "Topic002 Active Zeta";
const ARCHIVED_NAME = "Topic002 Archived Omega";

interface AuditRow {
  operation: string;
  actor_user_id: string;
  actor_global_role: string;
  team_id: string;
  actor_roles: string[] | null;
  metadata: Record<string, unknown>;
}

describe.skipIf(!infraUp)("TOPIC-002 administrator audit (real Postgres, #232, #208)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    await fx?.cleanup();
  });

  async function appFor(userId: string) {
    const app = await buildApp(mods, userId);
    apps.push(app);
    return app;
  }

  /** A team with exactly one active and one archived topic, each carrying a distinct definition. */
  async function seedTeam() {
    fx = new Fixture(mods.db);
    const fac = await fx.user(["facilitator"]);
    const teamId = await fx.team(fac);
    await fx.unlock(teamId, fac);
    const activeId = await fx.topic(teamId, { displayOrder: 1, name: ACTIVE_NAME, annotation: ACTIVE_DEFINITION });
    const archivedId = await fx.topic(teamId, {
      displayOrder: 2,
      name: ARCHIVED_NAME,
      status: "archived",
      annotation: ARCHIVED_DEFINITION,
    });
    return { fac, teamId, activeId, archivedId };
  }

  /** Only for the removed_at case; every other seed uses Fixture.member (#208 tasks.md 1.1). */
  async function membership(teamId: string, userId: string, role: "participant" | "engineering_manager", removed = false) {
    await mods.db.query(
      `INSERT INTO team_memberships (team_id, user_id, role, removed_at) VALUES ($1, $2, $3::membership_role, $4)`,
      [teamId, userId, role, removed ? new Date() : null],
    );
  }

  async function user(roles: readonly GlobalRole[]) {
    return fx.user(roles);
  }

  async function adminRows(actorUserId: string): Promise<AuditRow[]> {
    return (
      await mods.db.query<AuditRow>(
        `SELECT operation, actor_user_id, actor_global_role, team_id, actor_roles::text[] AS actor_roles, metadata
           FROM audit_log
          WHERE actor_user_id = $1 AND operation LIKE 'admin.%'`,
        [actorUserId],
      )
    ).rows;
  }

  async function getAll(userId: string, teamId: string) {
    return (await appFor(userId)).inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
  }

  function expectNoTopicText(value: unknown) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    for (const s of [ACTIVE_DEFINITION, ARCHIVED_DEFINITION, ACTIVE_NAME, ARCHIVED_NAME]) {
      expect(text).not.toContain(s);
    }
  }

  // -------------------------------------------------------------------------
  // 5.1
  // -------------------------------------------------------------------------
  it("admin with an engineering_manager membership (#208): 200 with both definitions, read-only, one text-free access row recording engineering_manager, no denial row", async () => {
    const { teamId, activeId, archivedId } = await seedTeam();
    const admin = await user(["application_admin", "engineering_manager"]);
    await fx.member(teamId, admin, "engineering_manager");

    const res = await getAll(admin, teamId);

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body.canEditAnnotations).toBe(false);
    expect(body.canAddTopics).toBe(true);
    expect(body.active).toEqual([expect.objectContaining({ topicId: activeId, teamAnnotation: ACTIVE_DEFINITION })]);
    expect(body.archived).toEqual([
      expect.objectContaining({ topicId: archivedId, teamAnnotation: ARCHIVED_DEFINITION }),
    ]);

    const rows = await adminRows(admin);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      operation: "admin.topic_config_accessed",
      actor_user_id: admin,
      actor_global_role: "application_admin",
      team_id: teamId,
      actor_roles: ["application_admin", "engineering_manager"],
    });
    expect(row!.metadata).toMatchObject({
      http_status: 200,
      membership_role: "engineering_manager",
      actor_idp_roles_include_em: true,
      annotated_count: 2,
    });
    expectNoTopicText(row);
    expect(JSON.stringify(row!.metadata)).not.toMatch(new RegExp(`${activeId}|${archivedId}`));
    expect(rows.filter((r) => r.operation === "admin.topic_config_denied")).toHaveLength(0);
  });

  it("admin non-member, roles {application_admin}: 200 and one access row with exact counts and actor_roles", async () => {
    const { teamId } = await seedTeam();
    const admin = await user(["application_admin"]);

    const res = await getAll(admin, teamId);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.active).toHaveLength(1);
    expect(body.archived).toHaveLength(1);

    const rows = await adminRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operation: "admin.topic_config_accessed",
      actor_user_id: admin,
      actor_global_role: "application_admin",
      team_id: teamId,
      actor_roles: ["application_admin"],
    });
    expect(rows[0]!.metadata).toEqual({
      endpoint: "GET /api/v1/teams/:teamId/topics/all",
      http_status: 200,
      membership_role: null,
      actor_idp_roles_include_em: false,
      team_found: true,
      active_count: 1,
      archived_count: 1,
      annotated_count: 2,
    });
    expectNoTopicText(rows[0]!.metadata);
  });

  it("admin non-member, roles {application_admin,engineering_manager}: 200, actor_roles decodes to the array and the flag is true", async () => {
    const { teamId } = await seedTeam();
    const admin = await user(["application_admin", "engineering_manager"]);

    const res = await getAll(admin, teamId);

    expect(res.statusCode).toBe(200);
    const rows = await adminRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.operation).toBe("admin.topic_config_accessed");
    expect(rows[0]!.actor_roles).toEqual(["application_admin", "engineering_manager"]);
    expect(rows[0]!.metadata.actor_idp_roles_include_em).toBe(true);
    expect(rows[0]!.metadata.membership_role).toBeNull();
  });

  it("admin with a participant membership: 200 and the access row records membership_role participant", async () => {
    const { teamId } = await seedTeam();
    const admin = await user(["application_admin"]);
    await fx.member(teamId, admin, "participant");

    const res = await getAll(admin, teamId);

    expect(res.statusCode).toBe(200);
    const rows = await adminRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.operation).toBe("admin.topic_config_accessed");
    expect(rows[0]!.metadata.membership_role).toBe("participant");
  });

  it("global engineering manager with a participant membership: 403 and no admin.* row", async () => {
    const { teamId } = await seedTeam();
    const em = await user(["engineering_manager"]);
    await fx.member(teamId, em, "participant");

    const res = await getAll(em, teamId);

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe("Only a facilitator or an application admin can view this team's topic list.");
    expect(await adminRows(em)).toHaveLength(0);
  });

  it("non-member facilitator: 200 and no admin.* row", async () => {
    const { teamId } = await seedTeam();
    const fac = await user(["facilitator"]);

    const res = await getAll(fac, teamId);

    expect(res.statusCode).toBe(200);
    expect(res.json().canEditAnnotations).toBe(true);
    expect(await adminRows(fac)).toHaveLength(0);
  });

  // #208: a removed membership (removed_at set) is no membership, so the
  // access row records membership_role null. Regression pin for the raw
  // membership read (only active rows count).
  it("admin whose engineering_manager membership was removed: 200 and one access row with membership_role null", async () => {
    const { teamId } = await seedTeam();
    const admin = await user(["application_admin"]);
    await membership(teamId, admin, "engineering_manager", true);

    const res = await getAll(admin, teamId);

    expect(res.statusCode).toBe(200);
    const rows = await adminRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.operation).toBe("admin.topic_config_accessed");
    expect(rows[0]!.metadata.membership_role).toBeNull();
  });

  it("admin, canonical UUID that names no team: 200 unchanged, one access row with the requested team_id, zero counts and team_found false", async () => {
    fx = new Fixture(mods.db);
    const admin = await user(["application_admin"]);
    const missingTeamId = randomUUID();

    const res = await getAll(admin, missingTeamId);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ teamId: missingTeamId, teamName: "", active: [], archived: [] });
    const rows = await adminRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operation: "admin.topic_config_accessed", team_id: missingTeamId });
    expect(rows[0]!.metadata).toMatchObject({
      team_found: false,
      active_count: 0,
      archived_count: 0,
      annotated_count: 0,
    });
  });

  // -------------------------------------------------------------------------
  // 5.2 — TOPIC-004 regression: admin writes are unchanged by #232 and #208
  // (the full write matrix is topic-write-member-admin-integration.test.ts).
  // -------------------------------------------------------------------------
  it.each([
    ["participant", ["application_admin"]],
    ["engineering_manager", ["application_admin", "engineering_manager"]],
  ] as const)("TOPIC-004: an admin with a %s membership still archives a topic on an unlocked team (200 + topic.archived row)", async (role, roles) => {
    const { teamId, activeId } = await seedTeam();
    // A second active topic, so archiving one is not refused as the last.
    await fx.topic(teamId, { displayOrder: 3, name: "Topic002 Second Active" });
    const admin = await user(roles);
    await fx.member(teamId, admin, role);

    const res = await (await appFor(admin)).inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${activeId}` });

    expect(res.statusCode).toBe(200);
    const audit = await mods.db.query<{ actor_user_id: string; actor_global_role: string }>(
      `SELECT actor_user_id, actor_global_role FROM audit_log WHERE team_id = $1 AND operation = 'topic.archived'`,
      [teamId],
    );
    expect(audit.rows).toEqual([{ actor_user_id: admin, actor_global_role: "application_admin" }]);
  });
});
