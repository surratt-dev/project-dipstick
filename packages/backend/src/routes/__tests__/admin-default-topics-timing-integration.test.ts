import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow } from "./helpers/real-db.js";
import { useMaintenanceTemplate } from "./helpers/maintenance-test-hygiene.js";
import { CONTENT_TIMING_FLOOR_MS } from "../../content/timing-oracle.js";

// ---------------------------------------------------------------------------
// admin-default-topic-maintenance (#216) design.md E2: the timing floor is applied on every
// return. Read from the REAL timing module (not the `{ CONTENT_TIMING_FLOOR_MS: 150 }` mock
// several unit tests use). Kept in its own file because the other route-level files mock the
// floor away to stay fast. #305 owns measuring the floor's value; this asserts only that the
// exported constant is honoured on 200, 403, 404, 422, 409 and 415.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "admin-default-topics-timing-integration.test.ts");

const BASE = "/api/v1/admin/default-topics";

describe.skipIf(!infraUp)("admin default-topics timing floor (real timing module, #216)", () => {
  const h = useMaintenanceTemplate();
  let admin: string;
  let facilitator: string;
  beforeAll(async () => {
    admin = await h.fx.user("application_admin");
    facilitator = await h.fx.user("facilitator");
  });

  it("every return path takes at least CONTENT_TIMING_FLOOR_MS: 200, 403, 404, 409, 415 and 422", async () => {
    expect(CONTENT_TIMING_FLOOR_MS).toBeGreaterThan(0);
    const adminApp = await h.appFor(admin);
    const facApp = await h.appFor(facilitator);
    const ids = (await adminApp.inject({ method: "GET", url: BASE })).json().defaults.map((d: { id: string }) => d.id) as string[];
    const timed = async (app: FastifyInstance, req: Parameters<FastifyInstance["inject"]>[0]) => {
      const started = Date.now();
      const res = await app.inject(req);
      return { status: res.statusCode, ms: Date.now() - started };
    };
    const cases: Array<[number, FastifyInstance, Parameters<FastifyInstance["inject"]>[0]]> = [
      [200, adminApp, { method: "GET", url: BASE }],
      [403, facApp, { method: "GET", url: BASE }],
      [404, adminApp, { method: "PATCH", url: `${BASE}/not-a-uuid`, payload: { name: "X" } }],
      [422, adminApp, { method: "POST", url: BASE, payload: {} }],
      [409, adminApp, { method: "PUT", url: `${BASE}/order`, payload: { order: ids.slice(1) } }],
      [415, adminApp, { method: "POST", url: BASE, headers: { "content-type": "text/plain" }, payload: "x" }],
    ];
    for (const [status, app, req] of cases) {
      const r = await timed(app, req);
      expect(r.status).toBe(status);
      expect(r.ms, `${status}`).toBeGreaterThanOrEqual(CONTENT_TIMING_FLOOR_MS - 5);
    }
  });
});
