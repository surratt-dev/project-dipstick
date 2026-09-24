import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import Fastify from "fastify";
import { buildJoinLinkPath } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// join-link-redemption-wiring, design.md Decision 7 / tasks.md Tasks 5.1/5.2.
//
// The bug this change fixes was "technically complete, functionally
// invisible": a token-only test against GET /api/join/:token, seeded with an
// independently-known-good token and path, would have passed against the
// original code even though the frontend's own rendered link 404'd. This
// test closes that gap by:
//
//   1. Obtaining joinToken the same way the facilitator's browser does --
//      through a real GET .../facilitator-state call against the real
//      backend (get-or-create's miss branch, a real join_links INSERT, a
//      real audit_log row) -- not a token independently minted by this test.
//   2. Building the URL path with buildJoinLinkPath (packages/shared/src/
//      types/auth.ts), the exact same function DraftSessionHost.tsx imports
//      to render the link a facilitator copies (see that component and its
//      own test, DraftSessionHost.test.tsx, which asserts the identical
//      string appears in the rendered DOM). One shared function, not two
//      independently-maintained copies of the path -- a regression in
//      either half (token or path) is caught by this same test.
//   3. Following that exact constructed path against the real, registered
//      GET /api/join/:token route to confirm redemption actually succeeds
//      (a real team_memberships row for a second, real user).
//
// Task 5.2 (this test would have failed against the pre-fix code): verified
// directly, not just reasoned about -- temporarily reverting
// facilitator-sessions.ts and join-links.ts to their pre-fix (HEAD)
// versions and re-running this file, the first test below fails: the
// facilitator-state response's joinToken comes back null (the pre-fix
// handler still reads sessions.join_token, and this test's fixture -- like
// production code after Migration A -- no longer populates that column),
// so the exact failure mode this change closes ("the link is never really
// wired to a redeemable token") is what breaks the test, not an unrelated
// assertion. The two supplementary tests below it are structural guards,
// not pre-fix regression demonstrations in their own right (see their own
// comments for what each does and does not prove).
//
// Follows facilitator-error-states-integration.test.ts's established
// pattern: self-skip when Postgres is unreachable, env var fallbacks
// matching .env.example, dynamic post-fallback imports, no db.js mocking.
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
    `[e2e-join-link-redemption.test.ts] SKIPPED — Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}) not reachable. ` +
      "Run `docker compose up` (repo root) and re-run this file.",
  );
}

async function loadModules() {
  const { db } = await import("../../db.js");
  const { facilitatorSessionRoutes } = await import("../facilitator-sessions.js");
  const { joinLinkRoutes } = await import("../join-links.js");
  return { db, facilitatorSessionRoutes, joinLinkRoutes };
}

describe.skipIf(!dbUp)("join-link-redemption-wiring — real Postgres end-to-end (tasks.md 5.1/5.2)", () => {
  let mods: Awaited<ReturnType<typeof loadModules>>;

  beforeAll(async () => {
    mods = await loadModules();
  });

  function buildApp(
    routes: typeof mods.facilitatorSessionRoutes | typeof mods.joinLinkRoutes,
    userId: string | undefined,
  ) {
    const app = Fastify();
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    app.register(routes);
    return app.ready().then(() => app);
  }

  it(
    "5.1: the exact URL DraftSessionHost.tsx would render (real facilitator-state-sourced token, real buildJoinLinkPath) " +
      "redeems successfully against the real, registered backend route",
    async () => {
      const facilitatorId = "aaaaaaaa-0000-0000-0000-000000000001";
      const engineerId = "aaaaaaaa-0000-0000-0000-000000000002";
      const teamId = "bbbbbbbb-0000-0000-0000-000000000001";
      const sessionId = "cccccccc-0000-0000-0000-000000000001";
      const { db } = mods;

      try {
        await db.query(
          `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
           VALUES ($1, $2, 'test-issuer', 'E2E Facilitator', $3, 'facilitator')`,
          [facilitatorId, `sub-${facilitatorId}`, `${facilitatorId}@example.com`],
        );
        await db.query(
          `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
           VALUES ($1, $2, 'test-issuer', 'E2E Engineer', $3, 'engineer')`,
          [engineerId, `sub-${engineerId}`, `${engineerId}@example.com`],
        );
        await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
          teamId,
          "Integration Test Team (join-link-redemption-wiring)",
          facilitatorId,
        ]);
        // No join_token supplied -- Migration A (task 4.1) has already made
        // the column nullable, and facilitator-sessions.ts no longer
        // generates or inserts one (task 4.2).
        await db.query(
          `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number)
           VALUES ($1, $2, $3, 'draft', true, 1)`,
          [sessionId, teamId, facilitatorId],
        );

        // Step 1: obtain joinToken the way the facilitator's browser does --
        // a real GET .../facilitator-state call. No active join_links row
        // exists yet, so this exercises get-or-create's miss branch: a real
        // createJoinLink call, a real join_links INSERT, and a real
        // audit_log row in the same transaction.
        const facilitatorApp = await buildApp(mods.facilitatorSessionRoutes, facilitatorId);
        const stateRes = await facilitatorApp.inject({
          method: "GET",
          url: `/api/v1/teams/${teamId}/sessions/${sessionId}/facilitator-state`,
        });
        expect(stateRes.statusCode).toBe(200);
        const joinToken = (stateRes.json() as { joinToken: string }).joinToken;
        expect(typeof joinToken).toBe("string");
        expect(joinToken.length).toBeGreaterThan(0);

        // Confirm the token is genuinely sourced from a real join_links row
        // for this team -- not a fabricated or session-scoped value.
        const linkRow = await db.query<{ team_id: string }>(
          `SELECT team_id FROM join_links WHERE token = $1`,
          [joinToken],
        );
        expect(linkRow.rows).toHaveLength(1);
        expect(linkRow.rows[0]!.team_id).toBe(teamId);

        // Step 2: build the path with the SAME function DraftSessionHost.tsx
        // imports to render the link a facilitator copies (verified
        // separately, at the DOM level, by DraftSessionHost.test.tsx).
        const path = buildJoinLinkPath(joinToken);
        expect(path).toBe(`/api/join/${joinToken}`);

        // Step 3: follow that exact path, as a different, real user (the
        // Engineer), against the real, registered redemption route.
        const engineerApp = await buildApp(mods.joinLinkRoutes, engineerId);
        const joinRes = await engineerApp.inject({ method: "GET", url: path });

        expect(joinRes.statusCode).toBe(302);
        expect(joinRes.headers.location).toBe(`/team/${teamId}`);

        const membership = await db.query(
          `SELECT role FROM team_memberships WHERE team_id = $1 AND user_id = $2`,
          [teamId, engineerId],
        );
        expect(membership.rows).toHaveLength(1);
        expect((membership.rows[0] as { role: string }).role).toBe("participant");
      } finally {
        await db.query(`DELETE FROM team_memberships WHERE team_id = $1`, [teamId]);
        await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
        await db.query(`DELETE FROM join_links WHERE team_id = $1`, [teamId]);
        await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
        await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
        await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[facilitatorId, engineerId]]);
      }
    },
  );

  // Supplementary structural guard, not itself a pre-fix regression
  // demonstration: GET /api/join/:token's own registration and behavior are
  // unchanged by this proposal (the bug was the frontend building a link
  // against a path the backend never registered, not a change to the
  // backend's routing) -- this test would pass against pre-fix backend code
  // too. It stays as a regression guard against a *future* change ever
  // moving or removing this route.
  it("the OLD, unregistered '/join/:token' path 404s even for a valid, real token, while the correct path succeeds", async () => {
    const facilitatorId = "aaaaaaaa-0000-0000-0000-000000000003";
    const teamId = "bbbbbbbb-0000-0000-0000-000000000002";
    const sessionId = "cccccccc-0000-0000-0000-000000000002";
    const { db } = mods;

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'E2E Facilitator 2', $3, 'facilitator')`,
        [facilitatorId, `sub-${facilitatorId}`, `${facilitatorId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Integration Test Team (join-link-redemption-wiring, pre-fix path check)",
        facilitatorId,
      ]);
      await db.query(
        `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number)
         VALUES ($1, $2, $3, 'draft', true, 1)`,
        [sessionId, teamId, facilitatorId],
      );

      const facilitatorApp = await buildApp(mods.facilitatorSessionRoutes, facilitatorId);
      const stateRes = await facilitatorApp.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}/sessions/${sessionId}/facilitator-state`,
      });
      const joinToken = (stateRes.json() as { joinToken: string }).joinToken;

      // The original bug: DraftSessionHost.tsx built its link at
      // `/join/:token` (no `/api` prefix), a path the backend never
      // registered a route for. A test seeded with only a known-good token
      // and the CORRECT path would never have caught this -- so this
      // assertion follows the historically-wrong path instead, against the
      // same real app that registers only the correct one, and confirms it
      // 404s even though the token itself is entirely valid.
      const joinLinkApp = await buildApp(mods.joinLinkRoutes, facilitatorId);
      const wrongPathRes = await joinLinkApp.inject({ method: "GET", url: `/join/${joinToken}` });
      expect(wrongPathRes.statusCode).toBe(404);

      // The correct path, same token, same app -- succeeds, proving the
      // 404 above is specifically about the path, not the token or the app.
      const correctPathRes = await joinLinkApp.inject({ method: "GET", url: buildJoinLinkPath(joinToken) });
      expect(correctPathRes.statusCode).toBe(302);
    } finally {
      await db.query(`DELETE FROM team_memberships WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM join_links WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorId]);
    }
  });

  // Supplementary structural guard, not itself a pre-fix regression
  // demonstration: GET /api/join/:token has always required a real
  // join_links row -- this was true before this change too, so this test
  // would also pass against pre-fix backend code. It documents, concretely,
  // that the dead sessions.join_token column was never a valid redemption
  // credential, which is the reason get-or-create (exercised in the first
  // test above) exists at all.
  it("sessions.join_token (the dead, session-scoped column) does not resolve through the real redemption route", async () => {
    const facilitatorId = "aaaaaaaa-0000-0000-0000-000000000004";
    const teamId = "bbbbbbbb-0000-0000-0000-000000000003";
    const sessionId = "cccccccc-0000-0000-0000-000000000003";
    const deadSessionScopedToken = "deadbeefdeadbeef";
    const { db } = mods;

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'E2E Facilitator 3', $3, 'facilitator')`,
        [facilitatorId, `sub-${facilitatorId}`, `${facilitatorId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Integration Test Team (join-link-redemption-wiring, pre-fix token check)",
        facilitatorId,
      ]);
      // The original bug: sessions.join_token was populated with a
      // session-scoped value that no route ever validated. Simulating that
      // exact pre-fix state directly (Migration A left the column nullable
      // and writable, so this INSERT is still valid even though production
      // code no longer populates it) and confirming the real redemption
      // route rejects it -- proving get-or-create's real join_links-sourced
      // token (exercised in the 5.1 test above) is what makes redemption
      // actually work, not this column.
      await db.query(
        `INSERT INTO sessions (id, team_id, facilitator_id, status, join_token, is_first_session, session_number)
         VALUES ($1, $2, $3, 'draft', $4, true, 1)`,
        [sessionId, teamId, facilitatorId, deadSessionScopedToken],
      );

      const joinLinkApp = await buildApp(mods.joinLinkRoutes, facilitatorId);
      const res = await joinLinkApp.inject({
        method: "GET",
        url: buildJoinLinkPath(deadSessionScopedToken),
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/join-error?joinError=invalid");
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorId]);
    }
  });
});
