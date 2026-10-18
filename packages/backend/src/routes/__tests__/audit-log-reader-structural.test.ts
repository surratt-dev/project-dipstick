import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BACKEND_SRC, productionSources, type SourceFile } from "./helpers/backend-sources.js";
import {
  countTouchingLiterals,
  findReferences,
  findWrappers,
  isProtectedOperation,
  judge,
  scanSource,
  shouldScan,
  statementKey,
  tokenize,
  type AdminEntry,
  type ExactEntry,
  type NamedSource,
  type Statement,
  type Violation,
} from "./helpers/audit-log-reader-scanner.js";

// ---------------------------------------------------------------------------
// AUDIT-LOG READER INVENTORY -- #271, requirement "Audit visibility guard" in
// the team-content-access capability (openspec/specs/team-content-access).
//
// PURPOSE. The requirement says audit rows for admin topic-configuration
// reads and denials (any `admin.` operation, `topic.config_list_denied`, the
// retired `admin.topic_config_denied`) must never reach team members or
// engineering managers, and that every query serving a non-admin caller
// filters `operation` by equality on one named operation. Until this test
// that rule held by reviewer memory (security review #208, finding D-5). The
// test mitigates D-5; it does not close it (see "Known limits").
//
// SCANNED ROOT. `BACKEND_SRC` (packages/backend/src), production `.ts` only,
// via productionSources(). Tests are skipped. The scan is over string and
// template literals and identifiers in the TypeScript AST, so comments never
// count; SQL text is then tokenized (comments and string values stripped).
//
// WHAT IT ENFORCES.
//  - Every TOUCH of `audit_log` is in the inventory below, keyed by
//    `file#function` (labels from functionLabel(): a function name, `route
//    GET /x` for an anonymous route handler, or `<module>`), with a non-blank
//    reason. A touch is `audit_log` in table position (after FROM, JOIN, INTO,
//    UPDATE, TRUNCATE, TABLE, ONLY, COPY, MERGE, LOCK or a FROM-list comma)
//    that is not a WRITER. A writer is a column-listed `INSERT INTO audit_log
//    (cols)` whose row source is VALUES or a SELECT that does not itself read
//    audit_log. Writers are never findings.
//  - EXACT_MATCH entries: every audit_log statement in the function passes a
//    positive grammar: ONE flat SELECT over audit_log alone (no JOIN, CTE,
//    subquery, UNION, comma source, BETWEEN), no top-level OR, exactly one
//    predicate mentioning `operation` and it is literally
//    `operation = '<name>'`, plus a scope predicate `team_id = <value>` or
//    `metadata->>'scopeId' = <value>`; and `<name>` is not protected (any
//    `admin.` operation, any `topic.config_` operation, and the named values
//    `topic.config_list_denied` and `admin.topic_config_accessed`).
//  - ADMIN_ONLY entries: exempt from the filter check. They carry `callers`
//    (exactly one file that may reference the function) and `statements` (the
//    number of audit_log statements in the function); both are verified.
//  - Anything the scanner cannot classify fails: UPDATE, DELETE, TRUNCATE,
//    COPY, MERGE, LOCK or DDL touching audit_log; SQL built with `+` or
//    `.concat`; tagged templates; a substitution that is not a same-file const
//    in table position; an anonymous function with no named ancestor;
//    E'..', U&'..', dollar-quoted or `;`-separated SQL; an unterminated
//    string or comment.
//  - TRIPWIRE: any other whole-word `audit_log` in code (a constant, an array
//    of table names, an identifier, error-message prose) fails and cannot be
//    inventoried. Fix prose by rewording ("audit log write failed").
//
// EXTENSION PROCEDURE (failure messages cite these step numbers).
//  1. Decide who the new reader serves. Anyone other than an
//     `application_admin`: write one flat `SELECT ... FROM audit_log WHERE
//     operation = '<name>' AND <scope predicate> ...`, a single non-protected
//     operation, and add an EXACT_MATCH entry (file#function; reason: who,
//     which operation, why it cannot expose admin rows).
//  2. Admin-only readers: add an ADMIN_ONLY entry whose reason names the
//     constant or operation and the route's admin check, with `callers` (the
//     one file allowed to reference the function) and `statements`.
//  3. A new entry is reviewed by the Security Analyst role, by convention; the
//     repository has no CODEOWNERS file.
//  4. A suspected false positive is fixed in the scanner with a fixture; do
//     NOT widen the inventory. A tripwire on prose is fixed by rewording.
//     Deleting a reader means deleting its entry; the stale check tells you.
//
// NO SWITCH (D9). A false positive is fixed in the scanner with a fixture,
// never by an inventory entry. There is no environment variable, skip flag or
// config that disables this test, and a standing assertion below fails if this
// file or the scanner contains one.
//
// PIN. content.test.ts pins the SQL that fetchConnectionRecoveries actually
// executes; this test pins the source. Do not remove the content.test.ts pin as
// redundant.
//
// KNOWN LIMITS (the only place they survive archive; see also the spec).
//  - ADMIN_ONLY is trusted for what it returns and whom the route serves. Only
//    callers (by name) and statement count are verified. An in-place edit of an
//    existing admin-only statement is not detected, and a caller file is not
//    checked for an actual `application_admin` guard. Reason quality beyond
//    non-blank is human review.
//  - A function that mixes shapes is admin-only as a whole and none of its
//    statements is verified: readTemplateList holds an `= ANY` statement and a
//    literal-equality reorder statement (R3), so the reorder statement is NOT
//    checked by this test.
//  - EXACT_MATCH checks the PRESENCE of a scope predicate, not that its value is
//    the caller's scope (team_id = $1 could be passed the wrong id), and does
//    not check selected columns (a reader returning whole rows could expose
//    actor_ip, actor_roles or metadata, including on non-protected operations).
//  - Keys are file plus function; two functions with the same label in one file
//    collapse to one key.
//  - The caller check is by name and can over-report on a name collision; the
//    remedy is a rename, never an inventory edit. It follows direct references
//    (identifiers, imports, aliases, `ns.name`, `ns["name"]`) and, inside the
//    defining file, exported wrappers (listed in the entry's `wrappers`). It does
//    NOT follow: a wrapper in a different file than the one defining the reader;
//    dynamic or computed keys (`m[k]`, `m["read" + "X"]`); `Reflect`/`eval`;
//    a re-export under another name by a barrel that is itself only imported.
//    So "referenced only from the listed files" holds for those forms only.
//  - Invisible readers: views, functions, triggers and policies created in
//    migrations; other packages' source (guarded only by the `packages/` list
//    assertion below); SQL assembled from fragments none of which spells
//    `audit_log` (for example an imported `${FRAG}` spliced outside table
//    position: `SELECT 1 ${FRAG} WHERE 1=1` where FRAG holds `FROM audit_log`); `.sql` files read at runtime; runtime query builders. The
//    migrations-manual/ directory is out of scope (operator-run, reviewed).
//    A production module placed under a `__tests__` directory is skipped by
//    productionSources().
//  - It guards against mistakes, not an attacker with SQL access or a
//    migration PR.
//  - A legitimately global (no scope predicate) non-admin reader, or a JOIN
//    reader, is unclassifiable today; it needs a reviewed grammar extension.
//  - APPROVAL IS BY CONVENTION. There is no CODEOWNERS file; new entries are
//    reviewed by the Security Analyst role. The control is advisory unless the
//    `test` CI job is a required status check on `main`.
//  - Runtime: pure source scan plus fixture self-tests; ceiling 5 seconds under
//    the CI command. The ceiling is never met by narrowing the scan.
//
// SCENARIO MAP (spec scenario "Application audit-log reads are inventoried and
// non-admin readers filter by exact operation" -> blocks in this file).
//  - each touch is inventoried, keyed by file and function, with a non-blank
//    reason  ->  "judge: uninventoried touch", "judge: blank reason",
//    "judge: stale entry", "judge: one class per key".
//  - each exact-match entry is a single-table SELECT filtering operation by
//    equality on one non-protected literal with a scope predicate  ->
//    "exact-match grammar: failing statements", "exact-match grammar: passing
//    statements", "protected operations (D6)".
//  - a statement that cannot be classified fails  ->  "scanner: unclassifiable
//    triggers", "scanner: tripwire", "tokenizer".
//  - each admin-only function is referenced only from its callers and its
//    statement count matches  ->  "judge: admin-only caller and count".
//  - admin-only classification and invisible readers are verified by review  ->
//    this header.
// ---------------------------------------------------------------------------

const TEST_FILE = "audit-log-reader-structural.test.ts";

/** `file#function` -> why this reader cannot expose admin rows. EXACT_MATCH is mechanically checked. */
const EXACT_MATCH: Record<string, ExactEntry> = {
  "routes/content.ts#fetchConnectionRecoveries": {
    reason:
      "serves the facilitator via session history; shows connection recoveries only (operation = 'session.connection_recovered', scoped by metadata->>'scopeId' = the session id)",
  },
};

/** `file#function` -> trusted admin-only readers. Callers and statement count are verified. */
const ADMIN_ONLY: Record<string, AdminEntry> = {
  "sessions/default-topic-maintenance.ts#readTemplateList": {
    reason:
      "returns the default-template maintenance audit rows (MAINTENANCE_AUDIT_OPERATIONS, bound as a parameter, plus the literal topic.default_reordered) for the sentinel team; served only by the application_admin route guard in routes/admin-default-topics.ts. Mixed shapes (= ANY and literal equality), so admin-only as a whole",
    callers: ["routes/admin-default-topics.ts"],
    statements: 2,
    // Exported and calls readTemplateList after COMMIT; its importers count as readTemplateList's.
    wrappers: ["writeTemplateTopics"],
  },
  "sessions/default-topic-maintenance.ts#readTemplateHistory": {
    reason:
      "returns the maintenance history for the sentinel team filtered by MAINTENANCE_AUDIT_OPERATIONS (bound as a parameter); served only by the application_admin route guard in routes/admin-default-topics.ts",
    callers: ["routes/admin-default-topics.ts"],
    statements: 1,
  },
};

// ---------------------------------------------------------------------------
// Real scan, computed once.
// ---------------------------------------------------------------------------

interface RealScan {
  files: SourceFile[];
  parsed: string[];
  statements: Statement[];
  writers: string[];
  ms: number;
}

let realScanCache: RealScan | null = null;

/** Throws when the source set cannot support a meaningful scan (D8). */
function assertScannable(files: NamedSource[]): void {
  if (files.length === 0) {
    throw new Error(`Audit visibility guard: no production sources were found under BACKEND_SRC (${BACKEND_SRC}); the scan would pass vacuously. See ${TEST_FILE}.`);
  }
  if (!files.some((f) => /audit_log/i.test(f.text))) {
    throw new Error(`Audit visibility guard: no file under BACKEND_SRC contains audit_log; the scan would pass vacuously. Check BACKEND_SRC in helpers/backend-sources.ts. See ${TEST_FILE}.`);
  }
}

function realScan(): RealScan {
  if (realScanCache) return realScanCache;
  const t0 = performance.now();
  const files = productionSources();
  assertScannable(files);
  const parsed: string[] = [];
  const statements: Statement[] = [];
  const writers: string[] = [];
  for (const f of files) {
    if (!shouldScan(f.text)) continue;
    parsed.push(f.rel);
    const r = scanSource(f.rel, f.text);
    statements.push(...r.statements);
    writers.push(...r.writers);
  }
  realScanCache = { files, parsed, statements, writers, ms: performance.now() - t0 };
  return realScanCache;
}

function runJudge(statements: Statement[], exact = EXACT_MATCH, admin = ADMIN_ONLY, files: NamedSource[] = realScan().files): Violation[] {
  return judge({ statements, exact, admin, files, testFile: TEST_FILE });
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FX = "fixtures/reader.ts";

function sqlModule(sql: string, fn = "f"): string {
  return `export function ${fn}() { return db.query(${JSON.stringify(sql)}); }`;
}

/** kind:code pairs, order-independent. */
function summary(code: string): string[] {
  return scanSource(FX, code).statements.map((s) => `${s.kind}:${s.code}`).sort();
}

function kinds(code: string): string[] {
  return [...new Set(scanSource(FX, code).statements.map((s) => s.kind))].sort();
}

/** Judge one SQL literal as an EXACT_MATCH entry on `fixtures/reader.ts#f`. */
function verdictFor(code: string): Violation[] {
  const { statements } = scanSource(FX, code);
  return judge({ statements, exact: { [`${FX}#f`]: { reason: "fixture" } }, admin: {}, files: [], testFile: TEST_FILE });
}

const GOOD_TAIL = "operation = 'session.x' AND team_id = $1";

// ---------------------------------------------------------------------------
// 0.1 / D8 / D9 standing assertions
// ---------------------------------------------------------------------------

describe("standing assertions (D8, D9)", () => {
  const own = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const scanner = readFileSync(fileURLToPath(new URL("./helpers/audit-log-reader-scanner.ts", import.meta.url)), "utf8");
  // Assembled from fragments so this assertion does not match itself.
  const FORBIDDEN = [["process", "env"].join("."), [".sk", "ip"].join(""), [".on", "ly"].join(""), ["skip", "If"].join(""), ["run", "If"].join("")];

  it.each(FORBIDDEN.map((p) => [p]))("neither the test nor the scanner contains %s (no switch)", (pattern) => {
    expect(own.includes(pattern)).toBe(false);
    expect(scanner.includes(pattern)).toBe(false);
  });

  it("packages/ contains exactly backend, frontend and shared (a new package must extend the scan on purpose)", () => {
    const dirs = readdirSync(join(BACKEND_SRC, "..", ".."), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(dirs).toEqual(["backend", "frontend", "shared"]);
  });

  it("packages/backend/src has no .js, .mjs, .cjs or .sql source (the scan reads .ts only)", () => {
    const stray = (readdirSync(BACKEND_SRC, { recursive: true }) as string[]).filter((p) => /\.(?:js|mjs|cjs|sql)$/.test(p));
    expect(stray).toEqual([]);
  });

  it("inventory keys are unique within each object (no CI step type-checks test files)", () => {
    const sf = ts.createSourceFile(TEST_FILE, own, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const seen = new Map<string, string[]>();
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && (node.name.text === "EXACT_MATCH" || node.name.text === "ADMIN_ONLY") && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        seen.set(
          node.name.text,
          node.initializer.properties.map((p) => (p.name && ts.isStringLiteral(p.name) ? p.name.text : "<non-literal key>")),
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect([...seen.keys()].sort()).toEqual(["ADMIN_ONLY", "EXACT_MATCH"]);
    for (const keys of seen.values()) expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// The real check
// ---------------------------------------------------------------------------

describe("audit_log readers in packages/backend/src (Audit visibility guard)", () => {
  it("every touch is inventoried and every inventory entry passes", () => {
    const violations = runJudge(realScan().statements);
    expect(violations.map((v) => v.message)).toEqual([]);
  });

  it("is not vacuous: R1, R2/R3 and R4 are detected by file and function name", () => {
    const keys = new Set(realScan().statements.filter((s) => s.kind === "touch").map(statementKey));
    expect(keys.has("routes/content.ts#fetchConnectionRecoveries")).toBe(true);
    expect(keys.has("sessions/default-topic-maintenance.ts#readTemplateList")).toBe(true);
    expect(keys.has("sessions/default-topic-maintenance.ts#readTemplateHistory")).toBe(true);
  });

  it("is not vacuous: the real writers are recognised as writers, not as touches", () => {
    const { writers, statements } = realScan();
    expect(writers).toContain("auth/fail-open-topic-audit.ts#<module>");
    expect(writers.length).toBeGreaterThan(10);
    expect(statements.filter((s) => s.file === "auth/fail-open-topic-audit.ts")).toEqual([]);
  });

  it("an empty source set, or one with no audit_log, fails naming BACKEND_SRC", () => {
    expect(() => assertScannable([])).toThrow(/BACKEND_SRC/);
    expect(() => assertScannable([{ rel: "a.ts", text: "export const x = 1;" }])).toThrow(/BACKEND_SRC/);
  });
});

// ---------------------------------------------------------------------------
// Tokenizer (D4a)
// ---------------------------------------------------------------------------

describe("tokenizer", () => {
  it.each([
    ["line comment is stripped", "SELECT 1 -- audit_log\n", []],
    ["block comment is stripped", "SELECT /* OR */ 1", []],
    ["string with keywords and parens is one opaque token", "SELECT 1 WHERE a = 'x OR (y'", []],
    ["doubled quote stays inside the string", "SELECT 'it''s'", []],
    ["double-quoted identifier", 'SELECT "operation"', []],
    ["unterminated string", "SELECT 'abc", ["unterminated-string"]],
    ["unterminated comment", "SELECT /* abc", ["unterminated-comment"]],
    ["unterminated identifier", 'SELECT "abc', ["unterminated-identifier"]],
    ["nested block comment", "SELECT /* a /* b */ c */ 1", ["nested-comment"]],
    ["E-string", "SELECT E'x'", ["escape-string"]],
    ["unicode string", "SELECT U&'x'", ["unicode-string"]],
    ["dollar quote", "SELECT $$x$$", ["dollar-quote"]],
    ["tagged dollar quote", "SELECT $t$x$t$", ["dollar-quote"]],
    ["semicolon", "SELECT 1; SELECT 2", ["semicolon"]],
  ])("%s", (_name, sql, errors) => {
    expect(tokenize(sql).errors).toEqual(errors);
  });

  it("emits parameters, operators and depth", () => {
    const { tokens } = tokenize("a ->> 'k' = $1 AND (b::text = ANY($2))");
    expect(tokens.map((t) => t.kind)).toContain("param");
    expect(tokens.find((t) => t.value === "->>")?.kind).toBe("op");
    expect(tokens.find((t) => t.value === "::")?.kind).toBe("op");
    expect(tokens.find((t) => t.lower === "b")?.depth).toBe(1);
    expect(tokens.find((t) => t.value === "$2")?.depth).toBe(2);
  });

  it("an unterminated string or comment is unclassifiable in touch-detection text too", () => {
    expect(summary(sqlModule("SELECT 1 FROM audit_log WHERE a = 'x"))).toEqual(["unclassifiable:tokenizer:unterminated-string"]);
    expect(summary(sqlModule("SELECT 1 FROM audit_log /* x"))).toEqual(["unclassifiable:tokenizer:unterminated-comment"]);
  });
});

// ---------------------------------------------------------------------------
// Scanner shell (1.2)
// ---------------------------------------------------------------------------

describe("scanner: shell and resolution (D5, D7)", () => {
  it("a file with parse diagnostics throws and names the file", () => {
    expect(() => scanSource("broken/file.ts", "const = ;")).toThrow(/broken\/file\.ts/);
  });

  it("resolves recursive same-file consts and reports the touch in the using function", () => {
    const code = 'const A = "audit_log";\nconst B = `FROM ${A}`;\nexport function f() { return db.query(`SELECT 1 ${B}`); }';
    const found = scanSource(FX, code).statements.filter((s) => s.kind === "touch" && s.fn === "f");
    expect(found).toHaveLength(1);
  });

  it("a ${CONST} whose value does not contain audit_log resolves with no finding", () => {
    expect(summary('const C = "id";\nexport function f() { return db.query(`SELECT ${C} FROM users`); }')).toEqual([]);
  });

  it("handles a multi-line template literal", () => {
    expect(summary("export function f() { return db.query(`SELECT 1\n  FROM\n    audit_log\n  WHERE x = 1`); }")).toEqual(["touch:touch"]);
  });

  it("shouldScan prefilters on audit_log, table-position substitutions and concatenation", () => {
    expect(shouldScan("export const x = 1;")).toBe(false);
    expect(shouldScan("select * from AUDIT_LOG")).toBe(true);
    expect(shouldScan("`SELECT 1 FROM ${t}`")).toBe(true);
    expect(shouldScan('"SELECT 1 FROM " + t')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Detection, table position, touch and writer (1.4a)
// ---------------------------------------------------------------------------

describe("scanner: touches (D2)", () => {
  it.each([
    ["self-reading INSERT...SELECT", "INSERT INTO audit_log (a, b) SELECT a, b FROM audit_log"],
    ["INSERT without a column list", "INSERT INTO audit_log VALUES ($1, $2)"],
    ["JOIN on audit_log", "SELECT 1 FROM users u JOIN audit_log a ON a.actor_user_id = u.id"],
    ["comma join", "SELECT 1 FROM users u, audit_log a WHERE a.actor_user_id = u.id"],
    ["double-quoted lowercase name", 'SELECT 1 FROM "audit_log" WHERE x = 1'],
    ["public-qualified name", "SELECT 1 FROM public.audit_log WHERE x = 1"],
    ["public-qualified quoted name", 'SELECT 1 FROM public."audit_log" WHERE x = 1'],
    ["upper-case name", "SELECT 1 FROM AUDIT_LOG"],
    ["mixed-case name", "SELECT 1 FROM Audit_Log"],
    ["FROM ONLY", "SELECT 1 FROM ONLY audit_log"],
    ["TABLE command", "TABLE audit_log"],
    ["lower-case keywords", "select 1 from audit_log where x = 1"],
    ["subquery", "SELECT 1 FROM users WHERE id IN (SELECT actor_user_id FROM audit_log)"],
    ["CTE", "WITH x AS (SELECT 1 FROM audit_log) SELECT * FROM x"],
    ["INSERT...SELECT whose SELECT is also a VALUES-less self read inside a subquery", "INSERT INTO audit_log (a) SELECT a FROM (SELECT a FROM audit_log) s"],
  ])("%s is a touch", (_name, sql) => {
    expect(summary(sqlModule(sql))).toEqual(["touch:touch"]);
  });

  it.each([
    ["UPDATE", "UPDATE audit_log SET operation = 'x'"],
    ["DELETE", "DELETE FROM audit_log WHERE id = $1"],
    ["TRUNCATE", "TRUNCATE audit_log"],
    ["TRUNCATE TABLE", "TRUNCATE TABLE audit_log"],
    ["COPY", "COPY audit_log TO STDOUT"],
    ["LOCK TABLE", "LOCK TABLE audit_log IN ACCESS EXCLUSIVE MODE"],
    ["MERGE", "MERGE INTO audit_log a USING x ON a.id = x.id WHEN MATCHED THEN DELETE"],
    ["CREATE VIEW (non-SELECT first token)", "CREATE VIEW v AS SELECT * FROM audit_log"],
    ["DELETE inside a CTE", "WITH d AS (DELETE FROM audit_log RETURNING *) SELECT * FROM d"],
  ])("%s is unclassifiable (non-read)", (_name, sql) => {
    expect(summary(sqlModule(sql))).toEqual(["unclassifiable:non-read"]);
  });

  it.each([
    [
      "the fail-open INSERT...SELECT shape (regression anchor)",
      "INSERT INTO audit_log\n (actor_user_id, actor_roles)\n SELECT $1::uuid, u.roles::text[]\n FROM (SELECT 1) s LEFT JOIN users u ON u.id = $1::uuid\n RETURNING actor_roles",
    ],
    ["multi-line INSERT INTO with the column list on a later line", "INSERT INTO\n  audit_log\n  (a, b)\n VALUES ($1, $2)"],
    ["column-listed INSERT with ON CONFLICT", "INSERT INTO audit_log (a) VALUES ($1) ON CONFLICT (id) DO UPDATE SET a = EXCLUDED.a"],
    ["column-listed INSERT with RETURNING", "INSERT INTO audit_log (a) VALUES ($1) RETURNING id"],
    ["audit_logs is a different table", "SELECT 1 FROM audit_logs"],
    ["audit_log_archive is a different table", "SELECT 1 FROM audit_log_archive"],
    ["comment-only mention", "SELECT 1 -- reads audit_log later\n"],
    ["block-comment-only mention", "SELECT 1 /* audit_log */"],
  ])("%s produces no finding", (_name, sql) => {
    expect(summary(sqlModule(sql))).toEqual([]);
  });

  it("recognises writers by function (non-vacuity input)", () => {
    const r = scanSource(FX, sqlModule("INSERT INTO audit_log (a) VALUES ($1)", "writeIt"));
    expect(r.writers).toEqual([`${FX}#writeIt`]);
    expect(r.statements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tripwire (1.4b)
// ---------------------------------------------------------------------------

describe("scanner: tripwire (D2)", () => {
  it.each([
    ["a constant holding the table name", 'const T = "audit_log";'],
    ["a prose string", 'export function f() { throw new Error("audit_log write failed"); }'],
    ["a prose string with an apostrophe", 'export function f() { throw new Error("couldn\'t write audit_log"); }'],
    ["a quoted upper-case name in SQL", 'export function f() { return db.query(\'SELECT 1 FROM "AUDIT_LOG"\'); }'],
    ["an identifier named audit_log", "const audit_log = 1;"],
    ["a property named audit_log", "export function f(row: { audit_log: number }) { return row.audit_log; }"],
    ["a table name inside a SQL string value", "export function f() { return db.query(\"SELECT 1 FROM pg_class WHERE relname = 'audit_log'\"); }"],
  ])("%s trips the wire", (_name, code) => {
    expect(kinds(code)).toContain("tripwire");
  });

  it("a recognised touch or writer is not also reported as a tripwire", () => {
    expect(kinds(sqlModule("SELECT 1 FROM audit_log"))).toEqual(["touch"]);
    expect(kinds(sqlModule("INSERT INTO audit_log (a) VALUES ($1)"))).toEqual([]);
  });

  it("tripwires are not inventoriable", () => {
    const { statements } = scanSource("fixtures/trip.ts", 'export function f() { return "audit_log write failed"; }');
    const v = judge({ statements, exact: { "fixtures/trip.ts#f": { reason: "x" } }, admin: {}, files: [], testFile: TEST_FILE });
    expect(v.map((x) => x.rule)).toContain("tripwire");
  });
});

// ---------------------------------------------------------------------------
// Unclassifiable triggers (1.4c, D5, D7)
// ---------------------------------------------------------------------------

describe("scanner: unclassifiable triggers", () => {
  it("a constant holding audit_log, substituted into a template, is a touch (and the constant a tripwire)", () => {
    const code = 'const T = "audit_log";\nexport function f() { return db.query(`SELECT 1 FROM ${T}`); }';
    expect(kinds(code)).toEqual(["touch", "tripwire"]);
  });

  it.each([
    ["an unresolved import", 'import { T } from "./x.js";\nexport function f() { return db.query(`SELECT 1 FROM ${T}`); }'],
    ["a let", 'let t = "audit_log";\nexport function f() { return db.query(`SELECT 1 FROM ${t}`); }'],
    ["a function call", "export function f() { return db.query(`SELECT 1 FROM ${table()}`); }"],
    ["a substitution after a FROM-list comma", "export function f() { return db.query(`SELECT 1 FROM users u, ${table()} a`); }"],
    ["a substitution after INTO", "export function f() { return db.query(`INSERT INTO ${table()} (a) VALUES ($1)`); }"],
  ])("%s in table position is unclassifiable", (_name, code) => {
    expect(summary(code)).toContain("unclassifiable:unresolved-table");
  });

  it("an unresolved substitution outside table position is allowed", () => {
    expect(summary("export function f() { return db.query(`SELECT 1 FROM users WHERE id = ${fn()} AND ${CLAUSE}`); }")).toEqual([]);
    expect(summary('import { J } from "./j.js";\nexport function f() { return db.query(`SELECT 1 FROM users ${J}`); }')).toEqual([]);
  });

  it.each([
    ["+ concatenation", 'export function f(t: string) { return db.query("SELECT 1 FROM " + t); }'],
    ["+ concatenation on the right", 'export function f(t: string) { return db.query(t + " SELECT 1 FROM x"); }'],
    [".concat receiver", 'export function f(t: string) { return db.query("SELECT 1 FROM ".concat(t)); }'],
    [".concat argument", 'export function f(t: string) { return db.query(t.concat("SELECT 1 FROM x")); }'],
  ])("%s of a SQL-looking literal is unclassifiable", (_name, code) => {
    expect(summary(code)).toContain("unclassifiable:concatenation");
  });

  it("a tagged template is unclassifiable", () => {
    expect(summary("export function f() { return sql`SELECT 1 FROM audit_log`; }")).toContain("unclassifiable:tagged-template");
  });

  it("a statement in an anonymous function with no named ancestor is unclassifiable", () => {
    expect(summary('register(async () => { await db.query("SELECT 1 FROM audit_log"); });')).toContain("unclassifiable:anonymous-function");
  });

  it("an anonymous callback inside a named function keeps the named key", () => {
    const r = scanSource(FX, 'export function f() { return items.map(() => db.query("SELECT 1 FROM audit_log")); }');
    expect(r.statements.map(statementKey)).toEqual([`${FX}#f`]);
  });

  it("route handlers and module-level constants get legal keys", () => {
    const route = scanSource(FX, 'app.get("/x", async () => { await db.query("SELECT 1 FROM audit_log"); });');
    expect(route.statements.map(statementKey)).toEqual([`${FX}#route GET /x`]);
    const mod = scanSource(FX, 'export const Q = "SELECT 1 FROM audit_log";');
    expect(mod.statements.map(statementKey)).toEqual([`${FX}#<module>`]);
  });
});

// ---------------------------------------------------------------------------
// exact-match positive grammar (1.5, D4b)
// ---------------------------------------------------------------------------

describe("exact-match grammar: failing statements", () => {
  const FAILS: Array<[string, string, string]> = [
    // [name, sql, code]
    ["no operation filter", "SELECT 1 FROM audit_log WHERE team_id = $1", "operation-missing"],
    ["no scope predicate", "SELECT 1 FROM audit_log WHERE operation = 'session.x'", "scope-missing"],
    ["no WHERE at all", "SELECT 1 FROM audit_log", "shape"],
    ["LIKE", "SELECT 1 FROM audit_log WHERE operation LIKE 'session.%' AND team_id = $1", "operation-form"],
    ["LIKE with an underscore wildcard", "SELECT 1 FROM audit_log WHERE operation LIKE 'session_x' AND team_id = $1", "operation-form"],
    ["ILIKE", "SELECT 1 FROM audit_log WHERE operation ILIKE 'x' AND team_id = $1", "operation-form"],
    ["IN with several items", "SELECT 1 FROM audit_log WHERE operation IN ('a', 'b') AND team_id = $1", "operation-form"],
    ["IN with one item", "SELECT 1 FROM audit_log WHERE operation IN ('a') AND team_id = $1", "operation-form"],
    ["= ANY", "SELECT 1 FROM audit_log WHERE operation = ANY($2::text[]) AND team_id = $1", "operation-form"],
    ["= ANY(ARRAY[...])", "SELECT 1 FROM audit_log WHERE operation = ANY(ARRAY['a']) AND team_id = $1", "operation-form"],
    ["!=", "SELECT 1 FROM audit_log WHERE operation != 'x' AND team_id = $1", "operation-form"],
    ["<>", "SELECT 1 FROM audit_log WHERE operation <> 'x' AND team_id = $1", "operation-form"],
    ["IS NOT DISTINCT FROM", "SELECT 1 FROM audit_log WHERE operation IS NOT DISTINCT FROM 'x' AND team_id = $1", "operation-form"],
    ["= $n", "SELECT 1 FROM audit_log WHERE operation = $2 AND team_id = $1", "operation-form"],
    ["a cast on the literal", "SELECT 1 FROM audit_log WHERE operation = 'x'::text AND team_id = $1", "operation-form"],
    ["a parenthesised literal", "SELECT 1 FROM audit_log WHERE operation = ('x') AND team_id = $1", "operation-form"],
    ["a literal on the left", "SELECT 1 FROM audit_log WHERE 'x' = operation AND team_id = $1", "operation-form"],
    ["OR widening", "SELECT 1 FROM audit_log WHERE operation = 'x' OR team_id = $1", "or-in-where"],
    ["(operation = 'x' OR true)", "SELECT 1 FROM audit_log WHERE (operation = 'x' OR true) AND team_id = $1", "operation-form"],
    ["operation only in HAVING", "SELECT operation FROM audit_log WHERE team_id = $1 GROUP BY operation HAVING operation = 'x'", "operation-missing"],
    ["operation only in the SELECT list and ORDER BY", "SELECT operation FROM audit_log WHERE team_id = $1 ORDER BY operation", "operation-missing"],
    ["operation only in a JOIN ON", "SELECT 1 FROM audit_log a JOIN users u ON u.operation = 'x' WHERE a.team_id = $1", "shape"],
    ["a function-wrapped column", "SELECT 1 FROM audit_log WHERE lower(operation) = 'x' AND team_id = $1", "operation-form"],
    ["NOT", "SELECT 1 FROM audit_log WHERE NOT operation = 'x' AND team_id = $1", "operation-form"],
    ["an EXISTS subquery", "SELECT 1 FROM audit_log WHERE team_id = $1 AND EXISTS (SELECT 1 FROM audit_log WHERE operation = 'x')", "shape"],
    ["UNION with one unfiltered branch", "SELECT 1 FROM audit_log WHERE operation = 'a' AND team_id = $1 UNION SELECT 1 FROM audit_log", "shape"],
    ["INTERSECT", "SELECT 1 FROM audit_log WHERE operation = 'a' AND team_id = $1 INTERSECT SELECT 1", "shape"],
    ["EXCEPT", "SELECT 1 FROM audit_log WHERE operation = 'a' AND team_id = $1 EXCEPT SELECT 1", "shape"],
    ["LATERAL", "SELECT 1 FROM audit_log a, LATERAL (SELECT 1) x WHERE a.operation = 'a' AND a.team_id = $1", "shape"],
    ["a CTE", "WITH x AS (SELECT 1) SELECT 1 FROM audit_log WHERE operation = 'a' AND team_id = $1", "shape"],
    ["a subquery in the select list", "SELECT (SELECT 1) FROM audit_log WHERE operation = 'a' AND team_id = $1", "shape"],
    ["x.operation on a JOIN", "SELECT 1 FROM audit_log a JOIN other x ON true WHERE x.operation = 'ok' AND a.team_id = $1", "shape"],
    ["an unknown qualifier on operation", "SELECT 1 FROM audit_log a WHERE x.operation = 'ok' AND a.team_id = $1", "operation-form"],
    ["a second mention of operation", "SELECT 1 FROM audit_log WHERE operation = 'a' AND operation <> 'b' AND team_id = $1", "operation-duplicate"],
    ["BETWEEN", "SELECT 1 FROM audit_log WHERE operation = 'a' AND team_id = $1 AND timestamp BETWEEN $2 AND $3", "shape"],
    ["a comma between sources", "SELECT 1 FROM audit_log, users WHERE operation = 'a' AND team_id = $1", "shape"],
    ["a forged predicate inside a comment", "SELECT 1 FROM audit_log WHERE team_id = $1 /* AND operation = 'session.x' */", "operation-missing"],
    ["a scope predicate commented out", "SELECT 1 FROM audit_log WHERE operation = 'x' -- AND team_id = $1", "scope-missing"],
    ["a scope predicate that is not equality", "SELECT 1 FROM audit_log WHERE operation = 'x' AND team_id <> $1", "scope-missing"],
    ["a scope predicate with the wrong key", "SELECT 1 FROM audit_log WHERE operation = 'x' AND metadata->>'other' = $1", "scope-missing"],
    ["nested block comment", "SELECT 1 FROM audit_log WHERE /* a /* b */ c */ operation = 'x' AND team_id = $1", "tokenizer:nested-comment"],
    ["unterminated string", "SELECT 1 FROM audit_log WHERE operation = 'x AND team_id = $1", "tokenizer:unterminated-string"],
    ["unterminated comment", "SELECT 1 FROM audit_log WHERE operation = 'x' AND team_id = $1 /* ", "tokenizer:unterminated-comment"],
    ["an E-string", "SELECT 1 FROM audit_log WHERE operation = E'x' AND team_id = $1", "tokenizer:escape-string"],
    ["a U&-string", "SELECT 1 FROM audit_log WHERE operation = U&'x' AND team_id = $1", "tokenizer:unicode-string"],
    ["a dollar-quoted string", "SELECT 1 FROM audit_log WHERE operation = $$x$$ AND team_id = $1", "tokenizer:dollar-quote"],
    ["semicolon-separated statements", "SELECT 1 FROM audit_log WHERE operation = 'a' AND team_id = $1; SELECT 1 FROM audit_log", "tokenizer:semicolon"],
  ];

  it.each(FAILS)("%s", (_name, sql, code) => {
    const v = verdictFor(sqlModule(sql));
    expect(v.map((x) => ({ rule: x.rule, code: x.code, key: x.key }))).toEqual([{ rule: "unclassifiable", code, key: `${FX}#f` }]);
    expect(v[0]?.line).toBe(1);
  });

  it("an unresolved substitution in an exact-match statement is unclassifiable", () => {
    const v = verdictFor("export function f() { return db.query(`SELECT 1 FROM audit_log WHERE ${WHERE} AND operation = 'a' AND team_id = $1`); }");
    expect(v.map((x) => x.code)).toEqual(["unresolved-substitution"]);
  });

  it("a mutating verb is unclassifiable even when inventoried", () => {
    const v = verdictFor(sqlModule("DELETE FROM audit_log WHERE operation = 'a' AND team_id = $1"));
    expect(v.map((x) => x.rule)).toEqual(["unclassifiable"]);
  });

  it("every failing statement in a multi-statement exact-match function is judged on its own", () => {
    const code = `export function f() {\n  db.query(${JSON.stringify("SELECT 1 FROM audit_log WHERE " + GOOD_TAIL)});\n  return db.query(${JSON.stringify("SELECT 1 FROM audit_log WHERE team_id = $1")});\n}`;
    const v = verdictFor(code);
    expect(v.map((x) => [x.code, x.line])).toEqual([["operation-missing", 3]]);
  });
});

describe("exact-match grammar: passing statements", () => {
  const PASSES: Array<[string, string]> = [
    ["literal equality with a scope predicate", `SELECT 1 FROM audit_log WHERE ${GOOD_TAIL}`],
    ["the operation predicate after other conjuncts", "SELECT 1 FROM audit_log WHERE team_id = $1 AND metadata->>'scope' = 'session' AND operation = 'session.x'"],
    ["an aliased table and qualified columns", "SELECT a.id FROM audit_log AS a WHERE a.operation = 'session.x' AND a.team_id = $1"],
    ["an alias without AS", "SELECT a.id FROM audit_log a WHERE a.operation = 'session.x' AND a.team_id = $1"],
    ["audit_log-qualified columns", "SELECT 1 FROM audit_log WHERE audit_log.operation = 'session.x' AND audit_log.team_id = $1"],
    ["a quoted column and a quoted table", 'SELECT 1 FROM "audit_log" WHERE "operation" = \'session.x\' AND team_id = $1'],
    ["a public-qualified table", `SELECT 1 FROM public.audit_log WHERE ${GOOD_TAIL}`],
    ["lower-case keywords", "select 1 from audit_log where operation = 'session.x' and team_id = $1"],
    ["OR inside a parenthesised different conjunct", `SELECT 1 FROM audit_log WHERE ${GOOD_TAIL} AND (metadata->>'k' = 'a' OR metadata->>'k' = 'b')`],
    ["a comment between conjuncts", "SELECT 1 FROM audit_log WHERE operation = 'session.x' /* OR */ AND team_id = $1"],
    ["keywords inside a string value", `SELECT 1 FROM audit_log WHERE ${GOOD_TAIL} AND metadata->>'k' = 'a OR b'`],
    ["a parenthesis inside a string value", `SELECT 1 FROM audit_log WHERE ${GOOD_TAIL} AND metadata->>'k' = '('`],
    ["a doubled quote inside a string", `SELECT 1 FROM audit_log WHERE ${GOOD_TAIL} AND metadata->>'k' = 'it''s'`],
    ["GROUP BY terminates the WHERE", `SELECT operation FROM audit_log WHERE ${GOOD_TAIL} GROUP BY operation`],
    ["ORDER BY terminates the WHERE", `SELECT 1 FROM audit_log WHERE ${GOOD_TAIL} ORDER BY timestamp DESC`],
    ["LIMIT terminates the WHERE", `SELECT 1 FROM audit_log WHERE ${GOOD_TAIL} LIMIT 5`],
    ["FOR terminates the WHERE", `SELECT 1 FROM audit_log WHERE ${GOOD_TAIL} FOR UPDATE`],
    ["team_id = a string", "SELECT 1 FROM audit_log WHERE operation = 'session.x' AND team_id = 'abc'"],
    ["team_id = a number", "SELECT 1 FROM audit_log WHERE operation = 'session.x' AND team_id = 5"],
    ["team_id = $n", "SELECT 1 FROM audit_log WHERE operation = 'session.x' AND team_id = $3"],
    ["metadata ->> 'scopeId' = $n", "SELECT 1 FROM audit_log WHERE operation = 'session.x' AND metadata ->> 'scopeId' = $1"],
    ["metadata->>'scopeId' = a string", "SELECT 1 FROM audit_log WHERE operation = 'session.x' AND metadata->>'scopeId' = 'abc'"],
    ["operation in the SELECT list with a real filter", `SELECT operation FROM audit_log WHERE ${GOOD_TAIL} ORDER BY operation`],
    [
      "the real fetchConnectionRecoveries shape",
      "SELECT actor_user_id, timestamp\n FROM audit_log\n WHERE operation = 'session.connection_recovered'\n   AND metadata->>'scope' = 'session'\n   AND metadata->>'scopeId' = $1\n ORDER BY timestamp DESC",
    ],
  ];

  it.each(PASSES)("%s", (_name, sql) => {
    expect(verdictFor(sqlModule(sql)).map((v) => v.message)).toEqual([]);
  });

  it("a synthetic same-file const holding an operation value is resolved before judgement", () => {
    const code = 'const OP = "session.x";\nexport function f() { return db.query(`SELECT 1 FROM audit_log WHERE operation = \'${OP}\' AND team_id = $1`); }';
    expect(verdictFor(code)).toEqual([]);
  });

  it("a protected value arriving through a same-file const is still caught", () => {
    const code = 'const OP = "admin.topic_config_accessed";\nexport function f() { return db.query(`SELECT 1 FROM audit_log WHERE operation = \'${OP}\' AND team_id = $1`); }';
    expect(verdictFor(code).map((v) => v.rule)).toEqual(["protected-operation"]);
  });
});

// ---------------------------------------------------------------------------
// Protected operations (1.6, D6)
// ---------------------------------------------------------------------------

describe("protected operations (D6)", () => {
  it.each([
    ["admin.topic_config_accessed"],
    ["topic.config_list_denied"],
    ["admin.topic_config_denied"],
    ["admin.x"],
    ["admin."],
    ["topic.config_x"],
  ])("exact match on %s fails", (op) => {
    const v = verdictFor(sqlModule(`SELECT 1 FROM audit_log WHERE operation = '${op}' AND team_id = $1`));
    expect(v.map((x) => ({ rule: x.rule, key: x.key }))).toEqual([{ rule: "protected-operation", key: `${FX}#f` }]);
  });

  it.each([["topic.configure"], ["admin"], ["session.connection_recovered"], ["auth.role_claim_mapped"]])("%s is not protected", (op) => {
    expect(isProtectedOperation(op)).toBe(false);
    expect(verdictFor(sqlModule(`SELECT 1 FROM audit_log WHERE operation = '${op}' AND team_id = $1`))).toEqual([]);
  });

  it("the protected check does not apply to admin-only entries", () => {
    const { statements } = scanSource("sessions/x.ts", 'export function readX() { return db.query("SELECT 1 FROM audit_log WHERE operation = \'admin.x\' AND team_id = $1"); }');
    const files: NamedSource[] = [{ rel: "routes/y.ts", text: 'import { readX } from "../sessions/x.js"; readX();' }];
    const v = judge({ statements, exact: {}, admin: { "sessions/x.ts#readX": { reason: "admin", callers: ["routes/y.ts"], statements: 1 } }, files, testFile: TEST_FILE });
    expect(v).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pure primitives (1.7a)
// ---------------------------------------------------------------------------

describe("scanner: reference and count primitives", () => {
  const DEF = "sessions/x.ts";
  const f = (rel: string, text: string): NamedSource => ({ rel, text });

  it.each([
    ["a plain import and call", 'import { readX } from "../sessions/x.js"; readX();'],
    ["an aliased import", 'import { readX as r } from "../sessions/x.js"; r();'],
    ["a namespace import and property access", 'import * as m from "../sessions/x.js"; m.readX();'],
    ["a barrel re-export", 'export { readX } from "../sessions/x.js";'],
    ["an export specifier", "const y = 1; export { y as readX };"],
    ["a property access alone", "const o = { a: 1 }; use(o.readX);"],
  ])("%s counts as a reference", (_name, text) => {
    expect(findReferences("readX", [f(DEF, "export function readX() {}"), f("routes/y.ts", text)], DEF)).toEqual(["routes/y.ts"]);
  });

  it("string-keyed property access counts as a reference (X-2)", () => {
    expect(findReferences("readX", [f(DEF, "export function readX() {}"), f("routes/y.ts", 'import * as m from "../sessions/x.js"; m["readX"]();')], DEF)).toEqual(["routes/y.ts"]);
    expect(findReferences("readX", [f("routes/y.ts", "const q = ns[`readX`];")], DEF)).toEqual(["routes/y.ts"]);
  });

  it("a computed key that is not a literal is not followed (documented limit)", () => {
    expect(findReferences("readX", [f("routes/y.ts", 'const k = "read" + "X"; ns[k]();')], DEF)).toEqual([]);
  });

  it("a reference in the defining file is exempt", () => {
    expect(findReferences("readX", [f(DEF, "export function readX() {} export function g() { return readX(); }")], DEF)).toEqual([]);
  });

  it("a name collision in an unrelated file over-reports (documented)", () => {
    expect(findReferences("readX", [f("routes/z.ts", "const readX = 1; export default readX;")], DEF)).toEqual(["routes/z.ts"]);
  });

  it("a mention in a comment or string is not a reference", () => {
    expect(findReferences("readX", [f("routes/z.ts", '// readX is admin only\nexport const s = "readX";')], DEF)).toEqual([]);
  });

  it("an added statement raises the touching-literal count", () => {
    const one = sqlModule("SELECT 1 FROM audit_log", "g");
    const two = "export function g() { db.query(\"SELECT 1 FROM audit_log\"); return db.query(\"SELECT 2 FROM audit_log\"); }";
    expect(countTouchingLiterals(scanSource(FX, one).statements, FX, "g")).toBe(1);
    expect(countTouchingLiterals(scanSource(FX, two).statements, FX, "g")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Judge (2.3)
// ---------------------------------------------------------------------------

describe("judge: uninventoried touch, stale entry, blank reason, one class per key", () => {
  const touchCode = sqlModule("SELECT 1 FROM audit_log WHERE " + GOOD_TAIL);
  const statements = scanSource(FX, touchCode).statements;
  const key = `${FX}#f`;

  it("judge: uninventoried touch fails, even a correctly filtered one", () => {
    const v = judge({ statements, exact: {}, admin: {}, files: [], testFile: TEST_FILE });
    expect(v.map((x) => [x.rule, x.key, x.line])).toEqual([["uninventoried-touch", key, 1]]);
  });

  it("judge: stale entry fails and asks whether it was renamed or moved", () => {
    const v = judge({ statements, exact: { [key]: { reason: "ok" }, "gone.ts#oldReader": { reason: "ok" } }, admin: {}, files: [], testFile: TEST_FILE });
    expect(v.map((x) => [x.rule, x.key])).toEqual([["stale-entry", "gone.ts#oldReader"]]);
    expect(v[0]?.message).toContain("renamed or moved?");
  });

  it("judge: a stale admin-only entry fails too", () => {
    const v = judge({
      statements,
      exact: { [key]: { reason: "ok" } },
      admin: { "gone.ts#oldAdmin": { reason: "ok", callers: ["a.ts"], statements: 1 } },
      files: [],
      testFile: TEST_FILE,
    });
    expect(v.map((x) => [x.rule, x.key])).toEqual([["stale-entry", "gone.ts#oldAdmin"]]);
  });

  it.each([[""], ["   "], ["\n\t"]])("judge: blank reason %j fails for EXACT_MATCH", (reason) => {
    const v = judge({ statements, exact: { [key]: { reason } }, admin: {}, files: [], testFile: TEST_FILE });
    expect(v.map((x) => x.rule)).toEqual(["blank-reason"]);
  });

  it("judge: blank reason fails for ADMIN_ONLY", () => {
    const adminStatements = scanSource("sessions/x.ts", sqlModule("SELECT 1 FROM audit_log", "readX")).statements;
    const files: NamedSource[] = [{ rel: "routes/y.ts", text: 'import { readX } from "../sessions/x.js"; readX();' }];
    const v = judge({ statements: adminStatements, exact: {}, admin: { "sessions/x.ts#readX": { reason: " ", callers: ["routes/y.ts"], statements: 1 } }, files, testFile: TEST_FILE });
    expect(v.map((x) => x.rule)).toEqual(["blank-reason"]);
  });

  it("judge: the same key in both objects fails", () => {
    const v = judge({
      statements,
      exact: { [key]: { reason: "ok" } },
      admin: { [key]: { reason: "ok", callers: ["a.ts"], statements: 1 } },
      files: [],
      testFile: TEST_FILE,
    });
    expect(v.map((x) => x.rule)).toContain("class-conflict");
  });

  it("judge: the real inventory objects are disjoint", () => {
    const overlap = Object.keys(EXACT_MATCH).filter((k) => k in ADMIN_ONLY);
    expect(overlap).toEqual([]);
  });

  it("judge: a tripwire in a file fails regardless of the inventory", () => {
    const trip = scanSource("fixtures/t.ts", 'export const MSG = "audit_log write failed";').statements;
    expect(judge({ statements: trip, exact: {}, admin: {}, files: [], testFile: TEST_FILE }).map((v) => v.rule)).toEqual(["tripwire"]);
  });
});

describe("judge: admin-only caller and count", () => {
  const DEF = "sessions/x.ts";
  const defCode = sqlModule("SELECT 1 FROM audit_log WHERE operation = ANY($1::text[])", "readX");
  const statements = scanSource(DEF, defCode).statements;
  const caller: NamedSource = { rel: "routes/admin.ts", text: 'import { readX } from "../sessions/x.js"; export const a = () => readX();' };
  const entry = (over: Partial<AdminEntry> = {}): Record<string, AdminEntry> => ({ [`${DEF}#readX`]: { reason: "admin only", callers: ["routes/admin.ts"], statements: 1, ...over } });
  const run = (files: NamedSource[], admin: Record<string, AdminEntry>): string[] => judge({ statements, exact: {}, admin, files, testFile: TEST_FILE }).map((v) => v.rule);

  it("passes when references equal callers and the count matches", () => {
    expect(run([{ rel: DEF, text: defCode }, caller], entry())).toEqual([]);
  });

  it("fails when another file references the function", () => {
    const other: NamedSource = { rel: "routes/member.ts", text: 'import { readX as r } from "../sessions/x.js"; r();' };
    expect(run([caller, other], entry())).toEqual(["caller-mismatch"]);
  });

  describe("wrappers in the defining file (X-1)", () => {
    const wrapDef = defCode + "\nexport function leakWrap() { return readX(); }";
    const wrapDefFiles = (): NamedSource => ({ rel: DEF, text: wrapDef });
    const leaker: NamedSource = { rel: "routes/member.ts", text: 'import { leakWrap } from "../sessions/x.js"; leakWrap();' };

    it("findWrappers lists an exported function that calls the reader", () => {
      expect(findWrappers("readX", wrapDefFiles())).toEqual(["leakWrap"]);
    });

    it("findWrappers follows a non-exported helper to the exported function", () => {
      const text = defCode + "\nfunction h() { return readX(); }\nexport const outer = () => h();";
      expect(findWrappers("readX", { rel: DEF, text })).toEqual(["outer"]);
    });

    it("findWrappers sees a string-keyed reference and an export specifier", () => {
      const text = defCode + '\nconst o = {};\nfunction w() { return o["readX"](); }\nexport { w as ww, w };';
      expect(findWrappers("readX", { rel: DEF, text })).toEqual(["w"]);
    });

    it("findWrappers ignores an unrelated function and the reader itself", () => {
      expect(findWrappers("readX", { rel: DEF, text: defCode + "\nexport function other() { return 1; }" })).toEqual([]);
    });

    it("an unlisted wrapper fails even when only an admin route imports it", () => {
      expect(run([wrapDefFiles(), caller], entry())).toEqual(["caller-mismatch"]);
    });

    it("a wrapper imported by a non-admin route fails when it is listed", () => {
      expect(run([wrapDefFiles(), caller, leaker], entry({ wrappers: ["leakWrap"] }))).toEqual(["caller-mismatch"]);
    });

    it("a listed wrapper imported only by the listed caller passes", () => {
      const viaWrap: NamedSource = { rel: "routes/admin.ts", text: 'import { leakWrap } from "../sessions/x.js"; leakWrap();' };
      expect(run([wrapDefFiles(), viaWrap], entry({ wrappers: ["leakWrap"] }))).toEqual([]);
    });

    it("a listed wrapper that no longer exists fails", () => {
      expect(run([{ rel: DEF, text: defCode }, caller], entry({ wrappers: ["leakWrap"] }))).toEqual(["caller-mismatch"]);
    });

    it("a string-keyed access to the reader from another route fails the caller check", () => {
      const keyed: NamedSource = { rel: "routes/member.ts", text: 'import * as m from "../sessions/x.js"; m["readX"]();' };
      expect(run([{ rel: DEF, text: defCode }, caller, keyed], entry())).toEqual(["caller-mismatch"]);
    });
  });

  it("fails when a listed caller no longer references it", () => {
    expect(run([], entry())).toEqual(["caller-mismatch"]);
  });

  it("fails on a statement-count mismatch", () => {
    expect(run([caller], entry({ statements: 2 }))).toEqual(["statement-count"]);
  });

  it.each([[[]], [["routes/admin.ts", "routes/other.ts"]]])("fails for an entry with callers %j (exactly one is required)", (callers) => {
    expect(run([caller], entry({ callers }))).toEqual(["caller-mismatch"]);
  });

  it("fails for an unreferenceable function label", () => {
    const routeStatements = scanSource(DEF, 'app.get("/x", async () => { await db.query("SELECT 1 FROM audit_log"); });').statements;
    const v = judge({
      statements: routeStatements,
      exact: {},
      admin: { [`${DEF}#route GET /x`]: { reason: "admin only", callers: ["routes/admin.ts"], statements: 1 } },
      files: [caller],
      testFile: TEST_FILE,
    });
    expect(v.map((x) => x.rule)).toEqual(["caller-mismatch"]);
  });

  it("does not run the grammar on admin-only statements", () => {
    // The statement has no scope predicate and uses = ANY; it is admin-only, so only callers and count matter.
    expect(run([caller], entry())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Failure messages (2.5, D10)
// ---------------------------------------------------------------------------

describe("failure messages teach a developer who has never heard of #208", () => {
  const key = `${FX}#f`;
  const base = (code: string, exact: Record<string, ExactEntry> = {}, admin: Record<string, AdminEntry> = {}): Violation[] =>
    judge({ statements: scanSource(FX, code).statements, exact, admin, files: [], testFile: TEST_FILE });

  const cases: Array<[string, Violation, number]> = [
    ["uninventoried-touch", base(sqlModule("SELECT 1 FROM audit_log WHERE " + GOOD_TAIL))[0]!, 1],
    ["stale-entry", base(sqlModule("SELECT 1"), { [key]: { reason: "x" } })[0]!, 4],
    ["blank-reason", base(sqlModule("SELECT 1 FROM audit_log WHERE " + GOOD_TAIL), { [key]: { reason: "" } })[0]!, 1],
    ["protected-operation", base(sqlModule("SELECT 1 FROM audit_log WHERE operation = 'admin.x' AND team_id = $1"), { [key]: { reason: "x" } })[0]!, 1],
    ["unclassifiable", base(sqlModule("SELECT 1 FROM audit_log WHERE operation LIKE 'a%' AND team_id = $1"), { [key]: { reason: "x" } })[0]!, 4],
    ["tripwire", base('export function f() { return "audit_log write failed"; }')[0]!, 4],
    ["statement-count", base(sqlModule("SELECT 1 FROM audit_log"), {}, { [key]: { reason: "x", callers: ["a.ts"], statements: 5 } })[0]!, 2],
  ];

  it.each(cases)("%s message has the rule, file#function, requirement name, test file and a procedure step", (rule, violation, step) => {
    expect(violation.rule).toBe(rule);
    expect(violation.message).toContain(`[${rule}]`);
    expect(violation.message).toContain(violation.key);
    expect(violation.message).toContain("Audit visibility guard");
    expect(violation.message).toContain(TEST_FILE);
    expect(violation.message).toContain(`step ${step}`);
  });

  it("the uninventoried-touch message leads with who the reader serves and mentions the Security Analyst review", () => {
    const m = base(sqlModule("SELECT 1 FROM audit_log WHERE " + GOOD_TAIL))[0]!.message;
    const what = m.slice(m.indexOf("What to do:"));
    expect(what).toMatch(/^What to do: First decide who this reader serves/);
    expect(what.indexOf("ADMIN_ONLY")).toBeGreaterThan(-1);
    expect(what).toContain("Security Analyst review");
  });

  it("grammar messages name the accepted form", () => {
    const v = base(sqlModule("SELECT 1 FROM audit_log WHERE operation IN ('a') AND team_id = $1"), { [key]: { reason: "x" } })[0]!;
    expect(v.message).toContain("operation = '<name>'");
    expect(v.message).toContain("team_id");
  });

  it("the tripwire message says to reword", () => {
    expect(base('export function f() { return "audit_log write failed"; }')[0]!.message).toMatch(/reword/);
  });

  it("the stale message asks whether the function was renamed or moved", () => {
    expect(base(sqlModule("SELECT 1"), { [key]: { reason: "x" } })[0]!.message).toContain("renamed or moved?");
  });
});
