import ts from "typescript";
import { enclosingFunction, functionLabel } from "./template-writer-scanner.js";

// ---------------------------------------------------------------------------
// Pure scanner behind routes/__tests__/audit-log-reader-structural.test.ts --
// #271, design.md D1 to D11 ("Audit visibility guard" in team-content-access).
//
// Two layers:
//   1. A TypeScript AST walk that finds every string and template literal (and
//      every identifier) in a source file, substitutes same-file `const`
//      values into template literals (D5), and names the enclosing function.
//   2. A small SQL tokenizer (D4a) and a positive grammar (D4b) over the
//      resolved literal text. No SQL parser is added; the only accepted form
//      for a non-admin reader is one flat single-table SELECT.
//
// It guards against mistakes, not against an attacker with SQL access. The
// rules, limits and the extension procedure live in the test header.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SQL tokenizer (D4a)
// ---------------------------------------------------------------------------

export type TokKind =
  | "word"
  | "qident"
  | "string"
  | "param"
  | "number"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "dot"
  | "subst";

export interface Tok {
  kind: TokKind;
  /** Raw value: identifier text, string content (unescaped), operator text. */
  value: string;
  /** Lower-cased value, used for case-insensitive keyword matching. */
  lower: string;
  /** Nesting depth of the token; a paren or bracket sits at its OUTER depth. */
  depth: number;
}

export interface Tokenized {
  tokens: Tok[];
  /** Every anomaly found. Any entry makes an exact-match statement unclassifiable. */
  errors: string[];
  /** True for an unterminated string/identifier/comment or a nested comment: no touch can be classified. */
  fatal: boolean;
}

const OP_CHARS = "+-*/<>=~!@#%^&|?:";
const FATAL_ERRORS = new Set(["unterminated-string", "unterminated-comment", "unterminated-identifier", "nested-comment"]);

export function tokenize(sql: string): Tokenized {
  const tokens: Tok[] = [];
  const errors: string[] = [];
  let depth = 0;
  let i = 0;
  const n = sql.length;
  const push = (kind: TokKind, value: string, at = depth): void => {
    tokens.push({ kind, value, lower: value.toLowerCase(), depth: at });
  };

  while (i < n) {
    const c = sql[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) {
        errors.push("unterminated-comment");
        i = n;
        continue;
      }
      if (sql.slice(i + 2, end).includes("/*")) errors.push("nested-comment");
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < n) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            value += c;
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        value += sql[j];
        j++;
      }
      if (!closed) errors.push(c === "'" ? "unterminated-string" : "unterminated-identifier");
      push(c === "'" ? "string" : "qident", value);
      i = j;
      continue;
    }
    if (c === "$") {
      if (sql.startsWith("${}", i)) {
        push("subst", "${}");
        i += 3;
        continue;
      }
      const digits = /^\$\d+/.exec(sql.slice(i));
      if (digits) {
        push("param", digits[0]);
        i += digits[0].length;
        continue;
      }
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        errors.push("dollar-quote");
        const end = sql.indexOf(tag[0], i + tag[0].length);
        if (end === -1) {
          errors.push("unterminated-string");
          push("string", sql.slice(i + tag[0].length));
          i = n;
        } else {
          push("string", sql.slice(i + tag[0].length, end));
          i = end + tag[0].length;
        }
        continue;
      }
      push("op", "$");
      i++;
      continue;
    }
    if (/[A-Za-z_\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j]!)) j++;
      const word = sql.slice(i, j);
      if ((word === "e" || word === "E") && sql[j] === "'") errors.push("escape-string");
      if ((word === "u" || word === "U") && sql[j] === "&" && sql[j + 1] === "'") errors.push("unicode-string");
      push("word", word);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(sql.slice(i))!;
      push("number", m[0]);
      i += m[0].length;
      continue;
    }
    if (c === "(" || c === "[") {
      push("lparen", c);
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      depth--;
      if (depth < 0) {
        errors.push("unbalanced");
        depth = 0;
      }
      push("rparen", c);
      i++;
      continue;
    }
    if (c === ",") {
      push("comma", c);
      i++;
      continue;
    }
    if (c === ".") {
      push("dot", c);
      i++;
      continue;
    }
    if (c === ";") {
      errors.push("semicolon");
      i++;
      continue;
    }
    if (OP_CHARS.includes(c)) {
      let j = i + 1;
      while (j < n && OP_CHARS.includes(sql[j]!) && !(sql[j] === "-" && sql[j + 1] === "-") && !(sql[j] === "/" && sql[j + 1] === "*")) j++;
      push("op", sql.slice(i, j));
      i = j;
      continue;
    }
    push("op", c);
    i++;
  }
  if (depth !== 0) errors.push("unbalanced");
  return { tokens, errors: [...new Set(errors)], fatal: errors.some((e) => FATAL_ERRORS.has(e)) };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type StatementKind = "touch" | "tripwire" | "unclassifiable";

export interface Statement {
  file: string;
  /** `functionLabel` label, `route GET /x`, or `<module>`. */
  fn: string;
  line: number;
  kind: StatementKind;
  /** Machine-readable sub-code (see the test fixtures). */
  code: string;
  /** Human-readable explanation of this finding. */
  detail: string;
  /** Resolved literal text (after same-file constant substitution). */
  text: string;
  /** Tokens, present for touches only. */
  tokens: Tok[];
  /** Tokenizer anomalies, present for touches only. */
  errors: string[];
}

export function statementKey(s: { file: string; fn: string }): string {
  return `${s.file}#${s.fn}`;
}

/** Recognised (non-finding) writer literals are counted but not reported as statements. */
export interface ScanResult {
  statements: Statement[];
  /** Literals recognised as writers, per `file#function`. Used by the non-vacuity checks. */
  writers: string[];
}

// ---------------------------------------------------------------------------
// Detection (D2)
// ---------------------------------------------------------------------------

const WHOLE_WORD = /(?<![A-Za-z0-9_])audit_log(?![A-Za-z0-9_])/i;
const TABLE_VERBS = new Set(["from", "join", "into", "update", "truncate", "table", "only", "copy", "merge", "lock"]);
const SQL_START = new Set(["select", "with", "insert", "update", "delete", "truncate", "copy", "table", "merge", "lock"]);
// Statements that are not reads and have no class (D2 "Classes"); also DDL.
const NON_READ_FIRST = new Set(["update", "delete", "truncate", "copy", "merge", "lock", "alter", "drop", "create", "grant", "revoke", "comment"]);
// Verbs that, found just before the table position, make the touch a non-read.
const NON_READ_LOOKBACK = new Set(["update", "delete", "truncate", "copy", "merge", "lock", "alter", "drop"]);
// Tokens that end a FROM list when scanning backwards from a comma.
const FROM_LIST_STOP = new Set(["select", "where", "by", "having", "limit", "offset", "set", "values", "returning", "using", "on", "when", "then", "else", "and", "or"]);

function isWord(t: Tok | undefined, lower: string): boolean {
  return t !== undefined && t.kind === "word" && t.lower === lower;
}

/** Index of the first token of an optional `public.` qualification before token `idx`, or `idx`. */
function qualifierStart(tokens: Tok[], idx: number): number {
  const dot = tokens[idx - 1];
  const schema = tokens[idx - 2];
  if (dot && dot.kind === "dot" && schema && ((schema.kind === "word" && schema.lower === "public") || (schema.kind === "qident" && schema.value === "public"))) {
    return idx - 2;
  }
  return idx;
}

/** True when the token at `idx` (the first token of a possible table name) is in table position. */
function inTablePosition(tokens: Tok[], idx: number): boolean {
  const prev = tokens[idx - 1];
  if (!prev) return false;
  if (prev.kind === "word" && TABLE_VERBS.has(prev.lower)) return true;
  if (prev.kind === "comma") {
    for (let k = idx - 2; k >= 0; k--) {
      const t = tokens[k]!;
      if (t.depth < tokens[idx]!.depth) return false;
      if (t.depth > tokens[idx]!.depth) continue;
      if (t.kind === "word") {
        if (t.lower === "from") return true;
        if (FROM_LIST_STOP.has(t.lower)) return false;
      }
    }
  }
  return false;
}

interface Occurrence {
  /** Index of the `audit_log` token. */
  idx: number;
  /** Index of the first token of the (possibly qualified) name. */
  start: number;
}

function analyzeTokens(tokens: Tok[]): {
  tablePositions: Occurrence[];
  stringHits: number;
  strayHits: number;
  unresolvedTable: boolean;
} {
  const tablePositions: Occurrence[] = [];
  let stringHits = 0;
  let strayHits = 0;
  let qualifierRefs = 0;
  let unresolvedTable = false;
  tokens.forEach((t, idx) => {
    if (t.kind === "string") {
      if (WHOLE_WORD.test(t.value)) stringHits++;
      return;
    }
    if (t.kind === "subst") {
      if (inTablePosition(tokens, idx)) unresolvedTable = true;
      return;
    }
    const isName = (t.kind === "word" && t.lower === "audit_log") || (t.kind === "qident" && t.value.toLowerCase() === "audit_log");
    if (!isName) return;
    // Unquoted matches case-insensitively; a quoted name must be exactly lowercase.
    const reads = t.kind === "word" || t.value === "audit_log";
    const start = qualifierStart(tokens, idx);
    if (reads && inTablePosition(tokens, start)) tablePositions.push({ idx, start });
    else if (reads && tokens[idx + 1]?.kind === "dot" && tokens[idx + 2]?.kind !== undefined && (tokens[idx + 2]!.kind === "word" || tokens[idx + 2]!.kind === "qident")) qualifierRefs++;
    else strayHits++;
  });
  // `audit_log.operation` qualifies a column of a table that is read elsewhere in the statement. With no
  // table-position use alongside it, it is just a stray mention.
  if (tablePositions.length === 0) strayHits += qualifierRefs;
  return { tablePositions, stringHits, strayHits, unresolvedTable };
}

/** True when the single table-position use is the target of a column-listed INSERT with a VALUES or SELECT source. */
function isWriterTarget(tokens: Tok[], occ: Occurrence): boolean {
  const into = tokens[occ.start - 1];
  const insert = tokens[occ.start - 2];
  if (!isWord(into, "into") || !isWord(insert, "insert")) return false;
  const open = tokens[occ.idx + 1];
  if (!open || open.kind !== "lparen" || open.value !== "(") return false;
  let k = occ.idx + 2;
  for (; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.kind === "rparen" && t.depth === open.depth) break;
    if (t.kind !== "word" && t.kind !== "qident" && t.kind !== "comma") return false;
  }
  if (k >= tokens.length) return false;
  const source = tokens[k + 1];
  return isWord(source, "values") || isWord(source, "select");
}

function isMutatingTouch(tokens: Tok[], occ: Occurrence): boolean {
  const first = tokens[0];
  if (first && first.kind === "word" && NON_READ_FIRST.has(first.lower)) return true;
  // Walk back over the table-position verbs to find a mutating verb (e.g. DELETE FROM, LOCK TABLE, WITH x AS (DELETE FROM ...)).
  for (let k = occ.start - 1, steps = 0; k >= 0 && steps < 4; k--, steps++) {
    const t = tokens[k]!;
    if (t.kind !== "word") break;
    if (NON_READ_LOOKBACK.has(t.lower)) return true;
    if (!TABLE_VERBS.has(t.lower)) break;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Literal resolution (D5)
// ---------------------------------------------------------------------------

type ConstMap = Map<string, ts.Expression | null>;

function collectConsts(sf: ts.SourceFile): ConstMap {
  const map: ConstMap = new Map();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && node.parent && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      // A name declared more than once in the file is ambiguous: unresolved.
      map.set(node.name.text, map.has(node.name.text) ? null : node.initializer);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      map.set(node.name.text, null);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return map;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let cur = expr;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
  return cur;
}

/** Literal text with same-file const substitution; unresolved substitutions stay as `${}`. Null for a non-literal. */
function resolveText(node: ts.Node, consts: ConstMap, seen: Set<string> = new Set()): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  let out = node.head.text;
  for (const span of node.templateSpans) {
    out += resolveExpression(span.expression, consts, seen) + span.literal.text;
  }
  return out;
}

function resolveExpression(expr: ts.Expression, consts: ConstMap, seen: Set<string>): string {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) {
    const init = consts.get(e.text);
    if (init && !seen.has(e.text)) {
      const next = new Set(seen).add(e.text);
      const text = resolveText(unwrap(init), consts, next);
      if (text !== null) return text;
    }
    return "${}";
  }
  const direct = resolveText(e, consts, seen);
  return direct !== null ? direct : "${}";
}

/** True when the literal begins (after whitespace and comments) with a SQL statement keyword. */
function isSqlLooking(tokens: Tok[]): boolean {
  const first = tokens[0];
  return first !== undefined && first.kind === "word" && SQL_START.has(first.lower);
}

function parseSource(file: string, text: string): ts.SourceFile {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const first = diagnostics[0]!;
    throw new Error(`audit-log-reader scanner: ${file} does not parse (${ts.flattenDiagnosticMessageText(first.messageText, " ")}); fix the file, the scan never skips a source file`);
  }
  return sf;
}

/** Cheap text prefilter (D7): only files that can matter are parsed. */
export function shouldScan(text: string): boolean {
  if (/audit_log/i.test(text)) return true;
  // A SQL template with a substitution straight after a table-position keyword or FROM-list comma.
  if (/\b(?:from|join|into|update|truncate|table|only|copy|merge|lock)\s+\$\{/i.test(text)) return true;
  if (/\bfrom\b[\s\S]*,\s*\$\{/i.test(text)) return true;
  // A SQL-looking literal ending in a table-position keyword, then concatenated.
  if (/\b(?:from|join|into|update|truncate|table|only|copy|merge|lock)\s*["'`]\s*\+/i.test(text)) return true;
  if (/\.concat\(/.test(text) && /\b(?:select|insert|update|delete|truncate|copy|merge)\b/i.test(text)) return true;
  return false;
}

function isConcatOperand(node: ts.Node): boolean {
  let cur: ts.Node = node;
  while (cur.parent && ts.isParenthesizedExpression(cur.parent)) cur = cur.parent;
  const parent = cur.parent;
  if (!parent) return false;
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) return true;
  if (ts.isCallExpression(parent)) {
    if (ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === "concat") {
      // The literal is the receiver or one of the arguments.
      return parent.expression.expression === cur || parent.arguments.some((a) => a === cur);
    }
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name.text === "concat" && parent.expression === cur) return true;
  return false;
}

function isTagged(node: ts.Node): boolean {
  return node.parent !== undefined && ts.isTaggedTemplateExpression(node.parent) && node.parent.template === node;
}

/** True when no named function encloses the node but an anonymous one does (no deterministic label, D7). */
function hasAnonymousScope(node: ts.Node): boolean {
  let anonymous = false;
  for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
    if (functionLabel(cur)) return false;
    if (ts.isFunctionLike(cur) || ts.isClassStaticBlockDeclaration(cur)) anonymous = true;
  }
  return anonymous;
}

export function scanSource(file: string, text: string): ScanResult {
  const sf = parseSource(file, text);
  const consts = collectConsts(sf);
  const statements: Statement[] = [];
  const writers: string[] = [];

  const add = (node: ts.Node, kind: StatementKind, code: string, detail: string, resolved: string, tokens: Tok[] = [], errors: string[] = []): void => {
    statements.push({
      file,
      fn: enclosingFunction(node),
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      kind,
      code,
      detail,
      text: resolved.replace(/\s+/g, " ").trim().slice(0, 160),
      tokens,
      errors,
    });
  };

  const analyzeLiteral = (node: ts.Node, resolved: string): void => {
    const mentions = WHOLE_WORD.test(resolved) || /audit_log/i.test(resolved);
    const hasSubst = resolved.includes("${}");
    const concat = isConcatOperand(node);
    const tagged = isTagged(node);
    if (!mentions && !hasSubst && !concat && !tagged) return;

    const tz = tokenize(resolved);
    const sqlLooking = isSqlLooking(tz.tokens);
    if (!mentions && !sqlLooking) return;

    if (tz.fatal) {
      if (sqlLooking) add(node, "unclassifiable", `tokenizer:${tz.errors.find((e) => FATAL_ERRORS.has(e))}`, "the SQL text has an unterminated or nested comment, string or identifier", resolved);
      else if (WHOLE_WORD.test(resolved)) add(node, "tripwire", "prose", "a non-SQL string mentions audit_log", resolved);
      return;
    }
    if (!sqlLooking) {
      // A non-SQL string. A bare mention is prose (tripwire); a fragment in table position is still a touch below.
      const probe = analyzeTokens(tz.tokens);
      if (probe.tablePositions.length === 0) {
        if (probe.stringHits + probe.strayHits > 0) add(node, "tripwire", "prose", "audit_log appears outside any table position", resolved);
        return;
      }
    }

    if (sqlLooking) {
      if (tagged) add(node, "unclassifiable", "tagged-template", "a SQL tagged template is not scanned", resolved);
      if (concat) add(node, "unclassifiable", "concatenation", "SQL built with + or .concat cannot be classified statically", resolved);
    }
    const a = analyzeTokens(tz.tokens);
    if (sqlLooking && a.unresolvedTable) {
      add(node, "unclassifiable", "unresolved-table", "a substitution that is not a same-file const sits in table position", resolved);
    }
    if (a.stringHits + a.strayHits > 0) {
      add(node, "tripwire", a.stringHits > 0 ? "string-value" : "not-table-position", "audit_log appears outside a table position", resolved);
    }
    if (a.tablePositions.length === 0) return;

    const only = a.tablePositions.length === 1 ? a.tablePositions[0]! : null;
    if (only && isWriterTarget(tz.tokens, only)) {
      writers.push(`${file}#${enclosingFunction(node)}`);
      return;
    }
    const mutating = a.tablePositions.find((occ) => isMutatingTouch(tz.tokens, occ));
    if (mutating) {
      add(node, "unclassifiable", "non-read", "a statement that is not a read touches audit_log (UPDATE, DELETE, TRUNCATE, COPY, MERGE, LOCK, DDL)", resolved);
      return;
    }
    add(node, "touch", "touch", "reads or otherwise touches audit_log", resolved, tz.tokens, tz.errors);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      // Module specifiers are not SQL; specifier names are checked as identifiers below.
      node.forEachChild((child) => {
        if (!ts.isStringLiteral(child)) visit(child);
      });
      return;
    }
    if (ts.isIdentifier(node)) {
      if (WHOLE_WORD.test(node.text)) add(node, "tripwire", "identifier", "an identifier or property is named audit_log", node.text);
      return;
    }
    const resolved = resolveText(node, consts);
    if (resolved !== null) {
      if (hasAnonymousScope(node) && (WHOLE_WORD.test(resolved) || /audit_log/i.test(resolved))) {
        analyzeLiteralWithAnonymous(node, resolved);
      } else {
        analyzeLiteral(node, resolved);
      }
    }
    ts.forEachChild(node, visit);
  };

  // A touch inside an anonymous function with no named ancestor is unclassifiable (no deterministic label).
  const analyzeLiteralWithAnonymous = (node: ts.Node, resolved: string): void => {
    const before = statements.length;
    analyzeLiteral(node, resolved);
    if (statements.slice(before).some((s) => s.kind === "touch")) {
      add(node, "unclassifiable", "anonymous-function", "the statement is in an anonymous function with no named enclosing function, so it has no inventory key", resolved);
    }
  };

  visit(sf);
  return { statements, writers };
}

// ---------------------------------------------------------------------------
// Pure primitives for the admin-only checks (1.7a)
// ---------------------------------------------------------------------------

export function countTouchingLiterals(statements: Statement[], file: string, fn: string): number {
  return statements.filter((s) => s.kind === "touch" && s.file === file && s.fn === fn).length;
}

export interface NamedSource {
  rel: string;
  text: string;
}

/**
 * Files, other than the defining file, that reference an identifier called `name`: a plain reference,
 * an import or export specifier (including `as` aliases), or a property access (`ns.name`). The match
 * is by name only and so can over-report on a name collision; the remedy is a rename.
 */
export function findReferences(name: string, files: NamedSource[], definingFile: string): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.rel === definingFile || !f.text.includes(name)) continue;
    const sf = parseSource(f.rel, f.text);
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isIdentifier(node) && node.text === name) {
        found = true;
        return;
      }
      // String-keyed access: m["name"] / m[`name`] (X-2).
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === name) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (found) out.push(f.rel);
  }
  return out.sort();
}

/**
 * Exported top-level functions of the defining file, other than `name`, that reach `name` (X-1): they
 * reference it directly, or through another top-level function of the same file that does. A non-admin
 * route importing such a wrapper would reach the admin-only reader without naming it. The result is
 * sorted. The walk is by name and one file deep: a wrapper of a wrapper in ANOTHER file is not followed.
 */
export function findWrappers(name: string, definingFile: NamedSource): string[] {
  if (!definingFile.text.includes(name)) return [];
  const sf = parseSource(definingFile.rel, definingFile.text);
  const bodies = new Map<string, ts.Node>();
  const exported = new Set<string>();
  const hasExport = (n: ts.Node): boolean => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) {
      bodies.set(st.name.text, st);
      if (hasExport(st)) exported.add(st.name.text);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) {
          bodies.set(d.name.text, d.initializer);
          if (hasExport(st)) exported.add(d.name.text);
        }
      }
    } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) exported.add((el.propertyName ?? el.name).text);
    }
  }
  const mentions = (node: ts.Node, target: string): boolean => {
    let hit = false;
    const visit = (n: ts.Node): void => {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text === target) hit = true;
      else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === target) hit = true;
      else ts.forEachChild(n, visit);
    };
    visit(node);
    return hit;
  };
  const reaching = new Set<string>([name]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [fn, body] of bodies) {
      if (reaching.has(fn)) continue;
      if ([...reaching].some((t) => mentions(body, t))) {
        reaching.add(fn);
        grew = true;
      }
    }
  }
  return [...reaching].filter((fn) => fn !== name && exported.has(fn)).sort();
}

// ---------------------------------------------------------------------------
// exact-match positive grammar (D4b) and protected operations (D6)
// ---------------------------------------------------------------------------

export function isProtectedOperation(op: string): boolean {
  return op.startsWith("admin.") || op.startsWith("topic.config_") || op === "topic.config_list_denied" || op === "admin.topic_config_accessed";
}

export interface Grade {
  ok: boolean;
  /** `unclassifiable` or `protected-operation`. */
  rule?: "unclassifiable" | "protected-operation";
  code?: string;
  detail?: string;
}

const FORBIDDEN_WORDS = new Set(["with", "union", "intersect", "except", "lateral", "join", "between"]);
const WHERE_END = new Set(["group", "having", "order", "limit", "offset", "for", "fetch", "window"]);

function fail(code: string, detail: string): Grade {
  return { ok: false, rule: "unclassifiable", code, detail };
}

function isIdentLike(t: Tok | undefined, lower: string): boolean {
  return t !== undefined && ((t.kind === "word" && t.lower === lower) || (t.kind === "qident" && t.value === lower));
}

/** Matches an optional `qualifier .` prefix; returns the index after it, or -1 when the qualifier is not allowed. */
function skipQualifier(c: Tok[], at: number, allowed: Set<string>): number {
  const dot = c[at + 1];
  if (dot && dot.kind === "dot") {
    const q = c[at];
    if (q && (q.kind === "word" || q.kind === "qident") && allowed.has(q.kind === "word" ? q.lower : q.value)) return at + 2;
    return -1;
  }
  return at;
}

export function gradeExactMatch(st: Pick<Statement, "tokens" | "errors">): Grade {
  const { tokens, errors } = st;
  if (errors.length > 0) {
    return fail(`tokenizer:${errors[0]}`, `the SQL contains ${errors.join(", ")}, which the tokenizer does not classify`);
  }
  if (tokens.some((t) => t.kind === "subst")) {
    return fail("unresolved-substitution", "an exact-match statement must be static; a substitution that is not a same-file const cannot be checked");
  }
  const first = tokens[0];
  if (!first || first.kind !== "word" || first.lower !== "select") return fail("shape", "the statement must be a single SELECT");
  if (tokens.filter((t) => t.kind === "word" && t.lower === "select").length !== 1) {
    return fail("shape", "exactly one SELECT is allowed: no subquery, scalar subquery or EXISTS");
  }
  const forbidden = tokens.find((t) => t.kind === "word" && FORBIDDEN_WORDS.has(t.lower));
  if (forbidden) return fail("shape", `${forbidden.value.toUpperCase()} is not allowed: an exact-match reader is one flat SELECT over audit_log alone`);

  const fromIdx = tokens.findIndex((t) => t.depth === 0 && t.kind === "word" && t.lower === "from");
  if (fromIdx === -1) return fail("shape", "the SELECT has no FROM audit_log");
  let k = fromIdx + 1;
  if (isWord(tokens[k], "only")) k++;
  if (isWord(tokens[k], "public") || isIdentLike(tokens[k], "public")) {
    if (tokens[k + 1]?.kind === "dot") k += 2;
  }
  const table = tokens[k];
  if (!table || !(isIdentLike(table, "audit_log") || (table.kind === "word" && table.lower === "audit_log"))) {
    return fail("shape", "the FROM source must be audit_log");
  }
  k++;
  const names = new Set<string>(["audit_log"]);
  if (isWord(tokens[k], "as")) k++;
  const maybeAlias = tokens[k];
  if (maybeAlias && (maybeAlias.kind === "word" || maybeAlias.kind === "qident") && !(maybeAlias.kind === "word" && (maybeAlias.lower === "where" || WHERE_END.has(maybeAlias.lower)))) {
    names.add(maybeAlias.kind === "word" ? maybeAlias.lower : maybeAlias.value);
    k++;
  }
  if (tokens[k]?.kind === "comma") return fail("shape", "a comma between FROM sources is not allowed: one table only");
  if (!isWord(tokens[k], "where")) return fail("shape", "the SELECT must have a WHERE clause directly after the table");

  // WHERE runs at depth 0 to the first terminating clause.
  const whereStart = k + 1;
  let whereEnd = tokens.length;
  for (let j = whereStart; j < tokens.length; j++) {
    const t = tokens[j]!;
    if (t.depth === 0 && t.kind === "word" && WHERE_END.has(t.lower)) {
      whereEnd = j;
      break;
    }
  }
  const where = tokens.slice(whereStart, whereEnd);
  if (where.some((t) => t.depth === 0 && t.kind === "word" && t.lower === "or")) {
    return fail("or-in-where", "a top-level OR in the WHERE widens the filter; combine predicates with AND only");
  }
  const conjuncts: Tok[][] = [[]];
  for (const t of where) {
    if (t.depth === 0 && t.kind === "word" && t.lower === "and") conjuncts.push([]);
    else conjuncts[conjuncts.length - 1]!.push(t);
  }
  if (conjuncts.some((c) => c.length === 0)) return fail("shape", "the WHERE has an empty predicate");

  const mentionsOperation = (c: Tok[]): boolean => c.some((t) => (t.kind === "word" && t.lower === "operation") || (t.kind === "qident" && t.value.toLowerCase() === "operation"));
  const opConjuncts = conjuncts.filter(mentionsOperation);
  if (opConjuncts.length === 0) {
    return fail("operation-missing", "the WHERE must filter operation by equality on one named operation: operation = '<name>'");
  }
  if (opConjuncts.length > 1) {
    return fail("operation-duplicate", "operation is mentioned in more than one predicate; use exactly one: operation = '<name>'");
  }
  const op = opConjuncts[0]!;
  const afterQual = skipQualifier(op, 0, names);
  const eq = op[afterQual + 1];
  const lit = op[afterQual + 2];
  const wellFormed =
    afterQual !== -1 &&
    isIdentLike(op[afterQual], "operation") &&
    op.length === afterQual + 3 &&
    eq !== undefined &&
    eq.kind === "op" &&
    eq.value === "=" &&
    lit !== undefined &&
    lit.kind === "string";
  if (!wellFormed || !lit) {
    return fail(
      "operation-form",
      "the operation predicate must be exactly operation = '<name>' (a literal, no IN, LIKE, ANY, cast, parameter, parentheses, NOT or inequality)",
    );
  }

  const hasScope = conjuncts.some((c) => {
    // The operation conjunct is excluded by object identity: `op` is the very element of `conjuncts` found earlier, not an equal copy.
    if (c === op) return false;
    const at = skipQualifier(c, 0, names);
    if (at === -1) return false;
    const s1 = c[at];
    if (isIdentLike(s1, "team_id")) {
      const e = c[at + 1];
      const v = c[at + 2];
      return c.length === at + 3 && e?.kind === "op" && e.value === "=" && v !== undefined && (v.kind === "string" || v.kind === "param" || v.kind === "number");
    }
    if (isIdentLike(s1, "metadata")) {
      const arrow = c[at + 1];
      const key = c[at + 2];
      const e = c[at + 3];
      const v = c[at + 4];
      return (
        c.length === at + 5 &&
        arrow?.kind === "op" &&
        arrow.value === "->>" &&
        key?.kind === "string" &&
        key.value === "scopeId" &&
        e?.kind === "op" &&
        e.value === "=" &&
        v !== undefined &&
        (v.kind === "string" || v.kind === "param")
      );
    }
    return false;
  });
  if (!hasScope) {
    return fail("scope-missing", "the WHERE needs a scope predicate: team_id = <value> or metadata->>'scopeId' = <value>, so the reader cannot return every team's rows");
  }

  if (isProtectedOperation(lit.value)) {
    return { ok: false, rule: "protected-operation", code: "protected", detail: `'${lit.value}' is a protected admin operation that a non-admin reader must never select` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Judge (D3, D8, D10)
// ---------------------------------------------------------------------------

export interface ExactEntry {
  reason: string;
}
export interface AdminEntry {
  reason: string;
  /** Files (relative to packages/backend/src) allowed to reference the function; exactly one. */
  callers: string[];
  /** Number of touching literals in the function. */
  statements: number;
  /**
   * Exported functions of the defining file, other than the keyed one, that reach it (X-1). Must equal
   * what findWrappers finds. Their references from other files count as references to the keyed function.
   */
  wrappers?: string[];
}

export type Rule =
  | "uninventoried-touch"
  | "stale-entry"
  | "blank-reason"
  | "class-conflict"
  | "protected-operation"
  | "unclassifiable"
  | "tripwire"
  | "caller-mismatch"
  | "statement-count";

export interface Violation {
  rule: Rule;
  /** `file#function` */
  key: string;
  /** Sub-code for unclassifiable and tripwire findings. */
  code?: string;
  line?: number;
  message: string;
}

export interface JudgeInput {
  statements: Statement[];
  exact: Record<string, ExactEntry | { reason: string }>;
  admin: Record<string, AdminEntry>;
  /** Production sources, for the caller check. */
  files: NamedSource[];
  /** Name of the file holding the header (for messages). */
  testFile: string;
}

const RULE_TEXT: Record<Rule, { step: number; how: string }> = {
  "uninventoried-touch": {
    step: 1,
    how: "First decide who this reader serves. Anyone other than an application_admin: write one flat SELECT ... FROM audit_log WHERE operation = '<name>' AND <team_id or metadata->>'scopeId' predicate> and add an EXACT_MATCH entry. Only application admins: add an ADMIN_ONLY entry with callers and statements. Either way, a Security Analyst review of the new entry follows; do not self-approve.",
  },

  "stale-entry": {
    step: 4,
    how: "The inventory lists a function that no longer touches audit_log. Renamed or moved? Update the key. Deleted? Delete the entry.",
  },
  "blank-reason": { step: 1, how: "Every inventory entry needs a non-blank reason: who the reader serves, which operation, and why it cannot expose admin rows." },
  "class-conflict": { step: 2, how: "A function is in both EXACT_MATCH and ADMIN_ONLY. Pick one class; reclassifying is a reviewed change, not a one-word edit." },
  "protected-operation": {
    step: 1,
    how: "A non-admin reader must not select an admin.* or topic.config_* operation. Choose a different operation, or if the reader serves only application admins, make it an ADMIN_ONLY entry through review.",
  },
  unclassifiable: {
    step: 4,
    how: "The scanner cannot classify this statement statically. Do not widen the inventory. Rewrite it into the accepted form, or, for a legitimate new shape, propose a reviewed grammar extension in the scanner with a fixture.",
  },
  tripwire: {
    step: 4,
    how: "audit_log appears in code where it is not a recognised table reference. If this is prose (a message), reword it (for example 'audit log write failed'). If it is a table name held in a constant, inline the table name in the SQL that uses it.",
  },
  "caller-mismatch": {
    step: 2,
    how: "An ADMIN_ONLY function is exempt from the operation-filter check only because its caller is an admin route. Its references must equal its callers list (exactly one file). Do not reuse it from another file; rename it if this is a name collision.",
  },
  "statement-count": {
    step: 2,
    how: "The number of audit_log statements in an ADMIN_ONLY function changed. Review the new SQL, then update statements in the entry (a reviewer sees the edit).",
  },
};

export function formatViolation(v: { rule: Rule; key: string; line?: number | undefined; detail: string }, testFile: string): string {
  const info = RULE_TEXT[v.rule];
  const where = v.line === undefined ? v.key : `${v.key} (line ${v.line})`;
  return [
    `Audit visibility guard [${v.rule}] at ${where}: ${v.detail}`,
    `Why: non-admin callers must never read admin audit rows (admin.* and topic.config_* operations); this test makes that rule mechanical.`,
    `What to do: ${info.how}`,
    `See the header of ${testFile}, extension procedure step ${info.step}.`,
  ].join("\n");
}

function blank(s: string | undefined): boolean {
  return s === undefined || s.trim().length === 0;
}

function isPlainIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

export function judge(input: JudgeInput): Violation[] {
  const out: Violation[] = [];
  const push = (rule: Rule, key: string, detail: string, extra: { code?: string; line?: number } = {}): void => {
    out.push({
      rule,
      key,
      ...(extra.code !== undefined ? { code: extra.code } : {}),
      ...(extra.line !== undefined ? { line: extra.line } : {}),
      message: formatViolation({ rule, key, line: extra.line, detail }, input.testFile),
    });
  };

  const exactKeys = new Set(Object.keys(input.exact));
  const adminKeys = new Set(Object.keys(input.admin));
  for (const key of exactKeys) if (adminKeys.has(key)) push("class-conflict", key, "the same key is in both EXACT_MATCH and ADMIN_ONLY");
  for (const [key, e] of Object.entries(input.exact)) if (blank(e.reason)) push("blank-reason", key, "EXACT_MATCH entry has a blank reason");
  for (const [key, e] of Object.entries(input.admin)) if (blank(e.reason)) push("blank-reason", key, "ADMIN_ONLY entry has a blank reason");

  const touches = new Map<string, Statement[]>();
  const seen = new Set<string>();
  for (const s of input.statements) {
    const key = statementKey(s);
    if (s.kind !== "tripwire") seen.add(key);
    if (s.kind === "tripwire") push("tripwire", key, `${s.detail}: "${s.text}"`, { code: s.code, line: s.line });
    else if (s.kind === "unclassifiable") push("unclassifiable", key, `${s.detail} [${s.code}]: "${s.text}"`, { code: s.code, line: s.line });
    else touches.set(key, [...(touches.get(key) ?? []), s]);
  }

  for (const [key, sts] of touches) {
    const isExact = exactKeys.has(key);
    const isAdmin = adminKeys.has(key);
    if (!isExact && !isAdmin) {
      for (const s of sts) push("uninventoried-touch", key, `this statement touches audit_log and is not in the inventory: "${s.text}"`, { line: s.line });
      continue;
    }
    if (isExact && !isAdmin) {
      for (const s of sts) {
        const g = gradeExactMatch(s);
        if (g.ok) continue;
        const rule = g.rule ?? "unclassifiable";
        push(rule, key, `${g.detail ?? ""}${rule === "unclassifiable" ? " Accepted form: SELECT ... FROM audit_log WHERE operation = '<name>' AND (team_id = <v> | metadata->>'scopeId' = <v>)." : ""}`, {
          code: g.code ?? "",
          line: s.line,
        });
      }
    }
    const entry = input.admin[key];
    if (isAdmin && entry) {
      const sep = key.indexOf("#");
      const file = key.slice(0, sep);
      const fn = key.slice(sep + 1);
      if (entry.statements !== sts.length) {
        push("statement-count", key, `the entry says ${entry.statements} statement(s) but the function holds ${sts.length}`);
      }
      if (entry.callers.length !== 1) {
        push("caller-mismatch", key, `an ADMIN_ONLY entry must list exactly one caller file; it lists ${entry.callers.length}`);
      } else if (!isPlainIdentifier(fn)) {
        push("caller-mismatch", key, `the callers check needs a named function; "${fn}" has no referenceable name. Move the SQL into a named, exported function`);
      } else {
        const defining = input.files.find((x) => x.rel === file);
        const found = defining ? findWrappers(fn, defining) : [];
        const listed = [...(entry.wrappers ?? [])].sort();
        if (found.join(",") !== listed.join(",")) {
          push(
            "caller-mismatch",
            key,
            `${file} exports [${found.join(", ")}] that reach ${fn} (a wrapper would let another route read it without naming it) but the entry lists wrappers [${listed.join(", ")}]. List each in the entry's wrappers, or make the wrapper not exported`,
          );
        }
        const refs = [...new Set([fn, ...found].flatMap((n) => findReferences(n, input.files, file)))].sort();
        const same = refs.length === entry.callers.length && refs.every((r, i) => r === [...entry.callers].sort()[i]);
        if (!same) {
          push("caller-mismatch", key, `${[fn, ...found].join(" / ")} is referenced from [${refs.join(", ")}] but the entry lists [${entry.callers.join(", ")}]`);
        }
      }
    }
  }

  // An entry whose function now holds an unclassifiable statement is not stale; the unclassifiable finding is the news.
  const live = seen;
  for (const key of [...exactKeys, ...adminKeys]) {
    if (!live.has(key)) push("stale-entry", key, "the inventory has an entry but no statement in that function touches audit_log (renamed or moved?)");
  }
  return out;
}
