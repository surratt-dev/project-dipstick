## Context

TOPIC-002 (`routes/content.ts`) calls `checkStandingFacilitatorOrAdminAuthorization`. On `authorized: false` it applies the timing floor and sends one of two 403 messages. Nothing durable is written. The same helper serves TOPIC-003..007. Verified facts (see `exploration-notes.md` section 3): `audit_log.team_id` has no foreign key; `actor_global_role` is unconstrained TEXT and `'unknown'` is the existing convention for a missing users row; `actor_roles` NULL means "not captured" (migration 22); `readActorRoleSet` throws on zero rows by design; `TIMING_FLOOR_MS = 150`; #262's structural guard test does not exist yet; no audit signal feeds an alert (#131).

## Goals / Non-Goals

**Goals:** a durable, content-free record of each TOPIC-002 non-admin denial; identical response and timing behaviour; no disclosure to the caller.
**Non-Goals:** other endpoints, alerting, UI, the malformed-id 404, any change to the decision itself.

## Decisions

### D1. One operation, `topic.config_list_denied`, reason in metadata
Reuse of `topic.config_read_denied_role` (TOPIC-001, log-only) would mix durability semantics. Both reasons use one operation, no dedup, no reason-dependent "audit or not" branch (that would make the audit selectively blind). `FACILITATOR_IS_TEAM_MEMBER` is informational, `NOT_A_FACILITATOR` the probing signal. Row and event key sets are pinned by exact equality in tests. The denial event is emitted on every denial, including when the insert failed, with `rowWritten: boolean`, so the log copy and the reason survive exactly when the database copy is lost (Engineer E5). Event keys: `actorUserId`, `actorGlobalRole`, `actorIp`, `teamId`, `endpoint`, `httpStatus`, `reason`, `actorRoles` (`null` when no row was written or the roles are unavailable), `rowWritten`. Failure event keys (`topic.audit_write_failed`): `actorUserId`, `teamId`, `endpoint`, `operation`, `stage` (always `"audit_insert"`), `reason`, `failureMode` (`"error"` or `"timeout"`), `errorCode` (SQLSTATE or `null`). Both pinned in the `audit-logger.ts` comment. On a timeout `failureMode` is `"timeout"`, so the two causes are distinguishable. The issue's ACs require a durable row for `FACILITATOR_IS_TEAM_MEMBER` (and an integration test for it), so the VP Engineering's request to drop it was declined; the privacy concern is answered by the access and retention statement in D9.

### D2. Row contents and no team lookup
`team_id` stores the requested id as validated; `isCanonicalUuid` runs first in the handler (the malformed-id 404 is untouched and writes no row), so `team_id` is always a valid UUID for the `UUID` column. A future reorder of that check would turn into an insert error. Metadata is exactly `{ endpoint: TOPIC_002_ENDPOINT, http_status: 403, reason }`. No `teams` read, no topic or annotation read (test asserts no such query ran). No existence check: it would add a timing/oracle surface. `team_id` on this operation means "requested id", not "verified team" (Security F6): an authenticated user can seed rows under arbitrary team ids, and a per-team view of a real team may show rows triggered by a participant of another team. Endorsed; it avoids an existence oracle.

The caller's role set is captured inside the insert (D4). `actor_global_role` comes from the decision (D6): `'unknown'` when the helper found no users row.

### D3. Fail-open on the response, loud on the signal (RULED: Security P1, Tomas Ferreira; Architect concurs)

Note: issue #264 item 3 is headed "Fail closed" but its text recommends fail-open. Ruling: the issue body and the Security ruling win over the heading; recorded here.
One failure point on the denial path: the single audit insert statement (D4). The 403 never becomes a 200 or a 500.
- **Ruling: fail-open.** What is audited is a rejection, not a disclosure (in #232 the 500 stopped unaudited data leaving; here none leaves). Fail-closed would make `audit_log` availability a precondition for a refusal, and a 500 where a 403 is correct is itself an oracle. The codebase already has fail-open audit writes (`writeFailOpenAuditRow`, 500 ms bound).
- Hard requirements: (1) the 403 is byte-identical (status, `Content-Type`, body) on every failure path; (2) the failure event never carries `err.message` or `err.detail`; (3) scope of fail-open is exactly the audit insert, so anything else that throws on the denial path (including the helper call, `applyTimingFloor`, `reply.send`) stays 500, and the new try/catch wraps only the audit step; (4) the administrator arm stays fail-closed, both behaviours pinned by tests; (5) the timeout bounds the wait, not the query (Risks).
- A new event name, because `admin.audit_write_failed` (admin-typed) and `auth.audit_write_failed` (auth-typed) would mislabel a topic denial.
- The asymmetry with #232 (admin read = disclosure = fail-closed; non-admin denial = fail-open) is written into the spec and pinned by tests. The fail-closed dissent (detection value of the no-manager rule) was considered and not carried: the denial is still enforced; what is lost during an incident is a record of one attempt, and the failure event preserves who, where and why in logs.
- Implementation: a local sibling `runDenialAuditStep` in `content.ts`, next to `withAdminAuditFailureSignal`. Do NOT generalize `withAdminAuditFailureSignal` (its "emit then rethrow" contract is what keeps #232 fail-closed; a `rethrow` flag would make that guarantee depend on a parameter) and do NOT extend `writeFailOpenAuditRow` (no `actor_roles`, hard-coded `auth.audit_write_failed`, fixed timer, void return). The new step uses `withTimeout` and `AuditWriteTimeoutError` from `audit-write-timeout.ts`. Lift a tiny shared `sqlstateOf(err)` so the "SQLSTATE only, never `err.message`" rule has one implementation used by both wrappers.

### D4. Role set captured in the insert statement; no separate role read (RULED: Architect, resolving Engineer E1 against Security's role-read ruling)

Conflict: Security ruled that a role-read failure writes the row with `actor_roles = NULL` plus a denial event plus a failure event. Engineer E1 showed this contradicts the shared 500 ms budget (the common role-read failure is a timeout, which leaves the insert 0 ms). Ruling: take Engineer's option 1. The role set is read inside the insert, so there is no separate role-read step and no contradiction:

```sql
INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata, actor_roles)
SELECT $1::uuid, $2::text, $3::inet, $4::text, $5::uuid, $6::jsonb, u.roles::text[]
FROM (SELECT 1) s LEFT JOIN users u ON u.id = $1::uuid
RETURNING actor_roles
```

Every parameter carries an explicit cast (Security A1). In an `INSERT ... SELECT`, bare parameters in the SELECT list get no type inference from the target columns (unlike `VALUES`, as in the admin arm); they resolve as `text`, and the insert would then fail every time against the `UUID`, `INET` and `JSONB` columns. Because the path is fail-open, the only symptom would be a stream of `topic.audit_write_failed` events with no rows while the 403 keeps working. A mocked `db.query` cannot catch this, so the real-Postgres integration test (task 3.6) is mandatory for the two normal denial cases and cannot be replaced by unit tests. The query text is a constant string with numbered placeholders only; `$1` is reused for the join. A `request.ip` that is not a valid inet fails the insert (fail-open, event emitted), the same as the admin arm.

Why this honours Security's invariants rather than weakening them: (a) the row is written even when role information is unavailable, because a missing users row yields `actor_roles = NULL` through the LEFT JOIN, which is Security's "NULL means not captured" semantics; (b) there is one query, one timeout (`AUDIT_WRITE_TIMEOUT_MS`, 500 ms), one failure stage, and no remainder arithmetic, so the shared-budget claim ("worst case 500 ms") is now true by construction; (c) a role-read failure that is independent of the insert no longer exists. If the statement itself fails or times out there is no row, which is exactly Security's "if the insert also fails" outcome, and the 403 is unchanged.

Security-facing wording that changes: the `stage: "role_set_read"` value, the "role-set read fails" scenario, the "both steps fail / two failure events" scenario, and the 400 ms-read latency test are removed; `actor_roles` NULL now means "no users row" (`users.roles` is `NOT NULL`, so NULL is otherwise unreachable); the old "row with `actor_roles` NULL after a read failure" case is covered structurally. The 403 invariant, the fail-open scope and the admin fail-closed invariant are untouched.

Validation: the single-statement route skips `parseRoleArray`. This is justified, not hidden: the content of `users.roles` is guaranteed by the column itself (`user_role[] NOT NULL` with the `users_roles_well_formed` CHECK constraint, migration 21), not only by the code that writes it (#245); the value here is a verbatim copy for an audit column that is NULL-tolerant and feeds no decision and no metadata; and a validator that throws would reintroduce a failure point whose only effect is a lost row. The admin arm keeps `readActorRoleSet` plus `parseRoleArray` because it also uses the roles in its own logic and is fail-closed. The integration test asserts `actor_roles` equals the stored array in stored order. `RETURNING actor_roles` feeds the event's `actorRoles`; it is `null` when no row was written.

### D5. Log-only detectability accepted for this change (RULED: Security P2)
Accepted as a residual risk, not a closure. No `AuditEventName` signal is consumed by any alert (#131); #131 stays open and is cited in the PR, and this change must not be cited as evidence that audit-failure alerting exists. `topic.audit_write_failed` is emitted at error level (warn at minimum), stated in the `audit-logger.ts` comment, and `docs/deployment.md` says plainly: log-only, no consumer, tracked by #131, operators grep for it. Compensating signal (weak): the admin arm inserts into the same table and fails closed, so a sustained audit-table outage also surfaces as admin-read 500s. The failure event carries `reason` (Security F3, closed enum, content-free) so the log alone says which rule fired.

### D6. Additive `actorGlobalRole: string | null` on the denied decision (RULED: Architect P4; Engineer approved)
Approved as written. The helper already holds `grant`; `null` is exactly the "no users row" branch. Zero added queries and the handler cannot disagree with the decision about the role. The authorized variant is untouched, so the union still narrows and TOPIC-003..007 (which read only `authorized`, `reason`, and `actorGlobalRole` after narrowing) are unaffected. `null` stays in the helper; the handler maps it to `'unknown'` (no storage convention leaks into a shared authorization type). Conditions: (1) the helper header comment says the field is for audit by TOPIC-002 only and must never feed an admission decision (same discipline as `membership_role` in #208); (2) a direct assertion on the helper's three denied return sites: no row gives `null`, non-facilitator gives its role, member-facilitator gives `"facilitator"` (there is no direct helper test today). Rejected: re-reading `users.global_role` in the handler (extra query, TOCTOU disagreement).

### D7. Timing
Order: insert (carrying the role read), event, `applyTimingFloor`, send; on both reasons and on the failure path. The insert never sits between the floor and the send. `applyTimingFloor(startTime)` is measured from handler entry, so audit time is absorbed up to the 150 ms floor; a test with fake timers asserts a denial whose helper plus audit total 20 ms responds at about 150 ms, not 170 ms (Security F4). Known limit: under fail-open the insert is bounded by `AUDIT_WRITE_TIMEOUT_MS` (500 ms), longer than the floor, so a hanging database can make a denial slower than the floor. This leaks nothing about other users or teams and is a database-incident symptom, the exposure every fail-open audit path has.

### D8. Visibility and the guard
Requirement is the existing spec rule (every non-admin `audit_log` read filters by equality on one named operation), now naming `topic.config_list_denied`. Verified by a sweep recorded in the PR description (with the grep commands pasted so it is reproducible), which is the interim acceptance evidence until #262's guard exists. The sweep covers handlers, raw SQL in migrations, views and materialised views, any generic audit export or log-search route, and log-sink access, not only `routes/`. The only current non-admin read is `fetchConnectionRecoveries`, which filters on `session.connection_recovered`. The structural test stays #262's.

### D9. Access and retention statement (answers the VP Engineering's privacy concern)
`topic.config_list_denied` rows are not read by any application endpoint or screen, for administrators or anyone else: access is database and log-sink operators only. There is no UI surface, no aggregation, and no alerting (Security F1: the earlier "readable by administrators only" overstated what exists). Retention follows the existing `audit_log` policy unchanged (no table-specific purge exists today); volume equals denied TOPIC-002 requests, dominated by member-facilitator page loads. Product (P3) is asked to confirm. Adding any non-admin read path, aggregation, alerting or user-visible signal would require re-consulting the VP Engineering.

### D10. Baselines
The 403 baseline is a snapshot (status, `Content-Type`, body string) for each reason, committed before the handler edit. Actor IP source: `request.ip` (the `trustProxy` and rate-limit findings are gate task 0.4, recorded before the handler is written), as in the `admin.topic_config_accessed` row; the PR records whether Fastify `trustProxy` is configured to the real proxy hops (otherwise a client-controlled `X-Forwarded-For` lands in a security audit row; exposure is unchanged from the admin arm). A missing `users` row arises from a deleted user whose session is still live; the integration fixture deletes the row after login. Risk: session middleware may reload the user and 401 before the handler, making that fixture unreachable. This is verified in the gate (task 0.3) and the result recorded before the handler is written; if unreachable, cover it as a unit test with a stubbed helper result `{ authorized: false, reason: "NOT_A_FACILITATOR", actorGlobalRole: null }`.

## Test plan (aligned with D4)

There is no role-read step, so there is no "forced role read failure" case, no "role read, insert, event" ordering, and no two-failure-event case; those lines in the issue and earlier reviews are obsolete. Cases: insert failure, insert timeout, missing users row (row with NULL `actor_roles`), call order insert, event, floor, send. Unit tests assert the insert SQL text is a constant string with no request data interpolated (Security A2) and, on a denied request, that no recorded query reads `teams`, topics or annotations. The real-Postgres integration tests (3.6) prove the casts and assert every row column. Test file and fixture: `content.test.ts`, on the #259 SQL-routed fixture. Task order and which tests land with which build step are in tasks.md.

## Risks / Trade-offs

- Insert after the floor reveals the branch by timing: call-order test and floor-clock test.
- Helper change altering TOPIC-003..007: additive field, their tests run unchanged.
- The row becoming a profiling instrument: actor/team/reason only, visibility-guarded, no aggregation.
- 403 body drift: snapshot assertion.
- Benign `FACILITATOR_IS_TEAM_MEMBER` noise: expected; handled by labelling, not suppression.
- Pool pressure (Security F2, accepted): `withTimeout` stops the wait, not the query, so during a slow database each denied request can hold a pool connection beyond 500 ms. Same exposure as every fail-open path, but the first reachable by a participant in a loop on a read endpoint. Needs an authenticated, attributable session.
- Write amplification (accepted residual, with mandatory follow-ups): any authenticated non-facilitator can write one row per request; there is no dedup by design (dedup would blind the audit under probing). Volume bound is one row per request. The only limiter found in the codebase is the topic write limiter (#184), which does not cover this GET. Before merge the PR states whether an edge or global per-IP or per-user limit covers the route. Rows are attributable by `actor_user_id` and `actor_ip`. Follow-ups (user files the issues; numbers are placeholders here): (1) bounded volume control using the episode shape of `topic.write_rate_limited` (first breach per window writes a row, later ones are counted in a log event; needs Redis, and that limiter's fail-open/closed choice is decided there): **#277**; (2) `docs/deployment.md` audit_log growth and retention statement plus a top-N denial-writers query: **#278** (the doc text itself is task 4.1).
- Log-only failure detectability (#131) and selective blindness during an incident: accepted by Security (D5).
- Migration 22's column comment ("populated only for auth.first_access_created and auth.role_claim_mapped") was already stale after #232; not altered here, but the registry comment for this operation says NULL `actor_roles` means "not captured or unavailable".

## Migration Plan

No migration. Deploy as a normal backend release. Rollback is a revert; existing rows are inert.

## Open Questions

- P1, P2 (Security) and P4 (Architect): ruled, see D3, D4, D5, D6. No blocking questions remain.
- P3 (Product): who consumes denial rows? If no one, the value is post-hoc reconstruction only, the SEC-13 rationale. Non-blocking.
- P5 (user): file the Topics-link / denial-copy follow-up issue and the two volume follow-ups (#277, #278) and cite the numbers in the proposal. This change does not create them.
