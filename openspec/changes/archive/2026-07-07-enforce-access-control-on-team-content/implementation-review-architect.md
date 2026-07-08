# Implementation Review: enforce-access-control-on-team-content

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect  
**Date:** 2026-07-07  
**Scope:** Architecture conformance — not code style or test coverage completeness  
**Files examined:**
- `packages/shared/src/types/team-content-access.ts`
- `packages/shared/src/types/team-content-views.ts`
- `packages/shared/src/types/session.ts`
- `packages/backend/src/auth/team-content-access-helper.ts`
- `packages/backend/src/content/team-content-serializers.ts`
- `packages/backend/src/content/timing-oracle.ts`
- `packages/backend/src/routes/content.ts`
- `packages/backend/src/routes/em-views.ts`
- `packages/backend/src/routes/facilitator-sessions.ts`
- `packages/backend/src/routes/sessions.ts`
- Supporting test files

---

## Summary Verdict

The core authorization infrastructure is correctly implemented and matches the design decisions. The discriminated union grant type, the authorization helper, the serializer separation, the draft session lazy expiry, the admin boundary, and the authorization-before-lookup pattern are all conformant. The implementation contains two issues I consider blocking before any content endpoint ships to production, and three items I consider advisory.

---

## Conformance Findings by Decision

### Decision 8 — TeamAccessGrant discriminated union

**CONFORMS**, with a positive deviation.

The type in `packages/shared/src/types/team-content-access.ts` matches the design specification. All three variants (`member`, `facilitator`, `admin`) carry `actorGlobalRole`. The `facilitator` variant carries `sessionStatus` as required. The `member` variant carries `role` as required.

The admin variant narrows `actorGlobalRole` to the literal type `"application_admin"` rather than `string`. This is stricter than the spec and provides a compile-time guarantee that no code path can construct an admin grant with a different role value. This is a correct improvement.

The helper returns `null` for no-access, not `false` or `undefined`, as specified. This is confirmed both in the implementation and in an explicit test case.

### Decision 9 — Three serializer/query pairs, no shared raw type

**CONFORMS.**

The three functions (`serializeForMemberParticipant`, `serializeForMemberEM`, `serializeForFacilitator`) accept nominally distinct query result types (`ParticipantQueryResult`, `EMQueryResult`, `FacilitatorQueryResult`). The types use a `__brand` field for nominal separation, preventing accidental cross-path use at compile time.

The attribution boundary at the query layer is correctly enforced: `EMQueryResult` does not include `voter_id` in its row type at all. The `buildEMQueryResult` function signature excludes `voter_id` from its parameter type. If the EM SQL query returns a voter_id column (e.g., because a prior query or join accidentally included it), that column is dropped by the type system before reaching the serializer. This is the correct defense-in-depth approach: the boundary is enforced at the query builder layer, not inside the serializer.

The `serializeForMemberEM` function has no code path that could expose voter identity. The `serializeForMemberParticipant` function correctly uses `row.voterId === result.callerUserId` to expose only the caller's own vote value, never another voter's.

### Decision 3 — Draft session lazy expiry

**CONFORMS.**

The authorization helper at `packages/backend/src/auth/team-content-access-helper.ts` lines 166–178 contains exactly the SQL condition specified in the design:

```sql
OR (
  s.status = 'draft'
  AND s.created_at + INTERVAL '24 hours' > NOW()
)
```

The condition is evaluated inline by the database on each authorization call. No background task exists or is needed. The comment in the implementation explicitly documents the lazy expiry rationale, referencing Decision 3. The corresponding test case ("returns null for a draft session older than 24 hours") verifies that the DB returning no rows (because the SQL condition excludes the stale draft) results in `null` from the helper.

### Decision 2 — Admin grant Option B

**CONFORMS.**

The helper returns `{ path: 'admin', actorGlobalRole: 'application_admin' }` for all Application Admin callers unconditionally, without examining which endpoint is calling. The scope enforcement is left entirely to the calling handler, as the design specifies.

In `content.ts`, every content endpoint handler checks for `grant.path === 'admin'` after receiving the grant and routes to `denyAdminContentAccess()`, which writes the audit log entry (including HTTP status 403) before returning the 403 response. The audit entry is written on every admin content access attempt, including denied attempts, as Decision 2 requires.

### Decision 9 — Pre-reveal constraint at two independent layers

**CONFORMS.**

The authorization layer grants facilitator access correctly via the session status check. The serializer layer enforces the pre-reveal constraint independently at `team-content-serializers.ts` lines 285–298, checking `row.revealStatus === 'revealed'` before populating the `votes` array. If the reveal check were removed from the serializer, vote values would appear for unrevealed topics regardless of authorization state.

All four named integration tests from the design are present:
- `facilitator-unrevealed-topic` — verifies vote values absent
- `facilitator-revealed-topic` — verifies full attribution present
- `layer-removal-serializer-check` — verifies the serializer check is independently load-bearing
- `layer-removal-auth-check` — verifies the authorization check is independently load-bearing

The `layer-removal-serializer-check` test implements a stripped-down serializer without the reveal guard and proves it produces different (incorrect) output. The `layer-removal-auth-check` test shows that bypassing auth allows the serializer to execute for an unauthorized caller. Both tests demonstrate the necessity of each enforcement point independently.

### Item 6 — `status = 'complete'` enum value

**CONFORMS.**

The value `'complete'` (not `'completed'`) is used consistently throughout. It appears in:
- `SessionStatus` type definition in `packages/shared/src/types/session.ts`
- Authorization helper SQL: `s.status = 'complete'`
- `content.ts` trend query: `s.status = 'complete'`
- `em-views.ts` session status check: `sr.status !== "complete"`
- `facilitator-sessions.ts` complete transition: `SET status = 'complete'`

The authorization helper includes a code comment noting the verification: "The check uses sessions.status = 'complete' (no trailing 'd') — verified against existing codebase."

### Decision 7 — Authorization-before-lookup pattern

**CONFORMS in content.ts.**

Every handler in `content.ts` calls `evaluateTeamAccess` as the first database operation and returns early on null or admin grants before executing any resource query. The pattern is clean and consistent across all five endpoints. The test suite verifies that unauthorized requests result in exactly two DB calls (Q1: user+membership, Q2: facilitator session check) and no additional resource queries.

**PARTIAL CONFORMANCE in em-views.ts** — see advisory item below.

### Decision 7 — 403/404 consistent error behavior

**CONFORMS** for the primary case: unauthorized callers to team content endpoints receive 403 without resource existence being confirmed.

**MINOR ISSUE** in the single-session endpoint — see blocking item 2 below.

---

## Blocking Issues

### Blocking Issue 1: `serializeContentResponse` passes `"sessions"` as sessionId to EM and participant query builders

**File:** `packages/backend/src/routes/content.ts`, lines 496–514  
**Severity:** Bug in response shape — incorrect data reaches client

In `serializeContentResponse`, the EM and participant paths call the query builders with string literals rather than actual values:

```typescript
// EM path
const result = buildEMQueryResult(
  "sessions",   // literal string — not a session ID
  rows as Parameters<typeof buildEMQueryResult>[1],
);

// Participant path
const result = buildParticipantQueryResult(
  "sessions",   // literal string — not a session ID
  "active",     // literal string — not the actual session status
  callerUserId,
  rows as Parameters<typeof buildParticipantQueryResult>[3],
);
```

The `GET /api/v1/teams/:teamId/sessions` endpoint is a session history endpoint that returns data across multiple completed sessions for a team. The `EMContentView` and `ParticipantContentView` types both have a `sessionId: string` field. A client receiving this response will see `sessionId: "sessions"` and `sessionStatus: "active"` (for participants), regardless of the actual session data in the rows. The existing test suite does not catch this because the E2E content tests do not assert on `response.sessionId`.

This is a data correctness bug, not a security bug. The serialized response shape is structurally wrong for the session history case. The root cause is that `EMContentView` and `ParticipantContentView` are designed for single-session views, but the `/teams/:teamId/sessions` endpoint is returning multi-session history through them.

This needs to be resolved before the endpoint ships. Either the response types need to be extended to represent session history (a list of session-scoped views) or the endpoint needs to be restructured so each session history entry carries its correct session ID and status.

### Blocking Issue 2: Cross-team session identifier probe via `GET /teams/:teamId/sessions/:sessionId`

**File:** `packages/backend/src/routes/content.ts`, lines 356–378  
**Severity:** Minor information disclosure gap in the 403/404 consistency requirement

The handler for the single-session endpoint queries sessions by ID without filtering by team_id:

```sql
SELECT id, team_id, status FROM sessions WHERE id = $1
```

If the session exists but belongs to a different team, the handler returns `denyAccess()` (403). If the session does not exist anywhere, the handler returns 404. An authorized Team A member who possesses a session UUID from Team B receives 403 (not 404), which confirms that the session UUID exists somewhere in the system and belongs to a different team.

Decision 7 states the 403/404 consistency rule without scoping it to "only for unauthorized callers." The correct query is:

```sql
SELECT id, team_id, status FROM sessions WHERE id = $1 AND team_id = $2
```

With this change, the handler returns 404 in both the "session doesn't exist" case and the "session exists but belongs to a different team" case, and the authorized caller cannot distinguish them. Session IDs are UUIDs so enumeration is not computationally feasible, but the principle of not confirming cross-team resource existence should be enforced regardless.

---

## Advisory Items

### Advisory 1: `em-views.ts` routes do not use `evaluateTeamAccess`

**File:** `packages/backend/src/routes/em-views.ts`  
**Severity:** Design conformance gap (not a security gap in itself)

The EM-specific routes under `/api/v1/teams/:teamId/em/` use a local `checkEmAuthorization` function that returns `{ authorized: boolean; globalRole?: string }` rather than the shared `TeamAccessGrant` type. These routes do not call `evaluateTeamAccess`.

The design's primary goal is "a single reusable server-side authorization helper that every content endpoint calls." The em-views routes are content endpoints (they return session data, trend data, action items). The fact that they use a locally defined function — which returns a boolean rather than a typed grant — means they are outside the shared authorization contract.

This may be because `em-views.ts` predates this change (it was built in `establish-manager-team-relationship`). If so, migrating these routes to use `evaluateTeamAccess` was either in scope and missed, or explicitly deferred. The deference should be documented if intentional.

Practical risk: the local `checkEmAuthorization` function is narrower (it only admits `engineering_manager` callers), so it does not represent a privilege escalation risk. But it creates two parallel authorization code paths that can diverge independently over time.

### Advisory 2: `em-views.ts` routes do not apply `applyTimingFloor`

**File:** `packages/backend/src/routes/em-views.ts`  
**Severity:** Missing control on existing content endpoints

Decision 7 states that the timing oracle mitigation is a blocking design requirement applying to all content endpoint responses. The `em-views.ts` routes return session history, trend data, and action items — they are content endpoints. None of them call `applyTimingFloor`.

The `content.ts` routes correctly apply `applyTimingFloor` on every code path (including denied and authorized). If the em-views routes are treated as content endpoints under Decision 7 (which they are), they should also apply the floor.

This is advisory and not a current production risk because no content endpoint is yet deployed. It should be resolved before any of the em-views endpoints ship.

### Advisory 3: WebSocket authorization deferred with explicit gate dependency

The e2e test file documents: "Task 11.3 — WebSocket revocation: blocked by Group 9 gate (engineering lead must confirm WebSocket latency bound; no WebSocket infrastructure exists in this codebase)." Decision 5's delivery-time authorization for the four named WebSocket events is not implemented.

This is correctly documented as a gate-blocked deferral, not an omission. No WebSocket infrastructure exists to implement it against. When the real-time layer is built, Decision 5's requirements apply in full and must not be weakened by citing implementation complexity after the fact. The timer-based fallback in Decision 5 is an escape valve that requires a specific, documented latency bound — "meaningful intervals" is not acceptable.

I am not flagging this as a blocking issue for this change because the prerequisite infrastructure does not exist. I am flagging it as an architectural commitment that must be honored when it does.

---

## Timing Floor Measurement Requirement (Restatement)

The `TIMING_FLOOR_MS = 150` value in `timing-oracle.ts` is explicitly documented as a development-time placeholder that must be replaced with a measured p95 or p99 value before any content endpoint reaches production. The code comments, the operations runbook stub, and the tests all correctly reflect this. I am confirming that the measurement requirement is understood and that 150ms must not remain as the production floor without measurement evidence.

The measurement must be performed against the highest-latency content endpoint under realistic database load, not in a test environment. The result must be documented in the operations runbook with the measurement date, the measured distribution, and the selected floor value. This is a prerequisite to production deployment, not a follow-on task.

---

## Architecture Verdict

The core enforcement infrastructure — `evaluateTeamAccess`, the `TeamAccessGrant` type, the three serializers, the pre-reveal two-layer enforcement, the admin boundary, the audit logging, the cache prohibition, the 403/404 consistency in content.ts, and the lazy draft expiry — is correctly built and matches the design decisions. This is a solid authorization foundation.

The two blocking issues are correctness problems, not security vulnerabilities. They should be fixed before any content endpoint is deployed. The three advisory items reflect integration gaps between this change and pre-existing routes that were not brought into conformance with the new shared contract.

I will not sign off on production readiness for content endpoints until the timing floor is measured and documented, the two blocking issues are resolved, and the em-views routing decision (migrate to `evaluateTeamAccess` or explicitly defer with documented justification) is made explicit.
