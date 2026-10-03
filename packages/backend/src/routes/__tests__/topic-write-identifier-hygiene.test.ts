import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as DefaultTopics from "../../sessions/default-topics.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) — identifier hygiene on topic writes.
//
//   3.2 The template guard is case-insensitive by construction (Decision 9):
//       with the template sentinel swapped for an id that HAS hex letters, an
//       UPPERCASE spelling of it is still answered 404 TEAM_NOT_FOUND with a
//       topic.write_denied_template row, on every topic-write route. The real
//       DEFAULT_TOPICS_TEAM_ID is pinned as lowercase canonical (security F-d).
//   3.5 A malformed topicId on archive, restore and annotation is 404
//       TOPIC_NOT_FOUND at the topic-existence step, with no `topics` query
//       and never a 5xx (Decision 10).
// ---------------------------------------------------------------------------

const { HEX_SENTINEL } = vi.hoisted(() => ({ HEX_SENTINEL: "abcdef00-0000-4000-8000-0000000000ab" }));

const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: () => mockDbConnect(),
  },
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
const mockApplyTimingFloor = vi.fn().mockResolvedValue(undefined);
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: (...args: unknown[]) => mockApplyTimingFloor(...args),
  CONTENT_TIMING_FLOOR_MS: 150,
}));
// #184 5.4a: the topic-write rate limiter is replaced by the shared "allowed"
// stand-in (helpers/topic-write-rate-limit-mock.ts); see that file for why.
vi.mock("../topic-write-rate-limit.js", () => import("./helpers/topic-write-rate-limit-mock.js"));
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
// 3.2: swap the sentinel for an id with hex letters. Every other export of
// the module is the real one.
vi.mock("../../sessions/default-topics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DefaultTopics>()),
  DEFAULT_TOPICS_TEAM_ID: HEX_SENTINEL,
}));

import Fastify from "fastify";
import { topicRoutes } from "../topics.js";

async function buildApp(userId = "facilitator-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(topicRoutes);
  await app.ready();
  return app;
}

const TOPIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "11111111-1111-4111-8111-111111111111";

function mockAuthQuery(globalRole: string, isMember: boolean) {
  mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: globalRole, is_member: isMember }] });
}

function topicsQueries() {
  return mockDbQuery.mock.calls.filter((c) => typeof c[0] === "string" && /\bFROM topics\b/i.test(c[0] as string));
}

describe("#184 3.2: DEFAULT_TOPICS_TEAM_ID is lowercase canonical", () => {
  it("the real constant equals its own lowercase form and is a canonical UUID", async () => {
    const actual = await vi.importActual<typeof DefaultTopics>(
      "../../sessions/default-topics.js",
    );
    const { isCanonicalUuid } = await import("../uuid.js");
    expect(actual.DEFAULT_TOPICS_TEAM_ID).toBe(actual.DEFAULT_TOPICS_TEAM_ID.toLowerCase());
    expect(isCanonicalUuid(actual.DEFAULT_TOPICS_TEAM_ID)).toBe(true);
  });
});

describe("#184 3.2: the template guard rejects an UPPERCASE spelling of a hex-letter sentinel", () => {
  beforeEach(() => vi.clearAllMocks());

  const upper = HEX_SENTINEL.toUpperCase();
  const routes = [
    ["TOPIC-003 add", "POST", `/api/v1/teams/${upper}/topics`, { name: "X", prompt: "Y?", voteType: "finger" }],
    ["TOPIC-004 archive", "DELETE", `/api/v1/teams/${upper}/topics/${TOPIC}?confirm=true`, undefined],
    ["TOPIC-005 restore", "POST", `/api/v1/teams/${upper}/topics/${TOPIC}/restore`, {}],
    ["TOPIC-006 reorder", "PUT", `/api/v1/teams/${upper}/topics/order`, { orderedTopicIds: [TOPIC] }],
    ["TOPIC-007 annotation", "PUT", `/api/v1/teams/${upper}/topics/${TOPIC}/annotation`, { annotation: "x" }],
  ] as const;

  it("the swapped sentinel really has hex letters (otherwise this test proves nothing)", () => {
    expect(upper).not.toBe(HEX_SENTINEL);
  });

  for (const [label, method, url, payload] of routes) {
    it(`${label}: 404 TEAM_NOT_FOUND and one topic.write_denied_template row`, async () => {
      mockAuthQuery("facilitator", false);
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: HEX_SENTINEL }] }); // team exists
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // template-denial audit insert

      const app = await buildApp();
      const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND" });

      // Every query after the canonical check used the lowercase spelling.
      for (const call of mockDbQuery.mock.calls) {
        expect(JSON.stringify(call[1] ?? [])).not.toContain(upper);
      }
      const audits = mockDbQuery.mock.calls.filter(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO audit_log"),
      );
      expect(audits).toHaveLength(1);
      const params = audits[0]![1] as unknown[];
      expect(params[3]).toBe("topic.write_denied_template");
      expect(params[4]).toBe(HEX_SENTINEL);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });
  }
});

describe("#184 3.5: a malformed topicId is 404 TOPIC_NOT_FOUND with no topics query", () => {
  beforeEach(() => vi.clearAllMocks());

  const spellings = [
    ["hyphenless", "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa"],
    ["braced", "{aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa}"],
    ["not-a-uuid", "not-a-uuid"],
    ["%20", " "],
  ] as const;
  const routes = [
    ["archive", "DELETE", (t: string) => `/api/v1/teams/${TEAM}/topics/${t}?confirm=true`, undefined],
    ["restore", "POST", (t: string) => `/api/v1/teams/${TEAM}/topics/${t}/restore`, {}],
    ["annotation", "PUT", (t: string) => `/api/v1/teams/${TEAM}/topics/${t}/annotation`, { annotation: "x" }],
  ] as const;

  for (const [routeLabel, method, url, payload] of routes) {
    it.each(spellings)(`${routeLabel}: a %s topicId`, async (_label, bad) => {
      mockAuthQuery("facilitator", false);
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: TEAM }] }); // team exists
      mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] }); // unlocked
      // Anything further would be a topics query; fail loudly if it happens.
      mockDbQuery.mockImplementation(() => Promise.reject(new Error("unexpected query")));

      const app = await buildApp();
      const res = await app.inject({
        method,
        url: url(encodeURIComponent(bad)),
        ...(payload === undefined ? {} : { payload }),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({ category: "not_found", code: "TOPIC_NOT_FOUND", message: "Topic not found." });
      expect(topicsQueries()).toHaveLength(0);
      expect(mockDbQuery).toHaveBeenCalledTimes(3);
      expect(mockDbConnect).not.toHaveBeenCalled();
      expect(mockApplyTimingFloor).toHaveBeenCalled();
      mockDbQuery.mockReset();
    });
  }
});
