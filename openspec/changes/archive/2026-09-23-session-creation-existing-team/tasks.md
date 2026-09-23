## Prerequisites

- [x] 0.1 Confirm the use case amendment is merged into `requirements/use cases/02 - Session Setup - Use Cases.md` (owner: Marcus Delgado, BA): the "at least one team membership" precondition reworded as assumed-but-unenforced; steps 5–8 amended with the draft-landing step and "Open the room" action; and the Acceptance Criteria checklist's "waiting for participants" status bullet and "participant readiness view after creation" bullet both corrected to describe draft-landing instead. Blocks: none of the engineering groups below, but should land before this change is archived.
- [x] 0.2 Priya's design.md walkthrough sign-off on the draft-vs-lobby landing decision (Decision D6). Recorded: APPROVE WITH SUGGESTIONS (`design-review-facilitator-d6.md`); her two follow-up questions are resolved in D6 (reversibility) and deferred with rationale (abandon-a-draft).

## 1. Database Migration

- [x] 1.1 Add migration creating `sessions_team_active_unique`, with a self-enforcing pre-check guard at the top of the migration file (not a separate manual step): `DO $$ BEGIN IF EXISTS (SELECT team_id FROM sessions WHERE status IN ('draft','lobby','pre_session','active','wrap_up') GROUP BY team_id HAVING COUNT(*) > 1) THEN RAISE EXCEPTION 'sessions_team_active_unique: pre-existing duplicate non-terminal sessions found'; END IF; END $$;` immediately followed by `CREATE UNIQUE INDEX sessions_team_active_unique ON sessions (team_id) WHERE status IN ('draft', 'lobby', 'pre_session', 'active', 'wrap_up')`
- [x] 1.2 Run the migration in local dev and verify the index exists and rejects a manually-attempted duplicate insert
- [x] 1.3 Write a migration test (or manual verification step, documented) confirming the `DO` block guard actually aborts the migration when duplicate non-terminal sessions exist for a team — not just that the index works once created

## 2. Backend — `POST /draft` Enforcement, Concurrency Protection, and Audit Logging

This section is one deployable unit per `design.md`'s Migration Plan step 2: the membership check, the concurrent-session block, and both audit paths (denial and success) all live in the same handler and ship together, independently of the eligible-teams endpoint (Section 3) or the frontend.

- [x] 2.1 Replace the handler's separate `global_role`-only query with the combined query: `SELECT u.global_role, (tm.id IS NOT NULL) AS is_member FROM users u LEFT JOIN team_memberships tm ON tm.user_id = u.id AND tm.team_id = $2 AND tm.removed_at IS NULL WHERE u.id = $1`. Check order: (1) no row → 401 (unchanged), (2) `global_role !== 'facilitator'` → 403 "not a facilitator" message, (3) team existence check (unchanged, runs next), (4) `is_member` → 403 cross-team-constraint message (distinct wording from step 2)
- [x] 2.2 Add `AuditEventName` value `session.draft_denied_membership_conflict` to `audit-logger.ts`; on the step-4 rejection, write a synchronous `audit_log` row (`actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`) before the 403 response, then call `emitAuditEvent`
- [x] 2.3 Write test: facilitator with active membership on target team → 403, named cross-team error, no session created, `audit_log` row written with `operation = 'session.draft_denied_membership_conflict'`
- [x] 2.4 Write test: facilitator with a previously-removed (`removed_at` set) membership on target team → permitted
- [x] 2.5 Write test: non-facilitator caller → 403 with a message distinguishable from the cross-team-constraint message, no `audit_log` row written for this rejection (see design.md D1's "Declined" note)
- [x] 2.6 Write test: direct API submission (no picker/confirm UI involved) with active membership → same 403 as 2.3
- [x] 2.7 Write test: caller fetches eligible-teams list, joins the target team afterward, then submits using stale list state → 403 at submission time
- [x] 2.8 Write test: a request for a `:teamId` that doesn't exist and where the caller also has no membership row for it → 404 (team-existence check), not a 403 from the membership branch, and no audit row from the membership-denial path
- [x] 2.9 Add `SessionAlreadyExistsResponse` as a named interface in `@dipstick/shared` (`errorState: 'session_already_exists'`, `existingSessionId`, `existingSessionStatus`, `teamId`)
- [x] 2.10 Add `AuditEventName` value `session.draft_created` to `audit-logger.ts`
- [x] 2.11 Implement the transaction wrapping the successful `INSERT INTO sessions ... RETURNING id` and the `session.draft_created` audit_log write as one unit: `BEGIN` → insert session → insert `audit_log` row (`actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, `metadata: { session_id }`, `operation: 'session.draft_created'`) → `COMMIT`; call `emitAuditEvent` after commit
- [x] 2.12 Catch unique-violation errors from the transaction, matching on `err.code === '23505' && err.constraint === 'sessions_team_active_unique'` specifically (the concrete node-postgres `DatabaseError` fields — not a message-substring match); on a match, roll back and translate to `409`; re-throw any other error unchanged
- [x] 2.13 On a caught violation, run the follow-up `SELECT` (a fresh statement, after rollback) for the existing non-terminal session's `id` and `status`, and return `409` with a `SessionAlreadyExistsResponse` body
- [x] 2.14 Write test: creating a session for a team that already has a `lobby` session → 409, existing session id/status included, no new row created
- [x] 2.15 Write test: creating a session for a team whose only prior session is `complete` (or `abandoned`) → permitted
- [x] 2.16 Write test: a successful draft creation writes an `audit_log` row with `operation = 'session.draft_created'` in the same transaction as the `sessions` insert (i.e., if the audit insert were to fail, the session insert rolls back too)
- [x] 2.17 Write test: two concurrent creation requests for the same team → exactly one succeeds, the other receives 409 identifying the session the first request created
- [x] 2.18 Write test: a `23505` unique-violation on a *different* constraint propagates as an unhandled 500, not a false-positive 409
- [x] 2.19 Write test: a non-`23505` database error during the insert propagates as an unhandled 500, not a false-positive 409

## 3. Backend — Eligible-Teams Endpoint

- [x] 3.1 Add `EligibleTeamsResponse` and `EligibleTeam` as named interfaces in `@dipstick/shared`
- [x] 3.2 Implement `GET /api/v1/teams/eligible-for-session`: reject non-facilitators with 403, reading `users.global_role` live from the database on every call (do not derive this gate from `canFacilitateSessions` or any `request.session`-carried value)
- [x] 3.3 Implement the eligibility query (`teams` LEFT JOIN `team_memberships` ... WHERE membership IS NULL AND `deactivated_at IS NULL`), including `lastSessionAt` per team, computed as `MAX(completed_at)` over that team's `status = 'complete'` sessions only
- [x] 3.4 Compute and include `callerHasTeamMemberships` in the 200 response, independent of `eligibleTeams`'s emptiness
- [x] 3.5 Write test: non-facilitator → 403
- [x] 3.6 Write test: facilitator with eligible teams → 200, correct team list with `teamId`, `teamName`, `lastSessionAt`
- [x] 3.7 Write test: deactivated team excluded from results
- [x] 3.8 Write test: facilitator with zero team memberships → 200, full eligible list, `callerHasTeamMemberships: false`
- [x] 3.9 Write test: facilitator with a home team and zero eligible targets → 200, empty array, `callerHasTeamMemberships: true`
- [x] 3.10 Write test: a team whose most recent session is `draft` or `lobby` (not yet `complete`) reports `lastSessionAt` from its last *completed* session (or `null` if none), not the live session's timestamp
- [x] 3.11 Write test: a `global_role` downgrade between two calls to this endpoint within the same session lifetime is reflected on the very next call (403 where the prior call returned 200)
- [x] 3.12 Write test: a team with a live non-terminal session (e.g. `lobby`) and no membership row for the caller still appears in `eligibleTeams`, unfiltered by session status — per design.md D2's Resolved decision, the `409` at submission time (Section 2) is the only enforcement point for this, not list-filtering

## 4. Backend — `AuthSession.canFacilitateSessions`

- [x] 4.1 Add `canFacilitateSessions: boolean` to the `AuthSession` type in `packages/shared/src/types/auth.ts`
- [x] 4.2 Compute `canFacilitateSessions` in the `/auth/session` handler from `users.global_role === 'facilitator'`, read live on every call, not cached in the Redis session blob
- [x] 4.3 Write test: facilitator caller → `canFacilitateSessions: true`
- [x] 4.4 Write test: non-facilitator caller → `canFacilitateSessions: false`
- [x] 4.5 Write test: a `global_role` change between two `/auth/session` calls within the same session lifetime is reflected on the second call
- [x] 4.6 Confirm (by code review, no new test needed) that no code path adds raw `users.global_role` anywhere on `AuthSession`

## 5. Frontend — Routing and Entry Point

- [x] 5.1 Update the frontend `AuthContext`/session type consumption to read `canFacilitateSessions` from `/auth/session`
- [x] 5.2 Update `AuthenticatedLanding` in `packages/frontend/src/App.tsx`: route order becomes (a) has team memberships → existing team view, (b) `canFacilitateSessions === true` → session-creation entry point, (c) else → `/no-team`
- [x] 5.3 Add the new route for the picker → confirm → create flow (e.g. `/sessions/new`), gated on `canFacilitateSessions`
- [x] 5.4 Write/update test: user with `canFacilitateSessions: false` never sees the session-creation entry point
- [x] 5.5 Write/update test: user with zero team memberships and `canFacilitateSessions: true` is routed to the session-creation entry point, not `/no-team`
- [x] 5.6 Write/update test: `/no-team` page content and copy are unchanged for users with `canFacilitateSessions: false`

## 6. Frontend — Picker and Confirm Screens

- [x] 6.1 Build the picker screen consuming `GET /api/v1/teams/eligible-for-session`, rendering the two distinct empty states from `callerHasTeamMemberships` (zero-home-team facilitator copy vs. zero-eligible-targets copy)
- [x] 6.2 Build the confirm screen showing team name, facilitator's own name, and `lastSessionAt` context (not the bare team name alone)
- [x] 6.3 Wire confirm submission to `POST /api/v1/teams/:teamId/sessions/draft`
- [x] 6.4 Handle the 403 cross-team-constraint rejection and the 409 concurrent-session rejection (`SessionAlreadyExistsResponse`) on the confirm screen with an inline, named error (no silent bounce back to the picker); the 409 case includes an affordance that navigates to `/team/:teamId/session/:existingSessionId`
- [x] 6.5 On any confirm-screen rejection, mark the picker's previously-fetched eligible-teams list as stale so it re-fetches on next open
- [x] 6.6 Write component/integration tests for both empty states and both rejection paths (403, 409), including the 409 resume-existing-session affordance and an explicit assertion that the confirm screen displays team name plus `lastSessionAt` context, not the bare team name alone

## 7. Frontend — Draft Control View and "Open the Room"

- [x] 7.1 Add the route `/team/:teamId/session/:sessionId` in `App.tsx`, gated by `ProtectedRoute`, rendering a new host component (this is a real, bookmarkable route — not an in-place render with no URL)
- [x] 7.2 The host component fetches `GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state` on mount and renders the draft control view when `currentSessionState === 'draft'`, or the live participant-readiness view otherwise; this must work identically whether reached via the create flow's navigation, a refresh, a direct/bookmarked hit, or the 409-resume affordance (task 6.4)
- [x] 7.3 Build the facilitator's draft control view: team context, join link marked not-yet-joinable, "Open the room" action
- [x] 7.4 Wire successful `POST /draft` to navigate the facilitator to `/team/:teamId/session/:sessionId` (not a participant-facing room)
- [x] 7.5 "Open the room" shows a lightweight inline confirmation (not a modal round-trip) before firing; on confirm, wire to `POST /api/v1/teams/:teamId/sessions/:sessionId/advance`; on success, update the same view in place to the live participant-readiness view with no navigation
- [x] 7.6 On advance failure, keep the facilitator on the draft control view with an inline, retryable error; verify the draft session is unaffected by the failed attempt
- [x] 7.7 Write test: successful creation lands on `/team/:teamId/session/:sessionId` showing the draft control view with a non-joinable join link
- [x] 7.8 Write test: refreshing the page (or navigating to the route directly) while on a `draft` session re-renders the same draft control view via the `facilitator-state` fetch, not the picker
- [x] 7.9 Write test: "Open the room" requires confirmation before the advance request fires
- [x] 7.10 Write test: "Open the room" success transitions the view in place to the live readiness view
- [x] 7.11 Write test: "Open the room" failure leaves the draft session intact and the action retryable
- [x] 7.12 Write test: a caller who is not this session's facilitator hitting `/team/:teamId/session/:sessionId` sees the `facilitator-state` endpoint's existing 403, not the control view (confirming no client-side gate is needed beyond what the server already enforces)

## 8. Cross-Cutting Verification

- [x] 8.1 Run the full backend and frontend test suites; confirm no regressions in existing `session-participation`, `first-access`, or `project-structure` coverage affected by the spec deltas in this change. Ran `npm run test` at the repo root: shared 25/25, backend 633/633, frontend 300/300, all passing, exit code 0.
- [x] 8.2 Manually verify the end-to-end flow in local dev: a facilitator with zero team memberships creates a session for an existing team, lands in draft, opens the room, and a second browser session joins via the link. Verified against the real local Postgres/Redis/OIDC-stub stack via the dev-login flow (`loginHint=facilitator-001`, promoted to `global_role='facilitator'` in DB since no code path grants that role today -- a pre-existing gap, not introduced by this change): `GET /auth/session` showed `canFacilitateSessions: true` recomputed live after the DB change with no re-login; `GET /eligible-for-session` listed the team; `POST /draft` returned 201 with a `joinToken` and wrote a `session.draft_created` audit_log row in the same transaction; `GET .../facilitator-state` returned `draft` status; `POST /advance` transitioned to `lobby` and `facilitator-state` reflected it immediately. Also verified the facilitator-from-another-team 403 (with its `session.draft_denied_membership_conflict` audit row) using a second seeded team/membership. **Partial:** "a second browser session joins via the link" could not be verified literally -- `sessions.join_token` has no redemption route anywhere in this codebase (confirmed by inspection); the join-link landing experience is an explicit non-goal in design.md, left for whoever builds that page next. The picker/confirm/draft-control-view/open-the-room UI flow itself is covered by the RTL integration tests in `SessionCreationPage.test.tsx` and `DraftSessionHost.test.tsx` (jsdom-rendered, real user-event clicks), which is the closest available substitute for a browser click-through in this environment (no browser-automation tool was available in this session).
- [x] 8.3 Manually verify: attempting to create a second session for a team that already has one is blocked with a clear message. Verified against real Postgres: a second `POST /draft` for the same team while the first was still `draft` returned `409` with `{"errorState":"session_already_exists","existingSessionId":...,"existingSessionStatus":"draft","teamId":...}`.
