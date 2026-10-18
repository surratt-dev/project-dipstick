import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import type pg from "pg";
import { probeInfra, requireInfraOrThrow, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import { buildLoggedFullApp, setTemplatePositions, useMaintenanceTemplate, type LogLine } from "./helpers/maintenance-test-hygiene.js";
import { withDroppedActiveOrderIndex } from "./helpers/template-lock.js";
import { copyCanonicalDefaults } from "../../sessions/default-topics.js";

// ---------------------------------------------------------------------------
// admin-default-topic-maintenance (#216) tasks.md 2.4: one named test per
// `default-topic-provisioning` delta scenario, seeded by direct SQL under the
// maintenance test hygiene (template lock, full restore). They protect the
// issue's "a team copied from the template can always be created" line without
// needing the writer: the template is put into each shape by hand.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "default-topic-provisioning-delta-integration.test.ts");

describe.skipIf(!infraUp)("default-topic-provisioning delta scenarios (#216 2.4)", () => {
  const h = useMaintenanceTemplate();
  let facilitator: string;
  beforeAll(async () => {
    facilitator = await h.fx.user("facilitator");
  });
  const db = () => h.mods.db;

  async function createTeam() {
    const app = await h.appFor(facilitator);
    const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: `Delta ${randomUUID()}` } });
    if (res.statusCode === 201) h.fx.track(res.json().teamId as string);
    return res;
  }
  async function teamTopics(teamId: string) {
    return (
      await db().query<{ name: string; display_order: number; status: string }>(
        `SELECT name, display_order, status FROM topics WHERE team_id = $1 ORDER BY display_order`,
        [teamId],
      )
    ).rows;
  }
  async function activeTemplate() {
    return (
      await db().query<{ id: string; name: string }>(
        `SELECT id, name FROM topics WHERE team_id = $1 AND is_default AND status = 'active' ORDER BY display_order, id`,
        [SENTINEL_TEAM_ID],
      )
    ).rows;
  }
  async function archiveRows(ids: string[]) {
    await db().query(`UPDATE topics SET status = 'archived', archived_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
  }
  async function insertTemplate(name: string, order: number, status: "active" | "archived") {
    await db().query(
      `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, status, is_default, first_session_description)
       VALUES ($1, $2, $3, 'finger', $4, $5::topic_status, true, 'About.')`,
      [SENTINEL_TEAM_ID, name, `Prompt ${name}?`, order, status],
    );
  }

  it("gaps in template positions do not reach the new team (positions 1..n, in the template's order)", async () => {
    const rows = await activeTemplate();
    const keep = rows.slice(0, 3);
    await archiveRows(rows.slice(3).map((r) => r.id));
    await setTemplatePositions(db(), [[keep[0]!.id, 1], [keep[1]!.id, 3], [keep[2]!.id, 7]]);
    const res = await createTeam();
    expect(res.statusCode).toBe(201);
    const topics = await teamTopics(res.json().teamId);
    expect(topics.map((t) => [t.name, t.display_order])).toEqual(keep.map((r, i) => [r.name, i + 1]));
  });

  it("an archived and an active template default at one position do not fail creation", async () => {
    const rows = await activeTemplate();
    await insertTemplate("Archived At One", 1, "archived"); // outside the partial unique index
    const res = await createTeam();
    expect(res.statusCode).toBe(201);
    const topics = await teamTopics(res.json().teamId);
    expect(topics).toHaveLength(rows.length);
    expect(topics.filter((t) => t.display_order === 1)).toHaveLength(1);
    expect(topics[0]!.name).toBe(rows[0]!.name);
    expect(topics.map((t) => t.name)).not.toContain("Archived At One");
  });

  it("duplicate active template positions do not fail creation (copy-function level, index dropped inside a rolled-back transaction)", async () => {
    const scratch = await h.fx.team(facilitator);
    const target = await h.fx.team(facilitator);
    await withDroppedActiveOrderIndex(async (client: pg.PoolClient) => {
      const idLow = "00000000-0000-0000-0000-0000000000b1";
      const idHigh = "00000000-0000-0000-0000-0000000000b2";
      for (const [id, name] of [[idHigh, "Dup Two"], [idLow, "Dup One"]] as const) {
        await client.query(
          `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, is_default)
           VALUES ($1, $2, $3, 'p?', 'finger', 1, true)`,
          [id, scratch, name],
        );
      }
      await copyCanonicalDefaults(client, target, scratch);
      const copied = (
        await client.query<{ name: string; display_order: number }>(
          `SELECT name, display_order FROM topics WHERE team_id = $1 ORDER BY display_order`,
          [target],
        )
      ).rows;
      expect(copied.map((c) => [c.name, c.display_order])).toEqual([["Dup One", 1], ["Dup Two", 2]]);
    });
  });

  it("a single active default is copied, at position 1", async () => {
    const rows = await activeTemplate();
    await archiveRows(rows.slice(1).map((r) => r.id));
    const res = await createTeam();
    expect(res.statusCode).toBe(201);
    const topics = await teamTopics(res.json().teamId);
    expect(topics.map((t) => [t.name, t.display_order])).toEqual([[rows[0]!.name, 1]]);
  });

  it("an active and an archived default of one name copy only the active one, once", async () => {
    const rows = await activeTemplate();
    await insertTemplate(rows[0]!.name, 40, "archived");
    const res = await createTeam();
    expect(res.statusCode).toBe(201);
    const topics = await teamTopics(res.json().teamId);
    expect(topics.filter((t) => t.name === rows[0]!.name)).toHaveLength(1);
    expect(topics).toHaveLength(rows.length);
  });

  it("an archived default alone raises no template_anomaly and is not copied", async () => {
    const rows = await activeTemplate();
    await archiveRows([rows[11]!.id]);
    const lines: LogLine[] = [];
    const app = await buildLoggedFullApp(h.mods, facilitator, lines);
    try {
      const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: `Delta ${randomUUID()}` } });
      expect(res.statusCode).toBe(201);
      h.fx.track(res.json().teamId as string);
      expect(lines.filter((l) => l.msg === "template_anomaly")).toHaveLength(0);
      expect((await teamTopics(res.json().teamId)).map((t) => t.name)).not.toContain(rows[11]!.name);
    } finally {
      await app.close();
    }
  });
});
