# Tasks: First Access
**Change:** first-access
**Date:** 2026-07-05

Most of the first-access implementation is already in place. These tasks verify the existing code against the finalized requirements, close the two confirmed gaps, and add tests for acceptance criteria not yet covered.

---

## Implementation Tasks

- [x] Task 1: Confirm users table schema VARCHAR limits — Confirmed: `display_name` and `email` in the `users` table are both `TEXT` (unconstrained), per migration `2_create_tables.sql`. Neither is `VARCHAR(n)`-constrained. No truncation logic is required before the upsert, including when the `sub` claim is used as the `display_name` fallback. A comment documenting this finding was added to `resolveOrCreateAccount` in `account-resolver.ts`.

- [x] Task 2: Implement MissingClaimError typed class — Created `packages/backend/src/auth/errors.ts` with a `MissingClaimError` class carrying a `claim: string` field (the name of the missing or empty claim, never its value). Updated `mapAuthError` in `packages/backend/src/auth/error-handler.ts` to recognize `MissingClaimError` and return an `authentication_failed` category with a generic message containing no claim values.

- [x] Task 3: Replace destroy()+regenerate() with regenerate() alone in the auth callback — In `packages/backend/src/routes/auth.ts`, removed the `session.destroy()` callback (which swallowed errors silently) and replaced the two-step destroy+regenerate with a single `await request.session.regenerate()` call. Comment added explaining the rationale.

- [x] Task 4: Add missing-claims validation to the authentication callback — In `packages/backend/src/routes/auth.ts`, added guards after `tokens.claims()` to throw `MissingClaimError("sub")` when claims is null or `claims.sub` is falsy, and `MissingClaimError("iss")` when `claims.iss` is falsy. These checks precede the call to `resolveOrCreateAccount`. Updated the catch block to include `missingClaim: err.claim` in the `auth.failure` audit event when the error is a `MissingClaimError`, without including any PII.

- [x] Task 5: Implement server-side no-team redirect in the authentication callback — In `packages/backend/src/routes/auth.ts`, after account resolution and any pending join token processing, added a `SELECT team_id FROM team_memberships WHERE user_id = $1 AND removed_at IS NULL LIMIT 1` query. If the join flow already produced a specific redirect (to a team or active session), it is used directly. Otherwise: memberships present → redirect to `/team/:teamId`; no memberships → redirect to `/no-team`. The default `redirectUrl = "/"` fallback has been removed.

- [x] Task 6: Add no-team guard to the `/no-team` route — In `packages/frontend/src/pages/NoTeamPage.tsx`, added a `loading` guard (returns `<AuthLoadingPage />` while session is loading) and a membership redirect guard (returns `<Navigate to="/team/:teamId" replace />` when `session.teamMemberships.length > 0`). This covers the bookmark scenario where a user who has since joined a team navigates directly to `/no-team`.

- [x] Task 7: Add sourceIp and correlationId to auth.first_access_created — In `packages/backend/src/routes/auth.ts`, updated the `emitAuditEvent` call for `auth.first_access_created` to include `sourceIp: request.ip` and `correlationId`. The event shape now matches every other security-relevant event in the audit trail.

- [x] Task 8: Evaluate audit log level independence — Finding: the original `emitAuditEvent` wrote via `logger.child({ audit: true }).info(...)`. If the application log level is raised to `warn` or `error` at startup, pino suppresses `info` calls on the child logger inherited level, silently dropping all audit events. Fix implemented: `auditLogger.level = "info"` is set on the child logger before the `.info()` call. In pino, each logger instance owns its level independently of its parent; overriding it on the child ensures audit events are always emitted regardless of the application-wide log level. The finding and fix are documented in a comment in `packages/backend/src/auth/audit-logger.ts`.

---

## Documentation Tasks

- [x] Task 9: Verify the `/no-team` route is not wrapped in any navigation-contributing layout — Verified: in `packages/frontend/src/App.tsx`, the `/no-team` route wraps `NoTeamPage` only in `ProtectedRoute` (authentication-gating only, no navigation elements). No `<Layout>`, `<AppShell>`, `<Shell>`, or `<Navigation>` wrapper is present. A multi-line comment was added adjacent to the route definition in `App.tsx` documenting this constraint and referencing the regression test in `App.test.tsx` that locks it in.

- [x] Task 10: Add isNewUser constraint comment to resolveOrCreateAccount — Added a detailed comment in `packages/backend/src/auth/account-resolver.ts` on the SELECT query that precedes the upsert. The comment states: (a) `isNewUser` is determined by this SELECT, not the upsert result; (b) two concurrent callbacks for the same new user may both read `existing.rows.length === 0` and both set `isNewUser = true`; (c) this is a hard constraint on future work — before any feature consuming `isNewUser` is merged, the SELECT-before-upsert must be replaced with a upsert-derived pattern, or the consumer must treat duplicate firings as idempotent.

- [x] Task 11: Verify email is absent from the identity resolution query — Verified: in `packages/backend/src/auth/account-resolver.ts`, the SELECT query uses only `oidc_subject = $1 AND oidc_issuer = $2` — email does not appear in any WHERE clause or JOIN condition. The INSERT ... ON CONFLICT clause keys on `(oidc_subject, oidc_issuer)`; email appears only in the SET clause (updated, never matched). A comment was added adjacent to the upsert query: "email is stored and updated here but is never used as a match key — see Capability 2 in proposal.md."

---

## Test Tasks

- [x] Task 12: Add tests for missing-claims rejection to the backend auth route — Added three test cases in the "missing claims rejection (Task 12)" describe block in `packages/backend/src/routes/__tests__/auth.test.ts`: (a) `sub` is empty string — asserts no `resolveOrCreateAccount` call, redirect to `/auth/error`, audit event with `missingClaim: "sub"` and no PII fields; (b) `iss` is empty string — same assertions, `missingClaim: "iss"`; (c) `claims()` returns `null` — same assertions. All three verify that `mockResolveOrCreateAccount` was not called.

- [x] Task 13: Add tests for server-side no-team redirect in the callback — Added three test cases in the "server-side no-team redirect (Task 13)" describe block: (a) new user with no memberships → redirect to `/no-team`; (b) user with memberships → redirect to `/team/team-abc`; (c) join token processed, join flow returns `/team/team-joined` → redirect to team URL, not `/no-team`.

- [x] Task 14: Add test for returning user with removed team memberships — Added test case in `packages/backend/src/routes/__tests__/auth.test.ts`: existing account (`isNewUser: false`), team memberships query returns empty rows → redirect to `/no-team`, not any team URL. This exercises the live-data constraint distinct from the new-user case in Task 13a.

- [x] Task 15: Add test for database failure during account creation — Added test case in `packages/backend/src/routes/__tests__/auth.test.ts`: `resolveOrCreateAccount` throws; asserts (a) `session.save` was not called (no session established), (b) redirect to `/auth/error` (not `/no-team` or any team URL), (c) `auth.failure` audit event emitted, (d) `resolveOrCreateAccount` was called and threw, no subsequent db queries.

- [x] Task 16: Add tests for the no-team guard (bookmark redirect) — In `packages/frontend/src/pages/__tests__/NoTeamPage.test.tsx`, added: Task 16a — session with no memberships → no-team content renders; Task 16b — session with team membership → `<Navigate>` fires, team page renders, no-team content absent. Both tests use `MemoryRouter` with a `/team/:teamId` route to capture the redirect destination.

- [x] Task 17: Add a test for the no-team page content elements — In `packages/frontend/src/pages/__tests__/NoTeamPage.test.tsx`, Task 17 test renders `NoTeamPage` with no-team session and asserts: (a) display name "Welcome, Bob"; (b) text matching "not yet a member of any team"; (c) text matching "ask your facilitator for a join link"; (d) sign-out button present. Also asserts exactly one `button` role element and zero `link` or `textbox` role elements.

- [x] Task 18: Add a routing-layer test that the `/no-team` route renders no navigation elements — Added test "Task 18" in `packages/frontend/src/pages/__tests__/App.test.tsx`. Renders `TestApp` at `/no-team` with a no-team session. Asserts `document.querySelector("nav")` is null and `screen.queryByRole("navigation")` is not in the document. Also verifies the no-team content renders (confirming the route loaded correctly).

- [x] Task 19: Verify existing account-resolver tests cover sub/iss-only identity matching — Added two tests in `packages/backend/src/auth/__tests__/account-resolver.test.ts`: (a) two identities with the same email but different `sub` values → two separate accounts created, each with `isNewUser: true`; SELECT queries confirmed to use `sub` and `iss` parameters, never email; (b) returning user with same `sub`/`iss` but changed email → `isNewUser: false`, `email` field updated, upsert parameters confirmed to carry the new email in position [3] (SET clause), not in ON CONFLICT position.

- [x] Task 20: Add test for concurrent upsert behavior — Added "handles simulated concurrent first access" test in `packages/backend/src/auth/__tests__/account-resolver.test.ts`. Mocks SELECT to return empty rows for two sequential calls with the same `sub`/`iss` (simulating the race condition), with upsert returning the correct user record for each. Asserts both calls return the correct user, both set `isNewUser: true` (documented race limitation), no error thrown, exactly 4 db operations. Test includes a comment noting this is a simulated-concurrency test and that a live-database concurrent test is the gold standard for AC-3.

- [x] Task 21: Verify audit logging for first_access_created — The "should emit first_access_created with all required fields for new users" test in `packages/backend/src/routes/__tests__/auth.test.ts` finds the `auth.first_access_created` call by event name and asserts it contains `userId`, `oidcSubject`, `oidcIssuer`, `sourceIp` (any string), and `correlationId` (any string). Also asserts absence of `displayName`, `email`, and `name` fields. The "should complete sign-in flow" test (returning user, `isNewUser: false`) asserts that `auth.first_access_created` is NOT emitted.
