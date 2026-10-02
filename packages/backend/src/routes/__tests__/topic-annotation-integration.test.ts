import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import pg from "pg";
import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Real Postgres coverage for topic-annotation (TOPIC-007, TOPIC-002 reads,
// SESSION-005/012 snapshot payloads, seed isolation).
//
// Built from facilitator-error-states-integration.test.ts's pattern:
// self-skip probe, env var fallbacks, dynamic post-fallback imports, and NO
// db mocking anywhere in this file. Several properties here are database
// properties a mocked db cannot prove -- above all the REQUIRED negative test
// (tasks.md 6.4): a live edit of topics.team_annotation must not change what
// SESSION-005/012 return for an existing session_topics snapshot. A mocked
// "set Y, still get X" would pass whatever the SQL does.
//
// Do NOT add vi.mock for db.js / config.js / ws-pubsub.js here.
//
// Requires Postgres (5433) and Redis (6380) from `docker compose up`; the
// SESSION-005/012 handlers publish to Redis after commit. Runs in CI via
// .github/workflows/integration.yml.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] ??= "postgresql://dipstick:dipstick@localhost:5433/dipstick";
process.env["REDIS_URL"] ??= "redis://localhost:6380";
process.env["SESSION_SECRET"] ??= "integration-test-session-secret-32-chars-min";
process.env["OIDC_ISSUER"] ??= "http://localhost:4011";
process.env["OIDC_CLIENT_ID"] ??= "dipstick-local";
process.env["OIDC_CLIENT_SECRET"] ??= "dipstick-local-secret";
process.env["OIDC_REDIRECT_URI"] ??= "http://localhost:3000/auth/callback";
process.env["NODE_ENV"] ??= "test";

const REDIS_URL = process.env["REDIS_URL"]!;
const DATABASE_URL = process.env["DATABASE_URL"]!;
const PROBE_TIMEOUT_MS = 750;
const SENTINEL_TEAM_ID = "00000000-0000-0000-0000-000000000001";

async function isRedisReachable(): Promise<boolean> {
  const client = new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: PROBE_TIMEOUT_MS,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
  });
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

async function isPostgresReachable(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: PROBE_TIMEOUT_MS });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const [redisUp, dbUp] = await Promise.all([isRedisReachable(), isPostgresReachable()]);
const infraAvailable = redisUp && dbUp;

if (!infraAvailable) {
  console.warn(
    `[topic-annotation-integration.test.ts] SKIPPED — Redis (${REDIS_URL}: ${redisUp ? "up" : "unreachable"}) and/or ` +
      `Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}: ${dbUp ? "up" : "unreachable"}) not available. ` +
      "Run `docker compose up` (repo root) and re-run this file.",
  );
}

async function loadModules() {
  const { db } = await import("../../db.js");
  const { contentRoutes } = await import("../content.js");
  const { topicRoutes } = await import("../topics.js");
  const { facilitatorSessionRoutes } = await import("../facilitator-sessions.js");
  return { db, contentRoutes, topicRoutes, facilitatorSessionRoutes };
}

const MIGRATION_PATH = fileURLToPath(new URL("../../../migrations/19_topics_team_annotation.sql", import.meta.url));

describe.skipIf(!infraAvailable)("topic-annotation — real Postgres", () => {
  let mods: Awaited<ReturnType<typeof loadModules>>;

  beforeAll(async () => {
    mods = await loadModules();
  });

  function buildApp(userId: string) {
    const app = Fastify();
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    app.register(mods.contentRoutes);
    app.register(mods.topicRoutes);
    app.register(mods.facilitatorSessionRoutes);
    return app.ready().then((a) => a);
  }

  type Db = typeof mods.db;

  async function insertUser(db: Db, id: string, displayName: string, globalRole = "facilitator") {
    await db.query(
      `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
       VALUES ($1, $2, 'test-issuer', $3, $4, $5)`,
      [id, `sub-${id}`, displayName, `${id}@example.com`, globalRole],
    );
  }

  async function insertTeam(db: Db, id: string, creator: string) {
    await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
      id,
      `Topic Annotation Integration ${id.slice(-6)}`,
      creator,
    ]);
  }

  /** A completed first session unlocks topic customization. */
  async function insertCompletedSession(db: Db, id: string, teamId: string, facilitatorId: string) {
    await db.query(
      `INSERT INTO sessions
         (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
       VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
      [id, teamId, facilitatorId],
    );
  }

  async function insertTopic(
    db: Db,
    id: string,
    teamId: string,
    opts: { name?: string; displayOrder?: number; isDefault?: boolean } = {},
  ) {
    await db.query(
      `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default)
       VALUES ($1, $2, $3, 'Prompt?', 'finger', $4, 'active', $5)`,
      [id, teamId, opts.name ?? `Topic ${id.slice(-4)}`, opts.displayOrder ?? 1, opts.isDefault ?? false],
    );
  }

  async function cleanup(db: Db, teamIds: string[], userIds: string[]) {
    for (const teamId of teamIds) {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    }
    for (const userId of userIds) {
      await db.query(`DELETE FROM audit_log WHERE actor_user_id = $1`, [userId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  }

  async function putAnnotation(app: Awaited<ReturnType<typeof buildApp>>, teamId: string, topicId: string, annotation: unknown) {
    return app.inject({
      method: "PUT",
      url: `/api/v1/teams/${teamId}/topics/${topicId}/annotation`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ annotation }),
    });
  }

  // -------------------------------------------------------------------------
  // 1.2 — the harness itself runs against real Postgres (no mocking).
  // -------------------------------------------------------------------------
  it("harness: the real schema carries the annotation columns", async () => {
    const result = await mods.db.query<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }>(
      `SELECT table_name, column_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'topics' AND column_name IN ('team_annotation', 'annotation_updated_by', 'annotation_updated_at'))
            OR (table_name = 'session_topics' AND column_name = 'topic_annotation'))
        ORDER BY table_name, column_name`,
    );
    expect(result.rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([
      "session_topics.topic_annotation",
      "topics.annotation_updated_at",
      "topics.annotation_updated_by",
      "topics.team_annotation",
    ]);
    for (const row of result.rows) {
      expect(row.is_nullable).toBe("YES");
      expect(row.column_default).toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // 1.3 — migration 19: existing rows read NULL; down then up round-trips and
  // down changes nothing else.
  //
  // Run against structurally identical copies of topics/session_topics in a
  // throwaway schema inside a rolled-back transaction, so this test never
  // takes an ACCESS EXCLUSIVE lock on the real tables that other integration
  // files are using in parallel. The migration file's own Up/Down sections
  // are executed verbatim (unqualified names resolve via search_path).
  // -------------------------------------------------------------------------
  describe("migration 19 (tasks.md 1.3)", () => {
    async function shape(client: pg.PoolClient, schema: string) {
      const columns = await client.query<{ t: string; c: string; type: string; nullable: string; def: string | null }>(
        `SELECT table_name AS t, column_name AS c, data_type AS type, is_nullable AS nullable, column_default AS def
           FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, column_name`,
        [schema],
      );
      const indexes = await client.query<{ def: string }>(
        `SELECT replace(indexdef, $1 || '.', '') AS def FROM pg_indexes WHERE schemaname = $1 ORDER BY indexdef`,
        [schema],
      );
      const constraints = await client.query<{ t: string; type: string; def: string }>(
        `SELECT c.relname AS t, con.contype::text AS type, pg_get_constraintdef(con.oid) AS def
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1
          ORDER BY 1, 2, 3`,
        [schema],
      );
      return {
        columns: columns.rows.map((r) => `${r.t}.${r.c}:${r.type}:${r.nullable}:${r.def ?? ""}`),
        indexes: indexes.rows.map((r) => r.def),
        constraints: constraints.rows.map((r) => `${r.t}:${r.type}:${r.def}`),
      };
    }

    it("down drops exactly the four columns, up restores them, and pre-existing rows read NULL", async () => {
      const sql = await readFile(MIGRATION_PATH, "utf8");
      // A string search for the markers only (implementation review N-5).
      // Whether the migration RUNNER recognizes them (the migration-8
      // incident class) is proven by `db:migrate` in CI's integration setup
      // step, which applies migration 19 before this file runs.
      const upIndex = sql.indexOf("-- Up Migration");
      const downIndex = sql.indexOf("-- Down Migration");
      expect(upIndex).toBeGreaterThanOrEqual(0);
      expect(downIndex).toBeGreaterThan(upIndex);
      const upSql = sql.slice(upIndex, downIndex);
      const downSql = sql.slice(downIndex);

      const schema = `mig19_${Math.random().toString(36).slice(2, 10)}`;
      const client = await mods.db.connect();
      try {
        await client.query("BEGIN");
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`CREATE TABLE ${schema}.topics (LIKE public.topics INCLUDING ALL)`);
        await client.query(`CREATE TABLE ${schema}.session_topics (LIKE public.session_topics INCLUDING ALL)`);
        await client.query(`SET LOCAL search_path TO ${schema}, public`);

        const afterUp = await shape(client, schema);

        await client.query(downSql);
        const afterDown = await shape(client, schema);

        const annotationColumns = [
          "session_topics.topic_annotation",
          "topics.annotation_updated_at",
          "topics.annotation_updated_by",
          "topics.team_annotation",
        ];
        const isAnnotationColumn = (col: string) => annotationColumns.some((name) => col.startsWith(`${name}:`));
        expect(afterUp.columns.filter(isAnnotationColumn)).toHaveLength(4);
        // Down removes exactly those four and nothing else.
        expect(afterDown.columns).toEqual(afterUp.columns.filter((c) => !isAnnotationColumn(c)));
        expect(afterDown.indexes).toEqual(afterUp.indexes);
        expect(afterDown.constraints).toEqual(afterUp.constraints);

        // "Existing" rows, written while the columns do not exist.
        const topicId = "e7a00000-0000-4000-8000-0000000000f1";
        await client.query(
          `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status)
           VALUES ($1, $2, 'Pre-existing', 'P?', 'finger', 1, 'active')`,
          [topicId, SENTINEL_TEAM_ID],
        );
        await client.query(
          `INSERT INTO session_topics (session_id, topic_id, display_order, topic_name, topic_prompt, vote_type)
           VALUES (gen_random_uuid(), $1, 1, 'Pre-existing', 'P?', 'finger')`,
          [topicId],
        );

        await client.query(upSql);
        const afterReUp = await shape(client, schema);

        expect(afterReUp.columns).toEqual(afterUp.columns);
        expect(afterReUp.indexes).toEqual(afterUp.indexes);
        // LIKE does not copy foreign keys, so the re-run Up adds exactly one:
        // annotation_updated_by -> users(id).
        const addedConstraints = afterReUp.constraints.filter((c) => !afterUp.constraints.includes(c));
        expect(addedConstraints).toEqual(["topics:f:FOREIGN KEY (annotation_updated_by) REFERENCES users(id)"]);

        const topicRow = await client.query(
          `SELECT team_annotation, annotation_updated_by, annotation_updated_at FROM topics WHERE id = $1`,
          [topicId],
        );
        expect(topicRow.rows[0]).toEqual({
          team_annotation: null,
          annotation_updated_by: null,
          annotation_updated_at: null,
        });
        const stRow = await client.query(`SELECT topic_annotation FROM session_topics WHERE topic_id = $1`, [topicId]);
        expect(stRow.rows[0]).toEqual({ topic_annotation: null });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("rows in the real tables that were never annotated read NULL in all four columns", async () => {
      const { db } = mods;
      const result = await db.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM topics WHERE team_id = $1
           AND (team_annotation IS NOT NULL OR annotation_updated_by IS NOT NULL OR annotation_updated_at IS NOT NULL)`,
        [SENTINEL_TEAM_ID],
      );
      expect(result.rows[0]?.n).toBe("0");
    });
  });

  // -------------------------------------------------------------------------
  // TOPIC-007 end to end + TOPIC-002/TOPIC-001 reads (tasks.md 4.5, 5.3, 5.4)
  // -------------------------------------------------------------------------
  describe("TOPIC-007 and reads, real SQL", () => {
    const F = "e7a00000-0000-4000-8000-00000000a001";
    const ENGINEER = "e7a00000-0000-4000-8000-00000000a002";
    const ADMIN = "e7a00000-0000-4000-8000-00000000a003";
    const EM = "e7a00000-0000-4000-8000-00000000a004";
    const OTHER_TEAM = "e7a00000-0000-4000-8000-00000000b002";
    const OTHER_TOPIC = "e7a00000-0000-4000-8000-00000000d003";
    const TEAM = "e7a00000-0000-4000-8000-00000000b001";
    const SESSION = "e7a00000-0000-4000-8000-00000000c001";
    const TOPIC_A = "e7a00000-0000-4000-8000-00000000d001";
    const TOPIC_B = "e7a00000-0000-4000-8000-00000000d002";

    async function setup(db: Db) {
      await insertUser(db, F, "Fran Facilitator");
      await insertUser(db, ENGINEER, "Eve Engineer", "engineer");
      await insertUser(db, ADMIN, "Ada Admin", "application_admin");
      await insertTeam(db, TEAM, F);
      await insertCompletedSession(db, SESSION, TEAM, F);
      await insertTopic(db, TOPIC_A, TEAM, { displayOrder: 1 });
      await insertTopic(db, TOPIC_B, TEAM, { displayOrder: 2 });
    }

    it("set, read via TOPIC-002 (facilitator and admin), markup round-trips byte-for-byte, audit carries no text", async () => {
      const { db } = mods;
      try {
        await setup(db);
        const app = await buildApp(F);

        const markup = "<script>alert(1)</script>";
        const res = await putAnnotation(app, TEAM, TOPIC_A, markup);
        expect(res.statusCode).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.json()).toMatchObject({
          topicId: TOPIC_A,
          teamAnnotation: markup,
          annotationUpdatedBy: { userId: F, displayName: "Fran Facilitator" },
        });

        const stored = await db.query(
          `SELECT team_annotation, annotation_updated_by, annotation_updated_at, updated_at, created_at FROM topics WHERE id = $1`,
          [TOPIC_A],
        );
        expect(stored.rows[0]?.team_annotation).toBe(markup);
        expect(stored.rows[0]?.annotation_updated_by).toBe(F);
        expect(stored.rows[0]?.annotation_updated_at).not.toBeNull();

        const all = await app.inject({ method: "GET", url: `/api/v1/teams/${TEAM}/topics/all` });
        const allBody = all.json();
        expect(allBody.canEditAnnotations).toBe(true);
        const entry = allBody.active.find((t: { topicId: string }) => t.topicId === TOPIC_A);
        expect(entry.teamAnnotation).toBe(markup);
        expect(entry.annotationUpdatedBy).toEqual({ userId: F, displayName: "Fran Facilitator" });
        const other = allBody.active.find((t: { topicId: string }) => t.topicId === TOPIC_B);
        expect(other).toMatchObject({ teamAnnotation: null, annotationUpdatedAt: null, annotationUpdatedBy: null });

        const adminApp = await buildApp(ADMIN);
        const adminAll = (await adminApp.inject({ method: "GET", url: `/api/v1/teams/${TEAM}/topics/all` })).json();
        expect(adminAll.canEditAnnotations).toBe(false);
        const adminEntry = adminAll.active.find((t: { topicId: string }) => t.topicId === TOPIC_A);
        expect(adminEntry.teamAnnotation).toBe(markup);
        expect(adminEntry.annotationUpdatedBy).toEqual({ userId: F, displayName: "Fran Facilitator" });

        // Admin cannot write (FR-8.7), and nothing changes.
        const adminPut = await putAnnotation(adminApp, TEAM, TOPIC_A, "Admin wording");
        expect(adminPut.statusCode).toBe(403);
        expect(adminPut.json().error.code).toBe("NOT_A_FACILITATOR");
        expect(adminPut.headers["cache-control"]).toBe("no-store");
        const afterAdmin = await db.query(`SELECT team_annotation, annotation_updated_by FROM topics WHERE id = $1`, [TOPIC_A]);
        expect(afterAdmin.rows[0]).toEqual({ team_annotation: markup, annotation_updated_by: F });

        const audit = await db.query<{ metadata: Record<string, unknown> }>(
          `SELECT metadata FROM audit_log WHERE team_id = $1 AND operation = 'topic.annotation_updated'`,
          [TEAM],
        );
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0]?.metadata).toEqual({ topic_id: TOPIC_A, action: "set", length: markup.length });
      } finally {
        await cleanup(db, [TEAM], [F, ENGINEER, ADMIN]);
      }
    });

    it("sentinel text never reaches audit_log on set or clear", async () => {
      const { db } = mods;
      const sentinel = "ZQX-annotation-sentinel-7781";
      try {
        await setup(db);
        const app = await buildApp(F);
        expect((await putAnnotation(app, TEAM, TOPIC_A, sentinel)).statusCode).toBe(200);
        expect((await putAnnotation(app, TEAM, TOPIC_A, "")).statusCode).toBe(200);
        const rejected = await putAnnotation(app, TEAM, TOPIC_A, `${sentinel}\u0000`);
        expect(rejected.statusCode).toBe(422);
        expect(rejected.body).not.toContain(sentinel);

        const audit = await db.query<{ metadata: unknown; operation: string }>(
          `SELECT operation, metadata FROM audit_log WHERE team_id = $1`,
          [TEAM],
        );
        expect(audit.rows.filter((r) => r.operation === "topic.annotation_updated")).toHaveLength(2);
        for (const row of audit.rows) {
          expect(JSON.stringify(row.metadata)).not.toContain(sentinel);
        }
        const cleared = audit.rows.map((r) => r.metadata as { action?: string; length?: number }).find((m) => m.action === "cleared");
        expect(cleared).toMatchObject({ action: "cleared", length: 0 });
      } finally {
        await cleanup(db, [TEAM], [F, ENGINEER, ADMIN]);
      }
    });

    it("U+0000 is a 422, never a Postgres 22021 500", async () => {
      const { db } = mods;
      try {
        await setup(db);
        const app = await buildApp(F);
        const res = await putAnnotation(app, TEAM, TOPIC_A, "a\u0000b");
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe("INVALID_ANNOTATION");
      } finally {
        await cleanup(db, [TEAM], [F, ENGINEER, ADMIN]);
      }
    });

    it("annotate a custom topic, archive, restore: TOPIC-002 returns the text with the original provenance (5.4)", async () => {
      const { db } = mods;
      try {
        await setup(db);
        const app = await buildApp(F);

        const set = await putAnnotation(app, TEAM, TOPIC_A, "X");
        expect(set.statusCode).toBe(200);
        const originalAt = set.json().annotationUpdatedAt as string;

        const archive = await app.inject({ method: "DELETE", url: `/api/v1/teams/${TEAM}/topics/${TOPIC_A}` });
        expect(archive.statusCode).toBe(200);

        const archivedView = (await app.inject({ method: "GET", url: `/api/v1/teams/${TEAM}/topics/all` })).json();
        const archivedEntry = archivedView.archived.find((t: { topicId: string }) => t.topicId === TOPIC_A);
        expect(archivedEntry).toMatchObject({
          teamAnnotation: "X",
          annotationUpdatedAt: originalAt,
          annotationUpdatedBy: { userId: F, displayName: "Fran Facilitator" },
        });

        // Archived topics cannot be annotated.
        const onArchived = await putAnnotation(app, TEAM, TOPIC_A, "Y");
        expect(onArchived.statusCode).toBe(422);
        expect(onArchived.json().error.code).toBe("TOPIC_ALREADY_ARCHIVED");

        const restore = await app.inject({ method: "POST", url: `/api/v1/teams/${TEAM}/topics/${TOPIC_A}/restore` });
        expect(restore.statusCode).toBe(200);

        const activeView = (await app.inject({ method: "GET", url: `/api/v1/teams/${TEAM}/topics/all` })).json();
        const activeEntry = activeView.active.find((t: { topicId: string }) => t.topicId === TOPIC_A);
        expect(activeEntry).toMatchObject({
          isDefault: false,
          teamAnnotation: "X",
          annotationUpdatedAt: originalAt,
          annotationUpdatedBy: { userId: F, displayName: "Fran Facilitator" },
        });
      } finally {
        await cleanup(db, [TEAM], [F, ENGINEER, ADMIN]);
      }
    });

    it("TOPIC-001 topic entries carry no annotation fields (security R7)", async () => {
      const { db } = mods;
      try {
        await setup(db);
        await db.query(
          `UPDATE topics SET team_annotation = 'X', annotation_updated_by = $2, annotation_updated_at = NOW() WHERE id = $1`,
          [TOPIC_A, F],
        );
        await db.query(`INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'participant')`, [
          TEAM,
          ENGINEER,
        ]);

        const app = await buildApp(ENGINEER);
        const res = await app.inject({ method: "GET", url: `/api/v1/teams/${TEAM}/topics` });
        expect(res.statusCode).toBe(200);
        const topics = res.json().topics as Array<Record<string, unknown>>;
        expect(topics.length).toBeGreaterThan(0);
        for (const topic of topics) {
          for (const key of ["teamAnnotation", "team_annotation", "annotationUpdatedBy", "annotationUpdatedAt"]) {
            expect(topic).not.toHaveProperty(key);
          }
        }
      } finally {
        await db.query(`DELETE FROM team_memberships WHERE team_id = $1`, [TEAM]);
        await cleanup(db, [TEAM], [F, ENGINEER, ADMIN]);
      }
    });

    // Security implementation review N2: team scoping (IDOR) holds in real
    // SQL, not only in SQL-text assertions.
    it("a topic ID from another team under this team's URL returns 404 and changes neither row", async () => {
      const { db } = mods;
      try {
        await setup(db);
        await insertTeam(db, OTHER_TEAM, F);
        await insertTopic(db, OTHER_TOPIC, OTHER_TEAM, { displayOrder: 1 });

        const app = await buildApp(F);
        const res = await putAnnotation(app, TEAM, OTHER_TOPIC, "Cross-team write");
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("TOPIC_NOT_FOUND");

        const rows = await db.query<{ id: string; team_annotation: string | null; annotation_updated_by: string | null }>(
          `SELECT id, team_annotation, annotation_updated_by FROM topics WHERE id = ANY($1::uuid[]) ORDER BY id`,
          [[TOPIC_A, OTHER_TOPIC]],
        );
        expect(rows.rows).toHaveLength(2);
        for (const row of rows.rows) {
          expect(row.team_annotation).toBeNull();
          expect(row.annotation_updated_by).toBeNull();
        }
      } finally {
        await cleanup(db, [TEAM, OTHER_TEAM], [F, ENGINEER, ADMIN]);
      }
    });

    // Security implementation review S1. TOPIC-001 still answers 200 to an
    // engineering manager (handoffs/new-issue-topic-001-em-and-casing.md),
    // which is the reason TOPIC-001 must never return the team's definition
    // until EMs are denied there. If this fails because the fields were
    // added, deny EMs on TOPIC-001 first -- do not relax this test.
    it("TOPIC-001 called by an engineering manager returns no annotation fields (security S1)", async () => {
      const { db } = mods;
      try {
        await setup(db);
        await insertUser(db, EM, "Emma Manager", "engineering_manager");
        await db.query(
          `UPDATE topics SET team_annotation = 'Sensitive team wording', annotation_updated_by = $2, annotation_updated_at = NOW()
            WHERE id = $1`,
          [TOPIC_A, F],
        );
        await db.query(`INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'engineering_manager')`, [
          TEAM,
          EM,
        ]);

        const app = await buildApp(EM);
        const res = await app.inject({ method: "GET", url: `/api/v1/teams/${TEAM}/topics` });
        expect(res.statusCode).toBe(200);
        expect(res.body).not.toContain("Sensitive team wording");
        const topics = res.json().topics as Array<Record<string, unknown>>;
        expect(topics.some((topic) => topic["id"] === TOPIC_A || topic["topicId"] === TOPIC_A)).toBe(true);
        for (const topic of topics) {
          for (const key of ["teamAnnotation", "team_annotation", "annotationUpdatedBy", "annotationUpdatedAt"]) {
            expect(topic).not.toHaveProperty(key);
          }
        }
      } finally {
        await db.query(`DELETE FROM team_memberships WHERE team_id = $1`, [TEAM]);
        await cleanup(db, [TEAM], [F, ENGINEER, ADMIN, EM]);
      }
    });

    it("a non-UUID teamId behaves exactly as on TOPIC-006 (shared auth layer, unchanged by this change)", async () => {
      const { db } = mods;
      try {
        await setup(db);
        const app = await buildApp(F);
        const annotation = await putAnnotation(app, "not-a-uuid", TOPIC_A, "X");
        const order = await app.inject({
          method: "PUT",
          url: `/api/v1/teams/not-a-uuid/topics/order`,
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({ orderedTopicIds: [TOPIC_A] }),
        });
        expect(annotation.statusCode).toBe(order.statusCode);
        expect(annotation.headers["cache-control"]).toBe("no-store");
      } finally {
        await cleanup(db, [TEAM], [F, ENGINEER, ADMIN]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5.5 — annotating a team's default topic leaves the template team's row
  // (and every other team's row) untouched.
  // -------------------------------------------------------------------------
  describe("template isolation (tasks.md 5.5)", () => {
    const F = "e7a00000-0000-4000-8000-00000000a101";
    const TEAM = "e7a00000-0000-4000-8000-00000000b101";
    const OTHER_TEAM = "e7a00000-0000-4000-8000-00000000b102";
    const SESSION = "e7a00000-0000-4000-8000-00000000c101";
    const TOPIC = "e7a00000-0000-4000-8000-00000000d101";
    const OTHER_TOPIC = "e7a00000-0000-4000-8000-00000000d102";

    it("the template row and another team's copy of the same default topic stay NULL", async () => {
      const { db } = mods;
      try {
        const template = await db.query<{ id: string; name: string }>(
          `SELECT id, name FROM topics WHERE team_id = $1 AND is_default = true ORDER BY display_order LIMIT 1`,
          [SENTINEL_TEAM_ID],
        );
        const templateRow = template.rows[0];
        expect(templateRow).toBeDefined();
        const defaultName = templateRow!.name;

        await insertUser(db, F, "Fran Facilitator");
        await insertTeam(db, TEAM, F);
        await insertTeam(db, OTHER_TEAM, F);
        await insertCompletedSession(db, SESSION, TEAM, F);
        await insertTopic(db, TOPIC, TEAM, { name: defaultName, isDefault: true });
        await insertTopic(db, OTHER_TOPIC, OTHER_TEAM, { name: defaultName, isDefault: true });

        const app = await buildApp(F);
        const res = await putAnnotation(app, TEAM, TOPIC, "Our meaning of this default topic");
        expect(res.statusCode).toBe(200);

        const rows = await db.query<{ team_id: string; team_annotation: string | null; annotation_updated_by: string | null; annotation_updated_at: Date | null }>(
          `SELECT team_id, team_annotation, annotation_updated_by, annotation_updated_at
             FROM topics WHERE name = $1 AND team_id = ANY($2::uuid[])`,
          [defaultName, [SENTINEL_TEAM_ID, OTHER_TEAM, TEAM]],
        );
        const byTeam = new Map(rows.rows.map((r) => [r.team_id, r]));
        expect(byTeam.get(TEAM)?.team_annotation).toBe("Our meaning of this default topic");
        expect(byTeam.get(OTHER_TEAM)).toMatchObject({
          team_annotation: null,
          annotation_updated_by: null,
          annotation_updated_at: null,
        });
        // The template is checked as a whole rather than by name: the
        // parallel default-topic-provisioning suite may have atomically
        // swapped the template's rows (and names) since templateRow was read.
        const annotatedTemplateRows = await db.query(
          `SELECT id FROM topics
            WHERE team_id = $1 AND (team_annotation IS NOT NULL OR annotation_updated_by = $2)`,
          [SENTINEL_TEAM_ID, F],
        );
        expect(annotatedTemplateRows.rows).toHaveLength(0);
      } finally {
        await cleanup(db, [TEAM, OTHER_TEAM], [F]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 6.4 — REQUIRED NEGATIVE TEST (do not drop). SESSION-005 and SESSION-012
  // return the session_topics snapshot, never the live topics value.
  // -------------------------------------------------------------------------
  describe("session payloads read the snapshot, never the live topic (tasks.md 6.4)", () => {
    const F = "e7a00000-0000-4000-8000-00000000a201";
    const TEAM = "e7a00000-0000-4000-8000-00000000b201";
    const SESSION = "e7a00000-0000-4000-8000-00000000c201";
    const TOPIC_1 = "e7a00000-0000-4000-8000-00000000d201";
    const TOPIC_2 = "e7a00000-0000-4000-8000-00000000d202";

    it("after topics.team_annotation is set to 'Y', SESSION-005 and SESSION-012 still return 'X'", async () => {
      const { db } = mods;
      try {
        await insertUser(db, F, "Fran Facilitator");
        await insertTeam(db, TEAM, F);
        await insertTopic(db, TOPIC_1, TEAM, { displayOrder: 1 });
        await insertTopic(db, TOPIC_2, TEAM, { displayOrder: 2 });
        await db.query(
          `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number)
           VALUES ($1, $2, $3, 'pre_session', false, 2)`,
          [SESSION, TEAM, F],
        );
        // Fixture snapshot rows (no production code writes session_topics
        // yet, #175). The source topics carry 'X' at snapshot time.
        await db.query(`UPDATE topics SET team_annotation = 'X' WHERE id = ANY($1::uuid[])`, [[TOPIC_1, TOPIC_2]]);
        await db.query(
          `INSERT INTO session_topics (session_id, topic_id, display_order, topic_name, topic_prompt, vote_type, topic_annotation)
           SELECT $1, t.id, t.display_order, t.name, t.prompt, t.vote_type, t.team_annotation
             FROM topics t WHERE t.id = ANY($2::uuid[])`,
          [SESSION, [TOPIC_1, TOPIC_2]],
        );

        // The live edit, after the snapshot exists.
        await db.query(`UPDATE topics SET team_annotation = 'Y' WHERE id = ANY($1::uuid[])`, [[TOPIC_1, TOPIC_2]]);

        const app = await buildApp(F);

        const begin = await app.inject({ method: "POST", url: `/api/v1/sessions/${SESSION}/begin-voting` });
        expect(begin.statusCode).toBe(200);
        expect(begin.json().currentTopic.topicAnnotation).toBe("X");

        // Reveal the first topic directly (the reveal flow itself is not
        // under test here), then advance.
        await db.query(
          `UPDATE session_topics SET status = 'revealed', revealed_at = NOW() WHERE session_id = $1 AND topic_id = $2`,
          [SESSION, TOPIC_1],
        );
        const advance = await app.inject({
          method: "POST",
          url: `/api/v1/teams/${TEAM}/sessions/${SESSION}/topics/advance`,
        });
        expect(advance.statusCode).toBe(200);
        expect(advance.json().status).toBe("active");
        expect(advance.json().currentTopic.topicAnnotation).toBe("X");

        // And the snapshot itself is unchanged by the live edit.
        const snapshot = await db.query<{ topic_annotation: string | null }>(
          `SELECT topic_annotation FROM session_topics WHERE session_id = $1 ORDER BY display_order`,
          [SESSION],
        );
        expect(snapshot.rows.map((r) => r.topic_annotation)).toEqual(["X", "X"]);
      } finally {
        await cleanup(db, [TEAM], [F]);
      }
    });

    it("a NULL snapshot returns null even when the live topic is annotated", async () => {
      const { db } = mods;
      try {
        await insertUser(db, F, "Fran Facilitator");
        await insertTeam(db, TEAM, F);
        await insertTopic(db, TOPIC_1, TEAM, { displayOrder: 1 });
        await db.query(
          `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number)
           VALUES ($1, $2, $3, 'pre_session', false, 2)`,
          [SESSION, TEAM, F],
        );
        await db.query(
          `INSERT INTO session_topics (session_id, topic_id, display_order, topic_name, topic_prompt, vote_type)
           VALUES ($1, $2, 1, 'T', 'P?', 'finger')`,
          [SESSION, TOPIC_1],
        );
        await db.query(`UPDATE topics SET team_annotation = 'Y' WHERE id = $1`, [TOPIC_1]);

        const app = await buildApp(F);
        const begin = await app.inject({ method: "POST", url: `/api/v1/sessions/${SESSION}/begin-voting` });
        expect(begin.statusCode).toBe(200);
        expect(begin.json().currentTopic.topicAnnotation).toBeNull();
      } finally {
        await cleanup(db, [TEAM], [F]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 7.2 — new-team seeding never copies an annotation from the template.
  // -------------------------------------------------------------------------
  describe("seed isolation (tasks.md 7.2)", () => {
    const F = "e7a00000-0000-4000-8000-00000000a301";

    it("a new team's topics have all three annotation columns NULL even when a template topic is annotated", async () => {
      const { db } = mods;
      let newTeamId: string | undefined;
      let templateTopicId: string | undefined;
      try {
        await insertUser(db, F, "Fran Facilitator");

        // Annotate an existing template row in place (no new rows, so the
        // parallel default-topic-provisioning suite's row counts are not
        // disturbed). That suite's swap is atomic (#175 tasks.md 1.6), so the
        // subquery always sees a row, but the UPDATE can still lose a row
        // deleted by a concurrent swap after the subquery chose it; hence
        // the brief retry stays.
        for (let attempt = 0; attempt < 5 && !templateTopicId; attempt++) {
          const updated = await db.query<{ id: string }>(
            `UPDATE topics
                SET team_annotation = 'Template definition', annotation_updated_by = $2, annotation_updated_at = NOW()
              WHERE id = (SELECT id FROM topics WHERE team_id = $1 AND is_default = true ORDER BY display_order LIMIT 1)
              RETURNING id`,
            [SENTINEL_TEAM_ID, F],
          );
          templateTopicId = updated.rows[0]?.id;
        }
        expect(templateTopicId).toBeDefined();

        const app = await buildApp(F);
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/teams",
          payload: { name: `Annotation Seed Isolation ${F.slice(-6)}` },
        });
        expect(res.statusCode).toBe(201);
        newTeamId = res.json().teamId as string;

        const rows = await db.query<{ n: string; annotated: string }>(
          `SELECT COUNT(*) AS n,
                  COUNT(*) FILTER (WHERE team_annotation IS NOT NULL
                                      OR annotation_updated_by IS NOT NULL
                                      OR annotation_updated_at IS NOT NULL) AS annotated
             FROM topics WHERE team_id = $1`,
          [newTeamId],
        );
        expect(Number(rows.rows[0]?.n)).toBeGreaterThan(0);
        expect(rows.rows[0]?.annotated).toBe("0");
      } finally {
        if (templateTopicId) {
          await db.query(
            `UPDATE topics SET team_annotation = NULL, annotation_updated_by = NULL, annotation_updated_at = NULL WHERE id = $1`,
            [templateTopicId],
          );
        }
        // Belt and braces: no template row may keep a reference to F.
        await db.query(
          `UPDATE topics SET team_annotation = NULL, annotation_updated_by = NULL, annotation_updated_at = NULL
            WHERE team_id = $1 AND annotation_updated_by = $2`,
          [SENTINEL_TEAM_ID, F],
        );
        await cleanup(db, newTeamId ? [newTeamId] : [], [F]);
      }
    });
  });
});
