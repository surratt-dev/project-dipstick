import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { probeInfra, requireInfraOrThrow, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import { useMaintenanceTemplate } from "./helpers/maintenance-test-hygiene.js";
import { auditRows } from "./helpers/assign-defaults.js";

// ---------------------------------------------------------------------------
// #311 tasks.md 3.3, 3.4, 4.2 to 4.6 -- real Postgres. A team's default is
// linked to its template default by topics.template_topic_id (copy path), and
// TOPIC-002 defaultTopicsNotActive matches by that link, never by name.
//
// The tests assert what the copy DOES (rows in `topics`), not only what the
// read shows. There is no team-level rename endpoint, so "the team renames its
// copy" is a direct UPDATE of the team's own row. The template rename goes
// through the real admin maintenance route. Holds the template lock per test and
// restores the template afterwards (useMaintenanceTemplate).
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-topic-link-integration.test.ts");

const ADMIN_BASE = "/api/v1/admin/default-topics";

interface TeamTopic {
  id: string;
  name: string;
  status: string;
  is_default: boolean;
  template_topic_id: string | null;
}
type Listed = Array<{ topicId: string; name: string; isArchived: boolean }>;

describe.skipIf(!infraUp)("template_topic_id: copy path and link-based defaultTopicsNotActive (real Postgres, #311)", () => {
  const h = useMaintenanceTemplate();
  let admin: string;
  let tpl: Array<{ id: string; name: string }>;

  beforeAll(async () => {
    admin = await h.fx.user("application_admin");
  });

  const db = () => h.mods.db;

  async function loadTemplate() {
    tpl = (
      await db().query<{ id: string; name: string }>(
        `SELECT id, name FROM topics WHERE team_id = $1 AND is_default = true AND status = 'active' ORDER BY display_order, id`,
        [SENTINEL_TEAM_ID],
      )
    ).rows;
    expect(tpl.length).toBeGreaterThanOrEqual(3);
  }

  async function rows(teamId: string): Promise<TeamTopic[]> {
    return (
      await db().query<TeamTopic>(
        `SELECT id, name, status, is_default, template_topic_id FROM topics WHERE team_id = $1 ORDER BY display_order, id`,
        [teamId],
      )
    ).rows;
  }

  async function createTeam(creator: string): Promise<{ teamId: string; body: unknown }> {
    const app = await h.appFor(creator);
    const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: `Link Team ${randomUUID()}` } });
    expect(res.statusCode).toBe(201);
    const teamId = res.json().teamId as string;
    h.fx.track(teamId);
    return { teamId, body: res.json() };
  }

  async function read(teamId: string): Promise<{ listed: Listed; raw: string }> {
    const app = await h.appFor(admin);
    const res = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    expect(res.statusCode).toBe(200);
    return { listed: res.json().defaultTopicsNotActive as Listed, raw: res.body };
  }

  async function emptyTeam(): Promise<{ teamId: string; owner: string }> {
    const owner = await h.fx.user("facilitator");
    return { teamId: await h.fx.team(owner), owner };
  }

  async function renameTemplate(id: string, name: string) {
    const app = await h.appFor(admin);
    const res = await app.inject({ method: "PATCH", url: `${ADMIN_BASE}/${id}`, payload: { name } });
    expect(res.statusCode).toBe(200);
    return res;
  }

  // -------------------------------------------------------------------------
  // 3.3 Copy path
  // -------------------------------------------------------------------------
  describe("the copy sets the link", () => {
    it("team creation links every copied default to the template row it came from, and nothing else", async () => {
      await loadTemplate();
      const owner = await h.fx.user("facilitator");
      const { teamId } = await createTeam(owner);

      const team = await rows(teamId);
      expect(team).toHaveLength(tpl.length);
      for (const row of team) {
        const source = tpl.find((t) => t.id === row.template_topic_id);
        expect(source, `row ${row.name} must link to a template default`).toBeDefined();
        expect(source!.name).toBe(row.name);
        expect(row.is_default).toBe(true);
      }
      expect(new Set(team.map((r) => r.template_topic_id))).toEqual(new Set(tpl.map((t) => t.id)));
    });

    it("two teams created from one template link independently to the same template ids", async () => {
      await loadTemplate();
      const owner = await h.fx.user("facilitator");
      const a = await createTeam(owner);
      const b = await createTeam(owner);

      const [rowsA, rowsB] = [await rows(a.teamId), await rows(b.teamId)];
      expect(new Set(rowsA.map((r) => r.template_topic_id))).toEqual(new Set(rowsB.map((r) => r.template_topic_id)));
      expect(rowsA.map((r) => r.id).filter((id) => rowsB.some((r) => r.id === id))).toEqual([]);
      // Changing team A's copy leaves B's untouched.
      await db().query(`UPDATE topics SET name = 'A only' WHERE id = $1`, [rowsA[0]!.id]);
      expect(await rows(b.teamId)).toEqual(rowsB);
    });

    it("assign-defaults on a zero-topic team links every inserted row to its source template row", async () => {
      await loadTemplate();
      const { teamId } = await emptyTeam();
      const app = await h.appFor(admin);

      const res = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/assign-defaults` });

      expect(res.statusCode).toBe(201);
      const team = await rows(teamId);
      expect(team).toHaveLength(tpl.length);
      for (const row of team) expect(tpl.find((t) => t.id === row.template_topic_id)?.name).toBe(row.name);
    });

    it("assign-defaults on a team whose topics are all archived and linked: 200-class, fresh linked rows, archive untouched, counts equal rows inserted", async () => {
      await loadTemplate();
      const { teamId } = await emptyTeam();
      const archivedA = await h.fx.topic(teamId, { displayOrder: 1, status: "archived", name: "Our own Pulse", templateTopicId: tpl[0]!.id });
      const archivedB = await h.fx.topic(teamId, { displayOrder: 2, status: "archived", name: "Our own Two", templateTopicId: tpl[1]!.id });
      const app = await h.appFor(admin);

      const res = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/assign-defaults` });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ topicCount: tpl.length });
      const team = await rows(teamId);
      // Archived rows stay archived with their own text and link.
      expect(team.find((r) => r.id === archivedA)).toMatchObject({ status: "archived", name: "Our own Pulse", template_topic_id: tpl[0]!.id });
      expect(team.find((r) => r.id === archivedB)).toMatchObject({ status: "archived", name: "Our own Two", template_topic_id: tpl[1]!.id });
      // Fresh linked active rows carry only canonical template text.
      const active = team.filter((r) => r.status === "active");
      expect(active).toHaveLength(tpl.length);
      expect(active.map((r) => r.name).sort()).toEqual(tpl.map((t) => t.name).sort());
      expect(new Set(active.map((r) => r.template_topic_id))).toEqual(new Set(tpl.map((t) => t.id)));
      const audit = await auditRows(h.mods, { teamId, operation: "topic.defaults_assigned" });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toMatchObject({ topic_count: tpl.length });
      // The team holds an archived and an active row for the first default; the active one wins.
      expect((await read(teamId)).listed).toEqual([]);
    });

    it("a custom topic added through the API leaves the link NULL, even with a default's name", async () => {
      await loadTemplate();
      const { teamId, owner } = await emptyTeam();
      await h.fx.unlock(teamId, owner);
      const app = await h.appFor(admin);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/topics`,
        payload: { name: tpl[0]!.name, prompt: "A custom prompt?", voteType: "finger" },
      });

      expect(res.statusCode).toBe(201);
      const team = await rows(teamId);
      expect(team).toHaveLength(1);
      expect(team[0]).toMatchObject({ is_default: false, template_topic_id: null });
    });
  });

  // -------------------------------------------------------------------------
  // 3.4 and 4.2 Rename and archive keep the link; the read is by link
  // -------------------------------------------------------------------------
  describe("a template rename is invisible to a team that holds the default", () => {
    it("rename, team rename, archive and restore keep the link and the same row id; the read does not change", async () => {
      await loadTemplate();
      const owner = await h.fx.user("facilitator");
      const { teamId } = await createTeam(owner);
      await h.fx.unlock(teamId, owner);
      const mine = (await rows(teamId))[0]!;
      const app = await h.appFor(admin);
      const before = await read(teamId);
      expect(before.listed).toEqual([]);

      // The team renames its copy (direct update: no team-level rename endpoint exists).
      await db().query(`UPDATE topics SET name = 'Our pulse' WHERE id = $1`, [mine.id]);
      // The administrator renames the template default.
      await renameTemplate(mine.template_topic_id!, "Heartbeat");
      expect(await rows(teamId).then((r) => r.find((x) => x.id === mine.id))).toMatchObject({
        name: "Our pulse",
        template_topic_id: mine.template_topic_id,
      });
      expect((await read(teamId)).listed).toEqual([]);

      // The team archives it: offered under the team's own name and row id, not the template's new name.
      const archive = await app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${mine.id}` });
      expect(archive.statusCode).toBe(200);
      expect((await read(teamId)).listed).toEqual([{ topicId: mine.id, name: "Our pulse", isArchived: true }]);

      // Restore reactivates the same row, link unchanged.
      const restore = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${mine.id}/restore` });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().topicId).toBe(mine.id);
      expect((await rows(teamId)).find((x) => x.id === mine.id)).toMatchObject({
        status: "active",
        name: "Our pulse",
        template_topic_id: mine.template_topic_id,
      });
      expect((await read(teamId)).listed).toEqual([]);
    });

    it("a template rename touches no team: no topic row, link, session snapshot or team audit row differs", async () => {
      await loadTemplate();
      const owner = await h.fx.user("facilitator");
      const { teamId } = await createTeam(owner);
      await h.fx.unlock(teamId, owner);
      const snapshot = async () => ({
        topics: (await db().query(`SELECT * FROM topics WHERE team_id = $1 ORDER BY id`, [teamId])).rows,
        snapshots: (
          await db().query(
            `SELECT st.* FROM session_topics st JOIN sessions s ON s.id = st.session_id WHERE s.team_id = $1 ORDER BY st.id`,
            [teamId],
          )
        ).rows,
        audit: (await db().query(`SELECT id, operation, metadata FROM audit_log WHERE team_id = $1 ORDER BY id`, [teamId])).rows,
      });
      const before = await snapshot();

      await renameTemplate(tpl[0]!.id, "Renamed for no team");

      expect(await snapshot()).toEqual(before);
    });

    it("an archived linked default is offered under the team's name even after the template renamed it", async () => {
      await loadTemplate();
      const { teamId } = await emptyTeam();
      const archived = await h.fx.topic(teamId, { displayOrder: 1, status: "archived", name: "Pulse", templateTopicId: tpl[0]!.id });
      await renameTemplate(tpl[0]!.id, "Heartbeat");

      const { listed } = await read(teamId);

      expect(listed.find((d) => d.topicId === archived)).toEqual({ topicId: archived, name: "Pulse", isArchived: true });
      // Every other default is unlinked here, so offered under its template id and name.
      expect(listed).toHaveLength(tpl.length);
      expect(listed.find((d) => d.topicId === tpl[0]!.id)).toBeUndefined();
    });

    it("a team holding an archived and an active linked row for one default does not see it listed", async () => {
      await loadTemplate();
      const { teamId } = await emptyTeam();
      await h.fx.topic(teamId, { displayOrder: 1, status: "archived", name: "Pulse old", templateTopicId: tpl[0]!.id });
      await h.fx.topic(teamId, { displayOrder: 2, name: "Pulse new", templateTopicId: tpl[0]!.id });

      const { listed } = await read(teamId);

      expect(listed).toHaveLength(tpl.length - 1);
      expect(listed.map((d) => d.name)).not.toContain("Pulse old");
      expect(listed.map((d) => d.name)).not.toContain(tpl[0]!.name);
    });

    it("an archived template default is omitted", async () => {
      await loadTemplate();
      const { teamId } = await emptyTeam();
      await db().query(`UPDATE topics SET status = 'archived', archived_at = now(), display_order = -display_order - 5000 WHERE id = $1`, [tpl[0]!.id]);

      const { listed } = await read(teamId);

      expect(listed).toHaveLength(tpl.length - 1);
      expect(listed.map((d) => d.name)).not.toContain(tpl[0]!.name);
    });

    it("another team's differently named linked row does not affect the read", async () => {
      await loadTemplate();
      const a = await emptyTeam();
      const b = await emptyTeam();
      const baseline = (await read(a.teamId)).listed;
      await h.fx.topic(b.teamId, { displayOrder: 1, status: "archived", name: "Team B's wording", templateTopicId: tpl[0]!.id });
      await h.fx.topic(b.teamId, { displayOrder: 2, name: "Team B active", templateTopicId: tpl[1]!.id });

      expect((await read(a.teamId)).listed).toEqual(baseline);
    });
  });

  // -------------------------------------------------------------------------
  // 4.3 Suppression by active name
  // -------------------------------------------------------------------------
  describe("an active same-name topic suppresses the offer", () => {
    it("an archived custom topic with a default's name, or an active custom topic with a different name, hides nothing", async () => {
      await loadTemplate();
      const { teamId } = await emptyTeam();
      await h.fx.topic(teamId, { displayOrder: 1, status: "archived", name: tpl[0]!.name });
      await h.fx.topic(teamId, { displayOrder: 2, name: "Something unrelated" });

      const { listed } = await read(teamId);

      expect(listed.map((d) => d.name)).toEqual(tpl.map((t) => t.name));
      expect(listed.every((d) => d.isArchived === false)).toBe(true);
    });

    it("a custom same-name topic no longer hides a default by spelling alone once it is archived; an ACTIVE one does (with case and spacing)", async () => {
      await loadTemplate();
      const { teamId } = await emptyTeam();
      const custom = await h.fx.topic(teamId, { displayOrder: 1, name: `  ${tpl[0]!.name.toUpperCase()} ` });

      expect((await read(teamId)).listed.map((d) => d.name)).toEqual(tpl.slice(1).map((t) => t.name));

      await db().query(`UPDATE topics SET status = 'archived', archived_at = now() WHERE id = $1`, [custom]);
      expect((await read(teamId)).listed.map((d) => d.name)).toEqual(tpl.map((t) => t.name));
    });

    it("an active default linked to a DIFFERENT template default suppresses an entry with its name; restoring the surfaced duplicate is 409 TOPIC_NAME_ACTIVE", async () => {
      await loadTemplate();
      const { teamId, owner } = await emptyTeam();
      await h.fx.unlock(teamId, owner);
      // Active row named like tpl[0], but linked to tpl[1].
      await h.fx.topic(teamId, { displayOrder: 1, name: tpl[0]!.name, templateTopicId: tpl[1]!.id });
      // An archived row linked to tpl[0] under the SAME name is also suppressed (restore would be rejected).
      const archived = await h.fx.topic(teamId, { displayOrder: 2, status: "archived", name: tpl[0]!.name, templateTopicId: tpl[0]!.id });

      const { listed } = await read(teamId);
      expect(listed.map((d) => d.topicId)).not.toContain(archived);
      expect(listed.map((d) => d.name)).not.toContain(tpl[0]!.name);

      const app = await h.appFor(admin);
      const restore = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${archived}/restore` });
      expect(restore.statusCode).toBe(409);
      expect(restore.json().error.code).toBe("TOPIC_NAME_ACTIVE");
      expect((await rows(teamId)).find((r) => r.id === archived)?.status).toBe("archived");
    });
  });

  // -------------------------------------------------------------------------
  // 4.4 Unlinked legacy default
  // -------------------------------------------------------------------------
  describe("an unlinked legacy default", () => {
    it("lists every active default the team lacks, with template id and name; TOPIC-005 on that id is the existing 404 and writes nothing", async () => {
      await loadTemplate();
      const { teamId, owner } = await emptyTeam();
      await h.fx.unlock(teamId, owner);
      // is_default, NULL link, a name that matches no template default.
      await h.fx.topic(teamId, { displayOrder: 1, name: "Legacy name of a default", isDefault: true });

      const { listed } = await read(teamId);

      expect(listed).toEqual(tpl.map((t) => ({ topicId: t.id, name: t.name, isArchived: false })));
      const before = await rows(teamId);
      const app = await h.appFor(admin);
      const res = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${tpl[0]!.id}/restore` });
      expect(res.statusCode).toBe(404);
      expect(await rows(teamId)).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // 4.5 Shared definition of the canonical default set
  // -------------------------------------------------------------------------
  describe("the copy and the restore list share one definition", () => {
    it("copied names equal the restore list for an empty team; for a team holding some defaults the list is the set difference", async () => {
      await loadTemplate();
      const empty = await emptyTeam();
      expect((await read(empty.teamId)).listed.map((d) => d.name)).toEqual(tpl.map((t) => t.name));

      const owner = await h.fx.user("facilitator");
      const created = await createTeam(owner);
      expect((await rows(created.teamId)).map((r) => r.name).sort()).toEqual(tpl.map((t) => t.name).sort());

      // A team holding the first two defaults by link: the list is the rest.
      const partial = await emptyTeam();
      await h.fx.topic(partial.teamId, { displayOrder: 1, name: "Own one", templateTopicId: tpl[0]!.id });
      await h.fx.topic(partial.teamId, { displayOrder: 2, name: "Own two", templateTopicId: tpl[1]!.id });
      expect((await read(partial.teamId)).listed.map((d) => d.topicId)).toEqual(tpl.slice(2).map((t) => t.id));
    });

    it("an archived default in the template is in neither the copy nor the list", async () => {
      await loadTemplate();
      await db().query(`UPDATE topics SET status = 'archived', archived_at = now(), display_order = -display_order - 5000 WHERE id = $1`, [tpl[0]!.id]);
      const owner = await h.fx.user("facilitator");
      const created = await createTeam(owner);
      const copied = (await rows(created.teamId)).map((r) => r.name).sort();
      const empty = await emptyTeam();
      expect((await read(empty.teamId)).listed.map((d) => d.name).sort()).toEqual(copied);
      expect(copied).not.toContain(tpl[0]!.name);
    });
  });

  // -------------------------------------------------------------------------
  // 4.6 The link never leaves the database
  // -------------------------------------------------------------------------
  describe("templateTopicId appears in no API response", () => {
    it("TOPIC-002, add, archive, restore, assign-defaults and the maintenance endpoints never carry the link", async () => {
      await loadTemplate();
      const { teamId, owner } = await emptyTeam();
      await h.fx.unlock(teamId, owner);
      const app = await h.appFor(admin);
      const bodies: string[] = [];
      const call = async (method: "GET" | "POST" | "DELETE" | "PATCH", url: string, payload?: Record<string, unknown>) => {
        const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
        bodies.push(res.body);
        return res;
      };

      // Include a linked row in every shape the readers return.
      const linked = await h.fx.topic(teamId, { displayOrder: 1, name: "Linked one", templateTopicId: tpl[0]!.id });
      await call("GET", `/api/v1/teams/${teamId}/topics/all`);
      await call("POST", `/api/v1/teams/${teamId}/topics`, { name: "Plain custom", prompt: "Prompt?", voteType: "finger" });
      await call("DELETE", `/api/v1/teams/${teamId}/topics/${linked}`);
      await call("GET", `/api/v1/teams/${teamId}/topics/all`);
      await call("POST", `/api/v1/teams/${teamId}/topics/${linked}/restore`);
      await call("GET", ADMIN_BASE);
      await call("GET", `${ADMIN_BASE}/history`);
      await call("PATCH", `${ADMIN_BASE}/${tpl[1]!.id}`, { name: "Renamed template two" });
      const zero = await emptyTeam();
      await call("POST", `/api/v1/teams/${zero.teamId}/topics/assign-defaults`);

      expect(bodies.length).toBeGreaterThan(8);
      for (const body of bodies) expect(body).not.toMatch(/template_?topic_?id/i);
    });
  });
});
