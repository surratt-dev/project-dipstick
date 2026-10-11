import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildApp,
  Fixture,
  activeTopicIdsInOrder,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import type { GlobalRole } from "../../auth/role-map.js";

// ---------------------------------------------------------------------------
// 208-member-admin-topic-writes (#208) tasks.md 1.2 — real-Postgres matrix
// for the topic writes (TOPIC-003 add, -004 archive, -005 restore, -006
// reorder) by an application_admin with no membership, a participant
// membership, or an engineering_manager membership on the team.
//
// #208 decision (product owner): an administrator is admitted to every
// topic write whatever their membership on the team, in any role. Each
// case asserts the status, the persisted outcome (response AND database),
// and exactly one in-transaction topic.* row for THIS request (filtered by
// actor, team and operation), attributed to application_admin. These rows
// are the permanent audit record of admin topic writes (#208 decision) —
// do not weaken these assertions.
//
// House pattern: describe.skipIf(!infraUp); requireInfraOrThrow() throws
// when infra is down and REQUIRE_DB is set.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-write-member-admin-integration.test.ts");

type MembershipCase = "none" | "participant" | "engineering_manager";

const MEMBERSHIPS: ReadonlyArray<{ membership: MembershipCase; roles: readonly GlobalRole[] }> = [
  { membership: "none", roles: ["application_admin"] },
  { membership: "participant", roles: ["application_admin"] },
  { membership: "engineering_manager", roles: ["application_admin", "engineering_manager"] },
];

const WRITES = ["add", "archive", "restore", "reorder"] as const;
type Write = (typeof WRITES)[number];

const OPERATION: Record<Write, string> = {
  add: "topic.custom_added",
  archive: "topic.archived",
  restore: "topic.restored",
  reorder: "topic.reordered",
};

const MATRIX = WRITES.flatMap((write) => MEMBERSHIPS.map((m) => ({ write, ...m })));

describe.skipIf(!infraUp)("Topic writes by a member administrator (real Postgres, #208)", () => {
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

  async function auditRows(actorUserId: string, teamId: string, operation: string) {
    return (
      await mods.db.query<{ actor_user_id: string; actor_global_role: string; team_id: string }>(
        `SELECT actor_user_id, actor_global_role, team_id FROM audit_log
          WHERE actor_user_id = $1 AND team_id = $2 AND operation = $3`,
        [actorUserId, teamId, operation],
      )
    ).rows;
  }

  async function topicStatus(topicId: string): Promise<string> {
    return (await mods.db.query<{ status: string }>(`SELECT status FROM topics WHERE id = $1`, [topicId])).rows[0]!
      .status;
  }

  it.each(MATRIX)(
    "$write by an admin with membership $membership: admitted, persisted, exactly one $write audit row",
    async ({ write, membership, roles }) => {
      fx = new Fixture(mods.db);
      const fac = await fx.user(["facilitator"]);
      const teamId = await fx.team(fac);
      await fx.unlock(teamId, fac);
      const t1 = await fx.topic(teamId, { displayOrder: 1, name: "One" });
      const t2 = await fx.topic(teamId, { displayOrder: 2, name: "Two" });
      const t3 = await fx.topic(teamId, { displayOrder: 3, name: "Three" });
      const archived = await fx.topic(teamId, { displayOrder: 4, name: "Archived", status: "archived" });
      const admin = await fx.user(roles);
      if (membership !== "none") await fx.member(teamId, admin, membership);
      const app = await appFor(admin);

      switch (write) {
        case "add": {
          const res = await app.inject({
            method: "POST",
            url: `/api/v1/teams/${teamId}/topics`,
            payload: { name: "Admin Topic", prompt: "Added by an admin?", voteType: "finger" },
          });
          expect(res.statusCode).toBe(201);
          const topicId = res.json().topicId as string;
          // Appended at the end of the team's display order (n + 1).
          expect(res.json().displayOrder).toBe(4);
          const row = await mods.db.query<{ display_order: number; status: string }>(
            `SELECT display_order, status FROM topics WHERE id = $1`,
            [topicId],
          );
          expect(row.rows[0]).toEqual({ display_order: 4, status: "active" });
          expect(await activeTopicIdsInOrder(mods.db, teamId)).toEqual([t1, t2, t3, topicId]);
          break;
        }
        case "archive": {
          const res = await app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${t2}` });
          expect(res.statusCode).toBe(200);
          expect(res.json()).toMatchObject({ topicId: t2, status: "archived" });
          expect(await topicStatus(t2)).toBe("archived");
          break;
        }
        case "restore": {
          const res = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${archived}/restore` });
          expect(res.statusCode).toBe(200);
          expect(res.json()).toMatchObject({ topicId: archived, status: "active" });
          expect(await topicStatus(archived)).toBe("active");
          break;
        }
        case "reorder": {
          const orderedTopicIds = [t3, t1, t2];
          const res = await app.inject({
            method: "PUT",
            url: `/api/v1/teams/${teamId}/topics/order`,
            payload: { orderedTopicIds },
          });
          expect(res.statusCode).toBe(200);
          expect((res.json().topics as Array<{ topicId: string }>).map((t) => t.topicId)).toEqual(orderedTopicIds);
          expect(await activeTopicIdsInOrder(mods.db, teamId)).toEqual(orderedTopicIds);
          break;
        }
      }

      const rows = await auditRows(admin, teamId, OPERATION[write]);
      expect(rows).toEqual([{ actor_user_id: admin, actor_global_role: "application_admin", team_id: teamId }]);
    },
  );
});
