import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
  },
}));

vi.mock("../../config.js", () => ({
  config: {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "test",
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test",
  },
}));

import { getOpenActionItemsForTopic } from "../open-action-items-helper.js";

// ---------------------------------------------------------------------------
// getOpenActionItemsForTopic — remove-topic, design.md Decision 5, tasks.md
// Task 2.1/2.2.
// ---------------------------------------------------------------------------
describe("getOpenActionItemsForTopic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty array for a topic with zero open action items", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getOpenActionItemsForTopic("topic-1");

    expect(result).toEqual([]);
  });

  it("returns open action items spanning two different sessions the topic has appeared in", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { id: "ai-1", description: "Follow up on flaky test" },
        { id: "ai-2", description: "Pair on the deploy script" },
      ],
    });

    const result = await getOpenActionItemsForTopic("topic-1");

    // The query itself (asserted below) joins across every session_topics
    // row for the topic, regardless of which session each belongs to — the
    // mocked rows above stand in for items from two distinct sessions.
    expect(result).toEqual([
      { actionItemId: "ai-1", description: "Follow up on flaky test" },
      { actionItemId: "ai-2", description: "Pair on the deploy script" },
    ]);
  });

  it("excludes an action item whose status is not 'open' (e.g. resolved)", async () => {
    // The SQL itself filters on ai.status = 'open'; a resolved item is
    // never in the mocked result set a real query would return.
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "ai-1", description: "Still open" }] });

    const result = await getOpenActionItemsForTopic("topic-1");

    expect(result).toEqual([{ actionItemId: "ai-1", description: "Still open" }]);

    const [sql] = mockDbQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ai.status = 'open'");
  });

  it("joins through session_topics on topic_id, scoped to the requested topic", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await getOpenActionItemsForTopic("topic-42");

    const [sql, params] = mockDbQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("JOIN session_topics st ON st.id = ai.session_topic_id");
    expect(sql).toContain("st.topic_id = $1");
    expect(params).toEqual(["topic-42"]);
  });

  it("runs on a caller-supplied executor (e.g. a transaction client) when one is provided", async () => {
    const mockClientQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query: mockClientQuery };

    await getOpenActionItemsForTopic("topic-1", client);

    expect(mockClientQuery).toHaveBeenCalledTimes(1);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });
});
