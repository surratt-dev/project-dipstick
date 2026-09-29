import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Real Postgres + real psql coverage for phantom-em-relationship-detection
// (tasks.md 4.1-4.4). These two scripts (migrations-manual/8_phantom_em_detect.sql,
// migrations-manual/8_phantom_em_annotate.sql) rely on psql-specific syntax --
// \if/\else/\endif meta-commands and :'name' quoted-literal substitution --
// that a plain `pg` client cannot execute. This file shells out to the real
// `psql` binary against a real Postgres instance, following
// default-topic-provisioning-integration.test.ts's established pattern
// (self-skip when infra is unreachable, env var fallbacks matching
// .env.example). Self-skips if either Postgres or the psql CLI is
// unavailable -- run `docker compose up` (repo root) and ensure a Postgres
// client is installed, then re-run this file.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] ??= "postgresql://dipstick:dipstick@localhost:5433/dipstick";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const PROBE_TIMEOUT_MS = 750;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DETECT_SQL_PATH = path.join(__dirname, "../../migrations-manual/8_phantom_em_detect.sql");
const ANNOTATE_SQL_PATH = path.join(__dirname, "../../migrations-manual/8_phantom_em_annotate.sql");

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

function isPsqlAvailable(): boolean {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dbUp = await isPostgresReachable();
const psqlUp = isPsqlAvailable();
const canRun = dbUp && psqlUp;

if (!canRun) {
  console.warn(
    `[phantom-em-relationship-detection.test.ts] SKIPPED -- ${
      !dbUp
        ? `Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}) not reachable`
        : "psql binary not found on PATH"
    }. Run \`docker compose up\` (repo root) and ensure a Postgres client is installed, then re-run this file.`,
  );
}

function runPsql(sqlPath: string, extraVars: string[] = []): string {
  const args = [DATABASE_URL, "--csv", "-v", "ON_ERROR_STOP=1", ...extraVars, "-f", sqlPath];
  return execFileSync("psql", args, { encoding: "utf8" });
}

describe.skipIf(!canRun)(
  "phantom-em-relationship-detection scripts (tasks.md 4.1-4.4) -- real Postgres + psql coverage",
  () => {
    let db: pg.Pool;

    const operatorUserId = crypto.randomUUID();
    const phantomUserId = crypto.randomUUID();
    const removedUserId = crypto.randomUUID();
    const teamId = crypto.randomUUID();

    const phantomEmail = `phantom-${phantomUserId.slice(0, 8)}@example.com`;
    const removedEmail = `removed-${removedUserId.slice(0, 8)}@example.com`;

    // Well before the 2026-09-16T20:46:16-04:00 cutoff.
    const preCutoffTimestamp = "2026-08-01T12:00:00-04:00";

    beforeAll(async () => {
      db = new pg.Pool({ connectionString: DATABASE_URL });

      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Operator', $3, 'engineer'),
                ($4, $5, 'test-issuer', 'Phantom EM', $6, 'engineer'),
                ($7, $8, 'test-issuer', 'Removed EM', $9, 'engineer')`,
        [
          operatorUserId,
          `sub-${operatorUserId}`,
          `${operatorUserId}@example.com`,
          phantomUserId,
          `sub-${phantomUserId}`,
          phantomEmail,
          removedUserId,
          `sub-${removedUserId}`,
          removedEmail,
        ],
      );

      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        `Phantom EM Fixture Team ${teamId.slice(0, 8)}`,
        operatorUserId,
      ]);

      // Fixture 1 (tasks.md 4.1.1): the base phantom case -- an active EM
      // membership row with no backing team.manager_established audit entry.
      // Used by 4.2's positive detection match and 4.3's annotation.
      await db.query(
        `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'engineering_manager')`,
        [phantomUserId, teamId],
      );

      // Fixture 2 (4.1.2): removed-membership variant -- EM role, removed_at
      // set, no team.manager_established row. Used by 4.2's exclusion check:
      // a removed membership grants no current access and must not be flagged.
      await db.query(
        `INSERT INTO team_memberships (user_id, team_id, role, removed_at) VALUES ($1, $2, 'engineering_manager', now())`,
        [removedUserId, teamId],
      );

      // Fixture 1's backing historical audit row: a pre-cutoff team.role_changed
      // event -- the row 8_phantom_em_annotate.sql is expected to annotate.
      await db.query(
        `INSERT INTO audit_log (actor_user_id, actor_global_role, operation, target_user_id, team_id, timestamp, metadata)
         VALUES ($1, 'engineering_manager', 'team.role_changed', $2, $3, $4,
                 jsonb_build_object('from_role', 'participant', 'to_role', 'engineering_manager'))`,
        [operatorUserId, phantomUserId, teamId, preCutoffTimestamp],
      );

      // Fixture 3 (4.1.3): a pre-cutoff team.role_change_denied row, same
      // metadata shape as team.role_changed. Dated BEFORE the cutoff
      // deliberately (design.md Decision 5 / security design review): this
      // proves the `operation` filter itself excludes it, not the timestamp
      // predicate -- a post-cutoff denial row would be excluded either way,
      // which would let this test pass even if the operation filter were
      // silently dropped in a future edit.
      await db.query(
        `INSERT INTO audit_log (actor_user_id, actor_global_role, operation, target_user_id, team_id, timestamp, metadata)
         VALUES ($1, 'engineering_manager', 'team.role_change_denied', $2, $3, $4,
                 jsonb_build_object('from_role', 'participant', 'to_role', 'engineering_manager', 'http_status', 403))`,
        [operatorUserId, crypto.randomUUID(), crypto.randomUUID(), preCutoffTimestamp],
      );

      // Fixture 4 (4.1.4): a pre-cutoff team.role_changed row already paired
      // with a team.manager_established_retroactive_annotation row
      // referencing it via annotated_audit_log_id -- used by 4.3's
      // already-annotated exclusion check (distinct from 4.4, which re-runs
      // the whole script rather than pre-seeding an annotation).
      const alreadyAnnotated = await db.query<{ id: string }>(
        `INSERT INTO audit_log (actor_user_id, actor_global_role, operation, target_user_id, team_id, timestamp, metadata)
         VALUES ($1, 'engineering_manager', 'team.role_changed', $2, $3, $4,
                 jsonb_build_object('from_role', 'participant', 'to_role', 'engineering_manager'))
         RETURNING id`,
        [operatorUserId, crypto.randomUUID(), crypto.randomUUID(), preCutoffTimestamp],
      );
      const alreadyAnnotatedAuditId = alreadyAnnotated.rows[0]!.id;

      await db.query(
        `INSERT INTO audit_log (actor_user_id, actor_global_role, operation, target_user_id, team_id, metadata)
         VALUES ($1, 'system:production_data_engineer', 'team.manager_established_retroactive_annotation', NULL, NULL,
                 jsonb_build_object('annotated_audit_log_id', $2::text))`,
        [operatorUserId, alreadyAnnotatedAuditId],
      );
    });

    afterAll(async () => {
      await db.query(`DELETE FROM audit_log WHERE actor_user_id = $1`, [operatorUserId]);
      await db.query(`DELETE FROM team_memberships WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
        [operatorUserId, phantomUserId, removedUserId],
      ]);
      await db.end();
    });

    it("4.2: 8_phantom_em_detect.sql flags the base phantom case and excludes the removed-membership variant", () => {
      const output = runPsql(DETECT_SQL_PATH);
      expect(output).toContain(phantomEmail);
      expect(output).not.toContain(removedEmail);
    });

    it("4.3: 8_phantom_em_annotate.sql inserts exactly one annotation row, excluding the denied row and the already-annotated row", async () => {
      const output = runPsql(ANNOTATE_SQL_PATH, ["-v", `operator_user_id=${operatorUserId}`]);

      expect(output).toMatch(/new_annotations_inserted\r?\n1\r?\n/);

      const annotations = await db.query<{ metadata: { annotated_audit_log_id: string } }>(
        `SELECT metadata FROM audit_log
         WHERE operation = 'team.manager_established_retroactive_annotation'
           AND actor_user_id = $1
           AND metadata->>'annotated_timestamp' IS NOT NULL`,
        [operatorUserId],
      );

      // Exactly one NEW annotation from this run (the base phantom case's
      // audit row) -- the denied row was never a candidate, and the
      // already-annotated row was excluded by the idempotency guard.
      expect(annotations.rows).toHaveLength(1);
    });

    it("4.4: running 8_phantom_em_annotate.sql a second time inserts zero new rows", () => {
      const output = runPsql(ANNOTATE_SQL_PATH, ["-v", `operator_user_id=${operatorUserId}`]);

      expect(output).toMatch(/new_annotations_inserted\r?\n0\r?\n/);
    });
  },
);
