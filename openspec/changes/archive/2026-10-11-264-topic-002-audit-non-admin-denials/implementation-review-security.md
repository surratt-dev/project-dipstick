# Implementation Security Review: #264 TOPIC-002 non-admin denial audit

Reviewer: Tomas Ferreira, Senior Application Security Analyst
Reviewed: `git diff main...HEAD` (content.ts, audit-logger.ts, standing-facilitator-access-helper.ts, content.test.ts, helper test, integration test, 403 baseline fixture, docs/specs), against design.md, design-review-security.md and design-review-security-confirm.md.
Ran: `vitest content.test.ts + src/auth` (465 passed) and the real-Postgres `topic-002-denial-audit-integration.test.ts` (8 passed).

## Checks against my rulings and merge-blocking conditions

| Check | Result |
|---|---|
| SQL is a constant; every param bound with an explicit cast (A1) | PASS. `TOPIC_002_DENIAL_INSERT_SQL` is a module-level constant; `$1::uuid, $2::text, $3::inet, $4::text, $5::uuid, $6::jsonb`, `u.roles::text[]`. Metadata is `JSON.stringify` of a fixed-shape object (endpoint constant, 403, closed-enum reason). Unit test pins constant text and casts; the real-Postgres test proves the casts work (fail-open would otherwise hide a permanent failure). |
| LEFT JOIN yields exactly one row; missing users row | PASS. `(SELECT 1) s LEFT JOIN users u ON u.id = $1::uuid` (PK join); integration test covers the deleted-users-row case: `'unknown'` role, NULL `actor_roles`, no failure event. Role mapping to `'unknown'` is in the route, not the shared helper. |
| Order: insert -> event -> floor -> send; floor clock | PASS. `startTime` is taken at handler entry, before the helper; `applyTimingFloor(startTime)` follows the audit and event, immediately before the send. Call-order test per reason and the 20 ms fake-timer test (answers at about 150 ms, not 170 ms) pin it (F4 satisfied). |
| 403 byte-identical on all failure paths | PASS. The 403 code/body is untouched; the audit step returns a value and cannot influence it. Rejected-insert and timeout paths are asserted against the committed baseline snapshot (`expectBaseline403`). |
| Fail-open only around the audit step | PASS. The try/catch is in `runDenialAuditStep` and wraps only the `insert()` closure. Tests show a throwing helper query and a throwing timing floor are still 500 with no row. Admin arm still fail-closed (`withAdminAuditFailureSignal` rethrows; behavior test shows a rejected admin insert is 500 and writes no denial row/event). `sqlstateOf` extraction is behavior-neutral. |
| Event/row key sets exactly as pinned | PASS. Denial event: nine keys (`actorUserId, actorGlobalRole, actorIp, teamId, endpoint, httpStatus, reason, actorRoles, rowWritten`); failure event: eight keys (`actorUserId, teamId, endpoint, operation, stage, reason, failureMode, errorCode`). Both asserted by exact key-set and value equality. Row metadata is three keys. |
| No content leakage | PASS. Only ids, closed enums, role strings, IP and constants. The handler makes no team-name/topic/annotation read before the denial; the failure event uses `sqlstateOf` only, and the test injects `err.message` and `err.detail` sentinels ("leaked-...") and asserts they are absent. |
| No non-admin read path | PASS. No route, query or view added that reads these rows; the diff adds no SELECT on `audit_log`. The wording is "database/log-sink operators only" (F1 fixed in audit-logger comment and docs). |
| Admitted callers incur no added query | PASS. The deny branch is the only new code; test asserts identical SQL set for admitted facilitator and admin. `actorGlobalRole` on the denied variant is read only at the audit site; TOPIC-003..007 do not read it, and the authorized-branch reads are unchanged. |
| Failure event at error level | PASS. `emitAuditEvent(..., "error")` (new optional level param defaults to "info", so all other events are unchanged); test asserts level `error`; documented in the audit-logger comment. |
| Timeout bound | PASS. Shared `AUDIT_WRITE_TIMEOUT_MS` (500 ms) via `withTimeout`; a hanging insert test shows 403 within the bound, `failureMode: "timeout"`, `errorCode: null`. |

## Non-blocking observations

1. A throw from `emitAuditEvent` itself (logger fault) in the catch block or on the denial event would surface as a 500. This is consistent with every other audit event in the codebase and is not a new class of risk; noted only for completeness.
2. The abandoned timed-out query still holds a pool connection (F2) and denial row volume is unbounded but attributable. Both are accepted residual risks already recorded; follow-up issue numbers (#TBD-A/#TBD-B) must be real before the issue closes (task 5.2).
3. PR obligations still open (cannot be verified from the diff): record the `request.ip` / `trustProxy` finding (F5), the existing edge rate-limit answer, and the visibility-sweep commands (task 3.8/3.9). The PR must not cite this change as evidence that audit-failure alerting exists (#131 stays open).

## Verdict: APPROVED

No blocking defects. Conditions carried to the PR: the trustProxy / edge rate-limit statement, the sweep evidence, real follow-up issue numbers before closing, and #131 left open.
