import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// topic-add-form-and-empty-state task 1.4 (design.md Decision 1; security
// review S1, REQUIRED).
//
// Spec scenario "The flag agrees with the add endpoint's authorization for
// every caller class": TOPIC-002's `canAddTopics` and TOPIC-003's 403 checks
// are computed by two different helpers
// (checkStandingFacilitatorOrAdminAuthorization vs.
// checkStandingFacilitatorAuthorization) that agree today only by
// coincidence. This table-driven test is the control that keeps them in
// step: for each caller class it calls both routers against the same
// unlocked team and asserts `canAddTopics === (POST status !== 403)` for
// callers TOPIC-002 admits, and POST 403 for callers it rejects.
//
// The relational check alone could pass vacuously (implementation review:
// architect S2 / security SF-1): if the shared authorization query's text
// stopped matching `fakeQuery`, every caller would be denied on both sides
// and every row would still agree. So each row also carries an explicit
// `expected` outcome (GET status, canAddTopics, POST status), and the
// baseline non-member facilitator row must reach GET 200 / true / POST 201.
//
// A #176 fix (letting application administrators add topics) MUST keep this
// test green: flip both sides in the same change, then update the
// `expected` field of the application_admin rows in CALLER_CLASSES below.
//
// The database is a SQL-routing fake rather than ordered mocks, so both
// routes run their real authorization code against the same caller row.
// Each successful POST row "creates" a topic on the shared test team; that
// is harmless here, and every row uses a distinct name so a later
// uniqueness rule cannot fail this test for an unclear reason. (No live
// Postgres is required; see implementation-notes.md.)
// ---------------------------------------------------------------------------

type Caller = { globalRole: string; isMember: boolean };
// null = no users row exists for the session's userId.
let currentCaller: Caller | null = { globalRole: "facilitator", isMember: false };

function fakeQuery(sql: string): Promise<{ rows: unknown[] }> {
  if (sql.includes("FROM users u") && sql.includes("team_memberships")) {
    if (currentCaller === null) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [{ global_role: currentCaller.globalRole, is_member: currentCaller.isMember }] });
  }
  if (sql.includes("COUNT(*) AS count FROM sessions")) {
    // One completed session: the team is unlocked.
    return Promise.resolve({ rows: [{ count: "1" }] });
  }
  if (sql.includes("SELECT id FROM teams")) {
    return Promise.resolve({ rows: [{ id: "team-1" }] });
  }
  if (sql.includes("FROM teams")) {
    return Promise.resolve({ rows: [{ name: "Platform Squad" }] });
  }
  return Promise.resolve({ rows: [] });
}

const mockDbQuery = vi.fn((sql: unknown) => fakeQuery(String(sql)));
const mockDbConnect = vi.fn(() =>
  Promise.resolve({
    query: vi.fn((sql: unknown) => {
      const text = String(sql);
      if (text.includes("next_display_order")) return Promise.resolve({ rows: [{ next_display_order: 3 }] });
      if (text.includes("INSERT INTO topics")) {
        return Promise.resolve({ rows: [{ id: "topic-new", created_at: new Date("2026-10-01T00:00:00.000Z") }] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  }),
);

vi.mock("../../db.js", () => ({
  db: {
    query: (sql: unknown) => mockDbQuery(sql),
    connect: () => mockDbConnect(),
  },
}));
vi.mock("../../auth/audit-logger.js", () => ({ emitAuditEvent: vi.fn() }));
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: vi.fn().mockResolvedValue(undefined),
  CONTENT_TIMING_FLOOR_MS: 150,
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

import Fastify from "fastify";
import { contentRoutes } from "../content.js";
import { topicRoutes } from "../topics.js";
import type { GetAllTopicsResponse } from "@dipstick/shared";

async function buildApp() {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId: "actor-1" };
  });
  app.register(contentRoutes);
  app.register(topicRoutes);
  await app.ready();
  return app;
}

type Expected = { get: 200; canAddTopics: boolean; post: 201 | 403 } | { get: 403; post: 403 };

const ADMITTED_CAN_ADD: Expected = { get: 200, canAddTopics: true, post: 201 };
// Pending #176: admins see the screen but cannot add. Flip to ADMITTED_CAN_ADD
// in the same change that widens TOPIC-003.
const ADMITTED_CANNOT_ADD: Expected = { get: 200, canAddTopics: false, post: 403 };
const REJECTED: Expected = { get: 403, post: 403 };

const CALLER_CLASSES: Array<{ label: string; caller: Caller | null; expected: Expected }> = [
  { label: "non-member standing facilitator", caller: { globalRole: "facilitator", isMember: false }, expected: ADMITTED_CAN_ADD },
  { label: "facilitator who is a member of the team", caller: { globalRole: "facilitator", isMember: true }, expected: REJECTED },
  { label: "application_admin", caller: { globalRole: "application_admin", isMember: false }, expected: ADMITTED_CANNOT_ADD },
  {
    label: "application_admin who is a member of the team",
    caller: { globalRole: "application_admin", isMember: true },
    expected: ADMITTED_CANNOT_ADD,
  },
  { label: "engineer", caller: { globalRole: "engineer", isMember: true }, expected: REJECTED },
  { label: "engineering manager", caller: { globalRole: "engineering_manager", isMember: true }, expected: REJECTED },
  { label: "no user row for the session's userId", caller: null, expected: REJECTED },
];

describe("canAddTopics agrees with TOPIC-003's authorization for every caller class (security review S1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the table includes a class that can add (guards against an all-deny table)", () => {
    expect(CALLER_CLASSES.some((row) => row.expected.post === 201)).toBe(true);
  });

  it.each(CALLER_CLASSES.map((row, index) => ({ ...row, index })))(
    "$label",
    async ({ caller, expected, index }) => {
      currentCaller = caller;
      const app = await buildApp();

      const list = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics/all" });
      const post = await app.inject({
        method: "POST",
        url: "/api/v1/teams/team-1/topics",
        payload: { name: `Parity topic ${index}`, prompt: "A valid prompt?", voteType: "finger" },
      });

      // Every POST is either created or forbidden; nothing else (404, 409,
      // 422) may hide a disagreement.
      expect([201, 403]).toContain(post.statusCode);

      // Anchor: explicit per-class outcomes, so a fake that silently denies
      // everyone on both sides cannot pass (architect S2 / security SF-1).
      expect(list.statusCode).toBe(expected.get);
      expect(post.statusCode).toBe(expected.post);
      if (expected.get === 200) {
        expect((list.json() as GetAllTopicsResponse).canAddTopics).toBe(expected.canAddTopics);
      }

      if (list.statusCode === 200) {
        const body = list.json() as GetAllTopicsResponse;
        expect(body.isCustomizationLocked).toBe(false);
        expect(body.canAddTopics).toBe(post.statusCode !== 403);
      } else {
        expect(list.statusCode).toBe(403);
        expect(post.statusCode).toBe(403);
      }
    },
  );
});
