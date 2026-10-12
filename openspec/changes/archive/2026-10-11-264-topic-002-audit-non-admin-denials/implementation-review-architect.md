# Implementation review: Solution Architect (Ingrid Sollenberger)

Change: 264-topic-002-audit-non-admin-denials. Scope reviewed: `git diff main...HEAD` (6 commits) against design.md D1-D10. Working tree is clean apart from the untracked change directory.

## Conformance to the design

- D3 (fail-open scope): `runDenialAuditStep` wraps only the insert. The helper call, `applyTimingFloor` and `reply.send` sit outside the try/catch, so they stay 500. `withAdminAuditFailureSignal` is untouched except for the `sqlstateOf` lift, which is behaviour-neutral. `writeFailOpenAuditRow` is not extended. Both match the design. The new `withTimeout` and `AuditWriteTimeoutError` are reused, not reimplemented. Failure event keys are exactly the eight in D1, and it carries SQLSTATE only.
- D4 (single-statement insert): the SQL is a constant string with numbered placeholders and explicit casts on every parameter. `LEFT JOIN users` gives NULL `actor_roles` for a missing row, and `RETURNING actor_roles` feeds the event. There is one query, one timeout and one failure stage, and no `parseRoleArray`, as justified in D4.
- D6 (helper): the field is additive on the denied variant only. All three denied return sites are populated: `null`, the role, and `facilitator`. The header comment states the audit-only, never-admission rule. The helper test adds direct assertions on the three sites. Every other non-test caller of the helper is in `topics.ts` (TOPIC-003..007), and they read only `authorized` and `reason` after narrowing. They are unaffected at the type and runtime level.
- D7 (ordering): insert, then event, then `applyTimingFloor`, then send, on both reasons. The event is emitted on every denial with `rowWritten`, and `actorRoles` is null on failure. Event keys match D1. `null` is mapped to `'unknown'` in the handler only, so no storage convention leaks into the shared type.
- D2: no `teams`, topic or annotation read. `team_id` is the requested id, and `isCanonicalUuid` runs first.
- Boundaries: all changes are in `auth/` (logger registry, helper) and `routes/content.ts`. No migration, no new module, no other endpoint touched. Patterns follow the existing fail-open convention.

## The reported deviations

1. `emitAuditEvent` gained an optional `level` param (`"info" | "error"`, default `"info"`). Accepted. D5 requires error level for the log-only failure signal, and `emitAuditEvent` is the only sanctioned emitter. The default preserves behaviour for all 84 other call sites, since no existing caller passes a fourth argument. The `audit: true` child and the forced `info` threshold are retained, so an error-level event cannot be filtered out by a lower app log level. Typing it as a closed union rather than a free `string` is good. The unit test covers both levels. TOPIC-003..007 do not call this path differently; they are unaffected. The design did not name this signature change, so I record it as an implicit decision now made explicit. No change required.
2. Handler wiring landed inside the integration-test commit (9c826a7). A process deviation, not an architectural one. The design's task order wanted the mocked unit tests first, but the real-Postgres test is the only thing that can validate the casts (D4), so shipping them together is defensible. The end state is correct and the commit message says it is task 3.1. Accepted, with a note that bisectability is slightly worse: that commit mixes handler, unit tests and the integration test.
3. The `actor_roles` fixture order is descending enum rank. Accepted. `users_roles_consistent` (migration 21) forces strictly descending rank, and the enum is `engineer < senior_engineer < facilitator < ...`. The chosen order `engineering_manager, facilitator, senior_engineer` is consistent with it. The assertion still compares against the stored array (`rows[0].actor_roles` equals the stored `users.roles`), so it pins "verbatim, stored order" and is not weakened. The comment explaining the fixture order is accurate enough, although "also alphabetical" is incidental.
4. Four changed `content.test.ts` assertions. Verified and they weaken nothing.
   - `toHaveBeenCalledTimes(1)` became `2`, plus a check that the second call matches `INSERT INTO audit_log`. This is a correct tightening: it still proves no resource queries ran, and now names the one allowed extra query. Separate no-teams/topic/annotation assertions exist per D2.
   - Three `auditInsertCalls()` zero-length assertions on the member-facilitator and admin-membership tests became `auditInsertCalls("admin.topic_config_accessed")`. The unfiltered form would now be wrong, because a denial legitimately writes a row. The filter keeps the original intent (no admin row on a non-admin denial) and the helper's filter is an exact match on the operation parameter. The positive `topic.config_list_denied` row assertions for those cases live in the new describe block. Other `auditInsertCalls()` zero-length uses that remain are on paths that do not reach the denial branch (I did not find one that now becomes vacuous, but a final grep by the engineer for any remaining unfiltered zero-length asserts on a denied path is cheap insurance).
   - The router fixture changes (`noUsersRow`, `denialRoles`, the `audit_insert` return value) are additive, with defaults that preserve prior behaviour.
5. `docs/deployment.md` counts: "Eight" became "Nine", "six" became "seven", and "14" became "15". Internally consistent: one new log-only event (`topic.audit_write_failed`) is added to the list, and `topic.config_list_denied` is correctly NOT in the log-only list because it is durable. The new paragraph states the D5 and D9 content: fail-open, log-only with no consumer (#131), informational member-facilitator rows, no read path, and unchanged retention. It also does not claim that alerting exists. Accepted.
6. The hand-synced spec: `openspec/specs/topic-customization-lock/spec.md` (+114) matches the change's delta body (I diffed the added lines against the delta file; only the `## ADDED Requirements` header differs, as expected for a sync). The `team-content-access` edits extend the visibility guard to `topic.config_list_denied` and replace the old "does not decide SEC-13" scenario line with the row assertion. Obsolete D4-era terms (`role_set_read` for the denial, two failure events, 400 ms read) are absent; the one `role_set_read` hit at line 311 is the pre-existing admin-arm requirement. Accepted. Note that hand-syncing risks drift at archive time, so the archive step should confirm no further diff.

## Helper change and TOPIC-003..007

Zero effect. Additive field on the denied variant only, no new queries, the authorized variant is unchanged, and the callers in `topics.ts` do not read the new field. The emitAuditEvent default keeps their audit output byte-identical.

## Other observations (non-blocking)

- Insert-after-event ordering relies on the denial event being emitted even when the insert fails; this is implemented and covered.
- Follow-ups #TBD-A, #TBD-B, #131 remain with the user, as the design says; the PR description must still carry the visibility sweep and the rate-limit and `trustProxy` statements (D8, D10, Risks). I could not verify those from the diff, since they live in the PR text.
- The pool-pressure and write-amplification residuals are accepted in the design and nothing in the code contradicts them.

## Verdict

APPROVED

No changes required. Two optional suggestions: (a) grep the remaining unfiltered `auditInsertCalls()` zero-length assertions to confirm none sits on a denial path; (b) make sure the PR description includes the D8 sweep commands and the D10 `trustProxy` and rate-limit statement.
