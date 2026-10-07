import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance, HTTPMethods, LightMyRequestResponse, RouteOptions } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildFullApp,
  buildUnauthenticatedFullApp,
  Fixture,
  SENTINEL_TEAM_ID,
} from "./helpers/real-db.js";
import type { Mods, Db } from "./helpers/real-db.js";
import { templateDenialDedupeKey } from "../../teams/template-team-guard.js";

// ---------------------------------------------------------------------------
// Structural template-guard test — template-team-not-usable (#214),
// design.md D8, tasks.md 5.1/5.2 (specs/default-topic-provisioning "The
// template guard covers every team-addressed session, membership and
// join-link route" and "The structural template test asserts each route's
// response, audit and row state, and proves it can fail").
//
// Enumerates EVERY registered route (onRoute over the same registerRoutes()
// buildApp() uses) and selects, in any method, each route under
// /api(/vN)?/teams/:param/(sessions|members|managers|join-links), plus
// EXTRA_IN_SCOPE_ROUTES. There is no exemption list: a selected route without
// a ROUTE_TABLE entry fails, by name. Fastify's automatic HEAD route for a GET
// is covered by that GET's entry; any other HEAD route needs its own.
//
// Each entry names its actor, request, parity response, floor (recorded as
// data, never measured) and evidence. "audit" routes must write exactly one
// team.template_access_denied row per request; only the closed
// REFUSED_BEFORE_GUARD set may show no audit evidence (asserted by equality).
// Every request is checked for: the expected status, parity with the same
// request for a team that does not exist, never 500, no body containing
// _not_template_team, and no new template row in sessions, team_memberships
// or join_links.
//
// The checker returns failure messages instead of asserting, so the probe
// self-test (5.1) can show that an unguarded route under the prefix fails
// it: both with no table entry and with one (the constraint answers a
// sanitized 500, not the expected 404).
//
// REQUIRE_DB: this file is what enforces the guard on future routes, so it
// must fail, not skip, in the integration.yml lane.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "team-template-guard-structural.test.ts");

const TEAM_SCOPED_PREFIX = /^\/api(\/v\d+)?\/teams\/:[^/]+\/(sessions|members|managers|join-links)(\/|$)/;

// Routes outside the prefix that can make the template a membership subject.
const EXTRA_IN_SCOPE_ROUTES: readonly string[] = ["GET /api/join/:token", "GET /auth/callback"];

// design.md D8 (engineering B4): the ONLY entries allowed to show no audit
// evidence. The two content reads are closed by evaluateTeamAccess, not a
// route-level guard; the two redemption routes cannot reach the guard with a
// real template link on CI (the validated constraint refuses the seed), so
// their guard is unit-tested with a stubbed lookup (join-links.test.ts,
// auth.test.ts).
const REFUSED_BEFORE_GUARD: readonly string[] = [
  "GET /api/v1/teams/:teamId/sessions",
  "GET /api/v1/teams/:teamId/sessions/:sessionId",
  "GET /api/join/:token",
  "GET /auth/callback",
];

// Architect implementation review A1: the two per-entry flags that drop
// assertions are closed the same way. Only draft rejects a non-canonical
// teamId at its boundary before the guard, and only draft refuses an admin
// before the guard (facilitator-only). Asserted by equality below.
const BOUNDARY_REJECTS_NON_CANONICAL: readonly string[] = ["POST /api/v1/teams/:teamId/sessions/draft"];
const ADMIN_REFUSED_BEFORE_GUARD: readonly string[] = ["POST /api/v1/teams/:teamId/sessions/draft"];

const OTHER_PARAM_VALUE = "ffffffff-ffff-4fff-bfff-ffffffffffff";

type Actor = "facilitator" | "application_admin" | "engineer";

interface RouteEntry {
  actor: Actor;
  request: (teamId: string) => { method: HTTPMethods; url: string; payload?: object };
  status: number;
  /** A property of the body the parity response must have (beyond matching the missing-team response). */
  body: (body: Record<string, unknown>) => boolean;
  evidence: "audit" | "refused-before-guard";
  /** Timing floor on this route's template answer: data only, nothing measures it. */
  floor: "none" | "existing content floor";
  /**
   * The route rejects a non-canonical teamId at its boundary, before the
   * guard (today only draft): non-canonical spellings get the same parity
   * response but no audit row, as #188's topic routes do.
   */
  boundaryRejectsNonCanonical?: boolean;
  /** An admin fails this route's authorization before the guard (draft is facilitator-only). */
  adminRefusedBeforeGuard?: { status: number };
}

const errorCode = (code: string) => (b: Record<string, unknown>) => (b["error"] as { code?: string })?.code === code;
const errorMessage = (message: string) => (b: Record<string, unknown>) =>
  (b["error"] as { message?: string })?.message === message;
const sessionPath = (t: string, tail: string) => `/api/v1/teams/${t}/sessions/${OTHER_PARAM_VALUE}/${tail}`;

const ROUTE_TABLE: Record<string, RouteEntry> = {
  "POST /api/v1/teams/:teamId/sessions/draft": {
    actor: "facilitator",
    request: (t) => ({ method: "POST", url: `/api/v1/teams/${t}/sessions/draft`, payload: {} }),
    status: 404,
    body: errorCode("TEAM_NOT_FOUND"),
    evidence: "audit",
    floor: "none",
    boundaryRejectsNonCanonical: true,
    adminRefusedBeforeGuard: { status: 403 },
  },
  "POST /api/v1/teams/:teamId/sessions/:sessionId/advance": {
    actor: "engineer",
    request: (t) => ({ method: "POST", url: sessionPath(t, "advance"), payload: {} }),
    status: 404,
    body: errorMessage("Session not found."),
    evidence: "audit",
    floor: "none",
  },
  "POST /api/v1/teams/:teamId/sessions/:sessionId/reveal": {
    actor: "engineer",
    request: (t) => ({ method: "POST", url: sessionPath(t, "reveal"), payload: {} }),
    // reveal's answer for a session it cannot find for the team.
    status: 409,
    body: (b) => b["errorState"] === "reveal_failure" && b["recoverable"] === false,
    evidence: "audit",
    floor: "none",
  },
  "POST /api/v1/teams/:teamId/sessions/:sessionId/complete": {
    actor: "engineer",
    request: (t) => ({ method: "POST", url: sessionPath(t, "complete"), payload: {} }),
    status: 404,
    body: errorMessage("Session not found."),
    evidence: "audit",
    floor: "none",
  },
  "POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance": {
    actor: "engineer",
    request: (t) => ({ method: "POST", url: sessionPath(t, "topics/advance"), payload: {} }),
    status: 404,
    body: errorMessage("Session not found."),
    evidence: "audit",
    floor: "none",
  },
  "GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state": {
    actor: "engineer",
    request: (t) => ({ method: "GET", url: sessionPath(t, "facilitator-state") }),
    status: 404,
    body: errorMessage("Session not found."),
    evidence: "audit",
    floor: "none",
  },
  "GET /api/v1/teams/:teamId/sessions": {
    actor: "facilitator",
    request: (t) => ({ method: "GET", url: `/api/v1/teams/${t}/sessions` }),
    status: 403,
    body: (b) => typeof b["error"] === "object",
    evidence: "refused-before-guard",
    floor: "existing content floor",
  },
  "GET /api/v1/teams/:teamId/sessions/:sessionId": {
    actor: "facilitator",
    request: (t) => ({ method: "GET", url: `/api/v1/teams/${t}/sessions/${OTHER_PARAM_VALUE}` }),
    status: 403,
    body: (b) => typeof b["error"] === "object",
    evidence: "refused-before-guard",
    floor: "existing content floor",
  },
  "GET /api/v1/teams/:teamId/members": {
    actor: "application_admin",
    request: (t) => ({ method: "GET", url: `/api/v1/teams/${t}/members` }),
    status: 404,
    body: errorCode("TEAM_NOT_FOUND"),
    evidence: "audit",
    floor: "none",
  },
  "PATCH /api/v1/teams/:teamId/members/:userId/role": {
    actor: "application_admin",
    request: (t) => ({
      method: "PATCH",
      url: `/api/v1/teams/${t}/members/${OTHER_PARAM_VALUE}/role`,
      payload: { role: "participant" },
    }),
    status: 404,
    body: errorMessage("User is not an active member of this team."),
    evidence: "audit",
    floor: "none",
  },
  "POST /api/v1/teams/:teamId/managers": {
    actor: "application_admin",
    request: (t) => ({
      method: "POST",
      url: `/api/v1/teams/${t}/managers`,
      payload: { engineeringManagerUserId: OTHER_PARAM_VALUE },
    }),
    status: 404,
    body: errorCode("TEAM_NOT_FOUND"),
    evidence: "audit",
    floor: "none",
  },
  "POST /api/teams/:teamId/join-links": {
    actor: "engineer",
    request: (t) => ({ method: "POST", url: `/api/teams/${t}/join-links` }),
    status: 403,
    body: errorMessage("You are not a member of this team."),
    evidence: "audit",
    floor: "none",
  },
  "GET /api/join/:token": {
    actor: "engineer",
    // An unknown token: no real template link can exist on CI (see above).
    request: () => ({ method: "GET", url: `/api/join/structural-unknown-${OTHER_PARAM_VALUE}` }),
    status: 302,
    body: () => true,
    evidence: "refused-before-guard",
    floor: "none",
  },
  "GET /auth/callback": {
    actor: "engineer",
    request: () => ({ method: "GET", url: `/auth/callback?state=structural-unknown-${OTHER_PARAM_VALUE}&code=x` }),
    status: 302,
    body: () => true,
    evidence: "refused-before-guard",
    floor: "none",
  },
};

const SPELLINGS: ReadonlyArray<{ label: string; value: string; canonical: boolean }> = [
  { label: "canonical", value: SENTINEL_TEAM_ID, canonical: true },
  { label: "no-hyphen", value: SENTINEL_TEAM_ID.replace(/-/g, ""), canonical: false },
  { label: "braced", value: encodeURIComponent(`{${SENTINEL_TEAM_ID}}`), canonical: false },
];

function methodsOf(route: RouteOptions): string[] {
  return (Array.isArray(route.method) ? route.method : [route.method]).map((m) => String(m).toUpperCase());
}

/** "METHOD /url" for every in-scope route (an automatic HEAD folds into its GET). */
function selectRoutes(routes: RouteOptions[]): string[] {
  const all = new Set(routes.flatMap((r) => methodsOf(r).map((m) => `${m} ${r.url}`)));
  const selected = new Set<string>();
  for (const key of all) {
    const [method, url] = key.split(" ") as [string, string];
    if (!TEAM_SCOPED_PREFIX.test(url) && !EXTRA_IN_SCOPE_ROUTES.includes(key)) continue;
    if (method === "HEAD" && all.has(`GET ${url}`)) continue;
    selected.add(key);
  }
  return [...selected].sort();
}

/** One failure message per selected route that has no table entry. */
function missingEntries(selected: string[], table: Record<string, RouteEntry>): string[] {
  return selected.filter((key) => !table[key]).map((key) => `${key}: selected route has no ROUTE_TABLE entry`);
}

/** Status and body (or redirect target), without correlationId and with any echoed teamId replaced. */
function comparable(res: LightMyRequestResponse) {
  if (res.statusCode >= 300 && res.statusCode < 400) {
    return { status: res.statusCode, location: String(res.headers.location ?? "").replace(/correlationId=[^&]+/, "") };
  }
  let body: Record<string, unknown>;
  try {
    body = res.json() as Record<string, unknown>;
  } catch {
    return { status: res.statusCode, raw: res.body };
  }
  const copy: Record<string, unknown> = { ...body };
  if (copy["error"] && typeof copy["error"] === "object") {
    const error = { ...(copy["error"] as Record<string, unknown>) };
    delete error["correlationId"];
    copy["error"] = error;
  }
  if ("teamId" in copy) copy["teamId"] = "<teamId>";
  return { status: res.statusCode, body: copy };
}

async function templateRowCounts(db: Db): Promise<string> {
  const res = await db.query(
    `SELECT (SELECT count(*)::int FROM sessions WHERE team_id = $1) AS sessions,
            (SELECT count(*)::int FROM team_memberships WHERE team_id = $1) AS memberships,
            (SELECT count(*)::int FROM join_links WHERE team_id = $1) AS links`,
    [SENTINEL_TEAM_ID],
  );
  return JSON.stringify(res.rows[0]);
}

interface CheckContext {
  mods: Mods;
  actorIds: Record<Actor, string>;
  apps: Record<Actor, FastifyInstance>;
  bodies: string[];
}

/**
 * Sends one template request and returns every way it falls short of the
 * entry, as messages. Empty means the route passed.
 */
async function checkRequest(
  ctx: CheckContext,
  key: string,
  entry: RouteEntry,
  actor: Actor,
  spelling: (typeof SPELLINGS)[number],
  expectation: { status: number; parity: boolean; auditRows: number },
): Promise<string[]> {
  const failures: string[] = [];
  const { db, redis } = ctx.mods;
  const app = ctx.apps[actor];
  const actorId = ctx.actorIds[actor];
  const label = `${key} [${actor}, ${spelling.label}]`;

  await redis.del(templateDenialDedupeKey(actorId, key));
  const rowsBefore = await templateRowCounts(db);
  const start = (await db.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;

  const res = await app.inject(entry.request(spelling.value));
  ctx.bodies.push(res.body);

  if (res.statusCode === 500) failures.push(`${label}: answered 500`);
  if (res.statusCode !== expectation.status) {
    failures.push(`${label}: expected ${expectation.status}, got ${res.statusCode}`);
  }
  if (res.body.includes("_not_template_team")) failures.push(`${label}: body names the constraint`);
  if (expectation.parity) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = res.json() as Record<string, unknown>;
    } catch {
      // redirects carry no body
    }
    if (!(res.statusCode >= 300 && res.statusCode < 400) && !entry.body(parsed)) {
      failures.push(`${label}: body is not the route's parity body: ${res.body.slice(0, 200)}`);
    }
    const missing = await app.inject(entry.request(randomUUID()));
    if (JSON.stringify(comparable(res)) !== JSON.stringify(comparable(missing))) {
      failures.push(
        `${label}: differs from the missing-team response: ${JSON.stringify(comparable(res))} vs ${JSON.stringify(comparable(missing))}`,
      );
    }
  }

  const audit = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_log
      WHERE operation = 'team.template_access_denied'
        AND actor_user_id = $1 AND "timestamp" >= $2 AND metadata->>'endpoint' = $3`,
    [actorId, start, key],
  );
  if (audit.rows[0]!.n !== expectation.auditRows) {
    failures.push(`${label}: expected ${expectation.auditRows} template denial row(s), found ${audit.rows[0]!.n}`);
  }
  if ((await templateRowCounts(db)) !== rowsBefore) failures.push(`${label}: a template row was created`);
  return failures;
}

/** Every request the table prescribes for one route, for its own actor. */
async function checkRoute(ctx: CheckContext, key: string, entry: RouteEntry): Promise<string[]> {
  const failures: string[] = [];
  if (entry.evidence === "refused-before-guard") {
    failures.push(
      ...(await checkRequest(ctx, key, entry, entry.actor, SPELLINGS[0]!, { status: entry.status, parity: true, auditRows: 0 })),
    );
    return failures;
  }
  for (const spelling of SPELLINGS) {
    const boundary = !spelling.canonical && entry.boundaryRejectsNonCanonical;
    failures.push(
      ...(await checkRequest(ctx, key, entry, entry.actor, spelling, {
        status: entry.status,
        parity: true,
        auditRows: boundary ? 0 : 1,
      })),
    );
  }
  return failures;
}

describe.skipIf(!infraUp)("structural: every team-scoped session, membership and join-link route refuses the template (#214)", () => {
  let mods: Mods;
  let fx: Fixture;
  let ctx: CheckContext;
  let unauthenticated: FastifyInstance;
  let rowsAtStart: string;
  const routes: RouteOptions[] = [];
  const extraApps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
    rowsAtStart = await templateRowCounts(mods.db);
    const actorIds = {
      facilitator: await fx.user("facilitator"),
      application_admin: await fx.user("application_admin"),
      engineer: await fx.user("engineer"),
    } as Record<Actor, string>;
    const apps = {
      facilitator: await buildFullApp(mods, actorIds.facilitator, (route) => routes.push(route)),
      application_admin: await buildFullApp(mods, actorIds.application_admin),
      engineer: await buildFullApp(mods, actorIds.engineer),
    } as Record<Actor, FastifyInstance>;
    ctx = { mods, actorIds, apps, bodies: [] };
    unauthenticated = await buildUnauthenticatedFullApp(mods);
  });

  afterAll(async () => {
    try {
      // "No template rows remain after the suite" and "No response leaks the
      // constraint name".
      if (mods) {
        expect(await templateRowCounts(mods.db)).toBe(rowsAtStart);
        for (const body of ctx.bodies) expect(body).not.toContain("_not_template_team");
      }
    } finally {
      for (const app of [...Object.values(ctx?.apps ?? {}), unauthenticated, ...extraApps]) await app?.close();
      if (ctx) {
        await mods.redis.del(
          `dipstick:ratelimit:team-manager:burst:${ctx.actorIds.application_admin}`,
          `dipstick:ratelimit:team-manager:daily:${ctx.actorIds.application_admin}`,
        );
      }
      await fx?.cleanup();
      await mods?.redis.quit();
    }
  });

  it("selects every route found in exploration §3 plus the two content.ts reads and the redemption routes, and each has a table entry", () => {
    const selected = selectRoutes(routes);
    expect(selected).toEqual(Object.keys(ROUTE_TABLE).sort());
    expect(missingEntries(selected, ROUTE_TABLE)).toEqual([]);
  });

  it("only the closed set of routes is marked refused-before-guard (asserted by equality)", () => {
    const marked = Object.entries(ROUTE_TABLE)
      .filter(([, entry]) => entry.evidence === "refused-before-guard")
      .map(([key]) => key)
      .sort();
    expect(marked).toEqual([...REFUSED_BEFORE_GUARD].sort());
  });

  it("only the closed sets of routes carry boundaryRejectsNonCanonical and adminRefusedBeforeGuard (asserted by equality)", () => {
    const flagged = (pick: (entry: RouteEntry) => unknown) =>
      Object.entries(ROUTE_TABLE)
        .filter(([, entry]) => pick(entry) !== undefined && pick(entry) !== false)
        .map(([key]) => key)
        .sort();
    expect(flagged((e) => e.boundaryRejectsNonCanonical)).toEqual([...BOUNDARY_REJECTS_NON_CANONICAL].sort());
    expect(flagged((e) => e.adminRefusedBeforeGuard)).toEqual([...ADMIN_REFUSED_BEFORE_GUARD].sort());
  });

  it("each selected route gives its parity response for every spelling, with the audit row where expected and no template row", async () => {
    const failures: string[] = [];
    for (const key of selectRoutes(routes)) {
      failures.push(...(await checkRoute(ctx, key, ROUTE_TABLE[key]!)));
    }
    expect(failures).toEqual([]);
  });

  it("admin pass: an application_admin gets the same parity response and one denial row on every audit route (no override)", async () => {
    const failures: string[] = [];
    for (const [key, entry] of Object.entries(ROUTE_TABLE)) {
      if (entry.evidence !== "audit") continue;
      const expectation = entry.adminRefusedBeforeGuard
        ? { status: entry.adminRefusedBeforeGuard.status, parity: false, auditRows: 0 }
        : { status: entry.status, parity: true, auditRows: 1 };
      failures.push(...(await checkRequest(ctx, key, entry, "application_admin", SPELLINGS[0]!, expectation)));
    }
    expect(failures).toEqual([]);
  });

  it("unauthenticated pass: every guarded route answers 401 and writes no denial row", async () => {
    const rowsBefore = await templateRowCounts(mods.db);
    for (const [key, entry] of Object.entries(ROUTE_TABLE)) {
      if (entry.evidence !== "audit") continue;
      const res = await unauthenticated.inject(entry.request(SENTINEL_TEAM_ID));
      ctx.bodies.push(res.body);
      expect(res.statusCode, key).toBe(401);
      // The auth middleware's own 401: no handler (so no guard) ran, and with
      // no actor there is no row to write.
      expect(res.json().error.message, key).toBe("Please sign in to continue.");
    }
    expect(await templateRowCounts(mods.db)).toBe(rowsBefore);
  });

  // -------------------------------------------------------------------------
  // 5.1 — the probe: an unguarded route under the prefix fails the checker
  // -------------------------------------------------------------------------
  it("probe self-test: an unguarded POST …/sessions/__probe fails both with no table entry and with one", async () => {
    const PROBE = "POST /api/v1/teams/:teamId/sessions/__probe";
    const probeRoutes: RouteOptions[] = [];
    const probeApp = await buildFullApp(mods, ctx.actorIds.facilitator, (route) => probeRoutes.push(route), {
      extraRoutes: (app) => {
        app.post<{ Params: { teamId: string } }>("/api/v1/teams/:teamId/sessions/__probe", async (request, reply) => {
          // No template guard: writes a session for whatever team it is given.
          const userId = (request.session as unknown as { userId: string }).userId;
          await mods.db.query(
            `INSERT INTO sessions (team_id, facilitator_id, status, is_first_session, session_number)
             VALUES ($1, $2, 'draft', false, 1)`,
            [request.params.teamId, userId],
          );
          return reply.code(201).send({});
        });
      },
    });
    extraApps.push(probeApp);

    // (a) The primary mechanism: no table entry.
    const selected = selectRoutes(probeRoutes);
    expect(selected).toContain(PROBE);
    expect(missingEntries(selected, ROUTE_TABLE)).toEqual([`${PROBE}: selected route has no ROUTE_TABLE entry`]);

    // (b) With an entry, the database constraint answers a sanitized 500
    // instead of the expected 404, and there is no audit row.
    const probeEntry: RouteEntry = {
      actor: "facilitator",
      request: (t) => ({ method: "POST", url: `/api/v1/teams/${t}/sessions/__probe`, payload: {} }),
      status: 404,
      body: errorCode("TEAM_NOT_FOUND"),
      evidence: "audit",
      floor: "none",
    };
    const probeCtx: CheckContext = { ...ctx, apps: { ...ctx.apps, facilitator: probeApp } };
    const failures = await checkRoute(probeCtx, PROBE, probeEntry);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.includes("answered 500"))).toBe(true);
    expect(failures.some((f) => f.includes("expected 1 template denial row(s), found 0"))).toBe(true);
    // Sanitized: the constraint name never reached a body, and nothing persisted.
    expect(failures.some((f) => f.includes("body names the constraint"))).toBe(false);
    expect(failures.some((f) => f.includes("a template row was created"))).toBe(false);
  });
});
