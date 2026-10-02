import { describe, it, expect, vi } from "vitest";
import {
  snapshotSessionTopics,
  lockTeamTopics,
  NoActiveTopicsError,
  LOCK_TEAM_TOPICS_SQL,
  TEAM_TOPICS_LOCK_KEY_SQL,
} from "../session-topic-snapshot.js";

// ---------------------------------------------------------------------------
// Mock-level coverage for the session topic snapshot helper
// (session-topics-snapshot-at-creation tasks.md 2.1). The SQL itself is
// exercised against real Postgres in session-topic-snapshot-integration.test.ts.
// ---------------------------------------------------------------------------

function mockClient(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

describe("snapshotSessionTopics", () => {
  it("throws NoActiveTopicsError when RETURNING yields zero rows", async () => {
    const client = mockClient([]);
    await expect(snapshotSessionTopics(client, "sess-1")).rejects.toBeInstanceOf(NoActiveTopicsError);
  });

  it("returns topicIds in display_order order, whatever order RETURNING used", async () => {
    const client = mockClient([
      { topic_id: "t-c", display_order: 3 },
      { topic_id: "t-a", display_order: 1 },
      { topic_id: "t-b", display_order: 2 },
    ]);
    await expect(snapshotSessionTopics(client, "sess-1")).resolves.toEqual({ topicIds: ["t-a", "t-b", "t-c"] });
  });

  it("is one INSERT ... SELECT keyed on the session id only, joining the session's own team", async () => {
    const client = mockClient([{ topic_id: "t-a", display_order: 1 }]);
    await snapshotSessionTopics(client, "sess-1");
    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO session_topics/);
    expect(sql).toMatch(/JOIN topics t ON t\.team_id = s\.team_id AND t\.status = 'active'/);
    expect(sql).toMatch(/row_number\(\) OVER \(ORDER BY t\.display_order, t\.id\)/);
    expect(sql).toMatch(/t\.team_annotation/);
    expect(params).toEqual(["sess-1"]);
  });

  it("propagates any other error unchanged", async () => {
    const boom = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const client = { query: vi.fn().mockRejectedValue(boom) };
    await expect(snapshotSessionTopics(client, "sess-1")).rejects.toBe(boom);
  });
});

describe("lockTeamTopics", () => {
  it("issues the canonical ::uuid::text key expression", async () => {
    const client = mockClient([]);
    await lockTeamTopics(client, "team-1");
    expect(TEAM_TOPICS_LOCK_KEY_SQL).toBe("hashtext($1::uuid::text)");
    expect(client.query).toHaveBeenCalledWith(LOCK_TEAM_TOPICS_SQL, ["team-1"]);
    expect(LOCK_TEAM_TOPICS_SQL).toBe("SELECT pg_advisory_xact_lock(hashtext($1::uuid::text))");
  });
});
