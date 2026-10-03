import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildFullApp,
  Fixture,
  SENTINEL_TEAM_ID,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { snapshotTemplate, assertTemplateUnchanged, restoreTemplate } from "./helpers/template-snapshot.js";

// ---------------------------------------------------------------------------
// Team-creation regression — reject-template-team-topic-writes (#188),
// design.md D5, tasks.md 4.4 (BA S6, engineer M1).
//
// With a completed sentinel session in place (so the lock cannot mask a
// regression), VALID writes -- ones that would succeed on an unlocked team --
// are sent to TOPIC-003..007 against the template. Each must be 404
// TEAM_NOT_FOUND, the template's own rows (every status) must be unchanged
// (this is what catches an add regression: a TOPIC-003 row has
// is_default = false, so the copy below would never carry it), and a team
// created afterwards must receive exactly the snapshot's default rows.
//
// In its own file so a regression fails only this test. Never
// fx.track(SENTINEL_TEAM_ID); the sentinel session is removed by id.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-team-creation-regression-integration.test.ts");

describe.skipIf(!infraUp)("team creation copies the pre-attempt template baseline (#188 tasks.md 4.4)", () => {
  let mods: Mods;
  let fx: Fixture;
  let app: FastifyInstance;
  let facilitatorId: string;

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
    facilitatorId = await fx.user("facilitator");
    app = await buildFullApp(mods, facilitatorId);
  });

  afterAll(async () => {
    await app?.close();
    await fx?.cleanup();
    await mods?.redis.quit();
  });

  it("valid writes to TOPIC-003..007 on an unlocked template are 404 and leave the template and the next team's copy unchanged", async () => {
    const { db } = mods;
    const sessionId = randomUUID();
    await db.query(
      `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at)
       VALUES ($1, $2, $3, 'complete', false, 1, NOW())`,
      [sessionId, SENTINEL_TEAM_ID, facilitatorId],
    );
    const snap = await snapshotTemplate(db);
    try {
      const active = [...snap.values()]
        .filter((row) => row.status === "active")
        .sort((a, b) => a.display_order - b.display_order);
      expect(active.length).toBeGreaterThan(1);
      const archived = [...snap.values()].find((row) => row.status === "archived");
      const base = `/api/v1/teams/${SENTINEL_TEAM_ID}/topics`;

      const writes = [
        { method: "POST", url: base, payload: { name: "Regression Add", prompt: "Added to the template?", voteType: "finger" } },
        { method: "DELETE", url: `${base}/${active[0]!.id}?confirm=true` },
        // No archived template row normally exists; an active id still
        // exercises the route (a regression would answer 422, not 404).
        { method: "POST", url: `${base}/${(archived ?? active[0]!).id}/restore`, payload: {} },
        { method: "PUT", url: `${base}/order`, payload: { orderedTopicIds: active.map((row) => row.id).reverse() } },
        { method: "PUT", url: `${base}/${active[0]!.id}/annotation`, payload: { annotation: "Regression definition" } },
      ] as const;

      for (const write of writes) {
        const res = await app.inject(write);
        expect(res.statusCode, `${write.method} ${write.url}`).toBe(404);
        expect(res.json().error.code, `${write.method} ${write.url}`).toBe("TEAM_NOT_FOUND");
      }

      await assertTemplateUnchanged(db, snap);

      const created = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        payload: { name: `Template Regression ${randomUUID().slice(-6)}` },
      });
      expect(created.statusCode).toBe(201);
      const newTeamId = created.json().teamId as string;
      fx.track(newTeamId);

      const copied = (
        await db.query<{ name: string; prompt: string; vote_type: string; display_order: number; is_default: boolean }>(
          `SELECT name, prompt, vote_type, display_order, is_default FROM topics WHERE team_id = $1`,
          [newTeamId],
        )
      ).rows;
      const expected = [...snap.values()]
        .filter((row) => row.is_default)
        .map(({ name, prompt, vote_type, display_order, is_default }) => ({ name, prompt, vote_type, display_order, is_default }));
      const byOrder = (a: { display_order: number; name: string }, b: { display_order: number; name: string }) =>
        a.display_order - b.display_order || a.name.localeCompare(b.name);
      expect(copied.sort(byOrder)).toEqual(expected.sort(byOrder));
    } finally {
      await restoreTemplate(db, snap);
      await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    }
  });
});
