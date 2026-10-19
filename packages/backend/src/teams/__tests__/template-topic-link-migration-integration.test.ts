import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { probeInfra, requireInfraOrThrow } from "../../routes/__tests__/helpers/real-db.js";
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";
import type { db as Db } from "../../db.js";

// ---------------------------------------------------------------------------
// #311 tasks.md 2.0 to 2.4, real Postgres: migration 24 (topics.template_topic_id)
// against a scratch copy of `topics` in its own schema. As in
// template-team-migration-integration.test.ts the Up section is sliced out of
// the real file and run with search_path pointing at the scratch schema; the
// scratch table is a LIKE copy of public.topics with the column (and its CHECK)
// dropped, i.e. the pre-24 shape. No team or template row of public is touched.
//
// The runbook statements are read from test-fixtures/template-link-runbook.sql,
// the single source of truth that the migration embeds and docs/deployment.md
// copies; both are asserted verbatim below.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-topic-link-migration-integration.test.ts");

const BACKEND = new URL("../../../", import.meta.url);
const MIGRATION_24 = fileURLToPath(new URL("migrations/24_template_topic_id.sql", BACKEND));
const FIXTURE = fileURLToPath(new URL("test-fixtures/template-link-runbook.sql", BACKEND));
const DEPLOYMENT_DOC = fileURLToPath(new URL("../../docs/deployment.md", BACKEND));
const TEMPLATE = DEFAULT_TOPICS_TEAM_ID;

async function migrationSections(): Promise<{ whole: string; up: string; down: string }> {
  const whole = await readFile(MIGRATION_24, "utf8");
  const upIndex = whole.indexOf("-- Up Migration");
  const downIndex = whole.indexOf("-- Down Migration");
  expect(upIndex).toBeGreaterThanOrEqual(0);
  expect(downIndex).toBeGreaterThan(upIndex);
  return { whole, up: whole.slice(upIndex, downIndex), down: whole.slice(downIndex) };
}

async function runbook(): Promise<{ text: string; count: string; listing: string; backfill: string }> {
  const text = await readFile(FIXTURE, "utf8");
  const part = (name: string, next: string | null): string => {
    const start = text.indexOf(`-- name: ${name}\n`) + `-- name: ${name}\n`.length;
    const end = next ? text.indexOf(`-- name: ${next}\n`) : text.length;
    return text.slice(start, end).trim();
  };
  return { text, count: part("count", "listing"), listing: part("listing", "backfill"), backfill: part("backfill", null) };
}

/** The only notice the Up section may raise is Postgres' "does not exist, skipping" for DROP CONSTRAINT IF EXISTS. */
function expectOnlyBenignNotices(notices: string[]): void {
  for (const n of notices) {
    expect(n).toMatch(/^constraint "topics_template_link_valid" of relation "topics" does not exist, skipping$/);
    expect(n).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  }
}

function scratchName(): string {
  return `mig24_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

describe.skipIf(!infraUp)("migration 24: topics.template_topic_id (real Postgres, #311)", () => {
  let db: typeof Db;
  const schemas: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("../../db.js"));
  });

  afterEach(async () => {
    for (const schema of schemas.splice(0)) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });

  /** A client whose search_path starts at a fresh pre-24 scratch copy of topics. */
  async function scratchClient(): Promise<{ client: pg.PoolClient; schema: string; notices: string[] }> {
    const schema = scratchName();
    schemas.push(schema);
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.topics (LIKE public.topics INCLUDING ALL)`);
    // Dropping the column drops its CHECK and any index on it: the pre-24 shape.
    await db.query(`ALTER TABLE ${schema}.topics DROP COLUMN IF EXISTS template_topic_id`);
    const client = await db.connect();
    const notices: string[] = [];
    client.removeAllListeners("notice");
    client.on("notice", (n) => notices.push(n.message));
    await client.query(`SET search_path TO ${schema}, public`);
    return { client, schema, notices };
  }

  async function addRow(
    client: pg.PoolClient,
    row: { id?: string; team: string; name: string; isDefault: boolean; status?: "active" | "archived"; order: number; link?: string | null },
  ): Promise<string> {
    const id = row.id ?? randomUUID();
    const link = row.link !== undefined;
    // The link column may not exist yet (pre-24): only name it when asked.
    await client.query(
      `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default${link ? ", template_topic_id" : ""})
       VALUES ($1, $2, $3, 'p', 'finger', $4, $5::topic_status, $6${link ? ", $7" : ""})`,
      [id, row.team, row.name, row.order, row.status ?? "active", row.isDefault, ...(link ? [row.link] : [])],
    );
    return id;
  }

  async function linkMap(client: pg.PoolClient): Promise<Record<string, string | null>> {
    const res = await client.query<{ id: string; template_topic_id: string | null }>(`SELECT id, template_topic_id FROM topics`);
    return Object.fromEntries(res.rows.map((r) => [r.id, r.template_topic_id]));
  }

  async function hasColumn(client: pg.PoolClient, schema: string): Promise<boolean> {
    const res = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'topics' AND column_name = 'template_topic_id'`,
      [schema],
    );
    return (res.rowCount ?? 0) === 1;
  }

  /** The seeded cases of the delta spec "Backfill on seeded data". Pre-24 shape: no link column yet. */
  async function seed(client: pg.PoolClient) {
    const teamA = randomUUID();
    const teamB = randomUUID();
    const teamD = randomUUID();
    const ids = {
      tplPulse: await addRow(client, { team: TEMPLATE, name: "Pulse", isDefault: true, order: 1 }),
      tplHeartbeat: await addRow(client, { team: TEMPLATE, name: "Heartbeat", isDefault: true, order: 2 }),
      tplDupActive: await addRow(client, { team: TEMPLATE, name: "Dup", isDefault: true, order: 3 }),
      tplDupArchived: await addRow(client, { team: TEMPLATE, name: "Dup", isDefault: true, status: "archived", order: 4 }),
      tplRetro: await addRow(client, { team: TEMPLATE, name: "Retro", isDefault: true, status: "archived", order: 5 }),
      tplQuad1: await addRow(client, { team: TEMPLATE, name: "Quad", isDefault: true, order: 6 }),
      tplQuad2: await addRow(client, { team: TEMPLATE, name: "Quad", isDefault: true, order: 7 }),
      // Team A: matching default, renamed-template default, custom with a default's name, archived-template match.
      aPulse: await addRow(client, { team: teamA, name: "Pulse", isDefault: true, order: 1 }),
      aOld: await addRow(client, { team: teamA, name: "Old name of Heartbeat", isDefault: true, order: 2 }),
      aCustomPulse: await addRow(client, { team: teamA, name: "Heartbeat", isDefault: false, order: 3 }),
      aRetro: await addRow(client, { team: teamA, name: "Retro", isDefault: true, order: 4 }),
      // Team B: two same-name defaults (active and archived) against two template rows (active and archived).
      bDupActive: await addRow(client, { team: teamB, name: "Dup", isDefault: true, order: 1 }),
      bDupArchived: await addRow(client, { team: teamB, name: "Dup", isDefault: true, status: "archived", order: 2 }),
      // Team D: the four-row case, both team rows active.
      dQuad1: await addRow(client, { team: teamD, name: "Quad", isDefault: true, order: 1 }),
      dQuad2: await addRow(client, { team: teamD, name: "Quad", isDefault: true, order: 2 }),
    };
    return { teamA, teamB, teamD, ids };
  }

  it("the Up section carries the contract text: markers, header facts, no unique index, no RAISE NOTICE", async () => {
    const { whole, up, down } = await migrationSections();
    expect(whole).toContain("-- Up Migration");
    expect(whole).toContain("-- Down Migration");
    expect(whole).toMatch(/archived, never deleted/);
    expect(whole).toMatch(/^-- Rollback: .+/m);
    expect(whole).toMatch(/implicit\s+-- transaction|one implicit/);
    expect(up.indexOf("SET LOCAL lock_timeout = '200ms'")).toBeLessThan(up.indexOf("ADD COLUMN"));
    expect(up.trimEnd().endsWith("RESET lock_timeout;")).toBe(true);
    expect(up).toMatch(/ON DELETE RESTRICT/);
    expect(up).toMatch(/NOT VALID/);
    expect(up).toMatch(/VALIDATE CONSTRAINT topics_template_link_valid/);
    expect(up).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(up).not.toMatch(/ON CONFLICT/i);
    expect(whole.replace(/--[^\n]*/g, "")).not.toMatch(/RAISE\s+NOTICE/i);
    expect(down.indexOf("DROP CONSTRAINT")).toBeLessThan(down.indexOf("DROP COLUMN"));
  });

  it("the migration embeds the runbook backfill verbatim, and docs/deployment.md copies all three statements verbatim", async () => {
    const { whole } = await migrationSections();
    const rb = await runbook();
    expect(whole).toContain(rb.backfill);
    const doc = await readFile(DEPLOYMENT_DOC, "utf8");
    for (const statement of [rb.count, rb.listing, rb.backfill]) {
      expect(doc, `docs/deployment.md must contain verbatim:\n${statement}`).toContain(statement);
    }
  });

  it("the sentinel literal in migration 24 equals DEFAULT_TOPICS_TEAM_ID", async () => {
    const { up } = await migrationSections();
    const literals = [...up.matchAll(/'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'::uuid/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThan(0);
    expect(new Set(literals)).toEqual(new Set([DEFAULT_TOPICS_TEAM_ID]));
    const rb = await runbook();
    for (const m of rb.text.matchAll(/'([0-9a-f]{8}-[0-9a-f-]{27})'::uuid/g)) expect(m[1]).toBe(DEFAULT_TOPICS_TEAM_ID);
  });

  it("backfill on seeded data links exactly the expected rows", async () => {
    const { up } = await migrationSections();
    const { client, notices } = await scratchClient();
    try {
      const { ids } = await seed(client);
      // An already linked row must stay unchanged: link it before the migration by adding the column first.
      await client.query(up);
      const links = await linkMap(client);

      expect(links[ids.aPulse]).toBe(ids.tplPulse); // matching default
      expect(links[ids.aRetro]).toBe(ids.tplRetro); // archived-template match
      expect(links[ids.aOld]).toBeNull(); // renamed-template row
      expect(links[ids.aCustomPulse]).toBeNull(); // custom topic named like a default
      expect(links[ids.bDupActive]).toBe(ids.tplDupActive); // active to active
      expect(links[ids.bDupArchived]).toBeNull(); // archived sibling stays NULL
      expect(Object.values(links)).not.toContain(ids.tplDupArchived); // archived template row gets no link
      // Template-team rows are never linked.
      for (const t of [ids.tplPulse, ids.tplHeartbeat, ids.tplDupActive, ids.tplDupArchived, ids.tplRetro, ids.tplQuad1, ids.tplQuad2]) {
        expect(links[t]).toBeNull();
      }
      // The four-row case: exactly one of team D's rows is linked, to exactly one template row.
      const quadLinks = [links[ids.dQuad1], links[ids.dQuad2]].filter((l) => l !== null);
      expect(quadLinks).toHaveLength(1);
      expect([ids.tplQuad1, ids.tplQuad2]).toContain(quadLinks[0]);
      // No team ends with two rows linked to one template row, and no row has two links (one column).
      const dup = await client.query(
        `SELECT 1 FROM topics WHERE template_topic_id IS NOT NULL GROUP BY team_id, template_topic_id HAVING count(*) > 1`,
      );
      expect(dup.rowCount).toBe(0);
      // "Output contains no identifier": the only server notice is Postgres' own DROP IF EXISTS skip.
      expectOnlyBenignNotices(notices);
    } finally {
      client.release();
    }
  });

  it("the migration result and notices contain no team id, row id or topic name", async () => {
    const { up } = await migrationSections();
    const { client, notices } = await scratchClient();
    try {
      await seed(client);
      const result = await client.query(up);
      const all = (Array.isArray(result) ? result : [result]) as Array<{ rows: unknown[]; command: string }>;
      expect(JSON.stringify(all.map((r) => r.rows))).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|Pulse|Dup|Quad/);
      expectOnlyBenignNotices(notices);
    } finally {
      client.release();
    }
  });

  it("is idempotent: a second backfill updates 0 rows, including a linked row with an unlinked same-name sibling", async () => {
    const { up } = await migrationSections();
    const rb = await runbook();
    const { client } = await scratchClient();
    try {
      const { ids } = await seed(client);
      const team = randomUUID();
      const tpl = await addRow(client, { team: TEMPLATE, name: "Sib", isDefault: true, order: 20 });
      await client.query(up);
      // Team with a linked "Sib" and an unlinked, same-name archived "Sib".
      const linked = await addRow(client, { team, name: "Sib", isDefault: true, order: 1, link: tpl });
      const sibling = await addRow(client, { team, name: "Sib", isDefault: true, status: "archived", order: 2 });
      const before = await linkMap(client);

      const again = await client.query(rb.backfill);
      expect(again.rowCount).toBe(0);
      const after = await linkMap(client);
      expect(after).toEqual(before);
      expect(after[sibling]).toBeNull();
      expect(after[linked]).toBe(tpl);
      expect(after[ids.aPulse]).toBe(ids.tplPulse);
    } finally {
      client.release();
    }
  });

  it("rolling deploy: rows an old build wrote with a NULL link are linked by the first re-run; the second updates 0", async () => {
    const { up } = await migrationSections();
    const rb = await runbook();
    const { client } = await scratchClient();
    try {
      const tplA = await addRow(client, { team: TEMPLATE, name: "Pulse", isDefault: true, order: 1 });
      const tplB = await addRow(client, { team: TEMPLATE, name: "Pairing", isDefault: true, order: 2 });
      await client.query(up);
      const team = randomUUID();
      const a = await addRow(client, { team, name: "Pulse", isDefault: true, order: 1 });
      const b = await addRow(client, { team, name: "Pairing", isDefault: true, order: 2 });

      const first = await client.query(rb.backfill);
      expect(first.rowCount).toBe(2);
      const links = await linkMap(client);
      expect(links[a]).toBe(tplA);
      expect(links[b]).toBe(tplB);
      expect((await client.query(rb.backfill)).rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("the runbook count query returns the unlinked is_default team rows; the listing returns the same rows", async () => {
    const { up } = await migrationSections();
    const rb = await runbook();
    const { client } = await scratchClient();
    try {
      const { ids, teamA, teamB, teamD } = await seed(client);
      await client.query(up);
      // Unlinked defaults left: aOld, bDupArchived, and one of team D's two Quad rows. The custom row is not counted.
      const count = await client.query<{ unlinked_defaults: number }>(rb.count);
      expect(count.rows[0]!.unlinked_defaults).toBe(3);
      const listing = await client.query<{ team_id: string; id: string; name: string }>(rb.listing);
      expect(listing.rows.map((r) => r.id)).toContain(ids.aOld);
      expect(listing.rows.map((r) => r.id)).toContain(ids.bDupArchived);
      expect(listing.rows).toHaveLength(3);
      expect(new Set(listing.rows.map((r) => r.team_id))).toEqual(new Set([teamA, teamB, teamD]));
    } finally {
      client.release();
    }
  });

  it("an empty database, and a database with no template defaults, migrate cleanly and count 0", async () => {
    const { up } = await migrationSections();
    const rb = await runbook();
    for (const withTeamCustomOnly of [false, true]) {
      const { client } = await scratchClient();
      try {
        if (withTeamCustomOnly) await addRow(client, { team: randomUUID(), name: "Custom", isDefault: false, order: 1 });
        await client.query(up);
        const count = await client.query<{ unlinked_defaults: number }>(rb.count);
        expect(count.rows[0]!.unlinked_defaults).toBe(0);
        expect((await client.query(rb.backfill)).rowCount).toBe(0);
      } finally {
        client.release();
      }
    }
  });

  it("the backfill ignores template-team rows and custom rows", async () => {
    const { up } = await migrationSections();
    const { client } = await scratchClient();
    try {
      const tpl = await addRow(client, { team: TEMPLATE, name: "X", isDefault: true, order: 1 });
      const tplTwin = await addRow(client, { team: TEMPLATE, name: "X", isDefault: true, status: "archived", order: 2 });
      const custom = await addRow(client, { team: randomUUID(), name: "X", isDefault: false, order: 1 });
      await client.query(up);
      const links = await linkMap(client);
      expect(links[tpl]).toBeNull();
      expect(links[tplTwin]).toBeNull();
      expect(links[custom]).toBeNull();
    } finally {
      client.release();
    }
  });

  it("a failing last statement leaves the column absent (one implicit transaction)", async () => {
    const { up } = await migrationSections();
    const { client, schema } = await scratchClient();
    try {
      await addRow(client, { team: TEMPLATE, name: "Pulse", isDefault: true, order: 1 });
      await expect(client.query(`${up}\nSELECT 1/0;`)).rejects.toMatchObject({ code: "22012" });
      expect(await hasColumn(client, schema)).toBe(false);
      const constraint = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = 'topics_template_link_valid' AND connamespace = $1::regnamespace`, [schema]);
      expect(constraint.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("a manual replay of the Up statements on a migrated database succeeds and changes nothing", async () => {
    const { up } = await migrationSections();
    const { client } = await scratchClient();
    try {
      await seed(client);
      await client.query(up);
      const before = await linkMap(client);
      await expect(client.query(up)).resolves.toBeDefined();
      expect(await linkMap(client)).toEqual(before);
    } finally {
      client.release();
    }
  });

  it("down then up: the schema returns to the pre-migration shape, no row is lost, and links are recomputed", async () => {
    const { up, down } = await migrationSections();
    const { client, schema } = await scratchClient();
    try {
      await seed(client);
      await client.query(up);
      const linked = await linkMap(client);
      const rowsBefore = (await client.query(`SELECT count(*)::int AS n FROM topics`)).rows[0].n;

      await client.query(down);
      expect(await hasColumn(client, schema)).toBe(false);
      expect((await client.query(`SELECT count(*)::int AS n FROM topics`)).rows[0].n).toBe(rowsBefore);

      await client.query(up);
      expect(await hasColumn(client, schema)).toBe(true);
      expect(await linkMap(client)).toEqual(linked);
    } finally {
      client.release();
    }
  });
});

// ---------------------------------------------------------------------------
// Database refusals on the real table (design Decision 5 and spec "Custom topics
// are never linked", "A referenced template row cannot be deleted"). Each case
// runs inside a transaction that is rolled back.
// ---------------------------------------------------------------------------
describe.skipIf(!infraUp)("topics.template_topic_id: constraints of the real table (#311)", () => {
  let db: typeof Db;

  beforeAll(async () => {
    ({ db } = await import("../../db.js"));
  });

  async function inRolledBackTx(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await fn(client);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  async function sqlState(client: pg.PoolClient, sql: string, params: unknown[] = []): Promise<string | null> {
    await client.query("SAVEPOINT probe");
    try {
      await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT probe");
      return null;
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT probe");
      return (err as { code?: string }).code ?? "unknown";
    }
  }

  async function aTeam(client: pg.PoolClient): Promise<string> {
    const team = (await client.query<{ id: string }>(`SELECT id FROM teams WHERE id <> $1 LIMIT 1`, [TEMPLATE])).rows[0];
    if (team) return team.id;
    const user = (await client.query<{ id: string }>(`SELECT id FROM users LIMIT 1`)).rows[0]!;
    return (
      await client.query<{ id: string }>(`INSERT INTO teams (name, created_by_user_id) VALUES ('mig24 team', $1) RETURNING id`, [user.id])
    ).rows[0]!.id;
  }

  const INSERT_TOPIC = `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, template_topic_id)
                        VALUES ($1, $2, 'p', 'finger', $3, $4, $5)`;

  it("the CHECK refuses a link on a custom row and on a template-team row (SQLSTATE 23514)", async () => {
    await inRolledBackTx(async (client) => {
      const team = await aTeam(client);
      const tpl = (
        await client.query<{ id: string }>(
          `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, status)
           VALUES ($1, 'mig24 tpl', 'p', 'finger', 9001, true, 'archived') RETURNING id`,
          [TEMPLATE],
        )
      ).rows[0]!.id;
      expect(await sqlState(client, INSERT_TOPIC, [team, "custom linked", 9101, false, tpl])).toBe("23514");
      expect(await sqlState(client, INSERT_TOPIC, [TEMPLATE, "template linked", 9002, true, tpl])).toBe("23514");
      // A linked default on a real team is accepted.
      expect(await sqlState(client, INSERT_TOPIC, [team, "default linked", 9102, true, tpl])).toBeNull();
    });
  });

  it("a delete of a referenced template row is refused (SQLSTATE 23503) and the link and the team row are unchanged", async () => {
    await inRolledBackTx(async (client) => {
      const team = await aTeam(client);
      const tpl = (
        await client.query<{ id: string }>(
          `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, status)
           VALUES ($1, 'mig24 tpl2', 'p', 'finger', 9003, true, 'archived') RETURNING id`,
          [TEMPLATE],
        )
      ).rows[0]!.id;
      const teamRow = (
        await client.query<{ id: string }>(
          `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, template_topic_id)
           VALUES ($1, 'mig24 copy', 'p', 'finger', 9103, true, $2) RETURNING id`,
          [team, tpl],
        )
      ).rows[0]!.id;

      expect(await sqlState(client, `DELETE FROM topics WHERE id = $1`, [tpl])).toBe("23503");
      const row = (await client.query(`SELECT template_topic_id FROM topics WHERE id = $1`, [teamRow])).rows[0];
      expect(row.template_topic_id).toBe(tpl);
      expect((await client.query(`SELECT 1 FROM topics WHERE id = $1`, [tpl])).rowCount).toBe(1);
    });
  });
});
