import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { probeInfra, requireInfraOrThrow, loadModules, Fixture, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { snapshotTemplate, restoreTemplate, assertTemplateUnchanged } from "./helpers/template-snapshot.js";
import type { TemplateSnapshot } from "./helpers/template-snapshot.js";
import { acquireTemplateLock, withDroppedActiveOrderIndex } from "./helpers/template-lock.js";
import { copyCanonicalDefaults } from "../../sessions/default-topics.js";

// ---------------------------------------------------------------------------
// harden-team-creation-topic-copy (#215) tasks.md 4.2, 4.4-4.8, 5.2, 5.3, 6.6:
// the canonical-set copy and restore list, and the template_anomaly signal,
// against real Postgres. The whole file holds the template lock (3.1), so no
// other template-mutating file runs alongside. Extra template rows are
// deleted in finally; existing rows' name/prompt/is_default/
// first_session_description are never changed (the #188 helper does not
// restore them). Log capture follows template-constraint-violation.test.ts.
//
// The generic copy-failure and failing-anomaly-check paths need module mocks
// and live in team-creation-failure-paths.test.ts (vi.mock is file-wide).
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "team-creation-canonical-copy-integration.test.ts");

interface LogLine {
  level: number;
  msg?: string;
  reqId?: string;
  [key: string]: unknown;
}

interface TopicRow {
  id: string;
  name: string;
  prompt: string;
  vote_type: string;
  display_order: number;
  status: string;
  is_default: boolean;
  first_session_description: string | null;
  team_annotation: string | null;
  annotation_updated_by: string | null;
  annotation_updated_at: Date | null;
}

const TOPIC_COLUMNS = `id, name, prompt, vote_type, display_order, status, is_default, first_session_description,
  team_annotation, annotation_updated_by, annotation_updated_at`;

describe.skipIf(!infraUp)("team creation copies the canonical defaults (#215)", () => {
  let mods: Mods;
  let fx: Fixture;
  let facilitatorId: string;
  let releaseLock: (() => Promise<void>) | undefined;
  let app: FastifyInstance;
  let lines: LogLine[];
  let snap: TemplateSnapshot;
  const extras: string[] = [];

  async function buildLoggedApp(userId: string): Promise<FastifyInstance> {
    const a = Fastify({
      logger: { level: "info", stream: { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) } },
    });
    a.decorateRequest("session", null);
    a.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    a.register(mods.facilitatorSessionRoutes);
    a.register(mods.contentRoutes);
    await a.ready();
    return a;
  }

  beforeAll(async () => {
    releaseLock = await acquireTemplateLock();
    mods = await loadModules();
    fx = new Fixture(mods.db);
    facilitatorId = await fx.user("facilitator");
  });

  afterAll(async () => {
    await fx?.cleanup();
    await mods?.redis.quit();
    await releaseLock?.();
  });

  async function begin(): Promise<void> {
    lines = [];
    snap = await snapshotTemplate(mods.db);
    app = await buildLoggedApp(facilitatorId);
  }

  afterEach(async () => {
    await app?.close();
    if (extras.length > 0) {
      await mods.db.query(`DELETE FROM topics WHERE id = ANY($1::uuid[])`, [extras.splice(0)]);
    }
    if (snap) await restoreTemplate(mods.db, snap);
  });

  /** An extra template row (deleted in afterEach). */
  async function addTemplateRow(opts: {
    name: string;
    order: number;
    status?: "active" | "archived";
    isDefault?: boolean;
    firstSessionDescription?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    await mods.db.query(
      `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, first_session_description)
       VALUES ($1, $2, $3, $4, 'finger', $5, $6::topic_status, $7, $8)`,
      [
        id,
        SENTINEL_TEAM_ID,
        opts.name,
        `Prompt for ${opts.name}?`,
        opts.order,
        opts.status ?? "active",
        opts.isDefault ?? true,
        opts.firstSessionDescription ?? null,
      ],
    );
    extras.push(id);
    return id;
  }

  function activeDefaults(): Array<{ id: string; name: string; display_order: number }> {
    return [...snap.values()]
      .filter((r) => r.is_default && r.status === "active")
      .sort((a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id));
  }

  /** Moves existing template rows by negate-then-set (the partial index). */
  async function setOrders(orders: Array<[id: string, order: number]>): Promise<void> {
    await mods.db.query(`UPDATE topics SET display_order = -display_order - 1000 WHERE id = ANY($1::uuid[])`, [
      orders.map(([id]) => id),
    ]);
    for (const [id, order] of orders) {
      await mods.db.query(`UPDATE topics SET display_order = $2 WHERE id = $1`, [id, order]);
    }
  }

  async function archiveTemplateRow(id: string): Promise<void> {
    await mods.db.query(`UPDATE topics SET status = 'archived', archived_at = now() WHERE id = $1`, [id]);
  }

  async function createTeam(): Promise<{ res: Awaited<ReturnType<FastifyInstance["inject"]>>; teamId?: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: `Canonical Copy ${randomUUID()}` },
    });
    if (res.statusCode === 201) {
      const teamId = res.json().teamId as string;
      fx.track(teamId);
      return { res, teamId };
    }
    return { res };
  }

  async function teamTopics(teamId: string): Promise<TopicRow[]> {
    return (
      await mods.db.query<TopicRow>(`SELECT ${TOPIC_COLUMNS} FROM topics WHERE team_id = $1 ORDER BY display_order, id`, [
        teamId,
      ])
    ).rows;
  }

  async function restoreListNames(teamId: string): Promise<Array<{ name: string; isArchived: boolean }>> {
    const res = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    expect(res.statusCode).toBe(200);
    return (res.json().defaultTopicsNotActive as Array<{ name: string; isArchived: boolean }>).map((d) => ({
      name: d.name,
      isArchived: d.isArchived,
    }));
  }

  function anomalyLines(): LogLine[] {
    return lines.filter((l) => l.msg === "template_anomaly");
  }

  // ---- 4.2 duplicate-position copy, function level ------------------------
  it("4.2: copyCanonicalDefaults renumbers two active defaults at one position (index dropped, rolled back)", async () => {
    await begin();
    const scratchTeam = await fx.team(facilitatorId);
    const targetTeam = await fx.team(facilitatorId);
    const idLow = "00000000-0000-0000-0000-0000000000a1";
    const idHigh = "00000000-0000-0000-0000-0000000000a2";
    await withDroppedActiveOrderIndex(async (client: pg.PoolClient) => {
      // Inserted high id first so insertion order cannot explain the result.
      for (const [id, name] of [
        [idHigh, "Dup Two"],
        [idLow, "Dup One"],
      ] as const) {
        await client.query(
          `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, is_default)
           VALUES ($1, $2, $3, 'p?', 'finger', 1, true)`,
          [id, scratchTeam, name],
        );
      }
      await client.query(
        `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default)
         VALUES ($1, 'Dup Three', 'p?', 'finger', 2, true)`,
        [scratchTeam],
      );
      await copyCanonicalDefaults(client, targetTeam, scratchTeam);
      const rows = (
        await client.query<{ name: string; display_order: number }>(
          `SELECT name, display_order FROM topics WHERE team_id = $1 ORDER BY display_order`,
          [targetTeam],
        )
      ).rows;
      expect(rows.map((r) => r.display_order)).toEqual([1, 2, 3]);
      // Ties broken by source id: idLow ("Dup One") before idHigh ("Dup Two").
      expect(rows.slice(0, 2).map((r) => r.name)).toEqual(["Dup One", "Dup Two"]);
      expect(rows[2]!.name).toBe("Dup Three");
    });
    // Rolled back: the index is back and the scratch rows are gone.
    const idx = await mods.db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'topics_team_active_order'`);
    expect(idx.rowCount).toBe(1);
    expect((await teamTopics(targetTeam)).length).toBe(0);
  });

  // ---- #200 2.3 copyCanonicalDefaults returns the inserted ids -------------
  it("#200 2.3: returns the inserted ids; their count equals the template's active default count", async () => {
    await begin();
    const targetTeam = await fx.team(facilitatorId);
    const client = await mods.db.connect();
    try {
      await client.query("BEGIN");
      const ids = await copyCanonicalDefaults(client, targetTeam);
      const inserted = (
        await client.query<{ id: string }>(`SELECT id FROM topics WHERE team_id = $1`, [targetTeam])
      ).rows.map((r) => r.id);
      await client.query("ROLLBACK");

      expect(ids.length).toBe(activeDefaults().length);
      expect([...ids].sort()).toEqual([...inserted].sort());
    } finally {
      client.release();
    }
  });

  it("#200 2.3: an empty source returns [] and inserts nothing", async () => {
    await begin();
    const emptySource = await fx.team(facilitatorId);
    const targetTeam = await fx.team(facilitatorId);
    const client = await mods.db.connect();
    try {
      await client.query("BEGIN");
      await expect(copyCanonicalDefaults(client, targetTeam, emptySource)).resolves.toEqual([]);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect((await teamTopics(targetTeam)).length).toBe(0);
  });

  // ---- 4.4 zero active defaults -------------------------------------------
  it("4.4: an empty template is HTTP 500 internal_error, leaks nothing, persists nothing, logs at error level", async () => {
    await begin();
    for (const r of activeDefaults()) await archiveTemplateRow(r.id);
    const name = `Empty Template ${randomUUID()}`;
    const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name } });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: { category: string; message: string; correlationId: string } };
    expect(body.error.category).toBe("internal_error");
    expect(body.error.message).toBe(
      "Team creation is unavailable because the default topic set is not configured. Contact an administrator.",
    );
    expect(body.error.correlationId).toBeTruthy();
    for (const forbidden of [SENTINEL_TEAM_ID, "NoActiveTopicsError", "INSERT INTO", "at ", "session_topics"]) {
      expect(res.body, `body must not contain ${forbidden}`).not.toContain(forbidden);
    }

    const { db } = mods;
    expect((await db.query(`SELECT 1 FROM teams WHERE name = $1`, [name])).rowCount).toBe(0);
    expect(
      (await db.query(`SELECT 1 FROM audit_log WHERE actor_user_id = $1 AND operation = 'team.created_with_session'`, [facilitatorId]))
        .rowCount,
    ).toBe(0);
    // Team-scoped rows are keyed by the team id, which never persisted: no
    // team named for this request exists, and no orphan membership/session
    // rows can reference it (FKs).
    const errorLog = lines.find((l) => l.level >= 50 && l.templateTeamId === SENTINEL_TEAM_ID);
    expect(errorLog).toBeDefined();
    expect(errorLog!.correlationId).toBe(body.error.correlationId);
  });

  // ---- 4.5 C1 --------------------------------------------------------------
  it("4.5 (C1): an archived template default is not copied; the active ones are", async () => {
    await begin();
    const archivedId = await addTemplateRow({ name: "Archived Y", order: 99, status: "archived" });
    const { res, teamId } = await createTeam();
    expect(res.statusCode).toBe(201);
    const rows = await teamTopics(teamId!);
    expect(rows.map((r) => r.name)).not.toContain("Archived Y");
    expect(rows.map((r) => r.name).sort()).toEqual(activeDefaults().map((r) => r.name).sort());
    expect(rows.every((r) => r.status === "active")).toBe(true);
    expect(archivedId).toBeTruthy();
  });

  // ---- 4.6 C4 positions ----------------------------------------------------
  it("4.6 (C4): gaps renumber to 1..n in order; a healthy template keeps its positions; an archived/active collision gives 201 with one topic at position 1", async () => {
    await begin();
    // Healthy: positions equal the template's.
    {
      const { res, teamId } = await createTeam();
      expect(res.statusCode).toBe(201);
      const rows = await teamTopics(teamId!);
      expect(rows.map((r) => [r.name, r.display_order])).toEqual(activeDefaults().map((r) => [r.name, r.display_order]));
    }
    // Gaps {1,3,7,...}: move row 2 to 3 and row 3 to 7, rest shifted high.
    const act = activeDefaults();
    await setOrders(act.map((r, i) => [r.id, i === 0 ? 1 : i === 1 ? 3 : i === 2 ? 7 : 10 + i] as [string, number]));
    {
      const { res, teamId } = await createTeam();
      expect(res.statusCode).toBe(201);
      const rows = await teamTopics(teamId!);
      expect(rows.map((r) => r.display_order)).toEqual(act.map((_, i) => i + 1));
      expect(rows.map((r) => r.name)).toEqual(act.map((r) => r.name));
    }
    // Archived/active collision at position 1: archive-colliding row inserted.
    await setOrders(act.map((r, i) => [r.id, i + 1] as [string, number]));
    await addTemplateRow({ name: "Archived P1", order: 1, status: "archived" });
    {
      const { res, teamId } = await createTeam();
      expect(res.statusCode).toBe(201);
      const rows = await teamTopics(teamId!);
      expect(rows.filter((r) => r.display_order === 1)).toHaveLength(1);
      expect(rows.map((r) => r.display_order)).toEqual(act.map((_, i) => i + 1));
      expect(rows.map((r) => r.name)).not.toContain("Archived P1");
    }
  });

  // ---- 4.7 C11 column fidelity ---------------------------------------------
  it("4.7 (C11): each copied column equals the template's, annotations unset; same-name archived row ignored; NULL first_session_description copies as NULL", async () => {
    await begin();
    // Annotate a template row directly so a copy that leaked annotation columns would show.
    const first = activeDefaults()[0]!;
    await mods.db.query(`UPDATE topics SET team_annotation = 'template definition' WHERE id = $1`, [first.id]);
    await addTemplateRow({ name: first.name, order: 77, status: "archived" }); // same-name archived
    const nullId = await addTemplateRow({ name: "Null Description", order: 50, firstSessionDescription: null });
    try {
      const { res, teamId } = await createTeam();
      expect(res.statusCode).toBe(201);
      const copied = await teamTopics(teamId!);
      const source = (
        await mods.db.query<TopicRow>(
          `SELECT ${TOPIC_COLUMNS} FROM topics WHERE team_id = $1 AND is_default AND status = 'active'
           ORDER BY display_order, id`,
          [SENTINEL_TEAM_ID],
        )
      ).rows;
      expect(copied).toHaveLength(source.length);
      copied.forEach((row, i) => {
        const src = source[i]!;
        expect(row.name).toBe(src.name);
        expect(row.prompt).toBe(src.prompt);
        expect(row.vote_type).toBe(src.vote_type);
        expect(row.first_session_description).toBe(src.first_session_description);
        expect(row.is_default).toBe(true);
        expect(row.status).toBe("active");
        expect(row.id).not.toBe(src.id);
        expect(row.team_annotation).toBeNull();
        expect(row.annotation_updated_by).toBeNull();
        expect(row.annotation_updated_at).toBeNull();
      });
      expect(copied.find((r) => r.name === "Null Description")!.first_session_description).toBeNull();
      // Same-name archived template row did not add a second copy of that name.
      expect(copied.filter((r) => r.name === first.name)).toHaveLength(1);
    } finally {
      await mods.db.query(`UPDATE topics SET team_annotation = $2 WHERE id = $1`, [first.id, snap.get(first.id)!.team_annotation]);
    }
    expect(nullId).toBeTruthy();
  });

  it("4.7 (C11): a single active default copies as exactly one topic", async () => {
    await begin();
    const act = activeDefaults();
    for (const r of act.slice(1)) await archiveTemplateRow(r.id);
    const { res, teamId } = await createTeam();
    expect(res.statusCode).toBe(201);
    const rows = await teamTopics(teamId!);
    expect(rows.map((r) => [r.name, r.display_order])).toEqual([[act[0]!.name, 1]]);
  });

  // ---- 4.8 C12, isolation --------------------------------------------------
  it("4.8 (C12): session topics equal the team's in name and order; response shape unchanged; an existing team is untouched by a second creation; edits to a copy leak nowhere", async () => {
    await begin();
    const first = await createTeam();
    expect(first.res.statusCode).toBe(201);
    expect(Object.keys(first.res.json()).sort()).toEqual(["sessionId", "status", "teamId"]);
    expect(first.res.json().status).toBe("lobby");
    const firstTeamId = first.teamId!;
    const firstSessionId = first.res.json().sessionId as string;

    const sessionTopics = (
      await mods.db.query<{ topic_name: string; display_order: number }>(
        `SELECT topic_name, display_order FROM session_topics WHERE session_id = $1 ORDER BY display_order`,
        [firstSessionId],
      )
    ).rows;
    const firstTopics = await teamTopics(firstTeamId);
    expect(sessionTopics.length).toBeGreaterThanOrEqual(1);
    expect(sessionTopics.map((s) => [s.topic_name, s.display_order])).toEqual(
      firstTopics.map((t) => [t.name, t.display_order]),
    );

    const beforeFirst = await teamTopics(firstTeamId);
    const second = await createTeam();
    expect(second.res.statusCode).toBe(201);
    expect(await teamTopics(firstTeamId)).toEqual(beforeFirst);

    // Edit the second team's copy: neither the template nor the first team moves.
    const secondTopics = await teamTopics(second.teamId!);
    await mods.db.query(`UPDATE topics SET name = 'Edited On Second Team', prompt = 'Edited?' WHERE id = $1`, [secondTopics[0]!.id]);
    await assertTemplateUnchanged(mods.db, snap);
    expect(await teamTopics(firstTeamId)).toEqual(beforeFirst);

    // A later template change does not retroactively touch an existing team.
    const tmplFirst = activeDefaults()[0]!;
    await mods.db.query(`UPDATE topics SET team_annotation = 'later template note' WHERE id = $1`, [tmplFirst.id]);
    expect(await teamTopics(firstTeamId)).toEqual(beforeFirst);
  });

  // ---- 5.2 C5, C6 ----------------------------------------------------------
  it("5.2 (C5/C6): restore list ignores an archived template default, offers a team's own archived copy of an active default, and ignores both-archived", async () => {
    await begin();
    const act = activeDefaults();
    const { res, teamId } = await createTeam();
    expect(res.statusCode).toBe(201);
    expect(await restoreListNames(teamId!)).toEqual([]);

    // C5: an archived template default, team has no copy of that name.
    await addTemplateRow({ name: "Archived Template Only", order: 98, status: "archived" });
    expect(await restoreListNames(teamId!)).toEqual([]);

    // C6a: team archives its own copy of an active default.
    await mods.db.query(`UPDATE topics SET status = 'archived', archived_at = now() WHERE team_id = $1 AND name = $2`, [
      teamId,
      act[0]!.name,
    ]);
    expect(await restoreListNames(teamId!)).toEqual([{ name: act[0]!.name, isArchived: true }]);

    // C6b: both archived -> absent.
    await archiveTemplateRow(act[0]!.id);
    expect(await restoreListNames(teamId!)).toEqual([]);
  });

  // ---- 5.3 C7 --------------------------------------------------------------
  it("5.3 (C7): names copied at creation equal names the restore list reports for an empty team, across states; set difference for a team holding some", async () => {
    await begin();
    const act = activeDefaults();
    await addTemplateRow({ name: "Archived Z", order: 97, status: "archived" });
    await archiveTemplateRow(act[1]!.id);

    const { res, teamId } = await createTeam();
    expect(res.statusCode).toBe(201);
    const copiedNames = (await teamTopics(teamId!)).map((t) => t.name).sort();

    // An empty team: no topics at all (creation always copies, so build one directly).
    const emptyTeam = await fx.team(facilitatorId);
    const reported = (await restoreListNames(emptyTeam)).map((d) => d.name).sort();
    expect(reported).toEqual(copiedNames);

    // A team holding some defaults: reported = canonical minus held.
    const some = await fx.team(facilitatorId);
    const held = act.filter((_, i) => i !== 1).slice(0, 3);
    for (const [i, h] of held.entries()) {
      await fx.topic(some, { name: h.name, displayOrder: i + 1 });
    }
    const canonical = new Set(copiedNames);
    held.forEach((h) => canonical.delete(h.name));
    expect((await restoreListNames(some)).map((d) => d.name).sort()).toEqual([...canonical].sort());

    // Template X active and team X active -> X absent.
    expect((await restoreListNames(some)).map((d) => d.name)).not.toContain(held[0]!.name);
  });

  // ---- 6.6 C2 anomaly signal -----------------------------------------------
  describe("template_anomaly signal (6.6)", () => {
    it("a healthy template writes no entry", async () => {
      await begin();
      const { res } = await createTeam();
      expect(res.statusCode).toBe(201);
      expect(anomalyLines()).toHaveLength(0);
      expect(lines.some((l) => l.msg === "template_anomaly_check_failed")).toBe(false);
    });

    const cases: Array<{ code: string; setup: () => Promise<void> }> = [
      {
        code: "non_active_default",
        setup: async () => {
          await addTemplateRow({ name: "Anom Archived Default", order: 90, status: "archived" });
        },
      },
      {
        code: "non_default_row",
        setup: async () => {
          await addTemplateRow({ name: "Anom Archived Custom", order: 91, status: "archived", isDefault: false });
        },
      },
      {
        code: "non_contiguous_order",
        setup: async () => {
          // Nonzero start: shift every active default up by one.
          await setOrders(activeDefaults().map((r) => [r.id, r.display_order + 1] as [string, number]));
        },
      },
    ];

    for (const c of cases) {
      it(`${c.code}: exactly one warn entry with the closed key set, ids only, matching correlation id; response unchanged`, async () => {
        await begin();
        const healthy = await createTeam();
        const healthyKeys = Object.keys(healthy.res.json()).sort();
        lines.length = 0;
        await c.setup();
        const { res } = await createTeam();
        expect(res.statusCode).toBe(201);
        expect(Object.keys(res.json()).sort()).toEqual(healthyKeys);
        expect(res.body).not.toContain("anomal");

        const entries = anomalyLines();
        expect(entries).toHaveLength(1);
        const e = entries[0]!;
        expect(e.level).toBe(40);
        expect(e.msg).toBe("template_anomaly");
        expect(e.templateTeamId).toBe(SENTINEL_TEAM_ID);
        expect(e.anomalies).toContain(c.code);
        expect(Array.isArray(e.topicIds)).toBe(true);
        if (c.code === "non_contiguous_order") expect(e.topicIds).toEqual([]);
        else expect((e.topicIds as string[]).length).toBeGreaterThan(0);
        // Closed key set: the four documented keys plus pino's own bindings.
        const bindings = new Set(["level", "time", "pid", "hostname", "reqId", "msg"]);
        const keys = Object.keys(e).filter((k) => !bindings.has(k)).sort();
        expect(keys).toEqual(["anomalies", "correlationId", "templateTeamId", "topicIds"]);
        // Joins to the request's other log lines.
        expect(e.correlationId).toBe(e.reqId);
        expect(lines.filter((l) => l.reqId === e.correlationId).length).toBeGreaterThan(1);
        // Ids and codes only: no topic text anywhere in the entry.
        const text = JSON.stringify(e);
        for (const r of snap.values()) {
          expect(text).not.toContain(r.name);
          expect(text).not.toContain(r.prompt);
        }
      });
    }

    // duplicate_active_order cannot be driven through the route: the rows
    // cannot exist while topics_team_active_order does, and the index cannot
    // be dropped across a route call (design.md Risks). The detector's rule
    // is pinned by the table-driven unit tests in template-anomalies.test.ts.

    it("a persistent fault writes one entry per creation (two creations, two entries)", async () => {
      await begin();
      await addTemplateRow({ name: "Persistent Fault", order: 92, status: "archived" });
      await createTeam();
      await createTeam();
      expect(anomalyLines()).toHaveLength(2);
    });

    it("the combined case: archived default plus a position gap names both, topicIds holds only the archived default's id", async () => {
      await begin();
      const archivedId = await addTemplateRow({ name: "Combined Archived", order: 93, status: "archived" });
      const act = activeDefaults();
      await setOrders(act.map((r, i) => [r.id, i === 0 ? 1 : i + 2] as [string, number]));
      const { res } = await createTeam();
      expect(res.statusCode).toBe(201);
      const e = anomalyLines()[0]!;
      expect((e.anomalies as string[]).sort()).toEqual(["non_active_default", "non_contiguous_order"]);
      expect(e.topicIds).toEqual([archivedId]);
    });
  });
});
