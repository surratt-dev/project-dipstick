import { describe, it, expect } from "vitest";
import { productionSources } from "./helpers/backend-sources.js";
import { scanLinkWriters, writesTemplateLink } from "./helpers/template-writer-scanner.js";

// ---------------------------------------------------------------------------
// #311 design.md Decision 5 (S4, link-target integrity): the database cannot
// constrain the FK target to template rows (a CHECK cannot subquery), so the
// only SQL in packages/backend/src that writes topics.template_topic_id is the
// INSERT ... SELECT in copyCanonicalDefaults. The migration is outside src.
// Limitation: the scanner only sees literal SQL (string/template literals). SQL
// assembled at runtime (concatenation, variables, helpers) is invisible to it.
// Reuses the template-writer scanner (production sources only: tests and
// migrations are excluded by productionSources / their location).
// ---------------------------------------------------------------------------
describe("only copyCanonicalDefaults writes topics.template_topic_id (#311)", () => {
  const findings = productionSources().flatMap((f) => scanLinkWriters(f.rel, f.text));

  it("the single link writer is the copy", () => {
    expect(findings.map((f) => `${f.file}#${f.fn}`)).toEqual(["sessions/default-topics.ts#copyCanonicalDefaults"]);
  });

  it("the scan is not vacuous: it sees the copy's INSERT", () => {
    expect(findings).toHaveLength(1);
    expect(findings[0]!.statement).toMatch(/^INSERT INTO topics/);
  });

  describe("the scan can fail (rogue-writer fixtures)", () => {
    const wrap = (sql: string) => `export async function rogue(c) { await c.query(${sql}, []); }`;
    it.each([
      ["a rogue UPDATE", "`UPDATE topics SET template_topic_id = $1 WHERE id = $2`"],
      ["an aliased UPDATE with other columns first", "`UPDATE topics t SET name = $1, template_topic_id = NULL WHERE t.id = $2`"],
      ["a rogue INSERT", "`INSERT INTO topics (team_id, name, template_topic_id) VALUES ($1, $2, $3)`"],
      ["a schema-qualified UPDATE", "`UPDATE public.topics SET template_topic_id = $1 WHERE id = $2`"],
      ["a multi-line lower-case UPDATE", "`update\\n topics\\n set template_topic_id = $1`"],
    ])("%s is reported", (_label, sql) => {
      expect(scanLinkWriters("routes/other.ts", wrap(sql))).toHaveLength(1);
    });

    it.each([
      ["a read in a WHERE", "`UPDATE topics SET name = $1 WHERE template_topic_id = $2`"],
      ["a SELECT", "`SELECT template_topic_id FROM topics WHERE team_id = $1`"],
      ["an INSERT without the column", "`INSERT INTO topics (team_id, name) VALUES ($1, $2)`"],
    ])("negative: %s is not reported", (_label, sql) => {
      expect(scanLinkWriters("routes/other.ts", wrap(sql))).toEqual([]);
    });

    it("writesTemplateLink matches the copy's own shape", () => {
      expect(writesTemplateLink("INSERT INTO topics (team_id, template_topic_id) SELECT $1, id FROM topics")).toBe(true);
    });
  });
});
