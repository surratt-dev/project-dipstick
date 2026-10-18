import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { RouteOptions } from "fastify";
import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  buildFullApp,
  probeInfra,
  requireInfraOrThrow,
  SENTINEL_TEAM_ID,
} from "./helpers/real-db.js";
import { expectActivePositionsDense, useMaintenanceTemplate } from "./helpers/maintenance-test-hygiene.js";
import { LOCK_TEAM_TOPICS_SQL } from "../../sessions/session-topic-snapshot.js";
import { MAINTENANCE_AUDIT_OPERATIONS, RENAME_NOTICE, SCOPE_STATEMENT } from "../../sessions/default-topic-maintenance.js";

// ---------------------------------------------------------------------------
// admin-default-topic-maintenance (#216) tasks.md 5.3 (route slice 2, one test
// per design E3/E4 table row), 5.5 (security), 5.6 (scope statement) and 6.3
// (endpoint inventory), over real HTTP injection against real Postgres.
// Authorization, the denial audit and the rate limit are in
// admin-default-topics-authz-integration.test.ts; the operations' semantics in
// default-topic-writer-integration.test.ts.
// ---------------------------------------------------------------------------

// The 150 ms timing floor is mocked away so the many requests below stay fast; the real floor is
// asserted in admin-default-topics-timing-integration.test.ts.
vi.mock("../../content/timing-oracle.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  applyTimingFloor: async () => undefined,
}));

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "admin-default-topics-routes-integration.test.ts");

const BASE = "/api/v1/admin/default-topics";

describe.skipIf(!infraUp)("admin default-topics routes (real Postgres, #216)", () => {
  const h = useMaintenanceTemplate();
  let admin: string;
  beforeAll(async () => {
    admin = await h.fx.user("application_admin");
  });

  const app = () => h.appFor(admin);
  const db = () => h.mods.db;
  const validAdd = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    prompt: `Prompt for ${name}?`,
    firstSessionDescription: `About ${name}.`,
    voteType: "finger",
    ...over,
  });
  async function list() {
    const res = await (await app()).inject({ method: "GET", url: BASE });
    return res.json() as { defaults: Array<{ id: string; name: string; status: string; displayOrder: number | null }> };
  }
  async function activeIds() {
    return (await list()).defaults.filter((d) => d.status === "active").map((d) => d.id);
  }
  async function fillTo(n: number) {
    const a = await app();
    let count = (await activeIds()).length;
    while (count < n) {
      const res = await a.inject({ method: "POST", url: BASE, payload: validAdd(`Route Fill ${count}`) });
      expect(res.statusCode).toBe(201);
      count++;
    }
  }
  const auditCount = async () =>
    (
      await db().query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE team_id = $1 AND operation = ANY($2::text[]) AND "timestamp" >= $3`,
        [SENTINEL_TEAM_ID, [...MAINTENANCE_AUDIT_OPERATIONS], h.startedAt()],
      )
    ).rows[0]!.n;
  const templateState = async () => (await db().query(`SELECT * FROM topics WHERE team_id = $1 ORDER BY id`, [SENTINEL_TEAM_ID])).rows;

  // ---- success shapes ----------------------------------------------------------
  describe("success status and shape per route", () => {
    it("add 201 with the refreshed list, limits, orderLastChangedAt, scope, changedTopicId", async () => {
      const res = await (await app()).inject({ method: "POST", url: BASE, payload: validAdd("Shape Add") });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(Object.keys(body).sort()).toEqual(["changedTopicId", "defaults", "limits", "orderLastChangedAt", "scope"]);
      expect(body.scope).toBe(SCOPE_STATEMENT);
      expect(body.limits).toEqual({ minActive: 1, maxActive: 15, nameMax: 60, promptMax: 400, descriptionMax: 800 });
      expect(body.defaults).toHaveLength(13);
      const added = body.defaults.find((d: { id: string }) => d.id === body.changedTopicId);
      expect(added).toMatchObject({ name: "Shape Add", status: "active", displayOrder: 13, voteType: "finger" });
      expect(added.lastChangedAt).not.toBeNull();
      expect(added.lastChangedBy).toMatchObject({ userId: admin });
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("edit, archive, restore and reorder are 200 with scope; list and history are 200", async () => {
      const a = await app();
      const ids = await activeIds();
      const edit = await a.inject({ method: "PATCH", url: `${BASE}/${ids[0]}`, payload: { prompt: "Shape edit?" } });
      expect(edit.statusCode).toBe(200);
      expect(edit.json().scope).toBe(SCOPE_STATEMENT);
      expect(edit.json().notice).toBeUndefined();
      const archive = await a.inject({ method: "POST", url: `${BASE}/${ids[1]}/archive` });
      expect(archive.statusCode).toBe(200);
      expect(archive.json().defaults.find((d: { id: string }) => d.id === ids[1])).toMatchObject({ status: "archived", displayOrder: null });
      const restore = await a.inject({ method: "POST", url: `${BASE}/${ids[1]}/restore` });
      expect(restore.statusCode).toBe(200);
      const current = await activeIds();
      const reorder = await a.inject({ method: "PUT", url: `${BASE}/order`, payload: { order: [...current].reverse() } });
      expect(reorder.statusCode).toBe(200);
      expect(reorder.json().scope).toBe(SCOPE_STATEMENT);
      expect(reorder.json().orderLastChangedAt).not.toBeNull();
      for (const r of [edit, archive, restore, reorder]) {
        expect(Object.keys(r.json())).toEqual(expect.arrayContaining(["defaults", "limits", "orderLastChangedAt", "scope"]));
      }
      const history = await a.inject({ method: "GET", url: `${BASE}/history` });
      expect(history.statusCode).toBe(200);
      expect(history.json().history.map((e: { operation: string }) => e.operation)).toEqual([
        "topic.default_reordered",
        "topic.default_restored",
        "topic.default_archived",
        "topic.default_edited",
      ]);
      await expectActivePositionsDense(db());
    });

    it("no-op edits, reorders and an empty PATCH are 200 with unchanged:true, scope and no audit row", async () => {
      const a = await app();
      const ids = await activeIds();
      const stored = (await db().query(`SELECT name, prompt FROM topics WHERE id = $1`, [ids[0]])).rows[0];
      const same = await a.inject({ method: "PATCH", url: `${BASE}/${ids[0]}`, payload: { name: ` ${stored.name} `, prompt: stored.prompt } });
      const empty = await a.inject({ method: "PATCH", url: `${BASE}/${ids[0]}`, payload: {} });
      const noBody = await a.inject({ method: "PATCH", url: `${BASE}/${ids[0]}` });
      const onlyEqualVote = await a.inject({ method: "PATCH", url: `${BASE}/${ids[0]}`, payload: { voteType: "finger", ignored: 1 } });
      const reorder = await a.inject({ method: "PUT", url: `${BASE}/order`, payload: { order: ids } });
      for (const r of [same, empty, noBody, onlyEqualVote, reorder]) {
        expect(r.statusCode).toBe(200);
        expect(r.json().unchanged).toBe(true);
        expect(r.json().scope).toBe(SCOPE_STATEMENT);
        expect(r.json().defaults).toHaveLength(12);
      }
      expect(await auditCount()).toBe(0);
    });

    it("a rename carries the exact notice; a case-only rename is a real change", async () => {
      const a = await app();
      const pairing = (await list()).defaults.find((d) => d.name === "Pairing")!;
      const res = await a.inject({ method: "PATCH", url: `${BASE}/${pairing.id}`, payload: { name: "pairing" } });
      expect(res.statusCode).toBe(200);
      expect(res.json().notice).toBe(RENAME_NOTICE);
      expect(res.json().unchanged).toBeUndefined();
      const spacing = await a.inject({ method: "PATCH", url: `${BASE}/${pairing.id}`, payload: { name: " pairing " } });
      expect(spacing.json().unchanged).toBe(true);
      expect(spacing.json().notice).toBeUndefined();
      expect(await auditCount()).toBe(1);
    });

    it("the audit metadata.topicId and the list use the lowercase database id when the path id is uppercase", async () => {
      const a = await app();
      const id = (await activeIds())[0]!;
      const res = await a.inject({ method: "PATCH", url: `${BASE}/${id.toUpperCase()}`, payload: { prompt: "Uppercase path id?" } });
      expect(res.statusCode).toBe(200);
      const audit = (await db().query(`SELECT metadata FROM audit_log WHERE team_id = $1 AND operation = 'topic.default_edited' AND "timestamp" >= $2`, [SENTINEL_TEAM_ID, h.startedAt()])).rows[0];
      expect(audit.metadata.topicId).toBe(id);
      expect(res.json().changedTopicId).toBe(id);
      expect(res.json().defaults.find((d: { id: string }) => d.id === id).lastChangedAt).not.toBeNull();
    });

    it("the first write response shows the changed row's lastChangedAt; an untouched seeded row shows nulls", async () => {
      const a = await app();
      const ids = await activeIds();
      const res = await a.inject({ method: "PATCH", url: `${BASE}/${ids[2]}`, payload: { prompt: "First write?" } });
      const rows = res.json().defaults as Array<{ id: string; lastChangedAt: string | null; lastChangedBy: unknown }>;
      expect(rows.find((r) => r.id === ids[2])!.lastChangedAt).not.toBeNull();
      expect(rows.find((r) => r.id === ids[3])).toMatchObject({ lastChangedAt: null, lastChangedBy: null });
    });
  });

  // ---- 5.3: every E3/E4 table row -------------------------------------------------
  describe("5.3 error table: one test per row (rejections write no success audit row and change nothing)", () => {
    async function expectRejected(
      res: { statusCode: number; json: () => { error: { code: string; correlationId: string } }; body: string },
      status: number,
      code: string,
      before: unknown[],
    ) {
      expect(res.statusCode).toBe(status);
      expect(res.json().error.code).toBe(code);
      expect(res.json().error.correlationId).toEqual(expect.any(String));
      expect(await auditCount()).toBe(0);
      expect(await templateState()).toEqual(before);
    }
    const run = async (method: "POST" | "PATCH" | "PUT", url: string, payload?: unknown) =>
      (await app()).inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });

    it("DEFAULT_FIELD_REQUIRED 422 (missing, blank, wrong type) with the field name", async () => {
      const before = await templateState();
      for (const [payload, field] of [
        [{}, "name"],
        [validAdd("X", { name: "   " }), "name"],
        [validAdd("X", { prompt: 5 }), "prompt"],
        [validAdd("X", { firstSessionDescription: undefined }), "firstSessionDescription"],
        [validAdd("X", { voteType: undefined }), "voteType"],
      ] as const) {
        const res = await run("POST", BASE, payload);
        await expectRejected(res, 422, "DEFAULT_FIELD_REQUIRED", before);
        expect(res.json().error.field).toBe(field);
      }
      const notObject = await run("POST", BASE, "just a string");
      expect(notObject.statusCode).toBe(415); // text/plain is not JSON: refused before validation
    });

    it("DEFAULT_FIELD_TOO_LONG 422 carries field and max", async () => {
      const before = await templateState();
      const res = await run("POST", BASE, validAdd("X", { prompt: "p".repeat(401) }));
      await expectRejected(res, 422, "DEFAULT_FIELD_TOO_LONG", before);
      expect(res.json().error).toMatchObject({ field: "prompt", max: 400 });
      expect((await run("POST", BASE, validAdd("n".repeat(61)))).json().error).toMatchObject({ field: "name", max: 60 });
    });

    it("PROMPT_FORMAT_INVALID 422 carries the field and never echoes the offending value", async () => {
      const before = await templateState();
      const res = await run("POST", BASE, validAdd("X", { prompt: "see <script>alert(1)</script> here" }));
      await expectRejected(res, 422, "PROMPT_FORMAT_INVALID", before);
      expect(res.json().error.field).toBe("prompt");
      expect(res.body).not.toContain("script");
      const bidi = await run("POST", BASE, validAdd("X", { name: "abc‮def" }));
      expect(bidi.json().error).toMatchObject({ code: "PROMPT_FORMAT_INVALID", field: "name" });
      expect(bidi.body).not.toContain("abc");
    });

    it("DEFAULT_VOTE_TYPE_INVALID 422 and DEFAULT_VOTE_TYPE_IMMUTABLE 422", async () => {
      const before = await templateState();
      await expectRejected(await run("POST", BASE, validAdd("X", { voteType: "thumbs" })), 422, "DEFAULT_VOTE_TYPE_INVALID", before);
      const id = (await activeIds())[0]!;
      await expectRejected(await run("PATCH", `${BASE}/${id}`, { voteType: "roman" }), 422, "DEFAULT_VOTE_TYPE_IMMUTABLE", before);
      await expectRejected(await run("PATCH", `${BASE}/${id}`, { voteType: "bogus" }), 422, "DEFAULT_VOTE_TYPE_INVALID", before);
    });

    it("DEFAULT_NAME_DUPLICATE 409 (add, rename)", async () => {
      const before = await templateState();
      await expectRejected(await run("POST", BASE, validAdd(" pairing ")), 409, "DEFAULT_NAME_DUPLICATE", before);
      const id = (await activeIds())[0]!;
      await expectRejected(await run("PATCH", `${BASE}/${id}`, { name: "PIPELINE" }), 409, "DEFAULT_NAME_DUPLICATE", before);
    });

    it("INVALID_HISTORY_LIMIT 422 at 0, -1 and abc; 1, 200 and 201 are accepted (201 clamped)", async () => {
      const a = await app();
      for (const limit of ["0", "-1", "abc", "", "1.5"]) {
        const res = await a.inject({ method: "GET", url: `${BASE}/history?limit=${limit}` });
        expect(res.statusCode, limit).toBe(422);
        expect(res.json().error.code).toBe("INVALID_HISTORY_LIMIT");
      }
      expect((await a.inject({ method: "GET", url: `${BASE}/history?limit=1&limit=2` })).statusCode).toBe(422);
      for (const limit of ["1", "200", "201"]) {
        expect((await a.inject({ method: "GET", url: `${BASE}/history?limit=${limit}` })).statusCode, limit).toBe(200);
      }
    });

    it("TEMPLATE_AT_CAPACITY 409 (add and restore), and validation precedes capacity", async () => {
      const first = (await activeIds())[0]!;
      await (await app()).inject({ method: "POST", url: `${BASE}/${first}/archive` });
      await fillTo(15);
      const before = await templateState();
      const audits = await auditCount();
      const res = await run("POST", BASE, validAdd("Sixteenth"));
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("TEMPLATE_AT_CAPACITY");
      expect((await run("POST", `${BASE}/${first}/restore` as string)).json().error.code).toBe("TEMPLATE_AT_CAPACITY");
      const invalid = await run("POST", BASE, validAdd("Sixteenth", { prompt: "p".repeat(401) }));
      expect(invalid.statusCode).toBe(422);
      expect(invalid.json().error.code).toBe("DEFAULT_FIELD_TOO_LONG");
      expect(await templateState()).toEqual(before);
      expect(await auditCount()).toBe(audits);
    });

    it("LAST_ACTIVE_DEFAULT 409", async () => {
      const a = await app();
      const ids = await activeIds();
      for (const id of ids.slice(1)) await a.inject({ method: "POST", url: `${BASE}/${id}/archive` });
      const before = await templateState();
      const audits = await auditCount();
      const res = await a.inject({ method: "POST", url: `${BASE}/${ids[0]}/archive` });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("LAST_ACTIVE_DEFAULT");
      expect(await templateState()).toEqual(before);
      expect(await auditCount()).toBe(audits);
    });

    it("REORDER_ID_MISMATCH 409 carries the current active list", async () => {
      const before = await templateState();
      const ids = await activeIds();
      const res = await run("PUT", `${BASE}/order`, { order: ids.slice(1) });
      await expectRejected(res, 409, "REORDER_ID_MISMATCH", before);
      expect(res.json().error.current.map((d: { id: string }) => d.id)).toEqual(ids);
      expect(res.json().error.message).toMatch(/Reload the list/);
    });

    it("INVALID_DEFAULT_ORDER 422: malformed, non-array, empty, repeated id, non-uuid element, and 16 ids before any per-element work", async () => {
      const before = await templateState();
      const ids = await activeIds();
      const bodies: unknown[] = [
        {},
        { order: "nope" },
        { order: [] },
        { order: [...ids.slice(0, -1), ids[0]] },
        { order: [...ids.slice(0, -1), "not-a-uuid"] },
        { order: [...ids, ...ids.slice(0, 4)] },
        { order: Array.from({ length: 16 }, () => 5) },
        [],
      ];
      for (const body of bodies) {
        const res = await run("PUT", `${BASE}/order`, body);
        await expectRejected(res, 422, "INVALID_DEFAULT_ORDER", before);
      }
    });

    it("DEFAULT_TOPIC_NOT_FOUND 404 (unknown id on edit, archive and restore)", async () => {
      const before = await templateState();
      const id = randomUUID();
      await expectRejected(await run("PATCH", `${BASE}/${id}`, { name: "Nope" }), 404, "DEFAULT_TOPIC_NOT_FOUND", before);
      await expectRejected(await run("POST", `${BASE}/${id}/archive`), 404, "DEFAULT_TOPIC_NOT_FOUND", before);
      await expectRejected(await run("POST", `${BASE}/${id}/restore`), 404, "DEFAULT_TOPIC_NOT_FOUND", before);
    });

    it("DEFAULT_ARCHIVED 409, DEFAULT_ALREADY_ARCHIVED 422 and DEFAULT_ALREADY_ACTIVE 422", async () => {
      const a = await app();
      const ids = await activeIds();
      await a.inject({ method: "POST", url: `${BASE}/${ids[0]}/archive` });
      const before = await templateState();
      const audits = await auditCount();
      const archivedEdit = await run("PATCH", `${BASE}/${ids[0]}`, { prompt: "No." });
      expect(archivedEdit.statusCode).toBe(409);
      expect(archivedEdit.json().error.code).toBe("DEFAULT_ARCHIVED");
      expect((await run("POST", `${BASE}/${ids[0]}/archive`)).json().error.code).toBe("DEFAULT_ALREADY_ARCHIVED");
      expect((await run("POST", `${BASE}/${ids[0]}/archive`)).statusCode).toBe(422);
      const active = await run("POST", `${BASE}/${ids[1]}/restore`);
      expect(active.statusCode).toBe(422);
      expect(active.json().error.code).toBe("DEFAULT_ALREADY_ACTIVE");
      expect(await templateState()).toEqual(before);
      expect(await auditCount()).toBe(audits);
    });

    it("a restore name collision is 409 DEFAULT_NAME_DUPLICATE naming the conflicting default", async () => {
      const a = await app();
      const pairing = (await list()).defaults.find((d) => d.name === "Pairing")!;
      await a.inject({ method: "POST", url: `${BASE}/${pairing.id}/archive` });
      const replacement = await a.inject({ method: "POST", url: BASE, payload: validAdd("Pairing") });
      const res = await a.inject({ method: "POST", url: `${BASE}/${pairing.id}/restore` });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({
        code: "DEFAULT_NAME_DUPLICATE",
        conflictingTopicId: replacement.json().changedTopicId,
        conflictingName: "Pairing",
      });
    });

    it("DEFAULT_MAINTENANCE_BUSY 503 with Retry-After when the sentinel lock is held past lock_timeout; nothing changes", async () => {
      const holder = await db().connect();
      try {
        await holder.query("BEGIN");
        await holder.query(LOCK_TEAM_TOPICS_SQL, [SENTINEL_TEAM_ID]);
        const before = await templateState();
        const res = await run("POST", BASE, validAdd("Busy"));
        expect(res.statusCode).toBe(503);
        expect(res.json().error).toMatchObject({ category: "service_unavailable", code: "DEFAULT_MAINTENANCE_BUSY" });
        expect(res.json().error.message).toBe("Another change to the default topics is in progress. Try again in a moment.");
        expect(res.headers["retry-after"]).toBe("3");
        expect(await templateState()).toEqual(before);
      } finally {
        await holder.query("ROLLBACK");
        holder.release();
      }
      expect(await auditCount()).toBe(0);
    });

    it("an audit write failure is the generic 500 (no driver text), rolls the write back and writes no success row", async () => {
      const a = await app();
      const before = await templateState();
      const res = await a.inject({
        method: "POST",
        url: BASE,
        payload: validAdd("Audit Fails"),
        remoteAddress: "not-an-ip-address", // makes request.ip an invalid inet: the audit INSERT fails
      });
      expect(res.statusCode).toBe(500);
      const err = res.json().error;
      expect(err).toMatchObject({ category: "internal_error", code: "DEFAULT_MAINTENANCE_FAILED" });
      expect(err.correlationId).toEqual(expect.any(String));
      expect(res.body).not.toMatch(/inet|audit_log|syntax|invalid input|not-an-ip/i);
      expect(await templateState()).toEqual(before);
      expect(await auditCount()).toBe(0);
    });
  });

  // ---- 5.5 security ----------------------------------------------------------------
  describe("5.5 security", () => {
    it("mass assignment: POST and PATCH carrying teamId, team_id, status, isDefault, displayOrder, archivedBy, archivedAt and id have no effect", async () => {
      const a = await app();
      const other = randomUUID();
      const extras = {
        teamId: other,
        team_id: other,
        status: "archived",
        isDefault: false,
        is_default: false,
        displayOrder: 1,
        display_order: 1,
        archivedBy: admin,
        archivedAt: "2020-01-01T00:00:00Z",
        id: other,
      };
      const created = await a.inject({ method: "POST", url: BASE, payload: { ...validAdd("Mass Assign"), ...extras } });
      expect(created.statusCode).toBe(201);
      const id = created.json().changedTopicId as string;
      expect(id).not.toBe(other);
      const row = (await db().query(`SELECT * FROM topics WHERE id = $1`, [id])).rows[0];
      expect(row).toMatchObject({ team_id: SENTINEL_TEAM_ID, status: "active", is_default: true, display_order: 13, archived_at: null, archived_by: null });
      const before = (await db().query(`SELECT * FROM topics WHERE id = $1`, [id])).rows[0];
      const patched = await a.inject({ method: "PATCH", url: `${BASE}/${id}`, payload: { prompt: "Patched?", ...extras } });
      expect(patched.statusCode).toBe(200);
      const after = (await db().query(`SELECT * FROM topics WHERE id = $1`, [id])).rows[0];
      expect({ ...after, prompt: before.prompt, updated_at: before.updated_at }).toEqual(before);
      expect(after.prompt).toBe("Patched?");
      await expectActivePositionsDense(db());
    });

    it("a text/plain body and a form-encoded body are refused with 415 and change nothing", async () => {
      const a = await app();
      const before = await templateState();
      const id = (await activeIds())[0]!;
      const plain = await a.inject({ method: "POST", url: BASE, headers: { "content-type": "text/plain" }, payload: JSON.stringify(validAdd("Plain")) });
      expect(plain.statusCode).toBe(415);
      const plainPatch = await a.inject({ method: "PATCH", url: `${BASE}/${id}`, headers: { "content-type": "text/plain" }, payload: JSON.stringify({ name: "Plain" }) });
      expect(plainPatch.statusCode).toBe(415);
      const plainPut = await a.inject({ method: "PUT", url: `${BASE}/order`, headers: { "content-type": "text/plain" }, payload: "x" });
      expect(plainPut.statusCode).toBe(415);
      const form = await a.inject({
        method: "POST",
        url: BASE,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "name=Form&prompt=P&voteType=finger&firstSessionDescription=D",
      });
      expect(form.statusCode).toBe(415);
      expect(await templateState()).toEqual(before);
      expect(await auditCount()).toBe(0);
    });

    it("an oversized body is refused by bodyLimit (413) and changes nothing", async () => {
      const a = await app();
      const before = await templateState();
      const res = await a.inject({ method: "POST", url: BASE, payload: validAdd("Big", { prompt: "x".repeat(20 * 1024) }) });
      expect(res.statusCode).toBe(413);
      expect(await templateState()).toEqual(before);
    });

    it("a reorder array longer than 15 is 422 INVALID_DEFAULT_ORDER before any query", async () => {
      const a = await app();
      const { vi } = await import("vitest");
      const ids = await activeIds();
      const sixteen = [...ids, ...ids.slice(0, 4)];
      const spy = vi.spyOn(db(), "connect");
      try {
        const res = await a.inject({ method: "PUT", url: `${BASE}/order`, payload: { order: sixteen } });
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe("INVALID_DEFAULT_ORDER");
        // pool.query() (the live role read) calls connect(callback); the writer's transaction
        // would call connect() with no callback. None did.
        expect(spy.mock.calls.filter((c) => typeof c[0] !== "function")).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    });

    it("error bodies never echo the rejected value (every 422 and 409 body is free of the submitted text)", async () => {
      const a = await app();
      const marker = "ZEBRA-MARKER-9137";
      const payloads = [
        validAdd("X", { prompt: `<b>${marker}</b>` }),
        validAdd(marker.repeat(10)),
        validAdd("pairing", { prompt: marker }),
        validAdd(marker, { voteType: marker }),
      ];
      for (const payload of payloads) {
        const res = await a.inject({ method: "POST", url: BASE, payload });
        expect([409, 422]).toContain(res.statusCode);
        expect(res.body).not.toContain(marker);
      }
      const id = (await activeIds())[0]!;
      const patch = await a.inject({ method: "PATCH", url: `${BASE}/${id}`, payload: { name: `<i>${marker}</i>` } });
      expect(patch.body).not.toContain(marker);
      const order = await a.inject({ method: "PUT", url: `${BASE}/order`, payload: { order: [marker] } });
      expect(order.body).not.toContain(marker);
    });
  });

  // ---- 5.6 scope statement ------------------------------------------------------------
  describe("5.6 scope statement", () => {
    it("every write response, including no-ops, carries the scope text", async () => {
      const a = await app();
      const ids = await activeIds();
      const responses = [
        await a.inject({ method: "POST", url: BASE, payload: validAdd("Scope Add") }),
        await a.inject({ method: "PATCH", url: `${BASE}/${ids[0]}`, payload: { prompt: "Scope edit?" } }),
        await a.inject({ method: "PATCH", url: `${BASE}/${ids[0]}`, payload: {} }),
        await a.inject({ method: "POST", url: `${BASE}/${ids[1]}/archive` }),
        await a.inject({ method: "POST", url: `${BASE}/${ids[1]}/restore` }),
        await a.inject({ method: "PUT", url: `${BASE}/order`, payload: { order: await activeIds() } }),
        await a.inject({ method: "PUT", url: `${BASE}/order`, payload: { order: (await activeIds()).reverse() } }),
      ];
      for (const r of responses) {
        expect(r.statusCode).toBeLessThan(300);
        expect(r.json().scope).toBe("Applies to teams created from now on. Existing teams keep their current topics.");
      }
    });

    it("no response string in the new modules calls a restored topic 'canonical'", () => {
      const sources = ["../../routes/admin-default-topics.ts", "../../sessions/default-topic-maintenance.ts", "../../sessions/default-topic-validation.ts"];
      for (const rel of sources) {
        const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
        const literals = [...text.matchAll(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g)].map((m) => m[0]);
        for (const lit of literals) expect(lit, `${rel}: ${lit}`).not.toMatch(/canonical/i);
      }
      expect(SCOPE_STATEMENT).not.toMatch(/canonical/i);
      expect(RENAME_NOTICE).not.toMatch(/canonical/i);
    });
  });

  // ---- 6.3 inventory ------------------------------------------------------------------
  describe("6.3 endpoint inventory", () => {
    it("the registered routes under /api/v1/admin/default-topics are exactly the seven; none has :teamId", async () => {
      const seen: string[] = [];
      const onRoute = (route: RouteOptions) => {
        const methods = ([] as string[]).concat(route.method as string | string[]);
        if (!route.url.startsWith(BASE)) return;
        for (const m of methods) if (m !== "HEAD" && m !== "OPTIONS") seen.push(`${m} ${route.url}`);
        expect(route.url).not.toMatch(/:teamId/i);
      };
      const full = await buildFullApp(h.mods, admin, onRoute);
      try {
        expect(seen.sort()).toEqual(
          [
            `GET ${BASE}`,
            `POST ${BASE}`,
            `PATCH ${BASE}/:topicId`,
            `POST ${BASE}/:topicId/archive`,
            `POST ${BASE}/:topicId/restore`,
            `PUT ${BASE}/order`,
            `GET ${BASE}/history`,
          ].sort(),
        );
        // Archive-not-delete: no DELETE, and no other verb on the family.
        const id = (await activeIds())[0]!;
        for (const [method, url] of [
          ["DELETE", `${BASE}/${id}`],
          ["DELETE", BASE],
          ["PUT", `${BASE}/${id}`],
          ["GET", `${BASE}/${id}`],
          ["PATCH", BASE],
        ] as const) {
          const res = await full.inject({ method, url });
          expect([404, 405], `${method} ${url}`).toContain(res.statusCode);
        }
        expect((await db().query(`SELECT 1 FROM topics WHERE id = $1`, [id])).rowCount).toBe(1);
      } finally {
        await full.close();
      }
    });

    it("team-scoped topic writes with the sentinel id still return 404 TEAM_NOT_FOUND for an administrator", async () => {
      const a = await app();
      const id = (await activeIds())[0]!;
      const before = await db().query(`SELECT count(*)::int AS n FROM topics WHERE team_id = $1`, [SENTINEL_TEAM_ID]);
      for (const [method, url, payload] of [
        ["POST", `/api/v1/teams/${SENTINEL_TEAM_ID}/topics`, { name: "N", prompt: "P?", voteType: "finger" }],
        ["DELETE", `/api/v1/teams/${SENTINEL_TEAM_ID}/topics/${id}`, undefined],
        ["POST", `/api/v1/teams/${SENTINEL_TEAM_ID}/topics/${id}/restore`, undefined],
        ["PUT", `/api/v1/teams/${SENTINEL_TEAM_ID}/topics/order`, { order: [id] }],
      ] as const) {
        const res = await a.inject({ method, url, ...(payload ? { payload } : {}) });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
      }
      const after = await db().query(`SELECT count(*)::int AS n FROM topics WHERE team_id = $1`, [SENTINEL_TEAM_ID]);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });

  // ---- Edit it back through the routes (the sole recovery path) --------------------------
  it("edit it back: PATCH the history's before-value restores the live row and writes a new audit row", async () => {
    const a = await app();
    const id = (await activeIds())[0]!;
    const original = (await db().query(`SELECT name, prompt, first_session_description FROM topics WHERE id = $1`, [id])).rows[0];
    await a.inject({ method: "PATCH", url: `${BASE}/${id}`, payload: { prompt: "Wrong wording?" } });
    const history = (await a.inject({ method: "GET", url: `${BASE}/history` })).json().history as Array<{ before: Record<string, string>; topicId: string }>;
    const entry = history.find((e) => e.topicId === id)!;
    const back = await a.inject({ method: "PATCH", url: `${BASE}/${id}`, payload: entry.before });
    expect(back.statusCode).toBe(200);
    expect((await db().query(`SELECT name, prompt, first_session_description FROM topics WHERE id = $1`, [id])).rows[0]).toEqual(original);
    expect(await auditCount()).toBe(2);
  });
});
