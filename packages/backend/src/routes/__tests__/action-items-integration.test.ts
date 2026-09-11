import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Real Postgres coverage for one specific claim task 6.3 asks to pin down
// directly, not just via a mocked column check: a resolutionNote written by
// PATCH /api/v1/action-items/:actionItemId/status is actually visible
// through content.ts's real GET /api/v1/teams/:teamId/action-items read
// query — the same read path production users go through — not merely
// present on the action_items row in isolation.
//
// Follows facilitator-error-states-integration.test.ts's established
// pattern exactly (self-skip when Postgres is unreachable, env var
// fallbacks matching .env.example, dynamic post-fallback imports). No
// db.js/config.js mocking anywhere in this file — that absence is the point.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] ??= "postgresql://dipstick:dipstick@localhost:5433/dipstick";
process.env["REDIS_URL"] ??= "redis://localhost:6380";
process.env["SESSION_SECRET"] ??= "integration-test-session-secret-32-chars-min";
process.env["OIDC_ISSUER"] ??= "http://localhost:4011";
process.env["OIDC_CLIENT_ID"] ??= "dipstick-local";
process.env["OIDC_CLIENT_SECRET"] ??= "dipstick-local-secret";
process.env["OIDC_REDIRECT_URI"] ??= "http://localhost:3000/auth/callback";
process.env["NODE_ENV"] ??= "test";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const PROBE_TIMEOUT_MS = 750;

async function isPostgresReachable(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: PROBE_TIMEOUT_MS });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const dbUp = await isPostgresReachable();

if (!dbUp) {
  console.warn(
    `[action-items-integration.test.ts] SKIPPED — Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}) not reachable. ` +
      "Run `docker compose up` (repo root) and re-run this file.",
  );
}

async function loadModules() {
  const { db } = await import("../../db.js");
  const { actionItemRoutes } = await import("../action-items.js");
  const { contentRoutes } = await import("../content.js");
  return { db, actionItemRoutes, contentRoutes };
}

describe.skipIf(!dbUp)("action-items — real Postgres round-trip (task 6.3)", () => {
  let mods: Awaited<ReturnType<typeof loadModules>>;

  beforeAll(async () => {
    mods = await loadModules();
  });

  function buildApp(routes: typeof mods.actionItemRoutes | typeof mods.contentRoutes, userId: string) {
    const app = Fastify();
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    app.register(routes);
    return app.ready().then(() => app);
  }

  it("a resolutionNote written by PATCH .../status is visible through GET /api/v1/teams/:teamId/action-items (content.ts's real read query)", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    const teamId = "22222222-2222-2222-2222-222222222222";
    const sessionId = "33333333-3333-3333-3333-333333333333";
    const itemId = "44444444-4444-4444-4444-444444444444";
    const { db } = mods;

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Integration Test User', $3, 'engineer')`,
        [userId, `sub-${userId}`, `${userId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Integration Test Team (action-items)",
        userId,
      ]);
      await db.query(`INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'participant')`, [
        teamId,
        userId,
      ]);
      await db.query(
        `INSERT INTO sessions (id, team_id, facilitator_id, status, join_token)
         VALUES ($1, $2, $3, 'complete', $4)`,
        [sessionId, teamId, userId, `jtok-${sessionId.slice(0, 8)}`],
      );
      await db.query(
        `INSERT INTO action_items (id, team_id, session_id, owner_id, description, status)
         VALUES ($1, $2, $3, $4, 'Integration test action item', 'in_progress')`,
        [itemId, teamId, sessionId, userId],
      );

      const patchApp = await buildApp(mods.actionItemRoutes, userId);
      const patchRes = await patchApp.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${itemId}/status`,
        payload: { status: "resolved", resolutionNote: "Closed via integration test round-trip" },
      });
      expect(patchRes.statusCode).toBe(200);

      const contentApp = await buildApp(mods.contentRoutes, userId);
      const getRes = await contentApp.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}/action-items`,
      });
      expect(getRes.statusCode).toBe(200);

      const body = getRes.json() as { actionItems: Array<{ id: string; resolution_note: string | null; status: string }> };
      const readBackItem = body.actionItems.find((ai) => ai.id === itemId);
      expect(readBackItem).toBeDefined();
      expect(readBackItem?.status).toBe("resolved");
      expect(readBackItem?.resolution_note).toBe("Closed via integration test round-trip");
    } finally {
      await db.query(`DELETE FROM action_item_history WHERE action_item_id = $1`, [itemId]);
      await db.query(`DELETE FROM action_items WHERE id = $1`, [itemId]);
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      await db.query(`DELETE FROM team_memberships WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });
});
