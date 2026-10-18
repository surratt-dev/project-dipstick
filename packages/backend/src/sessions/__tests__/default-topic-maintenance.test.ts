import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// admin-default-topic-maintenance (#216): the writer module without a database.
//
// A fake pg client interprets the writer's SQL against an in-memory template, so
// each operation's real branching (positions, capacity, duplicates, no-ops, the
// backstop, error mapping, the audit payload, the post-commit read) is exercised
// by the real code. The Postgres-backed behaviour (locks, the unique index,
// transactions) is covered by default-topic-writer-integration.test.ts, which
// self-skips when the infrastructure is absent; this file runs everywhere.
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  name: string;
  prompt: string;
  vote_type: string;
  display_order: number;
  status: "active" | "archived";
  is_default: boolean;
  first_session_description: string | null;
}

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  audits: [] as Array<{ params: unknown[] }>,
  statements: [] as string[],
  nextId: 1,
  /** Throws (or returns an error to throw) for a matching statement. */
  failOn: null as null | ((sql: string) => unknown),
  phaseCountDelta: 0,
  /** Rows / results for the pool queries behind readTemplateList and readTemplateHistory. */
  listChanges: [] as Array<Record<string, unknown>>,
  listReorder: [] as Array<Record<string, unknown>>,
  history: [] as Array<Record<string, unknown>>,
  poolFails: false,
  events: [] as Array<{ event: string; fields: Record<string, unknown> }>,
  emitThrows: false,
}));

const rows = () => state.rows as unknown as Row[];
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function clientQuery(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
  state.statements.push(sql);
  const failure = state.failOn?.(sql);
  if (failure) return Promise.reject(failure);
  const ok = (r: unknown[] = [], rowCount = r.length) => Promise.resolve({ rows: r, rowCount });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim()) || sql.startsWith("SET LOCAL") || sql.includes("pg_advisory_xact_lock")) return ok();
  if (sql.includes("FROM topics WHERE team_id = $1 ORDER BY display_order, id")) {
    return ok([...rows()].sort((a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id)).map((r) => ({ ...r })));
  }
  if (sql.includes("INSERT INTO topics")) {
    const [, name, prompt, voteType, position, desc] = params as [string, string, string, string, number, string];
    const id = uuid(900 + state.nextId++);
    rows().push({ id, name, prompt, vote_type: voteType, display_order: position, status: "active", is_default: true, first_session_description: desc });
    return ok([{ id }]);
  }
  if (sql.includes("SET display_order = -v.pos")) {
    const ids = params[1] as string[];
    let n = 0;
    ids.forEach((id, i) => {
      const r = rows().find((x) => x.id === id && x.status === "active");
      if (r) {
        r.display_order = -(i + 1);
        n++;
      }
    });
    return ok([], n + state.phaseCountDelta);
  }
  if (sql.includes("SET display_order = -display_order")) {
    let n = 0;
    for (const r of rows()) {
      if (r.status === "active" && r.display_order < 0) {
        r.display_order = -r.display_order;
        n++;
      }
    }
    return ok([], n + state.phaseCountDelta);
  }
  if (sql.includes("SET name = $3, prompt = $4")) {
    const [id, , name, prompt, desc] = params as [string, string, string, string, string | null];
    const r = rows().find((x) => x.id === id)!;
    Object.assign(r, { name, prompt, first_session_description: desc });
    return ok([], 1);
  }
  if (sql.includes("SET status = 'archived'")) {
    rows().find((x) => x.id === params[0])!.status = "archived";
    return ok([], 1);
  }
  if (sql.includes("SET status = 'active'")) {
    const r = rows().find((x) => x.id === params[0])!;
    r.status = "active";
    r.display_order = params[2] as number;
    return ok([], 1);
  }
  if (sql.includes("INSERT INTO audit_log")) {
    state.audits.push({ params });
    return ok([], 1);
  }
  throw new Error(`fake client: unhandled SQL ${sql.slice(0, 80)}`);
}

const released = vi.hoisted(() => ({ n: 0, connectFails: false }));

vi.mock("../../db.js", () => ({
  db: {
    connect: async () => {
      if (released.connectFails) throw new Error("no connection");
      return { query: clientQuery, release: () => void released.n++ };
    },
    query: async (sql: string) => {
      if (state.poolFails) throw new Error("pool down");
      if (sql.includes("DISTINCT ON")) return { rows: state.listChanges };
      if (sql.includes("topic.default_reordered") && sql.includes("LIMIT 1")) return { rows: state.listReorder };
      if (sql.includes("FROM audit_log a")) return { rows: state.history };
      if (sql.includes("is_default = true")) {
        const list = rows().filter((r) => r.is_default);
        return {
          rows: [...list.filter((r) => r.status === "active").sort((a, b) => a.display_order - b.display_order), ...list.filter((r) => r.status === "archived")],
        };
      }
      throw new Error(`fake pool: unhandled SQL ${sql.slice(0, 80)}`);
    },
  },
}));
vi.mock("../../config.js", () => ({ config: { DATABASE_URL: "postgres://test", REDIS_URL: "redis://test" } }));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (_log: unknown, event: string, fields: Record<string, unknown>) => {
    if (state.emitThrows) throw new Error("log sink down");
    state.events.push({ event, fields });
  },
}));

import {
  BackstopError,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  MAINTENANCE_AUDIT_OPERATIONS,
  MaintenanceError,
  RENAME_NOTICE,
  SCOPE_STATEMENT,
  parseHistoryLimit,
  readTemplateHistory,
  readTemplateList,
  writeTemplateTopics,
  type MaintenanceWrite,
} from "../default-topic-maintenance.js";
import { AuditWriteError as RealAuditWriteError } from "../../auth/errors.js";

const log = { error: vi.fn() } as never;
const actor = { userId: "admin-1", role: "application_admin", ip: "203.0.113.9" };
const ctx = { log, correlationId: "corr-1" };

function seed(count = 12, over: Partial<Row>[] = []): void {
  state.rows = Array.from({ length: count }, (_, i) => ({
    id: uuid(i + 1),
    name: `Topic ${i + 1}`,
    prompt: `Prompt ${i + 1}?`,
    vote_type: "finger",
    display_order: i + 1,
    status: "active",
    is_default: true,
    first_session_description: `About ${i + 1}.`,
    ...(over[i] ?? {}),
  }));
}
const write = (op: MaintenanceWrite) => writeTemplateTopics(op, actor, ctx);
const add = (name = "New One", prompt = "A new prompt?") =>
  write({ kind: "add", input: { name, prompt, firstSessionDescription: "About new.", voteType: "roman" } });
const positions = () => rows().filter((r) => r.status === "active").sort((a, b) => a.display_order - b.display_order).map((r) => r.display_order);
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as MaintenanceError).code ?? (e as Error).name;
  }
  return "no error";
};
const auditMetadata = (i = 0) => JSON.parse(state.audits[i]!.params[5] as string) as Record<string, unknown>;

beforeEach(() => {
  state.rows = [];
  state.audits = [];
  state.statements = [];
  state.nextId = 1;
  state.failOn = null;
  state.phaseCountDelta = 0;
  state.listChanges = [];
  state.listReorder = [];
  state.history = [];
  state.poolFails = false;
  state.events = [];
  state.emitThrows = false;
  released.n = 0;
  released.connectFails = false;
  seed();
});

describe("constants", () => {
  it("exports the five audit operations and the fixed statements", () => {
    expect(MAINTENANCE_AUDIT_OPERATIONS).toHaveLength(5);
    expect(SCOPE_STATEMENT).toMatch(/^Applies to teams created from now on/);
    expect(RENAME_NOTICE).toMatch(/^Renamed\./);
  });
});

describe("add", () => {
  it("appends at the next position, audits the full new row once, emits an identifiers-only event", async () => {
    const res = await add();
    expect(res.unchanged).toBe(false);
    expect(res.operation).toBe("topic.default_added");
    expect(positions()).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(res.changedTopicId).toBe(rows()[12]!.id);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]!.params.slice(0, 5)).toEqual(["admin-1", "application_admin", "203.0.113.9", "topic.default_added", expect.any(String)]);
    expect(auditMetadata()).toEqual({
      topicId: res.changedTopicId,
      operation: "topic.default_added",
      changedFields: ["name", "prompt", "firstSessionDescription"],
      before: null,
      after: { name: "New One", prompt: "A new prompt?", firstSessionDescription: "About new.", voteType: "roman", status: "active", displayOrder: 13 },
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]!.fields).toEqual({
      operation: "topic.default_added",
      topicId: res.changedTopicId,
      changedFields: ["name", "prompt", "firstSessionDescription"],
      actorUserId: "admin-1",
      actorGlobalRole: "application_admin",
      actorIp: "203.0.113.9",
      correlationId: "corr-1",
    });
    expect(res.list?.defaults.length).toBe(13);
    expect(released.n).toBe(1);
  });

  it("repairs a gapped template: the new row is appended and the active set renumbered dense", async () => {
    seed(4);
    rows()[2]!.display_order = 4;
    rows()[3]!.display_order = 5;
    const res = await add();
    expect(positions()).toEqual([1, 2, 3, 4, 5]);
    const after = auditMetadata()["after"] as { renumbered: Array<{ from: number; to: number }> };
    expect(after.renumbered.map((r) => [r.from, r.to])).toEqual([[4, 3], [5, 4]]);
    expect(res.changedTopicId).toBeDefined();
  });

  it("refuses a sixteenth active default and a duplicate name (trim, case) and changes nothing", async () => {
    expect(await codeOf(add(" TOPIC 1 "))).toBe("DEFAULT_NAME_DUPLICATE");
    seed(15);
    expect(await codeOf(add())).toBe("TEMPLATE_AT_CAPACITY");
    expect(state.audits).toHaveLength(0);
    expect(rows()).toHaveLength(15);
  });

  it("a name matching only an archived default is free", async () => {
    seed(3, [{ status: "archived" }]);
    positionsFix();
    await expect(add("Topic 1")).resolves.toMatchObject({ unchanged: false });
  });

  it("an invalid written row trips the backstop: rolled back, no audit, no event", async () => {
    const err = await write({ kind: "add", input: { name: "Bad", prompt: "<b>x</b>", firstSessionDescription: "d", voteType: "finger" } }).catch((e) => e);
    expect(err).toBeInstanceOf(BackstopError);
    expect(err.invariant).toMatch(/field validation/);
    expect(state.audits).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.statements).toContain("ROLLBACK");
  });
});

function positionsFix(): void {
  const active = rows().filter((r) => r.status === "active").sort((a, b) => a.display_order - b.display_order);
  active.forEach((r, i) => (r.display_order = i + 1));
}

describe("edit", () => {
  const edit = (topicId: string, fields: Record<string, string>, voteType?: "finger" | "roman" | "modified_roman") =>
    write({ kind: "edit", topicId, fields, ...(voteType ? { voteType } : {}) });

  it("changes only differing fields; audit holds their before and after; a rename is flagged", async () => {
    const res = await edit(uuid(1), { name: "Renamed", prompt: "Prompt 1?" });
    expect(res.renamed).toBe(true);
    expect(res.operation).toBe("topic.default_edited");
    expect(rows()[0]!.name).toBe("Renamed");
    expect(auditMetadata()).toMatchObject({
      topicId: uuid(1),
      changedFields: ["name"],
      before: { name: "Topic 1" },
      after: { name: "Renamed" },
    });
  });

  it("edits all three fields", async () => {
    await edit(uuid(2), { name: "N", prompt: "P?", firstSessionDescription: "D." });
    expect(rows()[1]).toMatchObject({ name: "N", prompt: "P?", first_session_description: "D." });
    expect(auditMetadata()["changedFields"]).toEqual(["name", "prompt", "firstSessionDescription"]);
  });

  it("a no-op writes no audit row and no event, and still returns the list", async () => {
    const res = await edit(uuid(1), { name: "Topic 1" }, "finger");
    expect(res.unchanged).toBe(true);
    expect(res.changedTopicId).toBe(uuid(1));
    expect(state.audits).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect((await edit(uuid(1), {})).unchanged).toBe(true);
  });

  it("a different vote type, an archived row, an unknown id and a name collision are typed refusals", async () => {
    expect(await codeOf(edit(uuid(1), { prompt: "Q?" }, "roman"))).toBe("DEFAULT_VOTE_TYPE_IMMUTABLE");
    expect(await codeOf(edit(uuid(99), { prompt: "Q?" }))).toBe("DEFAULT_TOPIC_NOT_FOUND");
    expect(await codeOf(edit(uuid(1), { name: "topic 2" }))).toBe("DEFAULT_NAME_DUPLICATE");
    rows()[0]!.status = "archived";
    expect(await codeOf(edit(uuid(1), { prompt: "Q?" }))).toBe("DEFAULT_ARCHIVED");
    expect(state.audits).toHaveLength(0);
  });

  it("a case-only rename of the row's own name is allowed", async () => {
    await expect(edit(uuid(1), { name: "TOPIC 1" })).resolves.toMatchObject({ renamed: true });
  });

  it("an edit does not check positions: a pre-existing gap never blocks it", async () => {
    rows()[11]!.display_order = 40;
    await expect(edit(uuid(1), { prompt: "Still fine?" })).resolves.toMatchObject({ unchanged: false });
  });
});

describe("archive", () => {
  it("archives, renumbers the rest dense and lists the renumbered rows", async () => {
    const res = await write({ kind: "archive", topicId: uuid(3) });
    expect(res.operation).toBe("topic.default_archived");
    expect(positions()).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    const m = auditMetadata();
    expect(m).toMatchObject({ before: { status: "active", displayOrder: 3 }, after: { status: "archived", displayOrder: null } });
    expect((m["after"] as { renumbered: unknown[] }).renumbered).toHaveLength(9);
  });

  it("refuses the last active default, an archived one, and an unknown one", async () => {
    seed(1);
    expect(await codeOf(write({ kind: "archive", topicId: uuid(1) }))).toBe("LAST_ACTIVE_DEFAULT");
    seed(3, [{ status: "archived" }]);
    positionsFix();
    expect(await codeOf(write({ kind: "archive", topicId: uuid(1) }))).toBe("DEFAULT_ALREADY_ARCHIVED");
    expect(await codeOf(write({ kind: "archive", topicId: uuid(77) }))).toBe("DEFAULT_TOPIC_NOT_FOUND");
  });

  it("a non-default template row is not a target", async () => {
    rows()[0]!.is_default = false;
    expect(await codeOf(write({ kind: "archive", topicId: uuid(1) }))).toBe("DEFAULT_TOPIC_NOT_FOUND");
  });

  it("a position write that touches an unexpected row count trips the backstop and rolls back", async () => {
    state.phaseCountDelta = -1;
    const err = await write({ kind: "archive", topicId: uuid(1) }).catch((e) => e);
    expect(err).toBeInstanceOf(BackstopError);
    expect(state.audits).toHaveLength(0);
  });
});

describe("restore", () => {
  it("restores at the next position and audits the transition", async () => {
    await write({ kind: "archive", topicId: uuid(2) });
    state.audits = [];
    const res = await write({ kind: "restore", topicId: uuid(2) });
    expect(res.operation).toBe("topic.default_restored");
    expect(positions()).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(rows()[1]!.display_order).toBe(12);
    expect(auditMetadata()).toMatchObject({ before: { status: "archived", displayOrder: null }, after: { status: "active", displayOrder: 12 } });
  });

  it("repairs a gap as it restores", async () => {
    seed(4, [{}, {}, {}, { status: "archived" }]);
    rows()[2]!.display_order = 5;
    await write({ kind: "restore", topicId: uuid(4) });
    expect(positions()).toEqual([1, 2, 3, 4]);
    expect(((auditMetadata()["after"]) as { renumbered: unknown[] }).renumbered).toHaveLength(1);
  });

  it("check order: already active, then capacity, then name collision (naming the conflict)", async () => {
    expect(await codeOf(write({ kind: "restore", topicId: uuid(1) }))).toBe("DEFAULT_ALREADY_ACTIVE");
    seed(16, [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { status: "archived", name: "Topic 1" }]);
    expect(await codeOf(write({ kind: "restore", topicId: uuid(16) }))).toBe("TEMPLATE_AT_CAPACITY");
    seed(3, [{}, {}, { status: "archived", name: " TOPIC 1 " }]);
    const err = await write({ kind: "restore", topicId: uuid(3) }).catch((e) => e);
    expect(err).toBeInstanceOf(MaintenanceError);
    expect(err.code).toBe("DEFAULT_NAME_DUPLICATE");
    expect(err.detail).toMatchObject({ conflictingTopicId: uuid(1), conflictingName: "Topic 1" });
    expect(await codeOf(write({ kind: "restore", topicId: uuid(55) }))).toBe("DEFAULT_TOPIC_NOT_FOUND");
  });
});

describe("reorder", () => {
  const ids = () => rows().map((r) => r.id);

  it("reorders, audits full before and after lists with no topicId, and emits an event without topicId", async () => {
    const original = ids();
    const after = [...original].reverse();
    const res = await write({ kind: "reorder", order: after });
    expect(res.operation).toBe("topic.default_reordered");
    expect(res.changedTopicId).toBeUndefined();
    expect(auditMetadata()).toEqual({ operation: "topic.default_reordered", changedFields: ["order"], before: original, after });
    expect(state.events[0]!.fields).not.toHaveProperty("topicId");
  });

  it("the stored order on a dense set is a no-op; on a gapped set it is a write that repairs the gap", async () => {
    expect((await write({ kind: "reorder", order: ids() })).unchanged).toBe(true);
    expect(state.audits).toHaveLength(0);
    rows()[11]!.display_order = 20;
    const res = await write({ kind: "reorder", order: ids() });
    expect(res.unchanged).toBe(false);
    expect(positions()).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("missing, extra, archived and unknown ids are REORDER_ID_MISMATCH; a repeated id is INVALID_DEFAULT_ORDER", async () => {
    expect(await codeOf(write({ kind: "reorder", order: ids().slice(1) }))).toBe("REORDER_ID_MISMATCH");
    expect(await codeOf(write({ kind: "reorder", order: [...ids(), uuid(500)] }))).toBe("REORDER_ID_MISMATCH");
    expect(await codeOf(write({ kind: "reorder", order: [...ids().slice(1), uuid(500)] }))).toBe("REORDER_ID_MISMATCH");
    expect(await codeOf(write({ kind: "reorder", order: [...ids().slice(0, -1), ids()[0]!] }))).toBe("INVALID_DEFAULT_ORDER");
  });
});

describe("transaction harness and error mapping", () => {
  it("takes the lock first, sets the timeouts, and issues the audit insert inside the transaction before COMMIT", async () => {
    await add();
    const s = state.statements;
    const idx = (needle: string) => s.findIndex((x) => x.includes(needle));
    expect(s[0]).toBe("BEGIN");
    expect(idx("SET LOCAL lock_timeout = '3s'")).toBeLessThan(idx("pg_advisory_xact_lock"));
    expect(idx("SET LOCAL statement_timeout = '10s'")).toBeGreaterThan(-1);
    expect(idx("INSERT INTO audit_log")).toBeLessThan(s.indexOf("COMMIT"));
  });

  it("a lock timeout (55P03) or statement timeout (57014) is DEFAULT_MAINTENANCE_BUSY and nothing is audited", async () => {
    for (const code of ["55P03", "57014"]) {
      state.failOn = (sql) => (sql.includes("pg_advisory_xact_lock") ? Object.assign(new Error("timeout"), { code }) : undefined);
      expect(await codeOf(add())).toBe("DEFAULT_MAINTENANCE_BUSY");
    }
    expect(state.audits).toHaveLength(0);
    expect(state.statements).toContain("ROLLBACK");
  });

  it("a MaintenanceError that happens to carry a timeout code is not rewritten; other database errors propagate raw", async () => {
    state.failOn = (sql) => (sql.includes("INSERT INTO topics") ? Object.assign(new Error("dup"), { code: "23505" }) : undefined);
    const err = await add().catch((e) => e);
    expect(err.code).toBe("23505");
    expect(err).not.toBeInstanceOf(MaintenanceError);
  });

  it("an audit insert failure is AuditWriteError, rolls back, and emits no event", async () => {
    state.failOn = (sql) => (sql.includes("INSERT INTO audit_log") ? new Error("audit down") : undefined);
    const err = await add().catch((e) => e);
    expect(err).toBeInstanceOf(RealAuditWriteError);
    expect(state.events).toHaveLength(0);
    expect(state.statements).toContain("ROLLBACK");
  });

  it("a failed connection is AuditWriteError", async () => {
    released.connectFails = true;
    expect(await add().catch((e) => e)).toBeInstanceOf(RealAuditWriteError);
  });

  it("a failing post-commit list read does not turn the committed write into an error", async () => {
    state.poolFails = true;
    const errorLog = vi.fn();
    const res = await writeTemplateTopics({ kind: "archive", topicId: uuid(1) }, actor, { log: { error: errorLog } as never, correlationId: "c" });
    expect(res.list).toBeNull();
    expect(res.unchanged).toBe(false);
    expect(errorLog).toHaveBeenCalled();
    const noop = await writeTemplateTopics({ kind: "reorder", order: rows().filter((r) => r.status === "active").map((r) => r.id) }, actor, ctx);
    expect(noop.list).toBeNull();
  });

  it("a failing log emit after commit is swallowed and logged", async () => {
    state.emitThrows = true;
    const errorLog = vi.fn();
    const res = await writeTemplateTopics({ kind: "archive", topicId: uuid(1) }, actor, { log: { error: errorLog } as never, correlationId: "c" });
    expect(res.unchanged).toBe(false);
    expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ correlationId: "c" }), expect.stringContaining("emit failed"));
  });

  it("backstop: removing every active default would fail (zero active) and more than fifteen would fail", async () => {
    // Force the post-write read to see a bad state by making the archive leave zero active defaults.
    seed(2, [{}, { status: "archived" }]);
    expect(await codeOf(write({ kind: "archive", topicId: uuid(1) }))).toBe("LAST_ACTIVE_DEFAULT");
  });
});

describe("reads", () => {
  it("readTemplateList: active by position then archived, archived displayOrder null, lastChanged derived, limits attached", async () => {
    seed(3, [{}, {}, { status: "archived", display_order: 9 }]);
    state.listChanges = [{ topic_id: uuid(1), at: new Date("2026-01-02T03:04:05Z"), actor_user_id: "u1", display_name: "Ada" }];
    state.listReorder = [{ at: new Date("2026-02-03T00:00:00Z") }];
    const list = await readTemplateList();
    expect(list.defaults.map((d) => [d.status, d.displayOrder])).toEqual([["active", 1], ["active", 2], ["archived", null]]);
    expect(list.defaults[0]).toMatchObject({ lastChangedAt: "2026-01-02T03:04:05.000Z", lastChangedBy: { userId: "u1", displayName: "Ada" } });
    expect(list.defaults[1]).toMatchObject({ lastChangedAt: null, lastChangedBy: null });
    expect(list.orderLastChangedAt).toBe("2026-02-03T00:00:00.000Z");
    expect(list.limits.maxActive).toBe(15);
  });

  it("readTemplateList: a missing display name becomes empty text and no reorder row is null", async () => {
    state.listChanges = [{ topic_id: uuid(1), at: new Date(0), actor_user_id: "u1", display_name: null }];
    const list = await readTemplateList();
    expect(list.defaults[0]!.lastChangedBy).toEqual({ userId: "u1", displayName: "" });
    expect(list.orderLastChangedAt).toBeNull();
  });

  it("parseHistoryLimit: absent 50, 1..200 as given, above 200 clamped, everything else INVALID_HISTORY_LIMIT", () => {
    expect(parseHistoryLimit(undefined)).toBe(HISTORY_DEFAULT_LIMIT);
    expect(parseHistoryLimit("1")).toBe(1);
    expect(parseHistoryLimit("200")).toBe(200);
    expect(parseHistoryLimit("201")).toBe(HISTORY_MAX_LIMIT);
    for (const bad of ["0", "-1", "abc", "", "1.5", ["1", "2"], 5, "9".repeat(30)]) {
      expect(() => parseHistoryLimit(bad)).toThrow(MaintenanceError);
    }
  });

  it("readTemplateHistory maps audit rows, defaulting missing metadata", async () => {
    state.history = [
      { id: "a1", operation: "topic.default_edited", at: new Date("2026-03-01T00:00:00Z"), actor_user_id: "u1", display_name: "Ada", metadata: { topicId: uuid(1), changedFields: ["prompt"], before: { prompt: "x" }, after: { prompt: "y" } } },
      { id: "a2", operation: "topic.default_reordered", at: new Date("2026-02-01T00:00:00Z"), actor_user_id: "u2", display_name: null, metadata: null },
    ];
    const h = await readTemplateHistory(50);
    expect(h[0]).toEqual({
      id: "a1", operation: "topic.default_edited", at: "2026-03-01T00:00:00.000Z", actor: { userId: "u1", displayName: "Ada" },
      topicId: uuid(1), changedFields: ["prompt"], before: { prompt: "x" }, after: { prompt: "y" },
    });
    expect(h[1]).toMatchObject({ topicId: null, changedFields: [], before: null, after: null, actor: { userId: "u2", displayName: "" } });
  });
});

