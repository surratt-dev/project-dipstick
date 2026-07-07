## 1. Prerequisite Decisions (gate — no implementation begins until complete)

- [x] 1.1 BA and security analyst update the use case doc and API contract to reflect the resolved Q2 decision (Application Admin as authorized actor for TEAM-006, per Decision 1); simultaneously correct the use case precondition to state that `users.global_role = 'engineering_manager'` must pre-exist before TEAM-006 is called — TEAM-006 writes only the `team_memberships` row; both corrections must be made in the same document update before any implementation task begins
- [x] 1.2 Solution architect and security analyst select the global_role mechanism (resolved as Option A — IdP role claim mapping per Decision 2); document the decision including all five token validation requirements (claim name configuration, signed ID token only, absent claim behavior, allowlist validation, re-evaluation on each authentication) in the first-access spec
- [ ] 1.3 Devon Calloway confirms the vote attribution boundary (defined in design.md Decision 5 and manager-team-association spec) in writing before EM-facing view design begins — **BLOCKED: requires written confirmation from Devon Calloway; boundary is defined in spec and design.md Decision 5; Phase 3 EM view design does not begin until this is received**
- [ ] 1.4 Product owner decides the multi-team EM landing experience (team selector vs. other approach); decision documented before wireframes are drawn (Q5); if a non-trivial landing approach is selected, implementation tasks for that surface must be added to the task list before Phase 3 begins — **BLOCKED: requires product owner decision; design.md Q5 default is team selector per risk mitigation**
- [x] 1.5 Design team decides action item assignee visibility to EM and documents the decision (Q8); replace the PENDING marker for Q8 in `specs/manager-team-association/spec.md` with the resolved decision text
- [ ] 1.6 Conduct threat modeling session covering the four scenarios named in design.md Phase 0: TEAM-006 as an access escalation vector, EM account compromise, IdP claim manipulation, and retroactive historical data exposure under Decision 6; session must complete and findings must be documented before Phase 2 begins; the threat model must also name the action item inference risk (Decision 13) as a known inference path, not a boundary violation; assign an owner and schedule this session before Phase 1 work completes — **BLOCKED: requires scheduling a team threat modeling session; required scenarios documented in design.md Phase 0 and Risks; must complete before Phase 2 ships to production**
- [x] 1.7 Confirm that Decision 9 (audit trail destination) is documented in the manager-team-association spec: the audit destination is the `audit_log` database table per the schema in Decision 9 — not a structured application log; this gates the transactional rollback requirement in task 3.6; if this confirmation cannot be made, task 3.6 must be revised before TEAM-006 implementation begins
- [x] 1.8 Confirm that both PENDING markers in `specs/manager-team-association/spec.md` have been replaced with resolved decision text (authorized actor per task 1.1; action item assignee visibility per task 1.5) before any implementation task begins

## 2. Global Role Mechanism (first-access spec update)

- [x] 2.1 Update `openspec/specs/first-access/spec.md` to document the chosen global_role mechanism, replacing the PENDING marker in the delta spec with the specific approach, claim name, and mapping logic; include all five token validation requirements from Decision 2 explicitly — the spec must be the authoritative reference for the implementation in task 2.2
- [x] 2.2 Implement the chosen mechanism end-to-end (IdP claim mapping in OIDC callback per Decision 2 Option A)
- [x] 2.3 Write a test confirming a user can reach `global_role = 'engineering_manager'` through the chosen path starting from sign-in
- [x] 2.4 Verify the end-to-end path: user signs in → `global_role = 'engineering_manager'` is set → TEAM-006 precondition is satisfied; test must pass in CI
- [x] 2.5 If Option B (bootstrap endpoint) is chosen: security analyst reviews and approves the endpoint design before implementation — N/A: Option A selected; Option B rejected per Decision 2
- [x] 2.6 Phase 1 gate: tasks in section 3 and beyond do not begin until task 2.4 is passing in CI; confirm the end-to-end test exists, is green, and runs in the CI pipeline on every PR; this is a blocking condition, not an advisory — no TEAM-006 implementation work begins until this gate is explicitly cleared

## 2a. Phase 2 Infrastructure (must complete before section 3)

_All tasks in this section must pass CI before any task in section 3 begins. These tasks build the database infrastructure and shared type layer that TEAM-006 depends on. An implementor who picks up task 3.1 without these in place will hit runtime schema failures and compile errors mid-implementation._

- [x] 2a.1 Verify that `team_memberships` has a partial unique constraint on `(user_id, team_id) WHERE removed_at IS NULL`; if absent, add it as a prerequisite migration before any TEAM-006 implementation begins — the `ON CONFLICT` clause in task 3.3 requires this constraint; without it the upsert fails at runtime, not at compile time
- [x] 2a.2 Create the `audit_log` database migration per the schema in Decision 9: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `actor_user_id UUID NOT NULL`, `actor_global_role TEXT NOT NULL`, `actor_ip INET`, `target_user_id UUID`, `team_id UUID`, `operation TEXT NOT NULL`, `timestamp TIMESTAMPTZ NOT NULL DEFAULT now()`, `metadata JSONB`
- [x] 2a.3 In the same migration as 2a.2: migrate TEAM-005's existing audit writes from `role_change_audit` to `audit_log`; drop `role_change_audit` in the same migration — these are one atomic schema change, not two
- [x] 2a.4 Update the `AuditEventName` union in `packages/backend/src/auth/audit-logger.ts` to include `"team.manager_established"`
- [x] 2a.5 Update TEAM-005 tests in `teams.test.ts` to match the new `audit_log` schema; test "4.4" checking positional parameters `[1]` through `[6]` must be corrected to match the new column positions before any task in section 3 begins; CI must be green on this test before TEAM-006 implementation starts
- [x] 2a.6 Implement `GET /api/v1/teams/:teamId` (TEAM-003) as a net-new route handler with `participants` and `engineeringManagers` arrays in the response; the current backend exposes `GET /api/v1/teams/:teamId/members` — TEAM-003 is a new, separate endpoint; it must ship in Phase 2 so that the EM row created by TEAM-006 never appears in the wrong array in production
- [x] 2a.7 Update `TeamMembersResponse` in `@dipstick/shared` (`packages/shared/src/types/team.ts`) to `{ participants: TeamMember[]; engineeringManagers: TeamMember[]; canAssignRoles: boolean; canAssociateManagers: boolean }`, replacing the flat `members: TeamMember[]` array; this is a compile-time boundary — CI fails if the backend ships without the updated shared type, which is the correct behavior
- [x] 2a.8 Implement the `canAssociateManagers` boolean in the TEAM-003 response: compute server-side per request (`true` when `actor.global_role = 'application_admin'`), same pattern as the existing `canAssignRoles` flag; this flag drives the escalation path in section 4
- [x] 2a.9 Update `MemberManagement` component to consume `participants` and `engineeringManagers` arrays from the updated `TeamMembersResponse` shape; the flat `members` array no longer exists after this task; tasks 2a.6, 2a.7, and 2a.9 must ship together as an atomic change — the type change is a compile-time enforcement point
- [x] 2a.10 Write test: call TEAM-003 after a successful TEAM-006 call; confirm the target user appears in `engineeringManagers` and does not appear in `participants`; include the case where the target user was previously a participant (`team_memberships.role` updated in-place — they must appear in `engineeringManagers` only, not in `participants`)
- [x] 2a.11 Write and validate the Phase 2 rollback migration before Phase 2 ships to production: restore `role_change_audit` from backup or reverse migration, reverse the `audit_log` creation; validate the rollback script executes cleanly in a non-production environment before the production deployment gate is cleared

## 3. TEAM-006 Endpoint

- [x] 3.1 Implement `POST /api/v1/teams/:teamId/managers` with the authorization check resolved in task 1.1
- [x] 3.2 Implement the `global_role = 'engineering_manager'` precondition check with a specific 409 error code distinguishing this condition from other failures
- [x] 3.3 Implement idempotent behavior: 201 on create-new, 200 on update-existing, identical response body in both cases; use the PostgreSQL `xmax` idiom per Decision 3 (`xmax = 0` is true for freshly inserted rows, false for updated rows) — do not use SELECT-before-INSERT; add a code comment documenting why `xmax` is used and what it means
- [x] 3.4 Implement 404 response for unknown `teamId` (not 409); 404 for "team not found" must be indistinguishable from 404 for "team found but caller not authorized to know it exists" when the caller is not an Application Admin
- [x] 3.5 Implement 403 response for unauthorized actor
- [x] 3.6 Implement audit trail: write audit log entry to the `audit_log` table (created in task 2a.2) in the same database transaction as the `team_memberships` write; roll back both if the audit write fails; a simulated rollback must produce neither a `team_memberships` row nor an audit record
- [x] 3.7 Add code comment at the TEAM-006 handler explicitly distinguishing it from TEAM-005 (precondition difference, distinct use cases)
- [x] 3.8 Add code comment at the TEAM-005 handler explicitly noting that TEAM-006 is NOT called from here
- [x] 3.9 Write tests: create-new (201), idempotent-update (200), precondition failure (409 with correct error code), team-not-found (404), unauthorized (403), audit rollback on audit write failure
- [ ] 3.10 Implement rate limiting on `POST /api/v1/teams/:teamId/managers` at the threshold agreed in Q6 resolution (BA and security analyst own this decision); rate limit must be implemented and tested before Phase 2 ships to production — bulk calls under a compromised admin account are a named risk — **BLOCKED: Q6 rate limit threshold requires BA and security analyst decision before implementation**

## 4. Facilitator Escalation Path (conditional on Q2 resolution)

- [x] 4.1 If admin-only is selected: implement plain-language explanation in the team administration view for actors without TEAM-006 permission
- [x] 4.2 Implement specific admin contact path in the escalation message (email address, in-app message path, or equivalent — "Contact the admin" with no mechanism is not acceptable)
- [x] 4.3 Write test: user without TEAM-006 permission sees explanation text and contact path, not a grayed-out control

## 5. EM Read-Only Access — Session History, Trends, Action Items

- [x] 5.1 Implement server-side authorization for EM-facing session history endpoint: check `team_memberships.role = 'engineering_manager'` for the requesting user and team, read from database per request (no cache)
- [x] 5.2 Implement session history response with permitted fields only: aggregate vote distribution, session date, participant count (aggregate, not names), facilitator name, topic names
- [x] 5.3 Verify session history response: no per-participant vote values in response body at any level (not just UI — API response must also be clean)
- [x] 5.4 Implement historical access from full team history: sessions predating the association date are included; no date boundary applied
- [x] 5.5 Implement trend data endpoint for EM: statistical aggregates (averages, medians, trend direction) without individual participant labels; all historical topics included
- [x] 5.6 Implement action item read-only endpoint for EM: title, status, due date; assignee visibility per decision from task 1.5
- [x] 5.7 Implement write-rejection for EM on action item and topic configuration endpoints: 403 on any write attempt
- [x] 5.8 Implement rejection for EM attempting to access live session data: 403
- [x] 5.9 Write acceptance test: QA reviewer using an EM-role account against real session data cannot determine any individual participant's vote for any topic in any session
- [x] 5.10 Write test: EM with no association to Team B is rejected (403) when requesting Team B's history
- [x] 5.11 Implement `audit_log` writes for every Phase 3 endpoint that returns data to an EM caller (SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, ACTION-005), per Decision 11 field requirements: caller identity, team ID, session identifier where applicable, timestamp
- [x] 5.12 For bulk reads (TREND-001/TREND-002 covering multiple sessions): write a single `audit_log` entry with team ID and date range — not one row per session returned; per-session rows create log volume without proportional security value
- [x] 5.13 Write tests for EM access audit records: EM access to a history endpoint that returns data produces an audit record in `audit_log`; EM access attempt that returns 403 does not produce an audit record
- [x] 5.14 Build session history view for EM: route, data fetch from SESSION-007/SESSION-008, field-constrained display per Decision 5 (aggregate vote distributions, session date, participant count, facilitator name, topic names — no per-participant vote attribution); this is a net-new view, not a modified participant view
- [x] 5.15 Build trend data view for EM: data fetch from TREND-001/TREND-002; display statistical aggregates only (averages, medians, trend direction) without individual participant labels; this is a net-new view
- [x] 5.16 Build action items read-only view for EM: data fetch from ACTION-004/ACTION-005; render title, status, due date; assignee visibility per task 1.5 decision; no write affordances in the view
- [x] 5.17 Write acceptance test: EM user can navigate to session history, trend data, and action items views in the running application; all three views render with the correct field constraints enforced; no write controls are present in any EM-facing view

## 6. Team Administration View — Labeled Sections

- [x] 6.1 Update the team administration view to display participants (`role = 'participant'`) and associated managers (`role = 'engineering_manager'`) in separate, labeled sections
- [x] 6.2 Section headings must make clear that associated managers are not session participants
- [x] 6.3 When no EM association exists, display a visually distinct incomplete-setup indicator (not an error state) in the associated managers section
- [x] 6.4 Display associated EM by display name (not userId) in the team administration view
- [x] 6.5 Write acceptance test: facilitator who has never used the application can correctly identify which users will receive a session invite and which will not, without reading help documentation

## 7. Participant-Accessible Access Model Statement

- [x] 7.1 Implement the access model statement — "Your Engineering Manager can see session history but cannot join or observe live sessions" — in both the team view and the session lobby; both surfaces are required, not optional
- [x] 7.2 Confirm the statement is findable but not prominent: no modal, no acknowledgment flow, no notification on page load
- [x] 7.3 Write test: no modal or pop-up is triggered by normal user actions (joining session, viewing team page) that would surface the statement as an interruption
- [x] 7.4 Write test: access model statement is present in the session lobby; this is a separate test from team view placement confirmation — both surfaces must be verified by independent tests

## 8. Out-of-Scope Documentation and Interim Procedure

- [x] 8.1 Document the EM/team relationship removal as explicitly out of scope in the change, with a reference to it as a named follow-on change
- [x] 8.2 Write the interim administrative procedure for removing an incorrect EM/team association: documented, access-controlled (admin only), produces an audit trail — not an undocumented backdoor
- [x] 8.3 Assign ownership of the follow-on removal-operation change to a named person or role
- [x] 8.4 Confirm that access control for the access-control use case ("Is the user the Engineering Manager associated with this team?") references the `team_memberships` row written by TEAM-006 — document this dependency explicitly in the access control spec

## 9. End-to-End Verification

- [x] 9.1 Verify TEAM-006 precondition is satisfied end-to-end: user sign-in → global_role mechanism → TEAM-006 call → session history accessible
- [x] 9.2 Verify EM cannot join a session after TEAM-006 establishes the association (session-participation spec dual check: `global_role` AND `team_memberships.role`)
- [x] 9.3 Verify multi-team EM: two TEAM-006 calls for the same EM on different teams produces independent access to each team's history, with no cross-team access
- [x] 9.4 Verify historical participant designated as EM via TEAM-006 retains their prior participation records in session history
- [x] 9.5 Verify that participant members and associated managers are displayed in separate, labeled sections in the team administration view across all facilitator-accessible views of the team
