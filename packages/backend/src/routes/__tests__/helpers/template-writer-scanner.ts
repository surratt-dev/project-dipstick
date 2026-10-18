import ts from "typescript";
import { DEFAULT_TOPICS_TEAM_ID } from "../../../sessions/default-topics.js";

// ---------------------------------------------------------------------------
// Pure scanner behind routes/__tests__/template-writer-structural.test.ts --
// admin-default-topic-maintenance (#216) design.md E11.
//
// Parses a TypeScript source file with the TypeScript compiler API (already a
// root devDependency; no new dependency), extracts SQL from string and template
// literals, and reports every statement that WRITES the `topics` table, with
// the name of its enclosing function, whether it (or the call that executes it)
// targets the sentinel, and any write whose table name is dynamic.
//
// It guards against mistakes, not against an attacker with SQL access. A
// sentinel id arriving through a runtime variable cannot be detected
// statically; for team-scoped handlers that guard is checkWritableTeam and its
// #188 structural test.
// ---------------------------------------------------------------------------

export interface WriteFinding {
  file: string;
  /** Nearest named enclosing function, `route <METHOD> <path>` for an anonymous route handler, or `<module>`. */
  fn: string;
  kind: "write" | "dynamic";
  /** True when the statement, or the call expression executing it, references the sentinel. */
  sentinel: boolean;
  statement: string;
}

// The sentinel id is built from its one definition: the template-id literal rule (#214 5.4)
// forbids spelling the UUID anywhere else in the source.
const SENTINEL = new RegExp(`${DEFAULT_TOPICS_TEAM_ID}|__default_topics__|\\bDEFAULT_TOPICS_TEAM_ID\\b`);

// `topics` as a table: optionally ONLY, schema-qualified, quoted; never
// `session_topics` (the keyword must be directly before it) or `topics_x`.
const TABLE = String.raw`(?:ONLY\s+)?(?:(?:"public"|public)\s*\.\s*)?(?:"topics"|topics(?![A-Za-z0-9_]))`;
const WRITE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\bINSERT\s+INTO\s+${TABLE}`, "i"),
  new RegExp(String.raw`\bUPDATE\s+${TABLE}`, "i"),
  new RegExp(String.raw`\bDELETE\s+FROM\s+${TABLE}`, "i"),
  new RegExp(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?${TABLE}`, "i"),
  new RegExp(String.raw`\bMERGE\s+INTO\s+${TABLE}`, "i"),
];
// Dynamic table names: a write keyword (upper-case, as SQL is written in this
// codebase, so prose such as "failed to update ${x}" is not flagged) followed by
// an interpolation, or a literal that ENDS in a write keyword (concatenation).
const DYNAMIC_PATTERNS: RegExp[] = [
  /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO)\s+(?:ONLY\s+)?\$\{\}/,
  // `FOR UPDATE` (row locking) legitimately ends a SELECT literal.
  /(?<!\bFOR\s+)\bUPDATE\s*$|\b(?:INSERT\s+INTO|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO)\s*$/,
];

export function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => "${}" + s.literal.text).join("");
  }
  return null;
}

const ROUTE_VERBS = new Set(["get", "post", "put", "patch", "delete"]);

export function functionLabel(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) {
      const verb = parent.expression.name.text;
      const first = parent.arguments[0];
      if (ROUTE_VERBS.has(verb) && first && ts.isStringLiteralLike(first)) return `route ${verb.toUpperCase()} ${first.text}`;
    }
  }
  return null;
}

export function enclosingFunction(node: ts.Node): string {
  for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
    const label = functionLabel(cur);
    if (label) return label;
  }
  return "<module>";
}

/** The nearest call expression the node is an ARGUMENT of (the call that executes the statement). */
function executingCall(node: ts.Node): ts.CallExpression | null {
  for (let cur: ts.Node = node; cur.parent; cur = cur.parent) {
    const parent = cur.parent;
    if (ts.isCallExpression(parent) && parent.arguments.some((a) => a === cur)) return parent;
    if (ts.isFunctionLike(parent)) return null;
  }
  return null;
}

export function scanSource(file: string, text: string): WriteFinding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: WriteFinding[] = [];
  const visit = (node: ts.Node): void => {
    const lit = literalText(node);
    if (lit !== null && /INSERT|UPDATE|DELETE|TRUNCATE|MERGE/i.test(lit)) {
      const isWrite = WRITE_PATTERNS.some((p) => p.test(lit));
      const isDynamic = DYNAMIC_PATTERNS.some((p) => p.test(lit));
      if (isWrite || isDynamic) {
        const call = executingCall(node);
        const sentinel = SENTINEL.test(lit) || (call !== null && SENTINEL.test(call.getText(sf)));
        out.push({
          file,
          fn: enclosingFunction(node),
          kind: isWrite ? "write" : "dynamic",
          sentinel,
          statement: lit.replace(/\s+/g, " ").trim().slice(0, 120),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
