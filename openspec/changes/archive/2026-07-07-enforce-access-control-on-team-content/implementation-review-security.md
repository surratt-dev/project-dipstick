# Security Review — enforce-access-control-on-team-content

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-07-07
**Scope:** Implementation files in `packages/backend/src/` introduced or modified by this change

Files reviewed:
- `packages/backend/src/auth/team-content-access-helper.ts`
- `packages/backend/src/auth/__tests__/team-content-access-helper.test.ts`
- `packages/backend/src/content/team-content-serializers.ts`
- `packages/backend/src/content/__tests__/team-content-serializers.test.ts`
- `packages/backend/src/content/timing-oracle.ts`
- `packages/backend/src/content/__tests__/timing-oracle.test.ts`
- `packages/backend/src/routes/content.ts`
- `packages/backend/src/routes/__tests__/content.test.ts`
- `packages/backend/src/routes/__tests__/e2e-content-auth.test.ts`
- `packages/backend/src/routes/facilitator-sessions.ts`
- `packages/backend/src/routes/teams.ts` (admin audit coverage)
- `packages/backend/src/routes/em-views.ts` (system-wide rule coverage)
- `packages/backend/src/auth/audit-logger.ts`

---

## Summary

The core authorization infrastructure introduced by this change is sound. The helper implements the correct priority ordering, the facilitator SQL includes all required conditions, the serializer's reveal-status check is genuinely independent of the authorization check, and the timing oracle design is correct in principle. I have one pre-production blocking finding and two implementation gaps that must be resolved before any of this code is deployed. The remaining observations are lower severity but require a documented disposition.

---

## Finding 1 — BLOCKING — em-views.ts does not set Cache-Control: no-store (Decision 6)

Decision 6 requires all content endpoints to set `Cache-Control: no-store`. The change correctly applies this requirement to the six endpoints in `content.ts` via the `noStore()` helper and the denial guards (`denyAccess`, `denyAdminContentAccess`). The requirement is then stated as a system-wide rule in the design's goal list.

The six EM-facing routes in `em-views.ts` (SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, ACTION-005) do not set `Cache-Control: no-store`. Every response path in that file uses bare `reply.code(N).send(...)` or `reply.send(response)` without a Cache-Control header. These routes return session content — vote distributions, trend data, action items — that is subject to the same caching risk that Decision 6 was written to address.

Without this header, a browser is free to cache a successful EM response and serve it from cache to a subsequent user who accesses the same URL from the same browser. The risk is most acute in shared-workstation environments, which are common in engineering offices.

**Required fix:** Add `Cache-Control: no-store` to all response paths in `em-views.ts`, including 403 denial paths, 404 paths, and all 200 data paths. The simplest approach is a Fastify `onSend` hook scoped to the EM routes that appends the header unconditionally, which avoids per-route additions that are easy to miss on future extensions.

**Blocked by this finding:** The EM content routes should not be deployed to production in their current form.

---

## Finding 2 — BLOCKING — em-views.ts does not apply the timing oracle (Decision 7)

Decision 7 is stated as a system-wide blocking design requirement: all content endpoint responses — both authorized and denied — must apply a constant minimum response time floor at the 95th or 99th percentile of authorized-request latency. The stated rationale is that an attacker who can observe response time distributions can statistically distinguish "resource exists, caller unauthorized" from "resource does not exist" even when both return 403 with identical bodies.

`content.ts` correctly wraps every response path — authorized and denied — with `applyTimingFloor(startTime)` before the reply is sent. `em-views.ts` applies no timing floor anywhere.

The EM routes are structured as authorization check first, then resource query. A caller who fails the dual authorization check (not an EM, or not associated with this team) receives a 403 after one database round-trip. A caller who passes authorization receives a response after multiple database round-trips and application-side aggregation. This latency difference is measurable. An attacker who probes many team IDs can build a statistical model from response times that distinguishes "I am not authorized for this team" (fast 403) from "I am authorized but the team is empty" (slower 200) without requiring any change to response codes or bodies.

**Required fix:** Apply the same `applyTimingFloor()` mechanism from `content.ts` to every response path in `em-views.ts`. This requires the same measurement exercise specified in Decision 7 — the floor value must be calibrated against actual authorized-request p95/p99 latency under realistic load, not derived analytically.

**Blocked by this finding:** The EM content routes should not be deployed to production in their current form.

---

## Finding 3 — PRE-PRODUCTION BLOCKER — Timing floor value is a development placeholder

The constant `TIMING_FLOOR_MS = 150` in `timing-oracle.ts` is explicitly documented as a development-time placeholder. The file and the inline comments both state that this value must be replaced with a measured p95 or p99 of authorized-request latency under realistic database load before any content endpoint reaches production.

This is not a code defect — the code correctly documents the requirement and the test in `timing-oracle.test.ts` verifies floor mechanics. It is a deployment gate: the measurement must be performed, the constant must be updated, and the measurement results must be recorded in the operations runbook before the first content endpoint ships. The design's Decision 7 lists this as a four-step prerequisite with a measurement artifact as a required output.

**Required action:** Complete the p95/p99 latency measurement under realistic database load, update `TIMING_FLOOR_MS` to the measured value, and document the measurement in the operations runbook. This is a named pre-production requirement from the design, not a suggestion.

---

## Finding 4 — OBSERVATION — EM read-access audit log writes occur outside a transaction with no paired data write

For write operations (TEAM-005 role change, TEAM-006 manager association), the audit log INSERT is correctly written inside the same database transaction as the data modification. If the audit INSERT fails, the transaction rolls back and neither the data change nor the audit record is committed. This is the correct atomicity model for writes.

For EM read operations in `em-views.ts`, the audit log INSERT is a standalone `db.query()` executed after the data has been fetched from the database but before the response is sent. There is no data write to pair it with, so a transaction is not mechanically available.

The risk is this: if the audit INSERT fails (for example, a transient database connection error), the handler throws and Fastify returns a 500 to the client. The client receives no data. But the database read has already occurred — the data was fetched into application memory. The access attempt is unlogged, and there is no record that the EM retrieved the data. The client-visible failure makes exploitation unlikely in practice (the attacker receives a 500, not data), but the audit trail has a gap.

This pattern is visible in SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, and ACTION-005. In all six handlers, the data fetch occurs before the audit INSERT.

**Recommendation:** Reorder these handlers so the audit INSERT executes before the data is fetched from the database. If the audit INSERT fails, the handler returns 500 before any data has been read — the access attempt that didn't produce data is still loggable at the call level, but more importantly, no data is placed in application memory before the audit record is established. This does not require a transaction; it only requires reversing the ordering of the fetch and the audit write.

---

## Check 1 — Cache-Control: no-store on content.ts endpoints — PASS

All six content endpoints in `content.ts` (session history, trends, action items, topics, single session, live session) set `Cache-Control: no-store` on every response path. The `denyAccess()` function sets it on null-grant 403 responses. The `denyAdminContentAccess()` function sets it on admin-denied 403 responses. The `noStore()` helper sets it on all authorized 200 responses. Tests in `content.test.ts` verify the header is present on denied and authorized responses.

ORM-level query caching: node-postgres (`pg`) does not cache queries. The authorization helper comment documents this explicitly. No ORM caching configuration is present in `db.ts`.

Application-session caching: `evaluateTeamAccess()` is called on every request, derived from the database, and the result is not stored in the session cookie or any per-request cache. The comment at the top of `content.ts` explicitly documents that "authorization is derived from the database (not from the session cookie's role snapshot) on every request." The test `executes live DB reads on every call` in the helper test suite verifies no cross-call shared state.

---

## Check 2 — Consistent 403/404 behavior in content.ts — PASS

The authorization check executes before any resource query in all five content endpoints. The test `returns 403 for null grant WITHOUT querying any resources` verifies this by asserting exactly two DB calls (user+membership, facilitator session) with no additional resource queries after a denied request.

The 403 denial body from `denyAccess()` contains a generic message ("You do not have access to this team's content.") and a correlation ID. It does not include the team ID, session ID, or any identifier that would confirm the resource exists. Both "team found, caller unauthorized" and "team not found" produce the same 403 response code, body structure, and message. The test `returns 403 (not 404) for unauthorized caller to nonexistent team` verifies this.

The timing oracle mechanism in `timing-oracle.ts` is correctly implemented: `applyTimingFloor(startTime)` subtracts elapsed time from the floor constant and sleeps only the remainder. If the elapsed time exceeds the floor, no delay is applied. This ensures that faster-than-floor responses are padded to the floor without penalizing slower authorized responses. The tests in `timing-oracle.test.ts` verify both the fast-path (no delay needed) and slow-path (delay applied) branches.

**Note on authorized caller to nonexistent session (GET /api/v1/teams/:teamId/sessions/:sessionId):** An authorized caller who queries a session ID that does not exist receives a 404 with `message: "Session not found."` This is the correct behavior — an authorized caller is entitled to know that a specific session ID does not exist within their team's scope. The 403/404 consistency requirement from Decision 7 applies to the unauthorized path, not to the authorized-caller-resource-missing path.

---

## Check 3 — Application Admin audit logging — PASS

**Denied admin requests to session content endpoints:** The `denyAdminContentAccess()` function in `content.ts` writes an `audit_log` INSERT via `await db.query()` before the 403 response is sent. The INSERT includes `actor_user_id`, `actor_global_role`, `actor_ip`, `operation` ("admin.session_content_denied"), `team_id`, and a metadata JSONB containing `endpoint` and `http_status: 403`. The `emitAuditEvent()` call follows immediately, also before the reply is sent. The test `returns 403 and writes audit log for Application Admin request (Task 5.12)` verifies the INSERT occurs and the metadata includes `http_status: 403`.

**Permitted admin reads of administrative data:** `GET /api/v1/teams/:teamId/members` and `GET /api/v1/teams/:teamId` in `teams.ts` both write `audit_log` entries (operations `admin.membership_list_accessed` and `admin.team_detail_accessed`) when `global_role === "application_admin"`. Both include the required fields. Both write the audit entry before the response is sent.

The `emitAuditEvent()` function in `audit-logger.ts` correctly handles the log-level suppression risk: it creates a child logger and explicitly sets `auditLogger.level = "info"` before emitting. This ensures audit events are written regardless of the application-wide log level, which addresses the scenario where the application log level is raised to "warn" or "error" in production.

---

## Check 4 — Pre-reveal serializer enforcement — PASS

The reveal-status check in `serializeForFacilitator()` is at line 285-298 of `team-content-serializers.ts`:

```typescript
if (
  row.revealStatus === "revealed" &&
  row.voterId !== null &&
  row.voterDisplayName !== null &&
  row.voteValue !== null
) {
  topic.votes.push({ voterId, voterDisplayName, voteValue });
}
```

This check runs on every row, inside the topic-building loop, without any reference to the grant object. It is structurally independent of the authorization check. A caller who somehow bypasses the authorization layer and reaches `serializeForFacilitator()` with a valid `FacilitatorQueryResult` will still receive an empty `votes` array for any topic whose `revealStatus` is not "revealed."

**Layer independence test:** The `layer-removal-serializer-check` test simulates removing the reveal check by implementing `serializeForFacilitatorWithoutRevealCheck()` inline. The test verifies that the broken serializer exposes `voteValue: 3` for an unrevealed topic, while the correct serializer produces an empty votes array. The test then asserts the two outputs differ — proving the check is load-bearing. The `layer-removal-auth-check` test proves the authorization layer is independently necessary by showing that bypassing it delivers real vote attribution data to an unauthorized caller. Both named tests are present.

**Attribution boundary at query layer:** The EM query in `buildSessionHistoryQuery()` forces `NULL::uuid AS voter_id` and `NULL::text AS voter_display_name` at the SQL level. Voter identifiers never enter application memory for the EM path. The EM serializer (`serializeForMemberEM`) does not include `ownVoteValue` or any voter identity field, enforced by the distinct `EMQueryResult` type with branded separation from `ParticipantQueryResult`.

---

## Check 5 — Audit log atomicity — CONDITIONAL PASS

**Write operations:** The TEAM-005 role change (PATCH `/api/v1/teams/:teamId/members/:userId/role`) writes the audit log inside the same `BEGIN`/`COMMIT` transaction as the `team_memberships` UPDATE. If the audit INSERT fails, `ROLLBACK` is called and neither the role change nor the audit record is committed. Same pattern applies to TEAM-006 (POST `/api/v1/teams/:teamId/managers`). This satisfies the atomicity requirement for data write operations.

**Read operations:** The audit log writes for EM read access (em-views.ts) and admin denied access (content.ts `denyAdminContentAccess`) are standalone `db.query()` calls outside any transaction. This is expected — there is no data modification to pair them with. For the admin denial case, the await on the audit INSERT ensures completion before the 403 is sent; if the INSERT fails, the handler throws and the admin receives a 500, which is acceptable. For EM reads, see Finding 4 above regarding the ordering concern.

---

## Check 6 — facilitator_access_expires_at / grace window — PASS

The expiry check for the 30-minute post-session grace window is entirely within the SQL query in `team-content-access-helper.ts` (lines 167-176):

```sql
OR (
  s.status = 'complete'
  AND s.facilitator_access_expires_at > NOW()
)
```

The application code checks only whether the query returned rows. There is no application-level datetime comparison — the database evaluates the condition against its own `NOW()` at query time. This is the lazy SQL check pattern required by the design; an application-level post-query check (comparing the returned `facilitator_access_expires_at` value against `new Date()`) would introduce a TOCTOU gap between the time the field is read and the time it is compared.

The draft session 24-hour check follows the same pattern:

```sql
OR (
  s.status = 'draft'
  AND s.created_at + INTERVAL '24 hours' > NOW()
)
```

Both expiry conditions are evaluated in-database at read time.

The `facilitator_access_expires_at` column is set server-side in `facilitator-sessions.ts` when the session completes:

```sql
UPDATE sessions
SET status = 'complete',
    completed_at = NOW(),
    facilitator_access_expires_at = NOW() + INTERVAL '30 minutes'
WHERE id = $1
```

This is a single-statement UPDATE that sets both the status and the expiry field atomically. The column is not exposed to client input, and the design note that the window cannot be shortened from within the application (requiring a direct database write to override) is implemented correctly — no endpoint accepts `facilitator_access_expires_at` as a request parameter.

---

## Additional Observation — Trend data endpoint does not scope votes to revealed topics (em-views.ts TREND-001/002)

The EM trend routes (`/api/v1/teams/:teamId/em/trends`, `/api/v1/teams/:teamId/em/trends/:topicId`) aggregate votes across all complete sessions without checking `session_topics.status`. Since the query's `WHERE s.status = 'complete'` filter restricts to complete sessions, and complete sessions would have all topics in a post-reveal state in the normal session flow, this is unlikely to expose pre-reveal data in practice. However, if a session somehow reaches `status = 'complete'` with topics in a non-revealed state (a state machine anomaly or a bug in the completion path), trend data for those topics would include their vote values without the reveal gate.

This is a defense-in-depth gap, not a confirmed data exposure. The session state machine's transition guards are the primary defense. I recommend adding `AND st.status = 'revealed'` to the trend query's join condition as belt-and-suspenders, consistent with the two-layer enforcement principle in Decision 9.

---

## Disposition Required Before Production Deployment

| ID | Severity | Finding | Required Action |
|---|---|---|---|
| F1 | Blocking | em-views.ts missing Cache-Control: no-store | Add header to all em-views.ts response paths |
| F2 | Blocking | em-views.ts missing timing oracle | Apply applyTimingFloor() to all em-views.ts response paths |
| F3 | Blocking | Timing floor is a placeholder (150ms) | Measure p95/p99 latency, update constant, document results |
| F4 | Observation | EM read-access audit write occurs after data fetch | Reorder: audit INSERT before data fetch in em-views.ts handlers |
| F5 | Observation | Trend query aggregates regardless of topic reveal status | Add `AND st.status = 'revealed'` to TREND-001/002 queries |

Items F1, F2, and F3 are blockers. I will not sign off on production deployment of the EM content routes or the new content routes until these three items are addressed. Items F4 and F5 require a documented disposition (fix or accepted risk) before production but do not constitute a hard block on their own.
