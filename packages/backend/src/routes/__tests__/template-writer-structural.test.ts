import { describe, it, expect } from "vitest";
import { productionSources } from "./helpers/backend-sources.js";
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";
import { scanSource, type WriteFinding } from "./helpers/template-writer-scanner.js";

// ---------------------------------------------------------------------------
// The second-writer rule -- admin-default-topic-maintenance (#216) design.md
// E11 (the outcome of the #215 trigger reconsideration: the
// BEFORE INSERT/UPDATE/DELETE trigger is declined again, replaced by this
// enumerating structural test).
//
// Scans PRODUCTION source (migrations and tests are out of scope) for SQL
// that writes the `topics` table, at statement and enclosing-function
// granularity, and compares the set of (file, function) pairs with the
// justified allowlist below. A new writer function in any file, including
// routes/topics.ts, is a red build until a reviewer adds a justified entry.
// A write whose table name is dynamic fails. A write that targets the
// sentinel template is allowed only inside the sanctioned writer module (with
// the one named exemption: copyCanonicalDefaults, where the sentinel is only
// the SELECT source). Limit, stated plainly: a sentinel id arriving through
// a runtime variable (a path parameter) cannot be detected statically; for the
// team-scoped handlers that guard is checkWritableTeam and its #188 structural
// test (team-template-guard-structural.test.ts).
//
// This guards against mistakes, not against an attacker with SQL access.
// ---------------------------------------------------------------------------

const WRITER = "sessions/default-topic-maintenance.ts";

/** file -> function -> one-line justification. */
const ALLOWLIST: Record<string, Record<string, string>> = {
  [WRITER]: {
    setActivePositions: "the sanctioned template writer: negate-then-set renumber of the active defaults",
    opAdd: "the sanctioned template writer: inserts a default",
    opEdit: "the sanctioned template writer: edits name, prompt and description",
    opArchive: "the sanctioned template writer: archives a default",
    opRestore: "the sanctioned template writer: restores an archived default",
  },
  "sessions/default-topics.ts": {
    copyCanonicalDefaults: "inserts the NEW team's rows; the sentinel appears only as the SELECT source",
  },
  "routes/topics.ts": {
    "route POST /api/v1/teams/:teamId/topics": "TOPIC-003 add custom topic; team-scoped, guarded by checkWritableTeam, covered by the #188 structural test",
    "route DELETE /api/v1/teams/:teamId/topics/:topicId": "TOPIC-004 archive; team-scoped, guarded by checkWritableTeam, covered by the #188 structural test",
    "route POST /api/v1/teams/:teamId/topics/:topicId/restore": "TOPIC-005 restore; team-scoped, guarded by checkWritableTeam, covered by the #188 structural test",
    "route POST /api/v1/teams/:teamId/topics/restore-defaults": "bulk restore (#218); team-scoped, guarded by checkWritableTeam, covered by the #188 structural test",
    "route PUT /api/v1/teams/:teamId/topics/order": "TOPIC-006 reorder; team-scoped, guarded by checkWritableTeam, covered by the #188 structural test",
    "route PUT /api/v1/teams/:teamId/topics/:topicId/annotation": "TOPIC-007 annotation; team-scoped, guarded by checkWritableTeam, covered by the #188 structural test",
  },
};

const SENTINEL_EXEMPT = new Set(["sessions/default-topics.ts#copyCanonicalDefaults"]);

export interface Verdict {
  unlisted: string[];
  staleAllowlist: string[];
  dynamic: string[];
  sentinelOutsideWriter: string[];
}

/** Pure: compares findings with an allowlist. */
export function judge(findings: readonly WriteFinding[], allowlist: Record<string, Record<string, string>>): Verdict {
  const pairs = new Set<string>();
  const verdict: Verdict = { unlisted: [], staleAllowlist: [], dynamic: [], sentinelOutsideWriter: [] };
  for (const f of findings) {
    if (f.kind === "dynamic") {
      verdict.dynamic.push(`${f.file} :: ${f.fn} :: ${f.statement}`);
      continue;
    }
    const key = `${f.file}#${f.fn}`;
    pairs.add(key);
    if (!allowlist[f.file]?.[f.fn] && !verdict.unlisted.includes(key)) verdict.unlisted.push(key);
    if (f.sentinel && f.file !== WRITER && !SENTINEL_EXEMPT.has(key)) {
      verdict.sentinelOutsideWriter.push(`${key} :: ${f.statement}`);
    }
  }
  for (const [file, fns] of Object.entries(allowlist)) {
    for (const fn of Object.keys(fns)) if (!pairs.has(`${file}#${fn}`)) verdict.staleAllowlist.push(`${file}#${fn}`);
  }
  return verdict;
}

const clean: Verdict = { unlisted: [], staleAllowlist: [], dynamic: [], sentinelOutsideWriter: [] };

describe("the production source holds exactly the allowlisted writers of the topics table (#216 E11)", () => {
  const findings = productionSources().flatMap((f) => scanSource(f.rel, f.text));
  const verdict = judge(findings, ALLOWLIST);

  it("the scan is not vacuous: it sees the writer module and routes/topics.ts", () => {
    const files = new Set(findings.map((f) => f.file));
    expect(files.has(WRITER)).toBe(true);
    expect(files.has("routes/topics.ts")).toBe(true);
    expect(findings.length).toBeGreaterThan(10);
  });

  it("no unlisted (file, function) writes topics, and no allowlist entry is stale", () => {
    expect(verdict.unlisted, "a new topics writer needs a justified allowlist entry").toEqual([]);
    expect(verdict.staleAllowlist, "remove entries whose writer is gone").toEqual([]);
  });

  it("no write uses a dynamic table name", () => {
    expect(verdict.dynamic).toEqual([]);
  });

  it("a write targeting the sentinel exists only inside the sanctioned writer (copyCanonicalDefaults exempt by name)", () => {
    expect(verdict.sentinelOutsideWriter).toEqual([]);
  });

  it("the writer module's writes do target the sentinel (the rule is exercised)", () => {
    expect(findings.filter((f) => f.file === WRITER && f.kind === "write").every((f) => f.sentinel)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The scanner can fail: every fixture below is a synthetic writer the pure
// scanner and the judge must report; the negative fixtures must not match.
// ---------------------------------------------------------------------------
describe("the scanner can fail (design E11 fixture table)", () => {
  const wrap = (sql: string, fn = "newWriter") =>
    `export async function ${fn}(client) { await client.query(${sql}, [teamId]); }`;
  // Fixtures are judged against the real allowlist, but a fixture does not "contain" the
  // allowlisted real writers, so staleness is not part of a fixture's verdict.
  const judged = (file: string, source: string): Verdict => ({
    ...judge(scanSource(file, source), ALLOWLIST),
    staleAllowlist: [],
  });

  const writes: Array<[string, string]> = [
    ["UPDATE", "`UPDATE topics SET name = 'x' WHERE id = $1`"],
    ["UPDATE ONLY", "`UPDATE ONLY topics SET name = 'x'`"],
    ["a schema-qualified table", "`UPDATE public.topics SET name = 'x'`"],
    ["a quoted table", '`UPDATE "topics" SET name = \'x\'`'],
    ["a quoted schema and table", '`UPDATE "public"."topics" SET name = \'x\'`'],
    ["an aliased table", "`UPDATE topics t SET name = 'x' FROM other o WHERE t.id = o.id`"],
    ["a CTE-wrapped write", "`WITH moved AS (UPDATE topics SET display_order = 1 RETURNING id) SELECT id FROM moved`"],
    ["INSERT INTO", "`INSERT INTO topics (team_id, name) VALUES ($1, 'x')`"],
    ["INSERT ... ON CONFLICT", "`INSERT INTO topics (id, name) VALUES ($1, 'x') ON CONFLICT (id) DO UPDATE SET name = 'y'`"],
    ["DELETE FROM", "`DELETE FROM topics WHERE id = $1`"],
    ["TRUNCATE", "`TRUNCATE topics`"],
    ["TRUNCATE TABLE", "`TRUNCATE TABLE topics`"],
    ["MERGE", "`MERGE INTO topics t USING src s ON t.id = s.id WHEN MATCHED THEN DELETE`"],
    ["a multi-line statement", "`\\n   UPDATE\\n     topics\\n   SET name = 'x'`"],
    ["a lower-case statement", "`update topics set name = 'x'`"],
  ];
  it.each(writes)("an unlisted function with %s is reported", (_label, sql) => {
    const v = judged("routes/other.ts", wrap(sql));
    expect(v.unlisted).toEqual(["routes/other.ts#newWriter"]);
  });

  it("an unlisted function inside a LISTED file (routes/topics.ts) is reported", () => {
    const v = judged("routes/topics.ts", wrap("`UPDATE topics SET name = 'x'`", "sneakyNewHelper"));
    expect(v.unlisted).toEqual(["routes/topics.ts#sneakyNewHelper"]);
  });

  it("an unlisted anonymous route handler inside routes/topics.ts is reported by its route label", () => {
    const v = judged(
      "routes/topics.ts",
      "export function r(app) { app.patch('/api/v1/teams/:teamId/topics/:topicId/rename', async (req) => { await db.query(`UPDATE topics SET name = $1`, []); }); }",
    );
    expect(v.unlisted).toEqual(["routes/topics.ts#route PATCH /api/v1/teams/:teamId/topics/:topicId/rename"]);
  });

  it.each([
    ["an interpolated table name", "`UPDATE ${table} SET name = 'x'`"],
    ["an interpolated INSERT target", "`INSERT INTO ${table} (a) VALUES (1)`"],
    ["a table built by concatenation", '"DELETE FROM " + table'],
  ])("a dynamic table name (%s) fails", (_label, sql) => {
    const v = judged("routes/other.ts", wrap(sql));
    expect(v.dynamic).toHaveLength(1);
  });

  it("a sentinel-targeted write outside the writer module is reported, by identifier, literal and name", () => {
    for (const sentinel of ["[DEFAULT_TOPICS_TEAM_ID]", `['${DEFAULT_TOPICS_TEAM_ID}']`]) {
      const v = judged(
        "routes/topics.ts",
        `export async function route(client) { await client.query(\`UPDATE topics SET name = 'x' WHERE team_id = $1\`, ${sentinel}); }`,
      );
      expect(v.sentinelOutsideWriter, sentinel).toHaveLength(1);
    }
    const inLiteral = judged("routes/other.ts", wrap(`\`UPDATE topics SET name = 'x' WHERE team_id = '${DEFAULT_TOPICS_TEAM_ID}'\``));
    expect(inLiteral.sentinelOutsideWriter).toHaveLength(1);
    const byName = judged("routes/other.ts", wrap("`UPDATE topics SET name = 'x' FROM teams WHERE teams.name = '__default_topics__'`"));
    expect(byName.sentinelOutsideWriter).toHaveLength(1);
  });

  it("a stale allowlist entry (its writer is gone) is reported", () => {
    const v = judge([], { "routes/gone.ts": { vanished: "was a writer" } });
    expect(v.staleAllowlist).toEqual(["routes/gone.ts#vanished"]);
  });

  it.each([
    ["session_topics", "`UPDATE session_topics SET status = 'x'`"],
    ["INSERT INTO session_topics", "`INSERT INTO session_topics (a) VALUES (1)`"],
    ["topics_x", "`UPDATE topics_x SET a = 1`"],
    ["a SELECT from topics", "`SELECT * FROM topics WHERE team_id = $1`"],
    ["FOR UPDATE row locking", "`SELECT id FROM topics WHERE team_id = $1 FOR UPDATE`"],
    ["a sentinel read", `\`SELECT * FROM topics WHERE team_id = '${DEFAULT_TOPICS_TEAM_ID}'\``],
    ["prose with an interpolation", "`failed to update ${thing}`"],
  ])("negative fixture: %s is not reported", (_label, sql) => {
    expect(judged("routes/other.ts", wrap(sql))).toEqual(clean);
  });

  it("negative fixture: comments are ignored", () => {
    const v = judged("routes/other.ts", "// UPDATE topics SET name = 'x'\n/* DELETE FROM topics */\nexport const a = 1;");
    expect(v).toEqual(clean);
  });

  it("negative fixture: a sentinel passed to the rate limiter or checkWritableTeam is not a write", () => {
    const v = judged(
      "routes/other.ts",
      "export async function h(req, reply) { await enforceTopicWriteRateLimit(req, reply, { teamId: DEFAULT_TOPICS_TEAM_ID }, 0); await checkWritableTeam(req, reply, DEFAULT_TOPICS_TEAM_ID, 0); }",
    );
    expect(v).toEqual(clean);
  });

  it("a write in the sanctioned writer module is allowed and may target the sentinel", () => {
    const v = judged(WRITER, "export async function opAdd(client) { await client.query(`INSERT INTO topics (team_id) VALUES ($1)`, [DEFAULT_TOPICS_TEAM_ID]); }");
    expect(v.unlisted).toEqual([]);
    expect(v.sentinelOutsideWriter).toEqual([]);
  });
});
