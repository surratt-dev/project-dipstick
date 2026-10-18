import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import {
  expectActivePositionsDense,
  setTemplatePositions,
  useMaintenanceTemplate,
  type LogLine,
} from "./helpers/maintenance-test-hygiene.js";
import { AuditWriteError } from "../../auth/errors.js";
import {
  BackstopError,
  DEFAULT_LIMITS,
  MAINTENANCE_AUDIT_OPERATIONS,
  MaintenanceError,
  findDefaultRowViolation,
  parseHistoryLimit,
  readTemplateHistory,
  readTemplateList,
  writeTemplateTopics,
  type MaintenanceWrite,
  type MaintenanceWriteResult,
} from "../../sessions/default-topic-maintenance.js";
import { LOCK_TEAM_TOPICS_SQL } from "../../sessions/session-topic-snapshot.js";

// ---------------------------------------------------------------------------
// admin-default-topic-maintenance (#216) tasks.md 3.2 (seed acceptance),
// 3.3 (the transaction harness), 4.1-4.9, 4.11, 4.12, 6.1, 6.2: the writer
// module against real Postgres, called directly (no HTTP, so no timing
// floor). The routes' own tests are in admin-default-topics-*-integration.
// Every test runs under the template lock and restores the template and
// deletes its maintenance audit rows (helpers/maintenance-test-hygiene.ts).
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "default-topic-writer-integration.test.ts");

describe.skipIf(!infraUp)("default-topic maintenance writer (real Postgres, #216)", () => {
  const h = useMaintenanceTemplate();
  let admin: string;
  let otherAdmin: string;
  let logApp: FastifyInstance;
  const lines: LogLine[] = [];

  beforeAll(async () => {
    admin = await h.fx.user("application_admin");
    otherAdmin = await h.fx.user("application_admin");
    logApp = Fastify({
      logger: { level: "info", stream: { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) } },
    });
    await logApp.ready();
  });

  const db = () => h.mods.db;
  const actor = (userId = admin) => ({ userId, role: "application_admin", ip: "203.0.113.7" });
  const write = (op: MaintenanceWrite, userId = admin): Promise<MaintenanceWriteResult> =>
    writeTemplateTopics(op, actor(userId), { log: logApp.log, correlationId: "corr-test" });
  const add = (name: string, over: Record<string, string> = {}) =>
    write({
      kind: "add",
      input: {
        name,
        prompt: over["prompt"] ?? `Prompt for ${name}?`,
        firstSessionDescription: over["firstSessionDescription"] ?? `About ${name}.`,
        voteType: (over["voteType"] as "finger" | "roman" | "modified_roman") ?? "finger",
      },
    });

  async function activeRows() {
    return (
      await db().query<{ id: string; name: string; display_order: number; updated_at: Date }>(
        `SELECT id, name, display_order, updated_at FROM topics
          WHERE team_id = $1 AND status = 'active' AND is_default = true ORDER BY display_order`,
        [SENTINEL_TEAM_ID],
      )
    ).rows;
  }
  async function maintenanceAudit(operation?: string) {
    return (
      await db().query<{ id: string; operation: string; team_id: string; actor_user_id: string; actor_global_role: string; actor_ip: string; actor_roles: string[] | null; metadata: Record<string, unknown> }>(
        `SELECT id, operation, team_id, actor_user_id, actor_global_role, host(actor_ip) AS actor_ip, actor_roles, metadata
           FROM audit_log
          WHERE team_id = $1 AND operation = ANY($2::text[]) AND "timestamp" >= $3
            AND ($4::text IS NULL OR operation = $4)
          ORDER BY "timestamp", id`,
        [SENTINEL_TEAM_ID, [...MAINTENANCE_AUDIT_OPERATIONS], h.startedAt(), operation ?? null],
      )
    ).rows;
  }
  async function templateRows() {
    return (await db().query(`SELECT * FROM topics WHERE team_id = $1 ORDER BY id`, [SENTINEL_TEAM_ID])).rows;
  }
  async function errorOf(p: Promise<unknown>): Promise<unknown> {
    try {
      await p;
    } catch (err) {
      return err;
    }
    return undefined;
  }
  const codeOf = async (p: Promise<unknown>) => ((await errorOf(p)) as MaintenanceError).code;

  // ---- 3.2 seed acceptance -------------------------------------------------
  it("3.2: the real validators and limits accept every migration-11 default, with the recorded maxima (no limit raised, no seed edited)", async () => {
    const seeded = await maintenanceAudit();
    const rows = (
      await db().query<{ name: string; prompt: string; vote_type: string; first_session_description: string | null; status: string }>(
        `SELECT name, prompt, vote_type, first_session_description, status FROM topics WHERE team_id = $1 AND is_default = true`,
        [SENTINEL_TEAM_ID],
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(findDefaultRowViolation(r), r.name).toBeNull();
    const cp = (s: string | null) => [...(s ?? "")].length;
    const maxima = {
      name: Math.max(...rows.map((r) => cp(r.name))),
      prompt: Math.max(...rows.map((r) => cp(r.prompt))),
      description: Math.max(...rows.map((r) => cp(r.first_session_description))),
    };
    console.info("[3.2] seed maxima in code points:", JSON.stringify(maxima));
    expect(maxima.name).toBeLessThanOrEqual(DEFAULT_LIMITS.nameMax);
    expect(maxima.prompt).toBeLessThanOrEqual(DEFAULT_LIMITS.promptMax);
    expect(maxima.description).toBeLessThanOrEqual(DEFAULT_LIMITS.descriptionMax);
    if (seeded.length === 0 && rows.length === 12) {
      // The migration-time seed: the recorded maxima.
      expect(maxima).toEqual({ name: 36, prompt: 61, description: 262 });
    }
  });

  // ---- 3.3 the harness -----------------------------------------------------
  describe("3.3 transaction harness", () => {
    it("a forced unique violation (23505) surfaces as a raw database error and rolls everything back", async () => {
      // Pre-existing damage the maintenance path does not repair: a non-default
      // active row sitting where the dense renumber would put the new default.
      const before = await templateRows();
      const active = await activeRows();
      await db().query(
        `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, status, is_default)
         VALUES ($1, 'Damage', 'p?', 'finger', $2, 'active', false)`,
        [SENTINEL_TEAM_ID, active.length + 1],
      );
      const err = (await errorOf(add("Collides"))) as { code?: string };
      expect(err).toBeDefined();
      expect(err instanceof MaintenanceError).toBe(false);
      expect(err.code).toBe("23505");
      expect((await templateRows()).length).toBe(before.length + 1); // only the damage row
      expect(await maintenanceAudit()).toHaveLength(0);
    });

    it("a lock held by a second connection past lock_timeout is DEFAULT_MAINTENANCE_BUSY and changes nothing", async () => {
      const holder = await db().connect();
      try {
        await holder.query("BEGIN");
        await holder.query(LOCK_TEAM_TOPICS_SQL, [SENTINEL_TEAM_ID]);
        const started = Date.now();
        expect(await codeOf(add("Blocked"))).toBe("DEFAULT_MAINTENANCE_BUSY");
        expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
        expect(Date.now() - started).toBeLessThan(8000);
      } finally {
        await holder.query("ROLLBACK");
        holder.release();
      }
      expect((await activeRows()).map((r) => r.name)).not.toContain("Blocked");
      expect(await maintenanceAudit()).toHaveLength(0);
    });

    it("an audit insert failure surfaces as AuditWriteError and the write is rolled back", async () => {
      const before = await templateRows();
      const err = await errorOf(
        writeTemplateTopics(
          { kind: "add", input: { name: "Audit Fails", prompt: "p?", firstSessionDescription: "d", voteType: "finger" } },
          { userId: admin, role: "application_admin", ip: "not-an-ip-address" },
          { log: logApp.log, correlationId: "corr-test" },
        ),
      );
      expect(err).toBeInstanceOf(AuditWriteError);
      expect(await templateRows()).toEqual(before);
      expect(await maintenanceAudit()).toHaveLength(0);
    });

    it("a backstop failure (the written row fails field validation) rolls back and writes no audit row", async () => {
      const before = await templateRows();
      lines.length = 0;
      const err = await errorOf(add("Bad", { prompt: "<b>markup</b>" }));
      expect(err).toBeInstanceOf(BackstopError);
      expect(await templateRows()).toEqual(before);
      expect(await maintenanceAudit()).toHaveLength(0);
      expect(lines.filter((l) => String(l.event ?? "").startsWith("topic.default_"))).toHaveLength(0);
    });

    it("pre-existing damage elsewhere does not block an edit (the backstop is scoped to what the operation produced)", async () => {
      const active = await activeRows();
      await setTemplatePositions(db(), active.map((r, i) => [r.id, i === active.length - 1 ? i + 3 : i + 1] as [string, number])); // a gap at the end
      const res = await write({ kind: "edit", topicId: active[0]!.id, fields: { prompt: "Edited despite the gap?" } });
      expect(res.unchanged).toBe(false);
    });

    it("sets updated_at on every row it touches, including renumbered ones", async () => {
      const before = await activeRows();
      await new Promise((r) => setTimeout(r, 20));
      await write({ kind: "archive", topicId: before[0]!.id });
      const after = await activeRows();
      for (const row of after) {
        const prev = before.find((b) => b.id === row.id)!;
        expect(row.updated_at.getTime(), row.name).toBeGreaterThan(prev.updated_at.getTime());
      }
    });
  });

  // ---- 4.1 add -------------------------------------------------------------
  describe("4.1 add", () => {
    it("appends at MAX+1 as an active is_default row, with one audit row holding the full new row", async () => {
      const before = await activeRows();
      const res = await add("Brand New", { voteType: "roman" });
      expect(res.unchanged).toBe(false);
      const ids = await expectActivePositionsDense(db());
      expect(ids).toHaveLength(before.length + 1);
      const row = (await db().query(`SELECT * FROM topics WHERE id = $1`, [res.changedTopicId])).rows[0];
      expect(row).toMatchObject({
        team_id: SENTINEL_TEAM_ID,
        name: "Brand New",
        vote_type: "roman",
        status: "active",
        is_default: true,
        display_order: before.length + 1,
      });
      const audit = await maintenanceAudit("topic.default_added");
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toEqual({
        topicId: res.changedTopicId,
        operation: "topic.default_added",
        changedFields: ["name", "prompt", "firstSessionDescription"],
        before: null,
        after: {
          name: "Brand New",
          prompt: "Prompt for Brand New?",
          firstSessionDescription: "About Brand New.",
          voteType: "roman",
          status: "active",
          displayOrder: before.length + 1,
        },
      });
    });

    it("at 15 active defaults the 16th is TEMPLATE_AT_CAPACITY and nothing changes", async () => {
      let n = (await activeRows()).length;
      while (n < 15) await add(`Fill ${n++}`);
      const before = await templateRows();
      expect(await codeOf(add("Sixteenth"))).toBe("TEMPLATE_AT_CAPACITY");
      expect(await templateRows()).toEqual(before);
      await expectActivePositionsDense(db());
    });

    it("a name equal after trim and lowercase to an active default is DEFAULT_NAME_DUPLICATE; an archived default's name is free", async () => {
      expect(await codeOf(add("pairing"))).toBe("DEFAULT_NAME_DUPLICATE");
      expect(await codeOf(add("PAIRING"))).toBe("DEFAULT_NAME_DUPLICATE");
      const pairing = (await activeRows()).find((r) => r.name === "Pairing")!;
      await write({ kind: "archive", topicId: pairing.id });
      await expect(add("Pairing")).resolves.toMatchObject({ unchanged: false });
    });

    it("the stored text is exactly the input (explicit field picking: is_default is always true, status active, annotation unset)", async () => {
      const res = await add("Picked");
      const row = (await db().query(`SELECT * FROM topics WHERE id = $1`, [res.changedTopicId])).rows[0];
      expect(row.is_default).toBe(true);
      expect(row.status).toBe("active");
      expect(row.team_annotation).toBeNull();
      expect(row.archived_at).toBeNull();
    });
  });

  // ---- 4.2 edit ------------------------------------------------------------
  describe("4.2 edit", () => {
    const edit = (topicId: string, fields: Record<string, string>, voteType?: "finger" | "roman" | "modified_roman") =>
      write({ kind: "edit", topicId, fields, ...(voteType ? { voteType } : {}) });

    it("changes a prompt: one audit row with changedFields and the full before and after", async () => {
      const target = (await activeRows())[0]!;
      const old = (await db().query(`SELECT prompt FROM topics WHERE id = $1`, [target.id])).rows[0].prompt as string;
      const res = await edit(target.id, { prompt: "A better prompt?" });
      expect(res.unchanged).toBe(false);
      expect(res.renamed).toBe(false);
      const audit = await maintenanceAudit("topic.default_edited");
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toEqual({
        topicId: target.id,
        operation: "topic.default_edited",
        changedFields: ["prompt"],
        before: { prompt: old },
        after: { prompt: "A better prompt?" },
      });
      await expectActivePositionsDense(db());
    });

    it("a no-op (every supplied field equals the stored value) writes no audit row and changes nothing", async () => {
      const target = (await activeRows())[0]!;
      const row = (await db().query(`SELECT name, prompt, first_session_description, updated_at FROM topics WHERE id = $1`, [target.id])).rows[0];
      const res = await edit(target.id, { name: row.name, prompt: row.prompt, firstSessionDescription: row.first_session_description });
      expect(res.unchanged).toBe(true);
      expect(await maintenanceAudit()).toHaveLength(0);
      const after = (await db().query(`SELECT updated_at FROM topics WHERE id = $1`, [target.id])).rows[0];
      expect(after.updated_at).toEqual(row.updated_at);
    });

    it("an empty field set (what {} parses to) is a no-op", async () => {
      const target = (await activeRows())[0]!;
      expect((await edit(target.id, {})).unchanged).toBe(true);
      expect((await edit(target.id, {}, "finger")).unchanged).toBe(true); // equal voteType is ignored
      expect(await maintenanceAudit()).toHaveLength(0);
    });

    it("a case-only rename of the row's own name is a real change (and not a duplicate of itself)", async () => {
      const pairing = (await activeRows()).find((r) => r.name === "Pairing")!;
      const res = await edit(pairing.id, { name: "pairing" });
      expect(res.unchanged).toBe(false);
      expect(res.renamed).toBe(true);
      expect((await db().query(`SELECT name FROM topics WHERE id = $1`, [pairing.id])).rows[0].name).toBe("pairing");
      expect(await maintenanceAudit("topic.default_edited")).toHaveLength(1);
    });

    it("a spacing-only rename trims to the stored value: a no-op (the route trims before the writer)", async () => {
      const pairing = (await activeRows()).find((r) => r.name === "Pairing")!;
      expect((await edit(pairing.id, { name: " Pairing ".trim() })).unchanged).toBe(true);
      expect(await maintenanceAudit()).toHaveLength(0);
    });

    it("a rename to another active default's name (any case) is DEFAULT_NAME_DUPLICATE and changes nothing", async () => {
      const rows = await activeRows();
      const pairing = rows.find((r) => r.name === "Pairing")!;
      expect(await codeOf(edit(pairing.id, { name: "pipeline" }))).toBe("DEFAULT_NAME_DUPLICATE");
      expect((await db().query(`SELECT name FROM topics WHERE id = $1`, [pairing.id])).rows[0].name).toBe("Pairing");
    });

    it("a partly-changed edit audits only the fields that differ", async () => {
      const target = (await activeRows())[0]!;
      const stored = (await db().query(`SELECT prompt FROM topics WHERE id = $1`, [target.id])).rows[0].prompt as string;
      await edit(target.id, { name: "Renamed Topic", prompt: stored });
      const audit = await maintenanceAudit("topic.default_edited");
      expect(audit[0]!.metadata["changedFields"]).toEqual(["name"]);
      expect(Object.keys(audit[0]!.metadata["before"] as object)).toEqual(["name"]);
      expect(Object.keys(audit[0]!.metadata["after"] as object)).toEqual(["name"]);
    });

    it("the vote type is immutable: a different value is DEFAULT_VOTE_TYPE_IMMUTABLE and nothing changes", async () => {
      const target = (await activeRows())[0]!;
      expect(await codeOf(edit(target.id, { prompt: "Also changed?" }, "roman"))).toBe("DEFAULT_VOTE_TYPE_IMMUTABLE");
      expect((await db().query(`SELECT vote_type, prompt FROM topics WHERE id = $1`, [target.id])).rows[0].vote_type).toBe("finger");
      expect(await maintenanceAudit()).toHaveLength(0);
    });

    it("an archived default cannot be edited (DEFAULT_ARCHIVED); an unknown or non-default id is DEFAULT_TOPIC_NOT_FOUND", async () => {
      const target = (await activeRows())[0]!;
      await write({ kind: "archive", topicId: target.id });
      expect(await codeOf(edit(target.id, { prompt: "No." }))).toBe("DEFAULT_ARCHIVED");
      expect(await codeOf(edit(randomUUID(), { prompt: "No." }))).toBe("DEFAULT_TOPIC_NOT_FOUND");
    });

    it("an edit leaves positions and the rest of the template untouched", async () => {
      const before = await activeRows();
      await edit(before[3]!.id, { prompt: "Only me?" });
      const after = await activeRows();
      expect(after.map((r) => [r.id, r.display_order])).toEqual(before.map((r) => [r.id, r.display_order]));
    });
  });

  // ---- 4.3 archive ---------------------------------------------------------
  describe("4.3 archive", () => {
    it("archives, renumbers the rest dense 1..N in their prior relative order, keeps the row and its id", async () => {
      const before = await activeRows();
      const victim = before[4]!;
      const res = await write({ kind: "archive", topicId: victim.id });
      expect(res.unchanged).toBe(false);
      const ids = await expectActivePositionsDense(db());
      expect(ids).toEqual(before.filter((r) => r.id !== victim.id).map((r) => r.id));
      const row = (await db().query(`SELECT status, archived_by, archived_at FROM topics WHERE id = $1`, [victim.id])).rows[0];
      expect(row).toMatchObject({ status: "archived", archived_by: admin });
      expect(row.archived_at).not.toBeNull();
      const audit = await maintenanceAudit("topic.default_archived");
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toMatchObject({
        topicId: victim.id,
        changedFields: ["status", "displayOrder"],
        before: { status: "active", displayOrder: 5 },
        after: { status: "archived", displayOrder: null },
      });
      const renumbered = (audit[0]!.metadata["after"] as { renumbered: unknown[] }).renumbered;
      expect(renumbered).toHaveLength(before.length - 5);
      expect(renumbered[0]).toEqual({ topicId: before[5]!.id, from: 6, to: 5 });
    });

    it("the last active default cannot be archived (LAST_ACTIVE_DEFAULT) and stays active", async () => {
      const rows = await activeRows();
      for (const r of rows.slice(0, -1)) await write({ kind: "archive", topicId: r.id });
      const last = rows[rows.length - 1]!;
      expect(await codeOf(write({ kind: "archive", topicId: last.id }))).toBe("LAST_ACTIVE_DEFAULT");
      expect((await activeRows()).map((r) => r.id)).toEqual([last.id]);
      await expectActivePositionsDense(db());
    });

    it("archiving an archived default is DEFAULT_ALREADY_ARCHIVED; the row is never deleted", async () => {
      const victim = (await activeRows())[0]!;
      await write({ kind: "archive", topicId: victim.id });
      expect(await codeOf(write({ kind: "archive", topicId: victim.id }))).toBe("DEFAULT_ALREADY_ARCHIVED");
      expect((await db().query(`SELECT count(*)::int AS n FROM topics WHERE id = $1`, [victim.id])).rows[0].n).toBe(1);
    });
  });

  // ---- 4.4 restore ---------------------------------------------------------
  describe("4.4 restore", () => {
    it("restores at the next position (never its old number), sets restored_by/at, and audits the transition", async () => {
      const before = await activeRows();
      const victim = before[2]!;
      await write({ kind: "archive", topicId: victim.id });
      const res = await write({ kind: "restore", topicId: victim.id });
      expect(res.unchanged).toBe(false);
      const ids = await expectActivePositionsDense(db());
      expect(ids[ids.length - 1]).toBe(victim.id);
      expect(ids).toHaveLength(before.length);
      const row = (await db().query(`SELECT restored_by, restored_at, status FROM topics WHERE id = $1`, [victim.id])).rows[0];
      expect(row).toMatchObject({ restored_by: admin, status: "active" });
      const audit = await maintenanceAudit("topic.default_restored");
      expect(audit[0]!.metadata).toMatchObject({
        topicId: victim.id,
        changedFields: ["status", "displayOrder"],
        before: { status: "archived", displayOrder: null },
        after: { status: "active", displayOrder: before.length },
      });
    });

    it("at capacity a restore is TEMPLATE_AT_CAPACITY", async () => {
      const victim = (await activeRows())[0]!;
      await write({ kind: "archive", topicId: victim.id });
      let n = (await activeRows()).length;
      while (n < 15) await add(`Fill ${n++}`);
      expect(await codeOf(write({ kind: "restore", topicId: victim.id }))).toBe("TEMPLATE_AT_CAPACITY");
    });

    it("a name collision names the conflicting active default and changes nothing", async () => {
      const pairing = (await activeRows()).find((r) => r.name === "Pairing")!;
      await write({ kind: "archive", topicId: pairing.id });
      const replacement = await add("Pairing");
      const err = (await errorOf(write({ kind: "restore", topicId: pairing.id }))) as MaintenanceError;
      expect(err.code).toBe("DEFAULT_NAME_DUPLICATE");
      expect(err.detail).toMatchObject({ conflictingTopicId: replacement.changedTopicId, conflictingName: "Pairing" });
      expect((await db().query(`SELECT status FROM topics WHERE id = $1`, [pairing.id])).rows[0].status).toBe("archived");
    });

    it("check order: already active, then capacity, then name collision", async () => {
      const rows = await activeRows();
      expect(await codeOf(write({ kind: "restore", topicId: rows[0]!.id }))).toBe("DEFAULT_ALREADY_ACTIVE");

      // An archived default that is both at capacity and name-colliding reports capacity.
      const pairing = rows.find((r) => r.name === "Pairing")!;
      await write({ kind: "archive", topicId: pairing.id });
      await add("Pairing");
      let n = (await activeRows()).length;
      while (n < 15) await add(`Fill ${n++}`);
      expect(await codeOf(write({ kind: "restore", topicId: pairing.id }))).toBe("TEMPLATE_AT_CAPACITY");
    });
  });

  // ---- 4.5 reorder ---------------------------------------------------------
  describe("4.5 reorder", () => {
    it("reorders the whole list, audits the full before and after id lists (no topicId)", async () => {
      const before = (await activeRows()).map((r) => r.id);
      const after = [...before].reverse();
      const res = await write({ kind: "reorder", order: after });
      expect(res.unchanged).toBe(false);
      expect(await expectActivePositionsDense(db())).toEqual(after);
      const audit = await maintenanceAudit("topic.default_reordered");
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toEqual({
        operation: "topic.default_reordered",
        changedFields: ["order"],
        before,
        after,
      });
    });

    it("a list equal to the stored order is a no-op: no audit row", async () => {
      const ids = (await activeRows()).map((r) => r.id);
      expect((await write({ kind: "reorder", order: ids })).unchanged).toBe(true);
      expect(await maintenanceAudit()).toHaveLength(0);
    });

    it("a list of one when exactly one default is active is a no-op", async () => {
      const rows = await activeRows();
      for (const r of rows.slice(1)) await write({ kind: "archive", topicId: r.id });
      const res = await write({ kind: "reorder", order: [rows[0]!.id] });
      expect(res.unchanged).toBe(true);
    });

    it("a missing id, an extra id, an archived id and an unknown id are REORDER_ID_MISMATCH", async () => {
      const ids = (await activeRows()).map((r) => r.id);
      expect(await codeOf(write({ kind: "reorder", order: ids.slice(1) }))).toBe("REORDER_ID_MISMATCH");
      expect(await codeOf(write({ kind: "reorder", order: [...ids, randomUUID()] }))).toBe("REORDER_ID_MISMATCH");
      await write({ kind: "archive", topicId: ids[0]! });
      expect(await codeOf(write({ kind: "reorder", order: ids }))).toBe("REORDER_ID_MISMATCH");
      expect(await codeOf(write({ kind: "reorder", order: [...ids.slice(1).slice(0, -1), randomUUID()] }))).toBe("REORDER_ID_MISMATCH");
    });

    it("a repeated id of the right length is INVALID_DEFAULT_ORDER", async () => {
      const ids = (await activeRows()).map((r) => r.id);
      const repeated = [...ids.slice(0, -1), ids[0]!];
      expect(await codeOf(write({ kind: "reorder", order: repeated }))).toBe("INVALID_DEFAULT_ORDER");
    });

    it("a stale list with the same ids is accepted (last write wins) and the second audit row's before is the first's after", async () => {
      const loaded = (await activeRows()).map((r) => r.id);
      const first = [...loaded].reverse();
      const second = [loaded[1]!, loaded[0]!, ...loaded.slice(2)];
      await write({ kind: "reorder", order: first }, admin);
      await write({ kind: "reorder", order: second }, otherAdmin);
      expect(await expectActivePositionsDense(db())).toEqual(second);
      const audit = await maintenanceAudit("topic.default_reordered");
      expect(audit).toHaveLength(2);
      expect(audit[1]!.metadata["before"]).toEqual(audit[0]!.metadata["after"]);
      expect(audit[1]!.metadata["after"]).toEqual(second);
    });
  });

  // ---- 4.6 gapped or damaged template repair --------------------------------
  describe("4.6 a gapped template is repaired by use and never wedges maintenance", () => {
    async function gap() {
      const rows = await activeRows();
      // 1, 2, 4, 5, ... (position 3 missing).
      await setTemplatePositions(db(), rows.map((r, i) => [r.id, i < 2 ? i + 1 : i + 2] as [string, number]));
      return rows;
    }

    it("add repairs the gap (no 23505), with the new row last", async () => {
      const rows = await gap();
      const res = await add("After Gap");
      const ids = await expectActivePositionsDense(db());
      expect(ids).toEqual([...rows.map((r) => r.id), res.changedTopicId]);
    });

    it("archive repairs the gap", async () => {
      const rows = await gap();
      await write({ kind: "archive", topicId: rows[0]!.id });
      expect(await expectActivePositionsDense(db())).toEqual(rows.slice(1).map((r) => r.id));
    });

    it("restore repairs the gap", async () => {
      const rows = await activeRows();
      await write({ kind: "archive", topicId: rows[11]!.id });
      await gap();
      await write({ kind: "restore", topicId: rows[11]!.id });
      expect(await expectActivePositionsDense(db())).toHaveLength(12);
    });

    it("reorder repairs the gap, even with the same order", async () => {
      const rows = await gap();
      const res = await write({ kind: "reorder", order: rows.map((r) => r.id) });
      expect(res.unchanged).toBe(false);
      expect(await expectActivePositionsDense(db())).toEqual(rows.map((r) => r.id));
    });

    it("a sequence of all five operations in turn keeps positions exactly 1..N after every step", async () => {
      const rows = await activeRows();
      await add("Seq A");
      await expectActivePositionsDense(db());
      await write({ kind: "edit", topicId: rows[0]!.id, fields: { prompt: "Seq edit?" } });
      await expectActivePositionsDense(db());
      await write({ kind: "archive", topicId: rows[1]!.id });
      await expectActivePositionsDense(db());
      await write({ kind: "restore", topicId: rows[1]!.id });
      await expectActivePositionsDense(db());
      const ids = (await activeRows()).map((r) => r.id).reverse();
      await write({ kind: "reorder", order: ids });
      expect(await expectActivePositionsDense(db())).toEqual(ids);
      expect(await maintenanceAudit()).toHaveLength(5);
    });
  });

  // ---- 4.8 list ------------------------------------------------------------
  describe("4.8 list read", () => {
    it("lists active by position then archived; archived displayOrder is null (from status, not the stored column)", async () => {
      const rows = await activeRows();
      await write({ kind: "archive", topicId: rows[3]!.id });
      const stored = (await db().query(`SELECT display_order FROM topics WHERE id = $1`, [rows[3]!.id])).rows[0].display_order;
      expect(stored).toBe(4); // the stale number is still stored
      const list = await readTemplateList();
      expect(list.limits).toEqual({ minActive: 1, maxActive: 15, nameMax: 60, promptMax: 400, descriptionMax: 800 });
      const active = list.defaults.filter((d) => d.status === "active");
      expect(active.map((d) => d.displayOrder)).toEqual(active.map((_, i) => i + 1));
      const archived = list.defaults.filter((d) => d.status === "archived");
      expect(archived).toHaveLength(1);
      expect(archived[0]!.displayOrder).toBeNull();
      expect(list.defaults.slice(0, active.length).every((d) => d.status === "active")).toBe(true);
      // Closed shape.
      expect(Object.keys(list).sort()).toEqual(["defaults", "limits", "orderLastChangedAt"]);
      expect(Object.keys(list.defaults[0]!).sort()).toEqual(
        ["displayOrder", "firstSessionDescription", "id", "lastChangedAt", "lastChangedBy", "name", "prompt", "status", "voteType"],
      );
    });

    it("an untouched seeded row has null lastChangedAt/By; an edited one shows the audit row's time and actor", async () => {
      const rows = await activeRows();
      const res = await write({ kind: "edit", topicId: rows[0]!.id, fields: { prompt: "Changed by A?" } });
      const audit = await maintenanceAudit("topic.default_edited");
      const at = (await db().query<{ at: Date }>(`SELECT "timestamp" AS at FROM audit_log WHERE id = $1`, [audit[0]!.id])).rows[0]!.at;
      const edited = res.list.defaults.find((d) => d.id === rows[0]!.id)!;
      // The first write's own response already shows the changed row with a non-null lastChangedAt.
      expect(edited.lastChangedAt).toBe(at.toISOString());
      expect(edited.lastChangedBy?.userId).toBe(admin);
      expect(res.list.defaults.find((d) => d.id === rows[1]!.id)!.lastChangedAt).toBeNull();
      expect(res.list.defaults.find((d) => d.id === rows[1]!.id)!.lastChangedBy).toBeNull();
    });

    it("a reorder does not touch any row's lastChangedAt; orderLastChangedAt is the reorder row's time", async () => {
      const rows = await activeRows();
      await write({ kind: "edit", topicId: rows[0]!.id, fields: { prompt: "Changed first?" } });
      const before = await readTemplateList();
      expect(before.orderLastChangedAt).toBeNull();
      await new Promise((r) => setTimeout(r, 15));
      const res = await write({ kind: "reorder", order: rows.map((r) => r.id).reverse() });
      expect(res.list.defaults.map((d) => [d.id, d.lastChangedAt])).toEqual(
        expect.arrayContaining(before.defaults.map((d) => [d.id, d.lastChangedAt])),
      );
      const reorderAudit = await maintenanceAudit("topic.default_reordered");
      const at = (await db().query<{ at: Date }>(`SELECT "timestamp" AS at FROM audit_log WHERE id = $1`, [reorderAudit[0]!.id])).rows[0]!.at;
      expect(res.list.orderLastChangedAt).toBe(at.toISOString());
    });

    it("lastChangedAt follows the latest of added/edited/archived/restored for that topic", async () => {
      const rows = await activeRows();
      await write({ kind: "edit", topicId: rows[0]!.id, fields: { prompt: "One?" } });
      await new Promise((r) => setTimeout(r, 15));
      await write({ kind: "archive", topicId: rows[0]!.id });
      await new Promise((r) => setTimeout(r, 15));
      const res = await write({ kind: "restore", topicId: rows[0]!.id }, otherAdmin);
      const restoredAudit = await maintenanceAudit("topic.default_restored");
      const at = (await db().query<{ at: Date }>(`SELECT "timestamp" AS at FROM audit_log WHERE id = $1`, [restoredAudit[0]!.id])).rows[0]!.at;
      const row = res.list.defaults.find((d) => d.id === rows[0]!.id)!;
      expect(row.lastChangedAt).toBe(at.toISOString());
      expect(row.lastChangedBy?.userId).toBe(otherAdmin);
    });
  });

  // ---- 4.9 history ----------------------------------------------------------
  describe("4.9 history read", () => {
    it("is newest first, includes before and after, and excludes denial and assign-defaults rows", async () => {
      const rows = await activeRows();
      await write({ kind: "edit", topicId: rows[0]!.id, fields: { prompt: "H1?" } });
      await new Promise((r) => setTimeout(r, 15));
      await add("H2");
      // Rows that share the sentinel team id but are NOT maintenance rows.
      for (const op of ["topic.defaults_assigned", "topic.defaults_assign_denied", "topic.defaults_assign_failed", "topic.write_denied_template"]) {
        await db().query(
          `INSERT INTO audit_log (actor_user_id, actor_global_role, operation, team_id, metadata) VALUES ($1, 'application_admin', $2, $3, '{}')`,
          [admin, op, SENTINEL_TEAM_ID],
        );
      }
      await db().query(
        `INSERT INTO audit_log (actor_user_id, actor_global_role, operation, team_id, metadata) VALUES ($1, 'facilitator', 'topic.default_maintenance_denied', NULL, '{}')`,
        [admin],
      );
      const history = (await readTemplateHistory(200)).filter((e) => e.actor.userId === admin);
      expect(history.map((e) => e.operation)).toEqual(["topic.default_added", "topic.default_edited"]);
      expect(history[1]!.before).toEqual({ prompt: expect.any(String) });
      expect(history[1]!.after).toEqual({ prompt: "H1?" });
      expect(history[0]!.actor).toEqual({ userId: admin, displayName: expect.any(String) });
    });

    it("breaks timestamp ties by id descending", async () => {
      const stamp = "2031-01-01T00:00:00Z";
      const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
      for (const id of ids) {
        await db().query(
          `INSERT INTO audit_log (id, actor_user_id, actor_global_role, operation, team_id, "timestamp", metadata)
           VALUES ($1, $2, 'application_admin', 'topic.default_reordered', $3, $4, '{"operation":"topic.default_reordered","changedFields":["order"],"before":[],"after":[]}')`,
          [id, admin, SENTINEL_TEAM_ID, stamp],
        );
      }
      const top = (await readTemplateHistory(3)).map((e) => e.id);
      expect(top).toEqual([...ids].reverse());
    });

    it.each([
      [undefined, 50],
      ["1", 1],
      ["200", 200],
      ["201", 200],
      ["50", 50],
    ])("limit %j is %i", (raw, expected) => {
      expect(parseHistoryLimit(raw)).toBe(expected);
    });

    it.each(["0", "-1", "abc", "", "1.5", "1e2", " 5"])("limit %j is INVALID_HISTORY_LIMIT", (raw) => {
      expect(() => parseHistoryLimit(raw)).toThrow(MaintenanceError);
    });

    it("the limit bounds the rows returned", async () => {
      for (let i = 0; i < 3; i++) await add(`Limit ${i}`);
      expect((await readTemplateHistory(1)).length).toBe(1);
      expect((await readTemplateHistory(2)).length).toBe(2);
    });

    it("Edit it back: patching the before-value restores the live row to its original", async () => {
      const target = (await activeRows())[0]!;
      const original = (await db().query(`SELECT name, prompt, first_session_description FROM topics WHERE id = $1`, [target.id])).rows[0];
      await write({ kind: "edit", topicId: target.id, fields: { prompt: "Oops, the wrong prompt?", name: "Oops" } });
      const entry = (await readTemplateHistory(10)).find((e) => e.topicId === target.id && e.operation === "topic.default_edited")!;
      const back = entry.before as Record<string, string>;
      await write({ kind: "edit", topicId: target.id, fields: back });
      const live = (await db().query(`SELECT name, prompt, first_session_description FROM topics WHERE id = $1`, [target.id])).rows[0];
      expect(live).toEqual(original);
      expect(await maintenanceAudit("topic.default_edited")).toHaveLength(2);
    });
  });

  // ---- 4.10 index confirmation ----------------------------------------------
  it("4.10: the list and history audit lookups are index-served, not sequential scans (EXPLAIN on the populated sentinel audit rows)", async () => {
    for (let i = 0; i < 3; i++) await add(`Explain ${i}`);
    const client = await db().connect();
    try {
      const plan = async (sql: string, params: unknown[]) =>
        (await client.query(`EXPLAIN ${sql}`, params)).rows.map((r) => r["QUERY PLAN"] as string).join("\n");
      const historySql = `SELECT a.id FROM audit_log a WHERE a.team_id = $1 AND a.operation = ANY($2::text[]) ORDER BY a."timestamp" DESC, a.id DESC LIMIT 50`;
      const listSql = `SELECT DISTINCT ON (a.metadata->>'topicId') a.id FROM audit_log a WHERE a.team_id = $1 AND a.operation = ANY($2::text[]) ORDER BY a.metadata->>'topicId', a."timestamp" DESC, a.id DESC`;
      const params = [SENTINEL_TEAM_ID, [...MAINTENANCE_AUDIT_OPERATIONS]];
      const natural = [await plan(historySql, params), await plan(listSql, params)];
      console.info("[4.10] natural plans:\n" + natural.join("\n---\n"));
      // The planner may choose a sequential scan on a small table, so also show an index serves
      // the lookup by disabling sequential scans for this session only. Recorded outcome (PR
      // description): the design expected idx_audit_log_team; on the test database the planner
      // picks whichever of idx_audit_log_team or idx_audit_log_operation is cheaper (the
      // sentinel's maintenance rows are few and the five operation names are rare), and filters
      // the other predicate. Either keeps the lookup an index scan; neither needs a new index.
      await client.query("SET enable_seqscan = off");
      const forced = [await plan(historySql, params), await plan(listSql, params)];
      await client.query("RESET enable_seqscan");
      console.info("[4.10] plans with sequential scans disabled:\n" + forced.join("\n---\n"));
      for (const p of forced) expect(p).toMatch(/idx_audit_log_team|idx_audit_log_operation/);
    } finally {
      client.release();
    }
  });

  // ---- 4.11 info events ------------------------------------------------------
  describe("4.11 structured info events", () => {
    const events = () => lines.filter((l) => String(l.event ?? "").startsWith("topic.default_"));

    it("all five operations emit identifiers and changedFields only, after commit", async () => {
      lines.length = 0;
      const distinct = "ZEBRA-SECRET-TEXT";
      const rows = await activeRows();
      const added = await add(`Name ${distinct}`, { prompt: `Prompt ${distinct}?`, firstSessionDescription: `Desc ${distinct}.` });
      await write({ kind: "edit", topicId: rows[0]!.id, fields: { prompt: `Edited ${distinct}?` } });
      await write({ kind: "archive", topicId: rows[1]!.id });
      await write({ kind: "restore", topicId: rows[1]!.id });
      await write({ kind: "reorder", order: (await activeRows()).map((r) => r.id).reverse() });
      const seen = events();
      expect(seen.map((e) => e.event)).toEqual([
        "topic.default_added",
        "topic.default_edited",
        "topic.default_archived",
        "topic.default_restored",
        "topic.default_reordered",
      ]);
      const allowed = new Set([
        "level", "time", "pid", "hostname", "msg", "audit", "event", "timestamp", "operation", "topicId",
        "changedFields", "actorUserId", "actorGlobalRole", "actorIp", "correlationId",
      ]);
      for (const e of seen) {
        expect(Object.keys(e).filter((k) => !allowed.has(k))).toEqual([]);
        expect(e).not.toHaveProperty("before");
        expect(e).not.toHaveProperty("after");
        expect(e["actorUserId"]).toBe(admin);
        expect(e["correlationId"]).toBe("corr-test");
        expect(e["level"]).toBe(30);
      }
      expect(seen[0]!["topicId"]).toBe(added.changedTopicId);
      expect(seen[4]).not.toHaveProperty("topicId");
      expect(JSON.stringify(lines)).not.toContain(distinct);
    });

    it("a forced audit failure and a forced backstop failure emit no topic.default_* event; no-ops emit none", async () => {
      lines.length = 0;
      await errorOf(
        writeTemplateTopics(
          { kind: "add", input: { name: "A", prompt: "p?", firstSessionDescription: "d", voteType: "finger" } },
          { userId: admin, role: "application_admin", ip: "nope" },
          { log: logApp.log, correlationId: "c" },
        ),
      );
      await errorOf(add("Bad", { prompt: "<i>x</i>" }));
      const ids = (await activeRows()).map((r) => r.id);
      await write({ kind: "reorder", order: ids }); // no-op
      await write({ kind: "edit", topicId: ids[0]!, fields: {} }); // no-op
      expect(events()).toHaveLength(0);
    });
  });

  // ---- 4.12 concurrency ------------------------------------------------------
  describe("4.12 concurrency", () => {
    it("two concurrent reorders serialize: positions are exactly 1..N and each got success or a mismatch", async () => {
      const ids = (await activeRows()).map((r) => r.id);
      const a = [...ids].reverse();
      const b = [ids[1]!, ids[0]!, ...ids.slice(2)];
      const results = await Promise.allSettled([write({ kind: "reorder", order: a }, admin), write({ kind: "reorder", order: b }, otherAdmin)]);
      for (const r of results) {
        if (r.status === "rejected") expect((r.reason as MaintenanceError).code).toBe("REORDER_ID_MISMATCH");
      }
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      const finalIds = await expectActivePositionsDense(db());
      expect([a, b]).toContainEqual(finalIds);
    });

    it("a team created while an admin transaction holds uncommitted negated positions receives the complete before-set", async () => {
      const facilitator = await h.fx.user("facilitator");
      const app = await h.appFor(facilitator);
      const before = await activeRows();
      const holder = await db().connect();
      try {
        // Direct SQL on a second connection with a manual BEGIN: no production test hook.
        await holder.query("BEGIN");
        await holder.query(LOCK_TEAM_TOPICS_SQL, [SENTINEL_TEAM_ID]);
        await holder.query(
          `UPDATE topics SET display_order = -display_order WHERE team_id = $1 AND status = 'active'`,
          [SENTINEL_TEAM_ID],
        );
        await holder.query(`UPDATE topics SET name = name || ' (uncommitted)' WHERE team_id = $1 AND status = 'active'`, [SENTINEL_TEAM_ID]);
        const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: `Concurrent ${randomUUID()}` } });
        expect(res.statusCode).toBe(201);
        const teamId = res.json().teamId as string;
        h.fx.track(teamId);
        const copied = (await db().query<{ name: string; display_order: number }>(
          `SELECT name, display_order FROM topics WHERE team_id = $1 ORDER BY display_order`, [teamId])).rows;
        expect(copied.map((c) => c.name)).toEqual(before.map((b) => b.name));
        expect(copied.map((c) => c.display_order)).toEqual(before.map((_, i) => i + 1));
      } finally {
        await holder.query("ROLLBACK");
        holder.release();
      }
    });
  });

  // ---- 6.1 audit -------------------------------------------------------------
  describe("6.1 audit rows", () => {
    it("exactly one row per effective write, with the documented columns and a closed key set", async () => {
      const rows = await activeRows();
      await add("Audit One");
      await write({ kind: "edit", topicId: rows[0]!.id, fields: { name: "Audit Edited" } });
      await write({ kind: "archive", topicId: rows[1]!.id });
      await write({ kind: "restore", topicId: rows[1]!.id });
      await write({ kind: "reorder", order: (await activeRows()).map((r) => r.id).reverse() });
      const audit = await maintenanceAudit();
      expect(audit.map((a) => a.operation)).toEqual([
        "topic.default_added",
        "topic.default_edited",
        "topic.default_archived",
        "topic.default_restored",
        "topic.default_reordered",
      ]);
      for (const a of audit) {
        expect(a.team_id).toBe(SENTINEL_TEAM_ID);
        expect(a.actor_user_id).toBe(admin);
        expect(a.actor_global_role).toBe("application_admin");
        expect(a.actor_ip).toBe("203.0.113.7");
        expect(a.actor_roles).toBeNull();
        const keys = Object.keys(a.metadata).sort();
        expect(keys).toEqual(
          a.operation === "topic.default_reordered"
            ? ["after", "before", "changedFields", "operation"]
            : ["after", "before", "changedFields", "operation", "topicId"],
        );
        expect(a.metadata["operation"]).toBe(a.operation);
        expect(JSON.stringify(a.metadata).length).toBeLessThan(8000); // bounded
      }
    });

    it("the text exception does not spread: no other operation's metadata holds topic text", async () => {
      const distinctName = "Spread Check Name";
      await add(distinctName);
      const rows = (
        await db().query<{ operation: string; metadata: unknown }>(
          `SELECT operation, metadata FROM audit_log
            WHERE NOT (operation = ANY($1::text[])) AND metadata::text ILIKE ANY($2::text[]) AND actor_user_id = $3`,
          [[...MAINTENANCE_AUDIT_OPERATIONS], ["%Spread Check Name%"], admin],
        )
      ).rows;
      expect(rows).toEqual([]);
    });

    it("a rejected write leaves the template unchanged and no success row", async () => {
      const before = await templateRows();
      await errorOf(add("pairing")); // duplicate
      await errorOf(write({ kind: "archive", topicId: randomUUID() }));
      expect(await templateRows()).toEqual(before);
      expect(await maintenanceAudit()).toHaveLength(0);
    });
  });

  // ---- 6.2 isolation -----------------------------------------------------------
  describe("6.2 live-session isolation", () => {
    it("no operation touches any real team's topics or any session_topics row; a team created afterwards gets the new set, an older team keeps the old", async () => {
      const facilitator = await h.fx.user("facilitator");
      const app = await h.appFor(facilitator);
      const olderRes = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: `Older ${randomUUID()}` } });
      const olderId = olderRes.json().teamId as string;
      h.fx.track(olderId);
      // Scoped to the team this test created. Test files share one database and run in
      // parallel, so a database-wide snapshot would also see other files' teams and topics
      // appear between the two reads. The writer's SQL touching only the sentinel is proven
      // separately by the statement-capture test below.
      const snapshotRows = async () => ({
        topics: (await db().query(`SELECT * FROM topics WHERE team_id = $1 ORDER BY id`, [olderId])).rows,
        sessionTopics: (
          await db().query(
            `SELECT st.* FROM session_topics st JOIN sessions s ON s.id = st.session_id WHERE s.team_id = $1 ORDER BY st.id`,
            [olderId],
          )
        ).rows,
        sessions: (await db().query(`SELECT id, status, current_topic_id FROM sessions WHERE team_id = $1 ORDER BY id`, [olderId])).rows,
        memberships: (await db().query(`SELECT * FROM team_memberships WHERE team_id = $1 ORDER BY user_id`, [olderId])).rows,
      });
      const before = await snapshotRows();

      const rows = await activeRows();
      await add("Isolation New");
      await write({ kind: "edit", topicId: rows[0]!.id, fields: { name: "Isolation Renamed" } });
      await write({ kind: "archive", topicId: rows[1]!.id });
      await write({ kind: "restore", topicId: rows[1]!.id });
      await write({ kind: "reorder", order: (await activeRows()).map((r) => r.id).reverse() });

      expect(await snapshotRows()).toEqual(before);

      const newerRes = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: `Newer ${randomUUID()}` } });
      const newerId = newerRes.json().teamId as string;
      h.fx.track(newerId);
      const names = async (id: string) =>
        (await db().query<{ name: string }>(`SELECT name FROM topics WHERE team_id = $1 ORDER BY display_order`, [id])).rows.map((r) => r.name);
      expect(await names(newerId)).toContain("Isolation Renamed");
      expect(await names(newerId)).toContain("Isolation New");
      expect(await names(olderId)).not.toContain("Isolation Renamed");
      expect(await names(olderId)).not.toContain("Isolation New");
    });

    it("recovery hands out the current template: a zero-topic team recovered after an edit receives the edited wording", async () => {
      const facilitator = await h.fx.user("facilitator");
      const emptyTeam = await h.fx.team(facilitator); // no topics at all
      const rows = await activeRows();
      await write({ kind: "edit", topicId: rows[0]!.id, fields: { prompt: "Recovered with the edited wording?" } });
      const app = await h.appFor(admin);
      const res = await app.inject({ method: "POST", url: `/api/v1/teams/${emptyTeam}/topics/assign-defaults` });
      expect(res.statusCode).toBe(201);
      const prompts = (await db().query<{ prompt: string }>(`SELECT prompt FROM topics WHERE team_id = $1 ORDER BY display_order`, [emptyTeam])).rows.map((r) => r.prompt);
      expect(prompts[0]).toBe("Recovered with the edited wording?");
      expect(prompts).toHaveLength(rows.length);
    });

    it("the writer's SQL names only the sentinel: it never locks or queries a real team, session or membership (works with no teams)", async () => {
      const statements: Array<{ text: string; values: unknown[] }> = [];
      const realConnect = db().connect.bind(db());
      const spy = vi.spyOn(db(), "connect").mockImplementation((async (...args: unknown[]) => {
        // pool.query() itself calls connect(callback): leave that form alone.
        if (typeof args[0] === "function") return (realConnect as (...a: unknown[]) => unknown)(...args);
        const client = await realConnect();
        const realQuery = client.query.bind(client) as (...a: unknown[]) => unknown;
        (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
          const first = args[0];
          const text = typeof first === "string" ? first : (first as { text: string }).text;
          const values = (typeof first === "string" ? args[1] : (first as { values?: unknown[] }).values) as unknown[] | undefined;
          statements.push({ text, values: values ?? [] });
          return realQuery(...args);
        };
        return client;
      }) as never);
      try {
        const rows = await activeRows();
        await add("Sql Scan");
        await write({ kind: "edit", topicId: rows[0]!.id, fields: { name: "Sql Scanned" } });
        await write({ kind: "archive", topicId: rows[1]!.id });
        await write({ kind: "restore", topicId: rows[1]!.id });
        await write({ kind: "reorder", order: (await activeRows()).map((r) => r.id).reverse() });
      } finally {
        spy.mockRestore();
      }
      expect(statements.length).toBeGreaterThan(10);
      for (const s of statements) {
        expect(s.text, s.text).not.toMatch(/\b(sessions|session_topics|team_memberships|join_links|teams)\b/i);
        if (s.text.includes("pg_advisory_xact_lock")) expect(s.values).toEqual([SENTINEL_TEAM_ID]);
        if (/FROM topics|UPDATE topics|INSERT INTO topics/i.test(s.text) && /team_id\s*=\s*\$1/.test(s.text)) {
          expect(s.values[0], s.text).toBe(SENTINEL_TEAM_ID);
        }
      }
    });
  });

  // sanity: the module under test never creates a team row
  it("the maintenance operations succeed on a database whose only team the writer knows is the sentinel", async () => {
    const res = await add("Alone");
    expect(res.unchanged).toBe(false);
  });
});

// A reminder of the exported surface the routes depend on.
void MAINTENANCE_AUDIT_OPERATIONS;
