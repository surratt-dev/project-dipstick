import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, buildApp, Fixture } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
// @ts-expect-error -- plain-JS fixture of the stub IdP; it ships no type declarations.
import { accounts } from "../../../../../docker/oidc/accounts.js";
import { DEFAULT_ROLE_MAP, resolveRoleSet } from "../../auth/role-map.js";

// ---------------------------------------------------------------------------
// configurable-oidc-role-map (#243) task 5.2(b), design D9/C8 — the gate half
// of the R15 acceptance check, against real Postgres: a users row carrying
// the global_role the stub's facilitator-001 resolves to under the default
// map can create a draft session through the session-create route. Together
// with auth/__tests__/stub-accounts-role-map.test.ts (the mapping half) this
// proves the path; it is not a browser end-to-end test.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "stub-facilitator-session-create-integration.test.ts");

describe.skipIf(!infraUp)("stub facilitator-001 can create a draft session (real Postgres)", () => {
  let mods: Mods;
  let fx: Fixture;
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    await fx?.cleanup();
  });

  it("POST /api/v1/teams/:teamId/sessions/draft returns 201 and creates a draft row", async () => {
    const role = resolveRoleSet(accounts["facilitator-001"].role, DEFAULT_ROLE_MAP).role;
    expect(role).toBe("facilitator");

    fx = new Fixture(mods.db);
    const fac = await fx.user(role);
    const teamId = await fx.team(fac);
    // Not a member: a facilitator may not run sessions for their own team.
    await fx.topic(teamId, { displayOrder: 1 });

    app = await buildApp(mods, fac);
    const res = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft` });

    expect(res.statusCode).toBe(201);
    const sessionId = res.json().sessionId as string;
    const row = await mods.db.query<{ status: string; facilitator_id: string }>(
      `SELECT status, facilitator_id FROM sessions WHERE id = $1`,
      [sessionId],
    );
    expect(row.rows).toEqual([{ status: "draft", facilitator_id: fac }]);
  });
});
