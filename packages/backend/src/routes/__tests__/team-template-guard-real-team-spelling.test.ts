import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type * as TemplateTeamGuardModule from "../../teams/template-team-guard.js";
import type { FastifyInstance, HTTPMethods, LightMyRequestResponse } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildFullApp,
  Fixture,
  SENTINEL_TEAM_ID,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 5.3, real Postgres:
// default-topic-provisioning "A real team's non-canonical spelling is
// unchanged", and the proposal's statement that no route gains a new
// rejection. isTemplateTeam normalises spellings (design.md D2), so this
// checks it never catches a REAL team written in another spelling.
//
// For each audit route of the structural table, the braced and no-hyphen
// spellings of a real team's id go through two apps: one built normally, and
// one built from modules re-imported after vi.doMock of
// teams/template-team-guard.js with isTemplateTeam stubbed to false (the
// "before the guard" baseline). Same status and body (apart from
// correlationId), and no team.template_access_denied row.
//
// Every request is read-only or refused for a real team (random session,
// user and EM ids; a non-member caller), so the first app's request cannot
// change the second's answer.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "team-template-guard-real-team-spelling.test.ts");

const OTHER = "ffffffff-ffff-4fff-bfff-ffffffffffff";

type Actor = "facilitator" | "application_admin" | "engineer";

const AUDIT_ROUTES: ReadonlyArray<{ key: string; actor: Actor; request: (t: string) => { method: HTTPMethods; url: string; payload?: object } }> = [
  { key: "POST /api/v1/teams/:teamId/sessions/draft", actor: "facilitator", request: (t) => ({ method: "POST", url: `/api/v1/teams/${t}/sessions/draft`, payload: {} }) },
  { key: "POST /api/v1/teams/:teamId/sessions/:sessionId/advance", actor: "engineer", request: (t) => ({ method: "POST", url: `/api/v1/teams/${t}/sessions/${OTHER}/advance`, payload: {} }) },
  { key: "POST /api/v1/teams/:teamId/sessions/:sessionId/reveal", actor: "engineer", request: (t) => ({ method: "POST", url: `/api/v1/teams/${t}/sessions/${OTHER}/reveal`, payload: {} }) },
  { key: "POST /api/v1/teams/:teamId/sessions/:sessionId/complete", actor: "engineer", request: (t) => ({ method: "POST", url: `/api/v1/teams/${t}/sessions/${OTHER}/complete`, payload: {} }) },
  { key: "POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance", actor: "engineer", request: (t) => ({ method: "POST", url: `/api/v1/teams/${t}/sessions/${OTHER}/topics/advance`, payload: {} }) },
  { key: "GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state", actor: "engineer", request: (t) => ({ method: "GET", url: `/api/v1/teams/${t}/sessions/${OTHER}/facilitator-state` }) },
  { key: "GET /api/v1/teams/:teamId/members", actor: "application_admin", request: (t) => ({ method: "GET", url: `/api/v1/teams/${t}/members` }) },
  { key: "PATCH /api/v1/teams/:teamId/members/:userId/role", actor: "application_admin", request: (t) => ({ method: "PATCH", url: `/api/v1/teams/${t}/members/${OTHER}/role`, payload: { role: "participant" } }) },
  { key: "POST /api/v1/teams/:teamId/managers", actor: "application_admin", request: (t) => ({ method: "POST", url: `/api/v1/teams/${t}/managers`, payload: { engineeringManagerUserId: OTHER } }) },
  { key: "POST /api/teams/:teamId/join-links", actor: "engineer", request: (t) => ({ method: "POST", url: `/api/teams/${t}/join-links` }) },
];

function comparable(res: LightMyRequestResponse) {
  let body: unknown = res.body;
  try {
    const parsed = res.json() as Record<string, unknown>;
    if (parsed["error"] && typeof parsed["error"] === "object") {
      const error = { ...(parsed["error"] as Record<string, unknown>) };
      delete error["correlationId"];
      parsed["error"] = error;
    }
    body = parsed;
  } catch {
    // non-JSON body: compared raw
  }
  return { status: res.statusCode, body };
}

describe.skipIf(!infraUp)("a real team's non-canonical spelling is answered as before the template guard (#214 5.3)", () => {
  let mods: Mods;
  let baselineMods: Mods;
  let fx: Fixture;
  let realTeamId: string;
  const actorIds = {} as Record<Actor, string>;
  const guarded = {} as Record<Actor, FastifyInstance>;
  const baseline = {} as Record<Actor, FastifyInstance>;

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
    for (const actor of ["facilitator", "application_admin", "engineer"] as const) actorIds[actor] = await fx.user(actor);
    realTeamId = await fx.team(actorIds.facilitator);
    for (const actor of Object.keys(actorIds) as Actor[]) guarded[actor] = await buildFullApp(mods, actorIds[actor]);

    // The "before the guard" baseline: fresh module instances that see a
    // guard which never recognises the template.
    vi.resetModules();
    vi.doMock("../../teams/template-team-guard.js", async (importOriginal) => {
      const actual = await importOriginal<typeof TemplateTeamGuardModule>();
      return { ...actual, isTemplateTeam: () => false };
    });
    baselineMods = await loadModules();
    for (const actor of Object.keys(actorIds) as Actor[]) baseline[actor] = await buildFullApp(baselineMods, actorIds[actor]);
  });

  afterAll(async () => {
    for (const app of [...Object.values(guarded), ...Object.values(baseline)]) await app.close();
    vi.doUnmock("../../teams/template-team-guard.js");
    if (actorIds.application_admin) {
      await mods.redis.del(
        `dipstick:ratelimit:team-manager:burst:${actorIds.application_admin}`,
        `dipstick:ratelimit:team-manager:daily:${actorIds.application_admin}`,
      );
    }
    await fx?.cleanup();
    await mods?.redis.quit();
    await baselineMods?.redis.quit();
    await baselineMods?.db.end();
  });

  it("the baseline really has the guard disabled", async () => {
    const { isTemplateTeam } = await import("../../teams/template-team-guard.js");
    expect(isTemplateTeam(SENTINEL_TEAM_ID)).toBe(false);
  });

  it.each(AUDIT_ROUTES.flatMap((r) => (["braced", "no-hyphen"] as const).map((s) => [`${r.key} [${s}]`, r, s] as const)))(
    "%s: same status and body as before the guard, and no template denial row",
    async (_label, route, spelling) => {
      const value =
        spelling === "braced" ? encodeURIComponent(`{${realTeamId}}`) : realTeamId.replace(/-/g, "");
      const start = (await mods.db.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;

      const before = await baseline[route.actor].inject(route.request(value));
      const after = await guarded[route.actor].inject(route.request(value));

      expect(comparable(after)).toEqual(comparable(before));
      const rows = await mods.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log
          WHERE operation = 'team.template_access_denied' AND actor_user_id = $1 AND "timestamp" >= $2`,
        [actorIds[route.actor], start],
      );
      expect(rows.rows[0]!.n).toBe(0);
    },
  );
});
