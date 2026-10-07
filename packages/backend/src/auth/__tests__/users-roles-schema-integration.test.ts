import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { Fixture, insertUser, probeInfra, requireInfraOrThrow } from "../../routes/__tests__/helpers/real-db.js";
import { GLOBAL_ROLES, type GlobalRole } from "../role-map.js";
import type { db as Db } from "../../db.js";
import { TRANSACTIONAL_AUDIT_STATEMENT_TIMEOUT_MS } from "../audit-write-transaction.js";

// ---------------------------------------------------------------------------
// store-idp-role-set (#245), real Postgres: the users.roles schema
// (migration 21) and audit_log.actor_roles (migration 22).
//
//   1.3  enum order = pg_enum.enumsortorder (design D11)
//   3.1  users_roles_consistent: one negative row per rule, the malformed
//        arrays, the stated-roles UPDATE, 22P02, and each positive row shape
//        (design D2)
//   3.2  migrations 21 and 22: Up -> Down -> Up in a scratch schema (D10)
//   3.3  the legacy-writer shim against the previous build's upsert (D13)
//   3.4  lock_timeout behaviour of both migrations, including an audit
//        INSERT queued behind migration 22 (D9)
//
// The integration lane migrates before tests run, so migration tests slice
// the Up / Down sections out of the files and run them against scratch
// copies of the tables with `search_path` pointing at the scratch schema
// first (topic-annotation-integration.test.ts precedent). They never touch
// public.users or public.audit_log DDL.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "users-roles-schema-integration.test.ts");

const MIGRATION_21 = fileURLToPath(new URL("../../../migrations/21_users_roles.sql", import.meta.url));
const MIGRATION_22 = fileURLToPath(new URL("../../../migrations/22_audit_log_actor_roles.sql", import.meta.url));

async function sections(path: string): Promise<{ up: string; down: string }> {
  const sql = await readFile(path, "utf8");
  const upIndex = sql.indexOf("-- Up Migration");
  const downIndex = sql.indexOf("-- Down Migration");
  expect(upIndex).toBeGreaterThanOrEqual(0);
  expect(downIndex).toBeGreaterThan(upIndex);
  return { up: sql.slice(upIndex, downIndex), down: sql.slice(downIndex) };
}

function scratchName(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** The SQLSTATE a query fails with, or null when it succeeds. */
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

const ROLE_COMBOS: readonly GlobalRole[] = GLOBAL_ROLES;

/** Seeds one user per global_role into <schema>.users (pre-21 shape). */
async function seedScratchUsers(client: pg.PoolClient | typeof Db, schema: string): Promise<void> {
  for (const role of ROLE_COMBOS) {
    await client.query(
      `INSERT INTO ${schema}.users (oidc_subject, oidc_issuer, display_name, email, global_role)
       VALUES ($1, 'scratch', 'Scratch', 'scratch@example.test', $2)`,
      [`scratch-${role}`, role],
    );
  }
}

/** Creates <schema>.users in the pre-21 shape: no roles, no CHECK, no trigger. */
function preTwentyOneUsersSql(schema: string): string {
  return `CREATE TABLE ${schema}.users (LIKE public.users INCLUDING ALL EXCLUDING CONSTRAINTS);
          ALTER TABLE ${schema}.users DROP COLUMN roles;`;
}

/** Creates <schema>.audit_log in the pre-22 shape. */
function preTwentyTwoAuditLogSql(schema: string): string {
  return `CREATE TABLE ${schema}.audit_log (LIKE public.audit_log INCLUDING ALL);
          ALTER TABLE ${schema}.audit_log DROP COLUMN actor_roles;`;
}

async function waitUntilWaitingOnLock(observer: typeof Db, pid: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await observer.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [pid]);
    if ((res.rowCount ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error(`backend ${pid} never waited on a lock`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function pidOf(client: pg.PoolClient): Promise<number> {
  return (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
}

describe.skipIf(!infraUp)("users.roles schema and audit_log.actor_roles (real Postgres, store-idp-role-set)", () => {
  let db: typeof Db;
  let fixture: Fixture;

  beforeAll(async () => {
    ({ db } = await import("../../db.js"));
    fixture = new Fixture(db);
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  // -------------------------------------------------------------------------
  // 1.3 — D11: the enum's sort order is the precedence order
  // -------------------------------------------------------------------------
  it("GLOBAL_ROLES order equals pg_enum.enumsortorder for user_role (task 1.3)", async () => {
    const res = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.user_role'::regtype ORDER BY enumsortorder`,
    );
    expect(res.rows.map((r) => r.enumlabel)).toEqual([...GLOBAL_ROLES]);
  });

  // -------------------------------------------------------------------------
  // 3.1 — D2: users_roles_consistent
  // -------------------------------------------------------------------------
  describe("users_roles_consistent (task 3.1)", () => {
    const INSERT = `INSERT INTO users (oidc_subject, oidc_issuer, display_name, email, global_role, roles)
                    VALUES ('chk-' || gen_random_uuid(), 'schema-test', 'Check', 'check@example.test', $1, $2::user_role[])`;

    async function inRolledBackTransaction(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await fn(client);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }

    it.each([
      ["rule 1: empty set", "engineer", "{}"],
      ["rule 2: first element is not global_role", "facilitator", "{engineering_manager,facilitator}"],
      ["rule 2: global_role not in the set", "application_admin", "{facilitator}"],
      ["rule 3: engineer with another role", "senior_engineer", "{senior_engineer,engineer}"],
      ["rule 4: duplicate", "facilitator", "{facilitator,facilitator}"],
      ["rule 4: ascending order", "facilitator", "{facilitator,application_admin}"],
      ["shape: NULL element", "engineer", "{NULL}"],
      ["shape: trailing NULL element", "application_admin", "{application_admin,NULL}"],
      ["shape: lower bound 0", "facilitator", "[0:1]={application_admin,facilitator}"],
      ["shape: two dimensions", "facilitator", "{{facilitator}}"],
    ])("rejects %s with 23514", async (_label, globalRole, roles) => {
      await inRolledBackTransaction(async (client) => {
        expect(await sqlState(client, INSERT, [globalRole, roles])).toBe("23514");
      });
    });

    it("an UPDATE that changes global_role while stating an inconsistent roles fails 23514 (the shim does not swallow it)", async () => {
      await inRolledBackTransaction(async (client) => {
        const id = await insertUser(client, { roles: ["facilitator"] });
        expect(
          await sqlState(
            client,
            `UPDATE users SET global_role = 'engineering_manager', roles = '{facilitator,senior_engineer}' WHERE id = $1`,
            [id],
          ),
        ).toBe("23514");
        const row = await client.query(`SELECT global_role, roles::text[] AS roles FROM users WHERE id = $1`, [id]);
        expect(row.rows[0]).toEqual({ global_role: "facilitator", roles: ["facilitator"] });
      });
    });

    it("a label outside the enum fails with 22P02", async () => {
      await inRolledBackTransaction(async (client) => {
        expect(await sqlState(client, INSERT, ["engineer", "{toString}"])).toBe("22P02");
        expect(await sqlState(client, `SELECT '{toString}'::user_role[]`)).toBe("22P02");
      });
    });

    it.each([
      ["missing or unmapped claim", ["engineer"]],
      ["a single mapped role", ["facilitator"]],
      ["a multi-role mapped set", ["application_admin", "engineering_manager", "facilitator", "senior_engineer"]],
    ] as const)("accepts the row shape for %s", async (_label, roles) => {
      await inRolledBackTransaction(async (client) => {
        expect(await sqlState(client, INSERT, [roles[0], [...roles]])).toBeNull();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3.2 — D10: Up -> Down -> Up against scratch copies
  // -------------------------------------------------------------------------
  describe("migrations Up -> Down -> Up in a scratch schema (task 3.2)", () => {
    it("migration 21 backfills, adds the constraint and trigger with no default, and down removes exactly them", async () => {
      const { up, down } = await sections(MIGRATION_21);
      const schema = scratchName("mig21");
      const client = await db.connect();

      async function shape() {
        const column = await client.query<{ column_default: string | null; is_nullable: string }>(
          `SELECT column_default, is_nullable FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'users' AND column_name = 'roles'`,
          [schema],
        );
        const constraint = await client.query(
          `SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = 'users' AND con.conname = 'users_roles_consistent'`,
          [schema],
        );
        const trigger = await client.query(
          `SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = 'users' AND t.tgname = 'users_roles_fill_legacy'`,
          [schema],
        );
        const functions = await client.query<{ proname: string }>(
          `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = $1 ORDER BY p.proname`,
          [schema],
        );
        return {
          column: column.rows[0] ?? null,
          hasConstraint: (constraint.rowCount ?? 0) > 0,
          hasTrigger: (trigger.rowCount ?? 0) > 0,
          functions: functions.rows.map((r) => r.proname),
        };
      }

      async function rolesByGlobalRole() {
        const res = await client.query<{ global_role: string; roles: string[] }>(
          `SELECT global_role, roles::text[] AS roles FROM ${schema}.users ORDER BY oidc_subject`,
        );
        return res.rows;
      }

      async function globalRoles() {
        const res = await client.query<{ oidc_subject: string; global_role: string }>(
          `SELECT oidc_subject, global_role FROM ${schema}.users ORDER BY oidc_subject`,
        );
        return res.rows;
      }

      try {
        await client.query("BEGIN");
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(preTwentyOneUsersSql(schema));
        await seedScratchUsers(client, schema);
        const before = await globalRoles();
        await client.query(`SET LOCAL search_path TO ${schema}, public`);

        for (const pass of ["first", "second"]) {
          await client.query(up);
          const afterUp = await shape();
          expect(afterUp.column, `${pass} up`).toEqual({ column_default: null, is_nullable: "NO" });
          expect(afterUp.hasConstraint).toBe(true);
          expect(afterUp.hasTrigger).toBe(true);
          expect(afterUp.functions).toEqual(["users_roles_fill_legacy", "users_roles_well_formed"]);
          for (const row of await rolesByGlobalRole()) expect(row.roles).toEqual([row.global_role]);
          expect(await globalRoles()).toEqual(before);

          if (pass === "first") {
            await client.query(down);
            const afterDown = await shape();
            expect(afterDown).toEqual({ column: null, hasConstraint: false, hasTrigger: false, functions: [] });
            expect(await globalRoles()).toEqual(before);
          }
        }

        // public objects untouched.
        const publicState = await client.query(
          `SELECT
             (SELECT count(*) FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'roles')::int AS roles_column,
             (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.users'::regclass AND tgname = 'users_roles_fill_legacy')::int AS trigger,
             (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname = 'users_roles_consistent')::int AS constraint_count,
             (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname IN ('users_roles_well_formed', 'users_roles_fill_legacy'))::int AS functions`,
        );
        expect(publicState.rows[0]).toEqual({ roles_column: 1, trigger: 1, constraint_count: 1, functions: 2 });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("migration 22 adds actor_roles TEXT[] NULL with its comment against a scratch audit_log, and down removes it", async () => {
      const { up, down } = await sections(MIGRATION_22);
      const schema = scratchName("mig22");
      const client = await db.connect();

      async function column() {
        const res = await client.query<{ data_type: string; is_nullable: string; column_default: string | null; comment: string | null }>(
          `SELECT c.data_type, c.is_nullable, c.column_default,
                  col_description(format('%I.audit_log', $1::text)::regclass, c.ordinal_position::int) AS comment
             FROM information_schema.columns c
            WHERE c.table_schema = $1 AND c.table_name = 'audit_log' AND c.column_name = 'actor_roles'`,
          [schema],
        );
        return res.rows[0] ?? null;
      }

      try {
        await client.query("BEGIN");
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(preTwentyTwoAuditLogSql(schema));
        await client.query(`SET LOCAL search_path TO ${schema}, public`);

        await client.query(up);
        const afterUp = await column();
        expect(afterUp).toMatchObject({ data_type: "ARRAY", is_nullable: "YES", column_default: null });
        expect(afterUp!.comment).toContain("NULL means the actor's role set was not captured");

        await client.query(down);
        expect(await column()).toBeNull();

        await client.query(up);
        expect(await column()).toMatchObject({ data_type: "ARRAY", is_nullable: "YES" });

        const publicColumn = await client.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'actor_roles'`,
        );
        expect(publicColumn.rowCount).toBe(1);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3.3 — D13: the previous build's upsert (global_role only) still works
  // -------------------------------------------------------------------------
  describe("legacy-writer shim (task 3.3)", () => {
    // Verbatim from auth/account-resolver.ts before #245 (main @ cc3a66f).
    const LEGACY_UPSERT = `WITH prior AS (
       SELECT global_role FROM users WHERE oidc_subject = $1 AND oidc_issuer = $2
     )
     INSERT INTO users (oidc_subject, oidc_issuer, display_name, email, global_role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (oidc_subject, oidc_issuer)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       email = EXCLUDED.email,
       global_role = EXCLUDED.global_role,
       updated_at = NOW()
     RETURNING id, oidc_subject, oidc_issuer, display_name, email, global_role,
               (xmax = 0) AS is_new_user,
               (SELECT global_role FROM prior) AS previous_global_role`;
    const ISSUER = "https://idp.legacy-writer.test";

    async function legacySignIn(subject: string, role: GlobalRole, issuer = ISSUER) {
      const res = await db.query<{ id: string; global_role: string; is_new_user: boolean }>(LEGACY_UPSERT, [
        subject,
        issuer,
        "Legacy Writer",
        `${subject}@example.test`,
        role,
      ]);
      return res.rows[0]!;
    }

    async function storedRoles(id: string): Promise<string[]> {
      const res = await db.query<{ roles: string[] }>(`SELECT roles::text[] AS roles FROM users WHERE id = $1`, [id]);
      return res.rows[0]!.roles;
    }

    const legacyIds: string[] = [];
    afterAll(async () => {
      if (legacyIds.length > 0) await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [legacyIds]);
    });

    it("(a) a first sign-in as facilitator succeeds with roles = [facilitator]", async () => {
      const row = await legacySignIn(`legacy-${randomUUID()}`, "facilitator");
      legacyIds.push(row.id);
      expect(row.is_new_user).toBe(true);
      expect(await storedRoles(row.id)).toEqual(["facilitator"]);
    });

    it("(b) a returning {facilitator} user re-signed as engineer succeeds with roles = [engineer]", async () => {
      const subject = `legacy-${randomUUID()}`;
      const first = await legacySignIn(subject, "facilitator");
      legacyIds.push(first.id);
      const second = await legacySignIn(subject, "engineer");
      expect(second.is_new_user).toBe(false);
      expect(second.global_role).toBe("engineer");
      expect(await storedRoles(first.id)).toEqual(["engineer"]);
    });

    it("(c) a stored {application_admin, engineering_manager} user re-signed as application_admin keeps the set", async () => {
      const id = await fixture.user(["application_admin", "engineering_manager"]);
      const row = await legacySignIn(`sub-${id}`, "application_admin", "test-issuer");
      expect(row.id).toBe(id);
      expect(row.is_new_user).toBe(false);
      expect(await storedRoles(id)).toEqual(["application_admin", "engineering_manager"]);
    });

    it("(d) the revocation runbook statement writes both columns", async () => {
      const id = await fixture.user(["engineering_manager", "facilitator"]);
      await db.query(`UPDATE users SET global_role = 'engineer', roles = '{engineer}' WHERE id = $1`, [id]);
      const res = await db.query(`SELECT global_role, roles::text[] AS roles FROM users WHERE id = $1`, [id]);
      expect(res.rows[0]).toEqual({ global_role: "engineer", roles: ["engineer"] });
    });
  });

  // -------------------------------------------------------------------------
  // 3.4 — D9/D10: lock_timeout. Needs a committed scratch schema that other
  // connections can see.
  // -------------------------------------------------------------------------
  describe("lock timeouts (task 3.4)", () => {
    it(
      "migration 21 fails with 55P03 within about 5 s while users is locked, changes nothing, and succeeds once released",
      async () => {
        const { up } = await sections(MIGRATION_21);
        const schema = scratchName("lock21");
        const blocker = await db.connect();
        const migrator = await db.connect();
        try {
          await db.query(`CREATE SCHEMA ${schema}`);
          await db.query(preTwentyOneUsersSql(schema));
          await seedScratchUsers(db, schema);

          await blocker.query("BEGIN");
          await blocker.query(`LOCK TABLE ${schema}.users IN ACCESS SHARE MODE`);

          await migrator.query("BEGIN");
          await migrator.query(`SET LOCAL search_path TO ${schema}, public`);
          const started = Date.now();
          let code: string | undefined;
          try {
            await migrator.query(up);
          } catch (err) {
            code = (err as { code?: string }).code;
          }
          const elapsed = Date.now() - started;
          await migrator.query("ROLLBACK");

          expect(code).toBe("55P03");
          expect(elapsed).toBeGreaterThanOrEqual(4500);
          expect(elapsed).toBeLessThan(7000);

          const columns = await db.query(
            `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'users' AND column_name = 'roles'`,
            [schema],
          );
          expect(columns.rowCount).toBe(0);
          const roles = await db.query<{ oidc_subject: string; global_role: string }>(
            `SELECT oidc_subject, global_role FROM ${schema}.users ORDER BY oidc_subject`,
          );
          expect(roles.rows.map((r) => r.global_role).sort()).toEqual([...GLOBAL_ROLES].sort());
          for (const r of roles.rows) expect(r.oidc_subject).toBe(`scratch-${r.global_role}`);

          await blocker.query("ROLLBACK");

          await migrator.query("BEGIN");
          await migrator.query(`SET LOCAL search_path TO ${schema}, public`);
          await migrator.query(up);
          await migrator.query("COMMIT");
          const after = await db.query<{ global_role: string; roles: string[] }>(
            `SELECT global_role, roles::text[] AS roles FROM ${schema}.users`,
          );
          for (const r of after.rows) expect(r.roles).toEqual([r.global_role]);
        } finally {
          await blocker.query("ROLLBACK").catch(() => undefined);
          await migrator.query("ROLLBACK").catch(() => undefined);
          blocker.release();
          migrator.release();
          await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        }
      },
      30_000,
    );

    describe("migration 22", () => {
      // The production sign-in audit INSERT shape, as the transactional
      // writer issues it (withAuditTransaction: SET LOCAL statement_timeout
      // immediately before the INSERT). Written without actor_roles, so it
      // is valid whether or not migration 22 has applied.
      async function queuedAuditInsert(client: pg.PoolClient, schema: string): Promise<void> {
        await client.query("BEGIN");
        await client.query(`SET LOCAL statement_timeout = ${TRANSACTIONAL_AUDIT_STATEMENT_TIMEOUT_MS}`);
        await client.query(
          `INSERT INTO ${schema}.audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
           VALUES ($1, 'facilitator', '127.0.0.1', 'auth.role_claim_mapped', NULL, $2)`,
          [randomUUID(), JSON.stringify({ globalRole: "facilitator" })],
        );
        await client.query("COMMIT");
      }

      async function withScratchAuditLog(fn: (schema: string, up: string) => Promise<void>): Promise<void> {
        const { up } = await sections(MIGRATION_22);
        const schema = scratchName("lock22");
        await db.query(`CREATE SCHEMA ${schema}`);
        await db.query(preTwentyTwoAuditLogSql(schema));
        try {
          await fn(schema, up);
        } finally {
          await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        }
      }

      async function actorRolesExists(schema: string): Promise<boolean> {
        const res = await db.query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'audit_log' AND column_name = 'actor_roles'`,
          [schema],
        );
        return (res.rowCount ?? 0) > 0;
      }

      it(
        "fails with 55P03 within about 200 ms while audit_log is locked; a queued audit INSERT under the 400 ms timeout succeeds",
        async () => {
          await withScratchAuditLog(async (schema, up) => {
            const blocker = await db.connect();
            const migrator = await db.connect();
            const writer = await db.connect();
            try {
              await blocker.query("BEGIN");
              await blocker.query(`LOCK TABLE ${schema}.audit_log IN ACCESS SHARE MODE`);

              const migratorPid = await pidOf(migrator);
              const started = Date.now();
              const migration = migrator
                .query(`BEGIN; SET LOCAL search_path TO ${schema}, public; ${up} COMMIT;`)
                .then(
                  () => ({ code: null as string | null, elapsed: Date.now() - started }),
                  (err: { code?: string }) => ({ code: err.code ?? "unknown", elapsed: Date.now() - started }),
                );
              await waitUntilWaitingOnLock(db, migratorPid);

              // Queued behind the pending ACCESS EXCLUSIVE request.
              const insert = queuedAuditInsert(writer, schema).then(
                () => null,
                (err: { code?: string }) => err.code ?? "unknown",
              );

              const result = await migration;
              await migrator.query("ROLLBACK").catch(() => undefined);
              expect(result.code).toBe("55P03");
              expect(result.elapsed).toBeLessThan(1000);

              expect(await insert).toBeNull();
              expect(await actorRolesExists(schema)).toBe(false);
              const rows = await db.query(`SELECT count(*)::int AS n FROM ${schema}.audit_log`);
              expect(rows.rows[0]).toEqual({ n: 1 });

              await blocker.query("ROLLBACK");
              await migrator.query(`BEGIN; SET LOCAL search_path TO ${schema}, public; ${up} COMMIT;`);
              expect(await actorRolesExists(schema)).toBe(true);
            } finally {
              await blocker.query("ROLLBACK").catch(() => undefined);
              await migrator.query("ROLLBACK").catch(() => undefined);
              await writer.query("ROLLBACK").catch(() => undefined);
              blocker.release();
              migrator.release();
              writer.release();
            }
          });
        },
        30_000,
      );

      it(
        "when the blocker releases first, migration 22 completes and the queued audit INSERT succeeds",
        async () => {
          await withScratchAuditLog(async (schema, up) => {
            const blocker = await db.connect();
            const migrator = await db.connect();
            const writer = await db.connect();
            try {
              await blocker.query("BEGIN");
              await blocker.query(`LOCK TABLE ${schema}.audit_log IN ACCESS SHARE MODE`);

              const migratorPid = await pidOf(migrator);
              const writerPid = await pidOf(writer);
              const migration = migrator
                .query(`BEGIN; SET LOCAL search_path TO ${schema}, public; ${up} COMMIT;`)
                .then(
                  () => null,
                  (err: { code?: string }) => err.code ?? "unknown",
                );
              await waitUntilWaitingOnLock(db, migratorPid);
              const insert = queuedAuditInsert(writer, schema).then(
                () => null,
                (err: { code?: string }) => err.code ?? "unknown",
              );
              await waitUntilWaitingOnLock(db, writerPid);
              await blocker.query("ROLLBACK");

              expect(await migration).toBeNull();
              expect(await insert).toBeNull();
              expect(await actorRolesExists(schema)).toBe(true);
            } finally {
              await blocker.query("ROLLBACK").catch(() => undefined);
              await migrator.query("ROLLBACK").catch(() => undefined);
              await writer.query("ROLLBACK").catch(() => undefined);
              blocker.release();
              migrator.release();
              writer.release();
            }
          });
        },
        30_000,
      );
    });
  });
});
