# Implementation Security Review: Assign a Role to a Team Member

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-07-06
**Change:** assign-role-to-team-member
**Prior review:** design-review-security.md (design sign-off, conditional on R1–R9)
**Files reviewed:**
- `packages/backend/src/routes/teams.ts`
- `packages/backend/migrations/6_role_change_audit.sql`
- `packages/backend/src/app.ts`
- `packages/backend/src/routes/sessions.ts`
- `packages/backend/src/auth/audit-logger.ts`
- `packages/backend/src/auth/session-store.ts`
- `openspec/changes/assign-role-to-team-member/design.md`

**Disposition:** IMPLEMENTATION SIGN-OFF — all in-scope REQUIRED items from design-review-security.md are satisfied. Two observations recorded below.

---

## Summary

The implementation correctly addresses every security requirement I flagged as REQUIRED in the design review that falls within scope of this change. The authorization logic, audit log design, transaction discipline, Redis prohibition, CSRF posture, and WebSocket lock-in handling are each implemented as the design specified them. The code comments demonstrate that the implementation team understood the threat model, not just the mechanics. That is not always the case and it matters here — the comments at the authorization check, the Redis prohibition, and the per-operation DB read are explicit enough that a future reviewer can verify the intent without reconstructing it from design documents.

Two observations are recorded below. Neither blocks sign-off.

---

## Checkpoint 1: EM Authorization — Per-Team DB Query Against URL Path `teamId`

**Result: SATISFIED**

The `checkAssignRolesAuthorization` function in `teams.ts` (lines 27–58) executes a parameterized query joining `users` and `team_memberships` with `tm.team_id = $2`, where `$2` is the `teamId` from the request path parameter. The function is called from the PATCH handler as `checkAssignRolesAuthorization(session.userId, teamId)` where `teamId` is `request.params.teamId`. Session state is used only to obtain the actor's user ID; the authorization decision itself is made from the database row, not from any claim stored in the session.

The cross-team attack path (R1, Section 2d of design-review-security.md) is closed. An EM on Team A calling `PATCH /api/v1/teams/team-b-id/members/:userId/role` will receive a LEFT JOIN result with `membership_role = null` for team B and the `authorized` flag will be false, yielding a 403. The function cannot return `authorized: true` for a team the actor does not have an active `engineering_manager` membership row on, regardless of their global role, unless they are an `application_admin`.

The code comment at lines 17–26 documents this requirement in a form that a code reviewer can verify directly against the implementation. That is the right approach.

---

## Checkpoint 2: Audit Log — `actor_global_role`, `actor_ip`, Same Transaction

**Result: SATISFIED, with one observation**

The `role_change_audit` INSERT in the PATCH handler (lines 308–322 of `teams.ts`) is executed between `BEGIN` (line 274) and `COMMIT` (line 325). The catch block calls `ROLLBACK` before re-throwing. A role change with no audit record is not a possible outcome — if the INSERT fails, the transaction rolls back and the UPDATE does not commit. This is the correct implementation of Decision 7's transaction requirement (R4 from design-review-security.md).

The INSERT populates:
- `actor_global_role` from the `actorGlobalRole` return value of `checkAssignRolesAuthorization`, which reads `u.global_role` directly from the `users` table at request time.
- `actor_ip` from `request.ip`, which resolves to the real client IP given `trustProxy: 1` configured in `buildApp()`.

The migration (`6_role_change_audit.sql`) stores `actor_global_role` as `text NOT NULL` rather than as a foreign key or enum, with an explicit comment explaining why: audit durability in the event the enum is extended. This is the right call — an audit record must remain readable regardless of future schema changes.

**Observation O1:** `actorGlobalRole` is captured during the authorization check, which runs before `BEGIN` is called. The value is then written inside the transaction. In theory, if the actor's `global_role` were modified concurrently between the authorization check and the audit INSERT — a separate, privileged operation on the `users` table — the logged role could reflect the pre-change value rather than the value at commit time. On a small-population internal application where `global_role` changes require Application Admin access, this window is negligible in practice. I am recording it so the design team is aware; it does not warrant a design change at this time. If a separate audit destination with stronger consistency guarantees is introduced in a future change (Section 5c of design-review-security.md), this edge case should be revisited.

---

## Checkpoint 3: WebSocket Lock-In — Per-Operation DB Reads, Not Connection-Time Values

**Result: SATISFIED**

The lock-in handler in `sessions.ts` (lines 153–298) executes a fresh parameterized query to `users` and `team_memberships` on each invocation (lines 223–236). The query is structurally identical to the one used in the authorization helper in `teams.ts` — a LEFT JOIN on `team_memberships` filtered by `team_id` from the session row, not from the HTTP session or any connection-level state.

The comment at lines 214–222 is explicit: "Read membership_role FROM THE DATABASE at this exact moment. NOT from the session, a WebSocket connection-time cache, or any in-memory store." This satisfies R6 from design-review-security.md. A user whose role is changed from `participant` to `engineering_manager` after a connection is established will be rejected on their next lock-in attempt, not on their next reconnection.

The handler also correctly checks both `global_role` and `membership_role` (the `||` condition at lines 254–257), consistent with Decision 1's two-layer role model. A user with `global_role = 'engineer'` and `membership_role = 'engineering_manager'` is correctly refused.

The session-join handler (`POST /api/v1/sessions/:sessionId/participants`, lines 37–136) applies the same dual-field check from the database. The prerequisite that the session-participation endpoint check both fields before role assignment shipped is met by this implementation.

---

## Checkpoint 4: Redis Prohibition — No Role Caching Introduced

**Result: SATISFIED**

The `SessionData` interface in `session-store.ts` stores only `userId`, `sessionCreatedAt`, and encrypted OIDC tokens. No `global_role` or `membership_role` fields appear in the session store schema. The Redis store implementation (`createRedisStore`) serializes and deserializes this interface; there is no path by which role data enters the Redis-backed session.

The PATCH handler, the lock-in handler, and the session-join handler each read role data exclusively from PostgreSQL. No Redis calls appear in any of the reviewed route files for role-related operations. The `redis.ts` module is a plain client export with no application-level logic attached to it. Decision 4's prohibition is respected throughout.

---

## Checkpoint 5: CSRF — Protection Confirmed on the PATCH Endpoint

**Result: SATISFIED**

The session cookie in `buildApp()` (`app.ts`, line 82) is configured with `sameSite: "strict"`. This prevents cross-site requests from carrying the session cookie, which is the correct CSRF mitigation for a session-cookie-authenticated application (R8 from design-review-security.md).

Two additional confirmations:

1. `"PATCH"` is present in the CORS `methods` array (`app.ts`, line 53: `["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]`). The Migration Plan in `design.md` flagged this as a prerequisite one-line change. It is in place. Without it, browser pre-flight requests for the PATCH endpoint would have been blocked by the missing `PATCH` in `Access-Control-Allow-Methods`, which would have caused a network-error failure mode rather than a 4xx — a misdiagnosis risk that the design correctly anticipated.

2. The PATCH handler does not accept credentials via query string or any other mechanism that would bypass SameSite enforcement. The `session.userId` comes exclusively from the server-side session cookie.

---

## Checkpoint 6: Real-Time Event Scope — Task Group 6 Deferred, No Broadcast Logic Introduced

**Result: SATISFIED**

There is no WebSocket infrastructure in the reviewed code. No socket connection pools, no broadcast calls, no event emission to connected clients. The PATCH handler emits a structured log entry (`team.role_changed`) via `emitAuditEvent` as an operational alerting path, not a WebSocket event. This is a log write, not a broadcast.

Task Group 6's requirement — that the facilitator readiness grid reflect mid-session role changes in real time — is correctly deferred to the WebSocket infrastructure change, consistent with Decision 6. The implementation does not prematurely introduce any real-time mechanism. When Task Group 6 is implemented in the WebSocket change, Decision 6's constraint must be carried forward: role-change events must be scoped to the session facilitator and the directly affected user, not broadcast to all connected clients (R9 from design-review-security.md, pending in the WebSocket change).

---

## Checkpoint 7: Cross-Team Attack — URL Path `teamId` Validated Against DB Membership

**Result: SATISFIED**

This checkpoint is substantially covered by Checkpoint 1 (authorization helper) and is addressed again here from the subject-user side.

Before the transaction begins, the handler validates that the subject user (`userId` from the URL path) has an active `team_memberships` row for the `teamId` from the URL path (lines 229–249 of `teams.ts`). The query uses both `user_id = $1 AND team_id = $2`, where `$2` is the URL path parameter. A request targeting a user who is a member of a different team — or a fabricated user ID — returns a 404 before the transaction opens.

The two-parameter binding (`$1` = subject user ID, `$2` = team ID) is consistent throughout the handler. At no point does the authorization or subject-validation logic derive `teamId` from session state, claims, or an in-memory value. The URL path `teamId` is used as database input and verified by the database on every operation that touches it.

---

## Outstanding Items From design-review-security.md

For completeness, the following REQUIRED items from the design review are noted with their current status:

| # | Item | Status |
|---|---|---|
| R1 | EM authorization per-team from DB | Satisfied — Checkpoint 1 |
| R2 | Use case and API contract updated simultaneously | Out of scope for implementation review; resolved at design stage |
| R3 | actor_global_role in audit log | Satisfied — Checkpoint 2 |
| R4 | Audit write in same transaction | Satisfied — Checkpoint 2 |
| R5 | Retention/storage/access policy | Documented in design.md Decision 7; migration stores records with append-only intent. No application UI for deletion confirmed by absence of a DELETE route on the audit table. Operational retention enforcement (12 months) is outside code scope. |
| R6 | WebSocket per-operation check | Satisfied — Checkpoint 3 |
| R7 | Redis caching prohibited | Satisfied — Checkpoint 4 |
| R8 | CSRF confirmed on PATCH | Satisfied — Checkpoint 5 |
| R9 | Real-time event scoped to authorized recipients | Deferred to WebSocket change per Decision 6 — Checkpoint 6 |
| R10 | Bootstrapping mechanism (pre-production) | Not in scope for this change; must be resolved before first team onboarding |

The following RECOMMENDED items from the design review remain unaddressed in this implementation and are noted for the record:

- **Rate limiting on TEAM-005** (Section 6c): No rate limiting is implemented on the role assignment endpoint. This was flagged as RECOMMENDED, not REQUIRED. It should be tracked for the production hardening phase.
- **Session ID in audit record for mid-session changes** (Section 3): The `role_change_audit` table does not include an optional session ID column. Correlating a role change to a concurrent active session currently requires cross-referencing `changed_at` against session timestamps. Low operational cost to add in a follow-on migration.
- **self-demotion policy** (Section 2b): Not explicitly addressed in implementation. An EM can demote themselves (no self-exclusion in the code), which is the behavior I recommended permitting. The audit log captures it. No action required.

---

## Sign-Off

All seven security checkpoints are satisfied. The implementation honors the design's security commitments at the code level, not only at the comment level. The two observations recorded (O1: actorGlobalRole capture timing; rate limiting and session ID fields outstanding from RECOMMENDED items) do not affect the security posture of the deployed feature.

This change is cleared for production deployment, subject to:
1. R10 (bootstrapping mechanism security controls) being resolved before any team is onboarded.
2. R9 (real-time event scoping) being carried as a non-negotiable constraint into the WebSocket infrastructure change design before that change begins implementation.
