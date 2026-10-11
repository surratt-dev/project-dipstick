import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// topic-add-form-and-empty-state task 1.4 (design.md Decision 1; security
// review S1, REQUIRED).
//
// Spec scenario "The flag agrees with the add endpoint's authorization for
// every caller class": TOPIC-002's `canAddTopics` and TOPIC-003's 403 checks
// both decide through checkStandingFacilitatorOrAdminAuthorization, but
// TOPIC-002 then derives the flag from an explicit role expression in
// content.ts, while TOPIC-003 answers through its own wrapper
// (checkAddCustomTopicAuthorization in topics.ts). This table-driven test is
// the control that keeps content.ts's expression in step with that wrapper:
// for each caller class it calls both routers against the same unlocked team
// and asserts `canAddTopics === (POST status !== 403)` for callers TOPIC-002
// admits, and POST 403 for callers it rejects.
//
// The relational check alone could pass vacuously (implementation review:
// architect S2 / security SF-1): if the shared authorization query's text
// stopped matching `fakeQuery`, every caller would be denied on both sides
// and every row would still agree. So each row also carries an explicit
// `expected` outcome (GET status, canAddTopics, POST status), and the
// baseline non-member facilitator row must reach GET 200 / true / POST 201.
//
// The database is a SQL-routing fake rather than ordered mocks, so both
// routes run their real authorization code against the same caller row.
// Each successful POST row "creates" a topic on the shared test team; that
// is harmless here, and every row uses a distinct name so a later
// uniqueness rule cannot fail this test for an unclear reason. (No live
// Postgres is required; see implementation-notes.md.)
// ---------------------------------------------------------------------------

// #232 task 2.4a (design.md D6): `membershipRole` is the caller's live active
// membership role on the team, served to readActiveMembershipRole (TOPIC-002's
// administrator arm). null = no active membership. Every application_admin
// row asserts that the fake actually served this value (servedMembershipRoles
// below), so a mis-routed membership query cannot pass as a null membership.
type Caller = { globalRole: string; isMember: boolean; membershipRole?: string | null };
// null = no users row exists for the session's userId.
let currentCaller: Caller | null = { globalRole: "facilitator", isMember: false };
// Membership roles the fake served to readActiveMembershipRole, per request.
let servedMembershipRoles: Array<string | null> = [];

function fakeQuery(sql: string): Promise<{ rows: unknown[] }> {
  // readActiveMembershipRole -- matched before any broader team_memberships rule.
  if (sql.includes("SELECT role FROM team_memberships")) {
    const role = currentCaller?.membershipRole ?? null;
    servedMembershipRoles.push(role);
    return Promise.resolve({ rows: role === null ? [] : [{ role }] });
  }
  // TOPIC-002's role-set read (`FROM users WHERE id`), kept apart from the
  // shared helper's `FROM users u`. One row; with no users row the request
  // never gets this far (the helper denies first).
  if (sql.includes("roles::text[] AS roles FROM users WHERE id")) {
    return Promise.resolve({ rows: currentCaller === null ? [] : [{ roles: [currentCaller.globalRole] }] });
  }
  // TOPIC-002's admin audit insert (admin.topic_config_accessed).
  if (sql.includes("INSERT INTO audit_log")) {
    return Promise.resolve({ rows: [] });
  }
  if (sql.includes("FROM users u") && sql.includes("team_memberships")) {
    if (currentCaller === null) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [{ global_role: currentCaller.globalRole, is_member: currentCaller.isMember }] });
  }
  if (sql.includes("COUNT(*) AS count FROM sessions")) {
    // One completed session: the team is unlocked.
    return Promise.resolve({ rows: [{ count: "1" }] });
  }
  if (sql.includes("SELECT id FROM teams")) {
    return Promise.resolve({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] });
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

// #208 (reverses #232's no-manager rule): TOPIC-002 and TOPIC-003 agree for
// every caller class, with no exception.
type Expected = { get: 200; canAddTopics: boolean; post: 201 | 403 } | { get: 403; post: 403 };

const ADMITTED_CAN_ADD: Expected = { get: 200, canAddTopics: true, post: 201 };
const REJECTED: Expected = { get: 403, post: 403 };

const CALLER_CLASSES: Array<{ label: string; caller: Caller | null; expected: Expected }> = [
  { label: "non-member standing facilitator", caller: { globalRole: "facilitator", isMember: false }, expected: ADMITTED_CAN_ADD },
  { label: "facilitator who is a member of the team", caller: { globalRole: "facilitator", isMember: true }, expected: REJECTED },
  { label: "application_admin", caller: { globalRole: "application_admin", isMember: false }, expected: ADMITTED_CAN_ADD },
  {
    label: "application_admin who is a member of the team",
    // #232 2.4a: pinned to a participant membership.
    caller: { globalRole: "application_admin", isMember: true, membershipRole: "participant" },
    expected: ADMITTED_CAN_ADD,
  },
  {
    label: "application_admin with an engineering_manager membership",
    // #208 decision: an administrator is admitted to TOPIC-002..006 whatever
    // their membership on the team, in any role.
    caller: { globalRole: "application_admin", isMember: true, membershipRole: "engineering_manager" },
    expected: ADMITTED_CAN_ADD,
  },
  { label: "engineer", caller: { globalRole: "engineer", isMember: true }, expected: REJECTED },
  { label: "engineering manager", caller: { globalRole: "engineering_manager", isMember: true }, expected: REJECTED },
  {
    label: "global engineering manager with a participant membership",
    caller: { globalRole: "engineering_manager", isMember: true, membershipRole: "participant" },
    expected: REJECTED,
  },
  {
    label: "global engineering manager with an engineering_manager membership",
    caller: { globalRole: "engineering_manager", isMember: true, membershipRole: "engineering_manager" },
    expected: REJECTED,
  },
  { label: "no user row for the session's userId", caller: null, expected: REJECTED },
];

describe("canAddTopics agrees with TOPIC-003's authorization for every caller class (security review S1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    servedMembershipRoles = [];
  });

  it("the table includes a class that can add (guards against an all-deny table)", () => {
    expect(CALLER_CLASSES.some((row) => row.expected.post === 201)).toBe(true);
  });

  it.each(CALLER_CLASSES.map((row, index) => ({ ...row, index })))(
    "$label",
    async ({ caller, expected, index }) => {
      currentCaller = caller;
      const app = await buildApp();

      const list = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/all" });

      // #232 2.4a (design.md D6): the fake must prove what it served. Every
      // application_admin row's GET read exactly the configured membership
      // role; any other caller's GET performed no membership-role read.
      if (caller?.globalRole === "application_admin") {
        expect(servedMembershipRoles).toEqual([caller.membershipRole ?? null]);
      } else {
        expect(servedMembershipRoles).toEqual([]);
      }
      const post = await app.inject({
        method: "POST",
        url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
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
