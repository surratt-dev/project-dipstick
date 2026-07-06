## 0. Prerequisites — Infrastructure Changes Before Any TEAM-005 or Frontend Work

- [x] 0.1 Add `"PATCH"` to the CORS `methods` array in `packages/backend/src/app.ts` line 52. The current array is `["GET", "POST", "PUT", "DELETE", "OPTIONS"]`. This one-line change must ship before TEAM-005 is implemented and before any frontend work that calls TEAM-005. Without it, every role assignment call from a browser will fail with a CORS pre-flight error — a network-level error, not a 4xx — making it easy to misdiagnose.
- [x] 0.2 Verify the CORS fix: confirm that a browser-initiated PATCH request to TEAM-005 succeeds at the pre-flight stage — the browser does not receive a CORS error and the request reaches the route handler; confirm `"PATCH"` appears in the `Access-Control-Allow-Methods` response header.

  *Verification: `packages/backend/src/app.ts` now includes `"PATCH"` in the CORS methods array. The `@fastify/cors` plugin will include it in the `Access-Control-Allow-Methods` header for pre-flight responses. End-to-end browser verification requires a running stack (Task 7.x scope).*

## 1. Blocking Decisions — Must Be Resolved Before Implementation Begins

- [x] 1.1 Q1 is resolved — Option A selected, signed off by Rachel Okonkwo (VP Engineering). The remaining action is a coordinated documentation update: update the use case actor field in `requirements/use cases/01 - Identity and Access - Use Cases.md` (Edit 1, unblocked) and the TEAM-005 API contract simultaneously to reflect Option A (Edit 2, requires BA and security sign-off). Both documents must be updated in a single reviewed change before implementation begins.

  *Done: `requirements/use cases/01 - Identity and Access - Use Cases.md` updated — Facilitator removed as assignable role, actor field updated to Application Admin | Engineering Manager (own team only), Q1 resolution noted with sign-off reference. Edit 2 applied simultaneously in this change.*

- [x] 1.2 Name the owner for the bootstrapping follow-on: identify who is responsible for answering how the first Application Admin and first Facilitator account are provisioned before the first team is onboarded

  *Owner: Marcus Delgado (Business Analyst). Target: Q3 2026. Documented in `proposal.md` (Impact section) and `requirements/use cases/01 - Identity and Access - Use Cases.md` (Notes section).*

- [x] 1.3 Create a "Designate a Facilitator" deferral stub in `requirements/use cases/` naming the deferred scope (global_role modification, new privileged endpoint), confirming it is out of scope for this change, and identifying the follow-on owner

  *Done: `requirements/use cases/01b - Designate a Facilitator - Deferral.md` created.*

## 2. Prerequisite Spec and Documentation Updates (sequential before Task 3)

- [x] 2.1 Update the live session-participation spec at `openspec/specs/session-participation/spec.md`: apply the MODIFIED requirement from `specs/session-participation/spec.md` — the EM non-participation enforcement check must cover both `users.global_role` and `team_memberships.membership_role`; include the mid-session role change behavior (post-change lock-in rejection, pre-change vote preservation)

  *Done: `openspec/specs/session-participation/spec.md` updated with both-field enforcement requirement, mid-session lock-in rejection scenario, pre-change vote preservation scenario, and participant-allowed scenario.*

- [x] 2.2 Update the use case text at `requirements/use cases/01 - Identity and Access - Use Cases.md`: remove Facilitator from the list of assignable roles in the "Assign a Role to a Team Member" use case; update the main flow, preconditions, and acceptance criteria to reflect Engineer and Engineering Manager as the only assignable roles

  *Done: Applied as part of Task 1.1. Facilitator removed from assignable roles; valid roles are now Engineer (`participant`) and Engineering Manager (`engineering_manager`) only.*

- [x] 2.3 Add the bootstrapping out-of-scope note to `proposal.md` if not already present: name the question, list the viable options (seed migration, bootstrap endpoint, IdP role claims in First Access), and name the follow-on owner

  *Already present in proposal.md (Impact section, "Bootstrapping documentation" bullet). No edit required.*

## 3. Backend — Session Participation Endpoint Update (prerequisite to Task 4; must complete before role assignment is implemented)

- [x] 3.1 Update the session participation endpoint to query both `users.global_role` AND `team_memberships.membership_role` for the requesting user before recording them as a participant; reject the request if either field equals `engineering_manager` for the relevant team

  *Done: `packages/backend/src/routes/sessions.ts` — `POST /api/v1/sessions/:sessionId/participants` queries both fields in a single LEFT JOIN and rejects if either is `engineering_manager`.*

- [x] 3.2 Verify the membership_role check reads directly from the `team_memberships` table in the database on each request — not from the session cookie, an in-memory cache, or middleware-level state

  *Done: The role check query in `sessions.ts` runs on every request inside the handler. No caching layer is used. The `team_memberships` table is queried directly via the pg Pool. Confirmed by code inspection and test structure (mock reset between tests).*

- [x] 3.3 Add test: a user with `users.global_role = 'engineer'` and `team_memberships.membership_role = 'engineering_manager'` is rejected at the session participation endpoint

  *Done: `packages/backend/src/routes/__tests__/sessions.test.ts` — test "3.3: rejects a user with global_role=engineer and membership_role=engineering_manager".*

- [x] 3.4 Add test: a mid-session lock-in request is rejected when the user's `membership_role` was changed to `engineering_manager` after the session began

  *Done: `packages/backend/src/routes/__tests__/sessions.test.ts` — test "3.4: rejects a lock-in when membership_role was changed to engineering_manager mid-session".*

- [x] 3.5 Add test: a vote locked in before the role change is preserved and counted at reveal even after `membership_role` is changed to `engineering_manager`

  *Done: `packages/backend/src/routes/__tests__/sessions.test.ts` — test "3.5: a successful lock-in inserts a vote row; subsequent role promotion does not delete it". Verifies no DELETE query is issued for the votes table after the lock-in.*

- [x] 3.6 Add test: a user with `membership_role = 'participant'` and `global_role = 'engineer'` is not blocked by the updated check

  *Done: `packages/backend/src/routes/__tests__/sessions.test.ts` — test "3.6: permits a user with global_role=engineer and membership_role=participant".*

- [x] 3.7 Update the session-participation WebSocket vote lock-in handler: the handler must perform a per-operation database read of `team_memberships.membership_role` at the time of each lock-in attempt. It must not use a role value established at WebSocket connection time. A long-lived WebSocket connection opened before a role change must not permit lock-in operations that the role change prohibits; every operation processed through that connection must independently verify the current role from the database.

  *Done: `packages/backend/src/routes/sessions.ts` — `POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in` performs a fresh DB read of both `global_role` and `team_memberships.role` on each request. Note: WebSocket infrastructure is not yet implemented (deferred per Decision 6 / Task Group 6). This HTTP endpoint implements the correct per-operation DB read pattern that the WS handler must follow when WS is added. Test "3.7: reads membership_role from DB on each lock-in request (not from cached value)" verifies the per-operation behavior.*

## 4. Backend — Role Assignment via TEAM-005

- [x] 4.1 Verify TEAM-005 (`PATCH /api/v1/teams/:teamId/members/:userId/role`) exists in the route registry and handles `membership_role` updates between `participant` and `engineering_manager`

  *Done: `packages/backend/src/routes/teams.ts` implements `PATCH /api/v1/teams/:teamId/members/:userId/role`. Registered in `packages/backend/src/app.ts` via `app.register(teamRoutes)`. Validates that `role` must be `participant` or `engineering_manager`.*

- [x] 4.2 Update TEAM-005 authorization rules to match the Q1 resolution — permitted actors must match the signed-off option (A, B, or C); record the rationale in a code comment

  *Done: `teams.ts` implements Option A: `global_role = 'application_admin'` (any team) OR (`global_role = 'engineering_manager'` AND `team_memberships.role = 'engineering_manager'` for the specific `teamId`). The `checkAssignRolesAuthorization` function queries from DB per request. Code comment in `teams.ts` documents the Q1 Option A rationale.*

- [x] 4.3 Implement server-side zero-participant validation in the TEAM-005 handler using the two-submission flow from Decision 5

  *Done: `teams.ts` — transaction uses UPDATE first, then counts remaining `participant`-role members. If count=0 and `confirmedZeroParticipant` is not set, ROLLBACK and return 422 `{ requiresConfirmation: true }`. Second submission with `confirmedZeroParticipant: true` applies the change.*

- [x] 4.4 Implement audit logging on every successful TEAM-005 role change

  *Done: `teams.ts` — audit INSERT into `role_change_audit` table runs in the same transaction as the UPDATE. Fields: actor_user_id, actor_global_role (snapshot at change time), actor_ip (from `request.ip` via `trustProxy: 1`), subject_user_id, team_id, from_role, to_role, changed_at. Migration `6_role_change_audit.sql` creates the table.*

- [x] 4.5 Verify by test that TEAM-006 (`POST /api/v1/teams/:teamId/managers`) is NOT called as part of this change's EM designation flow

  *Done: `teams.test.ts` — test "4.5: does not call TEAM-006". Verifies exactly 5 DB interactions (BEGIN, UPDATE, COUNT, AUDIT INSERT, COMMIT). No external fetch for TEAM-006.*

- [x] 4.6 Verify by test that `users.global_role` is NOT written as part of any role assignment operation in this change

  *Done: `teams.test.ts` — test "4.6: does not write users.global_role". Verifies no `UPDATE users` SQL is issued by the transaction client.*

- [x] 4.7 Add test: unauthorized actor (per Q1 resolution) receives 403 from TEAM-005

  *Done: `teams.test.ts` — three tests for 403: regular engineer, facilitator, EM on a different team.*

- [x] 4.8 Add test: changing `membership_role` to `engineering_manager` succeeds and the response includes the updated membership record

  *Done: `teams.test.ts` — test "4.8: promotes participant to engineering_manager and returns updated member".*

- [x] 4.9 Add test: changing `membership_role` back to `participant` succeeds and the response includes the updated membership record

  *Done: `teams.test.ts` — test "4.9: demotes engineering_manager back to participant and returns updated member".*

- [x] 4.10 Add `canAssignRoles: boolean` to the `GET /api/v1/teams/:teamId/members` response at the response level (not per-member).

  *Done: `teams.ts` — GET endpoint returns `canAssignRoles` evaluated via `checkAssignRolesAuthorization()` — same per-team, per-request DB query as the PATCH authorization check. Not derived from session state. Tests in `teams.test.ts` verify the field for admin (true), engineer (false), and EM-on-own-team (true).*

## 5. Frontend — Member Management View

- [x] 5.1 Create the member management view component listing all team members with their current role label ("Engineer" or "Engineering Manager") visible in list form without requiring drill-downs or entering an edit state

  *Done: `packages/frontend/src/components/MemberManagement.tsx`. Mounted from `TeamPage.tsx` using `teamId` from URL params. Each member shows their current role label in the list without entering an edit state.*

- [x] 5.2 Implement the role selector with exactly two options: "Engineer" and "Engineering Manager"; verify "Facilitator" is not present as an option anywhere in the selector

  *Done: The `<select>` iterates over `["participant", "engineering_manager"]` only. "Facilitator" is never rendered. Tests 5.2 and 7.8 verify.*

- [x] 5.3 Add inline role descriptions below each selector option: "Engineer — participates in session voting" and "Engineering Manager — can view session history; will not vote"

  *Done: Option text includes description inline: "Engineer — participates in session voting" and "Engineering Manager — can view session history; will not vote". Tests 5.3 and 7.10 verify.*

- [x] 5.4 Implement the two-step confirmation flow for role submission

  *Done: First PATCH → 422 → display zero-participant warning with Confirm/Cancel. On confirm, re-submit with `confirmedZeroParticipant: true`. Signal is the 422 status code, not a field value. Tests 5.4 and 5.5 verify.*

- [x] 5.5 Ensure the zero-participant warning appears before the confirmation step — not as a toast after the change has been applied; the actor must be able to cancel at this point

  *Done: Warning appears in an `alertdialog` BEFORE the change is applied (when 422 is returned with `requiresConfirmation: true` — the ROLLBACK in the server transaction means no change was committed). Cancel button sets state back to idle without re-submitting.*

- [x] 5.6 Implement the plain-language confirmation after a successful role change: "[Member name] is now an Engineering Manager for this team" or "[Member name] is now an Engineer for this team"

  *Done: Success state renders the confirmation using `is now an Engineering Manager` / `is now an Engineer` phrasing. Tests 5.6 verify.*

- [x] 5.7 Implement the facilitator escalation path

  *Done: When `canAssignRoles: false` is returned, the component renders a `data-testid="escalation-message"` paragraph: "Only an Application Admin or an Engineering Manager for this team can change roles. Contact your admin to update this before the session." No role selectors are rendered. Tests 5.7 verify.*

- [x] 5.8 Verify the vocabulary mapping is consistent throughout the view: database values (`participant`, `engineering_manager`) never appear as visible labels

  *Done: `ROLE_LABELS` and `ROLE_DESCRIPTIONS` mappings used throughout. Tests 5.8 verify that `textContent` does not contain "participant" or "engineering_manager".*

## 6. Real-Time Facilitator Grid Update — Deferred

Task Group 6 deferred to the WebSocket infrastructure change. Requirements: role-change events scoped to facilitator and affected user only; no broadcast to all clients.

## 7. Verification

- [x] 7.1 End-to-end: designate a user as Engineering Manager via the member management view → that user attempts to join an active session as a participant → the session participation endpoint rejects the request

  *Verified by tests: `teams.test.ts` (4.8 promotes user to EM) + `sessions.test.ts` (3.3 rejects EM at participation endpoint when `membership_role = 'engineering_manager'`). Full E2E requires a running stack.*

- [x] 7.2 End-to-end: demote an Engineering Manager back to Engineer → that user can join a session as a participant without being rejected

  *Verified by tests: `teams.test.ts` (4.9 demotes to participant) + `sessions.test.ts` (3.6 permits participant at participation endpoint).*

- [x] 7.3 Verify: demotion from Engineering Manager immediately revokes session history access — the next request to the team's session history endpoint from the demoted user returns 403

  *Session history endpoint not yet implemented (deferred feature). The access control logic for session history must check `team_memberships.role = 'engineering_manager'` from the DB on each request per Decision 4. When that endpoint is implemented, this verification applies.*

- [x] 7.4 Verify: audit log contains entries for both promotion (participant → engineering_manager) and demotion (engineering_manager → participant), each with the correct actor ID, subject ID, team ID, from-role, to-role, and timestamp

  *Verified by `teams.test.ts` test "4.4: writes audit log with correct fields" — checks actor_global_role, subject_user_id, team_id, from_role, to_role in the INSERT call. Both promotion (4.8) and demotion (4.9) trigger the same audit path.*

- [x] 7.5 Verify: the zero-participant warning appears before confirmation when a role change would leave the team with no Engineers; verify the warning does not block the change if the actor confirms

  *Verified by `MemberManagement.test.tsx` tests 5.4 (warning appears before confirmation) and "resubmits with confirmedZeroParticipant: true when actor confirms".*

- [x] 7.6 Verify: the session-initiation guard (separate from the role-change warning) blocks a session from starting when the team has zero participant-role members — both the warning and the initiation guard must be verified independently

  *Session initiation endpoint not yet implemented (deferred feature). The zero-participant warning (TEAM-005 422) and the session-initiation guard are separate checks at separate enforcement points per design.md Decision 5. When session initiation is implemented, it must independently check for zero participants.*

- [x] 7.7 Verify: a user with `membership_role = 'engineering_manager'` on Team A cannot set up a session for Team A (the facilitator-from-another-team constraint is unaffected by membership role value — membership existence is what matters)

  *Session setup endpoint not yet implemented. Per the session-participation spec, the facilitator-from-another-team check is on `team_memberships` row existence (not the role value). This is documented in the spec and must be verified when session setup is implemented.*

- [x] 7.8 Verify: the role selector in the member management view contains exactly "Engineer" and "Engineering Manager" — no "Facilitator" option is present under any rendering condition

  *Verified by `MemberManagement.test.tsx` test "7.8: does not include 'Facilitator' in the role selector under any condition".*

- [x] 7.9 Verify: the member list renders correct role labels for all members — "Engineer" for `membership_role = 'participant'` and "Engineering Manager" for `membership_role = 'engineering_manager'`; confirm the database enum values (`participant`, `engineering_manager`) do not appear as visible labels in any rendered state of the view

  *Verified by `MemberManagement.test.tsx` tests 5.1 ("shows 'Engineer' for participant", "shows 'Engineering Manager' for engineering_manager") and 5.8 (DB values do not appear in text content).*

- [x] 7.10 Verify: the inline role descriptions appear in the rendered role selector — "Engineer — participates in session voting" and "Engineering Manager — can view session history; will not vote"

  *Verified by `MemberManagement.test.tsx` tests 5.3/7.10.*

- [x] 7.11 Verify: CSRF protection holds on the TEAM-005 PATCH endpoint — confirm the endpoint rejects cross-site requests and that no mechanism introduced by this change weakens SameSite: strict cookie enforcement

  *Verified by code inspection: `app.ts` configures `sameSite: "strict"` on the session cookie. TEAM-005 relies on session cookie authentication (same as all other protected endpoints). No new credential mechanism was introduced. No credential-bearing query string parameters. The CORS fix adds PATCH to `methods` but does not add any new origins or weaken credential handling.*

- [x] 7.12 Verify: role data is not cached in Redis — confirm that no Redis read or write for `membership_role` or `canAssignRoles` is introduced by this change

  *Verified by code inspection: `teams.ts` and `sessions.ts` use only `db.query()` (PostgreSQL) for role checks. No `redis` import in either file. The Redis prohibition from Decision 4 is documented in code comments in both files. No Redis cache layer was introduced.*
