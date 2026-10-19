import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  DEFAULT_TOPICS_TEAM_ID,
  DefaultTopicsUnavailableError,
  canonicalDefaultsWhere,
  copyCanonicalDefaults,
} from "../default-topics.js";

describe("canonicalDefaultsWhere (#215 D1)", () => {
  it("emits the exact predicate for the content.ts alias", () => {
    expect(canonicalDefaultsWhere("dt", 2)).toBe(
      "dt.team_id = $2 AND dt.is_default = true AND dt.status = 'active'",
    );
  });

  it("emits the exact predicate for the copy's unaliased table", () => {
    expect(canonicalDefaultsWhere("topics", 2)).toBe(
      "topics.team_id = $2 AND topics.is_default = true AND topics.status = 'active'",
    );
  });

  it.each([0, 1.5, NaN])("throws for paramIndex %s", (n) => {
    expect(() => canonicalDefaultsWhere("dt", n)).toThrow();
  });
});

describe("copyCanonicalDefaults return value (#200 2.3)", () => {
  function clientReturning(rows: Array<{ id: string }>) {
    const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
    return { client: { query } as unknown as PoolClient, query };
  }

  it("returns the inserted ids, in the order the insert reports them", async () => {
    const { client, query } = clientReturning([{ id: "a" }, { id: "b" }, { id: "c" }]);

    await expect(copyCanonicalDefaults(client, "team-1")).resolves.toEqual(["a", "b", "c"]);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/RETURNING id\s*$/);
    // The template id is always a bound parameter, never interpolated.
    expect(params).toEqual(["team-1", DEFAULT_TOPICS_TEAM_ID]);
    expect(sql).not.toContain(DEFAULT_TOPICS_TEAM_ID);
  });

  // #311 E8: the copy is exactly one INSERT ... SELECT that sets the link in the
  // same statement; no UPDATE pass and no ON CONFLICT (regex on the SQL text).
  it("is one INSERT INTO topics ... SELECT whose column list includes template_topic_id, with no UPDATE and no ON CONFLICT", async () => {
    const { client, query } = clientReturning([{ id: "a" }]);
    await copyCanonicalDefaults(client, "team-1");

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as [string];
    expect(sql.match(/\bINSERT\s+INTO\s+topics\b/gi)).toHaveLength(1);
    expect(sql).toMatch(/\bINSERT\s+INTO\s+topics\s*\([^)]*\btemplate_topic_id\b[^)]*\)\s*SELECT\b[\s\S]*,\s*id\s+FROM\s+topics\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bON\s+CONFLICT\b/i);
  });

  it("returns [] when the source has no active defaults (the caller decides what that means)", async () => {
    const { client } = clientReturning([]);

    await expect(copyCanonicalDefaults(client, "team-1")).resolves.toEqual([]);
  });
});

describe("DefaultTopicsUnavailableError (#200 2.3)", () => {
  it("carries no session, team or template id in its message", () => {
    const err = new DefaultTopicsUnavailableError();

    expect(err.name).toBe("DefaultTopicsUnavailableError");
    expect(err.message).not.toContain(DEFAULT_TOPICS_TEAM_ID);
    expect(err.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(err).toBeInstanceOf(Error);
  });
});
