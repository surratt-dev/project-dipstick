import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { probeInfra, requireInfraOrThrow, loadModules, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { snapshotTemplate, assertTemplateUnchanged, restoreTemplate } from "./helpers/template-snapshot.js";

// ---------------------------------------------------------------------------
// Self-test for the shared template snapshot helper — reject-template-team-
// topic-writes (#188) tasks.md 3.2. The structural route test and the
// team-creation regression both rely on restoreTemplate leaving the
// __default_topics__ template exactly as it found it.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-snapshot-integration.test.ts");

describe.skipIf(!infraUp)("template snapshot helper (#188 tasks.md 3.2)", () => {
  let mods: Mods;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterAll(async () => {
    await mods?.redis.quit();
  });

  // Runs entirely inside one transaction that is rolled back (architect
  // implementation review B1): the mutation is never committed, so the
  // structural and team-creation tests, which snapshot and restore the
  // template in parallel files, can never capture or write it back.
  it("restoreTemplate undoes an annotation change, a display_order change and an added custom row", async () => {
    const { db } = mods;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const snap = await snapshotTemplate(client);
      const target = [...snap.values()].find((row) => row.status === "active");
      expect(target).toBeDefined();

      await client.query(`UPDATE topics SET team_annotation = 'self-test', display_order = 987654 WHERE id = $1`, [
        target!.id,
      ]);
      await client.query(
        `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default)
         VALUES ($1, 'Snapshot self-test', 'Removed by restoreTemplate?', 'finger', 987655, false)`,
        [SENTINEL_TEAM_ID],
      );
      await expect(assertTemplateUnchanged(client, snap)).rejects.toThrow();

      await restoreTemplate(db, snap, client);
      await assertTemplateUnchanged(client, snap);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});
