# Security Implementation Review — establish-manager-team-relationship

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-07-07
**Scope:** Pre-production security verification of Phase 2 (TEAM-006) and Phase 3 (EM read-only views) implementation.
**Files reviewed:**
- `packages/backend/src/routes/teams.ts`
- `packages/backend/src/routes/em-views.ts`
- `packages/backend/src/auth/account-resolver.ts`
- `packages/backend/src/auth/audit-logger.ts`
- `packages/backend/migrations/8_audit_log.sql`
- `packages/backend/migrations/8_rollback.sql`
- `packages/shared/src/types/team.ts`
- `packages/frontend/src/components/MemberManagement.tsx`
- `packages/frontend/src/pages/SessionLobbyPage.tsx`
- Supporting test files in `packages/backend/src/routes/__tests__/` and `packages/frontend/src/pages/__tests__/`

---

## Summary

The six security properties I was asked to verify are all correctly implemented at the code level. My findings include no blocking issues for the properties listed in the review scope. One item from the design document's own risk register — rate limiting on TEAM-006 — has no implementation in the current codebase and must be resolved before this change ships to production. I also have three observations that do not block deployment but should be addressed before the first team goes live with EM history access.

---

## Finding 1: Audit Trail Atomicity — VERIFIED

**Decision 9 / Blocking Finding B-1**

The TEAM-006 handler (`teams.ts`, POST `/api/v1/teams/:teamId/managers`) acquires a dedicated database client, issues `BEGIN`, performs the `team_memberships` upsert, then performs the `audit_log` INSERT, then issues `COMMIT`. The `catch` block issues `ROLLBACK` and re-throws. This is the correct pattern. A transaction that fails at the audit INSERT rolls back the upsert — neither row is committed. A committed transaction produces both rows.

The migration (`migrations/8_audit_log.sql`) creates the `audit_log` table, migrates TEAM-005 records from `role_change_audit`, and drops `role_change_audit` in a single atomic migration. The rollback script exists (`8_rollback.sql`) and is clearly documented.

Test coverage: `teams.test.ts` test 3.6 specifically simulates an audit INSERT failure and verifies that the handler returns 500 and that ROLLBACK is called. The `AuditEventName` union in `audit-logger.ts` correctly includes `"team.manager_established"`.

**Status: Verified. This property is correctly implemented and tested.**

---

## Finding 2: TEAM-006 Authorization — VERIFIED

**Decision 1 / Decision 14**

### Admin-only enforcement

The TEAM-006 handler reads the actor's `global_role` from the `users` table per request (`SELECT global_role FROM users WHERE id = $1`, with the actor's user ID from the session). Session state is not trusted for this determination. Non-admin actors receive 403 with `category: "forbidden"`. Engineering Managers, engineers, and any other role are all rejected.

Test coverage: `teams.test.ts` tests 3.5 verify that engineering_manager and engineer actors both receive 403. The 403 response uses `category: "forbidden"` (not `"invalid_request"`), which is correctly differentiated from the 409 precondition failure.

### Dual authorization checks (Decision 14)

The `checkEmAuthorization()` function in `em-views.ts` performs Check 1 (global_role guard) and Check 2 (team_memberships association guard) as independent sequential `if` statements — not as a combined SQL `AND` or a single condition. If Check 1 fails, the function returns before Check 2 is evaluated. If Check 1 passes but Check 2 fails (global EM role but no team association), the function correctly returns `authorized: false` with `reason: "not_associated_with_team"`.

This is the correct implementation of Decision 14's "must remain independent" requirement. Consolidating the two checks into a single SQL `AND` clause would satisfy the functional requirement but would undermine the defense-in-depth intent: a future change that sets `global_role` without going through TEAM-006 would still be blocked by the membership check.

Test coverage: `em-views.test.ts` has dedicated tests for both failure paths — global role check failure and association check failure — as independent test cases (tasks 5.1 and 5.10). The end-to-end test in `e2e-verification.test.ts` verifies that global role without team association returns 403 (task 9.1 negative case).

**Status: Verified. Both authorization properties are correctly implemented and independently tested.**

---

## Finding 3: Vote Attribution Boundary — VERIFIED

**Decision 5**

All six Phase 3 EM-facing handlers (SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, ACTION-005) are net-new implementations, not authorization unlocks on existing routes. The SQL queries in each handler never `SELECT voter_id` from the `votes` table. Vote data is aggregated by value (`GROUP BY vote_value`, `COUNT(*)`, `BOOL_OR(is_outlier)`). The `session_participants` table is joined only to count distinct participants, not to return participant identities.

The response serialization path produces `VoteDistributionBucket` objects containing only `voteValue`, `count`, and `containsOutlier` — no voter identity fields at any nesting level. The `EmSessionTopicSummary` type includes `average`, `median`, and `flaggedForDiscussion` — all aggregate statistics permitted under Decision 5.

The `participantCount` field in session history and trend responses is an integer count, not a list of participant identities.

The statistical helper functions (`computeMedian`, `computeTrendDirection`) operate on aggregated vote value arrays — the individual voter association is never present in the data passed to these functions because it was never selected.

Test coverage: `em-views.test.ts` includes response-body assertion tests for both SESSION-007 and SESSION-008 that explicitly check the serialized JSON string for `"voter_id"`, `"voterId"`, and per-bucket checks for `userId`, `voter_id`, and `displayName`. These tests run in CI. The `EmAcceptanceTest.test.tsx` (task 5.9) verifies the end-to-end acceptance criterion using realistic fixture data.

One note on ACTION-004/005: `ownerDisplayName` is included in the response. This is correct per Decision 13, which explicitly permits action item assignee visibility as work-tracking data. The test in `em-views.test.ts` (ACTION-004 response body test) verifies that `owner_id` and `ownerId` are absent while `ownerDisplayName` is present — the correct boundary.

**Status: Verified. The attribution boundary is enforced at the SQL layer and the serialization layer, with CI-gated unit tests covering both surfaces.**

---

## Finding 4: EM Data Access Scoping — VERIFIED

**Decision 14 / Phase 3 scope**

All six Phase 3 endpoints call `checkEmAuthorization(session.userId, teamId)` at the top of the handler, before any data access. The function checks both `users.global_role = 'engineering_manager'` and `team_memberships.role = 'engineering_manager'` for the specific team in the request path — using the team ID from the attacker-controlled URL parameter, not from any cached or session-derived value. An EM authenticated for team A who requests team B's data receives 403.

SESSION-008 additionally verifies that the requested session belongs to the team the EM is authorized for (`sr.team_id !== teamId` → 403). SESSION-008 also rejects access to sessions with status other than `'complete'` (live session data rejection per the non-goal "Any EM access to live session data").

The TREND-002 and ACTION-005 single-resource endpoints include the `team_id` in the SQL `WHERE` clause, so an EM cannot retrieve a topic or action item from a team they are not associated with by guessing the resource ID.

**Status: Verified. All six endpoints enforce the dual check. Cross-team access and live session data access are blocked.**

---

## Finding 5: canAssociateManagers Flag — VERIFIED

**Decision 10**

The `canAssociateManagers` flag is computed in the TEAM-003 handler (`teams.ts`) after a per-request database query establishes `actorGlobalRole`:

```
const canAssociateManagers = actorGlobalRole === "application_admin";
```

This evaluation happens on the server, using the `global_role` value fetched from the database. The client receives the flag in the `TeamMembersResponse` body and reads it from there. The `MemberManagement` component (`MemberManagement.tsx`) destructures `canAssociateManagers` from the fetched `data` object — it never recomputes or derives it from any client-side state.

This is the same pattern as `canAssignRoles`, which is also server-computed and serves as an established precedent.

Test coverage: `teams.test.ts` tests verify `canAssociateManagers: true` for application_admin and `canAssociateManagers: false` for engineer and EM actors.

**Status: Verified. The flag is server-side only. No client-side derivation is present.**

---

## Finding 6: Access Model Statement — VERIFIED

**Decision 8**

The statement "Your Engineering Manager can see session history but cannot join or observe live sessions." appears in both required surfaces:

- **Team view:** `MemberManagement.tsx`, rendered inside the Associated Engineering Manager section with `data-testid="access-model-statement"`. It is a static paragraph, not a modal, not an alert, not dismissible.
- **Session lobby:** `SessionLobbyPage.tsx`, rendered below the session info with `data-testid="session-lobby-access-model-statement"`. Same non-modal, non-dismissible treatment.

The section heading in `MemberManagement` reads "Associated Engineering Manager (views history only — does not attend sessions)", which meets Decision 7's requirement that a facilitator who has never used the application can correctly identify which users will vote.

Test coverage: `SessionLobbyPage.test.tsx` has independent tests for the session lobby surface (tasks 7.1, 7.4) that verify both the presence and exact text of the statement, and verify no modal or dismissal interaction is present. The `MemberManagement.test.tsx` file covers the team view surface.

**Status: Verified. Both surfaces are correctly implemented with independent test coverage.**

---

## Open Issue 1: Rate Limiting on TEAM-006 — NOT IMPLEMENTED

**Priority: Must resolve before production deployment**

Design document Q6 states: "Rate limiting on TEAM-006 is required. An Application Admin account is a high-value target; bulk TEAM-006 calls under a compromised account would grant historical data access across many teams before the compromise is detected. The threshold must be specified in the spec before Phase 2 implementation."

The TEAM-006 handler contains a comment acknowledging this requirement and stating "the specific limit value comes from Q6." No rate limiting middleware or implementation is present in the handler or the Fastify application configuration. Q6 remains open.

This is not a code-review recommendation — it is a requirement from the design document's own risk register that the implementation has not yet satisfied. A compromised Application Admin account with unrestricted TEAM-006 access can associate that credential with every team in the system before the compromise is detected. The audit log records the events, but the damage is done before detection.

The threshold value is the BA's and security analyst's decision. The implementation must be wired before the Phase 2 deployment gate is cleared.

---

## Observation 1: EM Access Audit Writes Are Not Transactional

**Priority: Low risk for read operations; acknowledge before go-live**

The TEAM-006 audit write is in the same database transaction as the `team_memberships` write (Decision 9, correctly implemented). The Phase 3 EM access audit writes (SESSION-007/008, TREND-001/002, ACTION-004/005) are not transactional — each handler issues a standalone `db.query()` INSERT after assembling the response data.

Decision 11 requires that EM access "must generate an audit record" but does not state the same transactionality requirement as Decision 9. For a read-only operation, the risk profile is different from a write: if the audit INSERT fails after data is fetched but before the response is sent, the handler throws a 500 (the client receives an error, not the data), and no audit record exists. In practice this means the data was not returned to the client but was processed internally, with no log evidence. On a retry, both the data and the audit record would be produced normally.

This is low risk compared to the TEAM-006 case (where the grant itself is the sensitive event) but should be acknowledged before the first team goes live. Recommended mitigation: wrap the data fetch and audit INSERT in a try/finally block that either logs a structured warning on audit failure (allowing the data to be returned) or makes the audit write transactional.

---

## Observation 2: actor_global_role Hardcoded in EM Access Audit Records

**Priority: Low risk now; relevant for future changes**

All six Phase 3 handlers hardcode `"engineering_manager"` as the `actor_global_role` in `audit_log` INSERT calls. This is correct today because `checkEmAuthorization` already verified the role before the handler reaches the audit write — no actor with a different role can reach this code path.

If a future change grants EM view access to application admins or other roles without updating the authorization check, the audit records would show `actor_global_role = 'engineering_manager'` for non-EM actors. This creates misleading audit records.

Recommended: pass the actual actor role through from `checkEmAuthorization` (which already reads it from the database) rather than hardcoding. This is a low-effort hardening step.

---

## Observation 3: SESSION-008 Does Not Call teamExists() Before Data Fetch

**Priority: Informational only**

SESSION-007 calls `teamExists(teamId)` after the dual-auth check and before fetching session data. SESSION-008 does not call `teamExists()` — instead it fetches the session directly and then validates `sr.team_id === teamId`. If the session exists but belongs to a different team, SESSION-008 returns 403. If neither the session nor the team exists, SESSION-008 returns 404 for session not found.

This is functionally secure: an EM cannot access session data from a team they are not associated with. However, the pattern is inconsistent with SESSION-007 and a team-not-found scenario in SESSION-008 is not explicitly surfaced as a 404 for the team. This is a minor consistency observation, not a security gap.

---

## Pre-Production Verification Checklist

The following verifications remain required before any team goes live with EM history access, per the design document and this review:

- [ ] Rate limiting on TEAM-006 implemented and tested (Open Issue 1 above)
- [ ] Atomicity test: simulated TEAM-006 transaction rollback produces neither `team_memberships` row nor `audit_log` row
- [ ] Attribution boundary QA: security analyst tests with an actual EM-role account against real session data (not fixture data) — both SESSION-007 and SESSION-008 must produce no voter-attributing fields
- [ ] WebSocket endpoints verified to reject EM-role accounts from live session access (Phase 4 gate)
- [ ] CORS configuration verified for all EM-facing endpoints (Phase 4 gate)
- [ ] Rollback script (`8_rollback.sql`) validated in a non-production environment (task 2a.11)
- [ ] Interim EM relationship removal procedure reviewed and in place, with named owner for follow-on removal change
- [ ] Threat model document covering scenarios identified in design.md Phase 0: TEAM-006 as escalation vector, EM account compromise, IdP claim manipulation, retroactive historical data exposure under Decision 6
