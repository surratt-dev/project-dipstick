# Security Implementation Review: topic002-unknown-team-404 (#265)

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Scope: uncommitted diff on `agent-team/265-topic002-unknown-team-404` (content.ts, audit-logger.ts, TopicManagementPage.tsx, unit/integration/frontend tests, REST API Contract).

## Verdict

Approve. No blocking findings. The handler change is small, ordered correctly, and the design-review items I raised (S1 normalization, S2 flood framing, S3 explicit residual, S6 zero-`teams`-query pin) are all reflected. Five non-blocking findings follow; N1 (the 500 test gap you asked about) is the one I would fix before merge.

## Verified (no action)

1. Authorization before existence. In `content.ts` the order is: canonical-UUID boundary (404, no query) -> `checkStandingFacilitatorOrAdminAuthorization` -> 403 branch (denial audit, floor, 403) -> `assertTopic002AuthorizedRole` -> team-name read -> 404 or continue. Neither 403 reason touches `teams`, so participants and member-facilitators get the same response for existing and missing teams. The `assertTopic002AuthorizedRole` fail-closed check still precedes the lookup, so an unexpected role cannot reach the 404 as an oracle.
2. Moved, not added. The `SELECT name FROM teams WHERE id = $1` text is unchanged and unfiltered (no `deactivated_at`), so deactivated and template teams stay 200 and a facilitator's SQL multiset is unchanged (pinned by the AC5 test).
3. Audit behaviour. The 404 returns before the admin arm, so there is no membership/role-set read, no `audit_log` insert and no event. `team_found`/`teamFound` are gone from the row metadata, the event payload and the comment contract; the key sets are pinned exactly in unit and the key is asserted absent in the real-DB test. `teamFound` was computed from the same result that now short-circuits, so no dangling reference. The audit-logger and API-contract text states that old rows may carry the key and must not be purged (my S4).
4. Timing floor. 404 path is `await applyTimingFloor(startTime)` then send, with `startTime` taken at handler entry; no insert sits between floor and send. Same shape as the other 404/403 exits. Test asserts floor called once and ordered before the reply.
5. `Cache-Control: no-store` is set via `noStore(reply)` on the new 404, and asserted in unit and integration tests.
6. Response body is the shared `teamNotFoundEnvelope()` (structural test already forbids a second literal). It does not echo the requested id. Test pins the exact key set.
7. Frontend. `hasEnvelopeCode` reads only `error.code`; copy is a literal constant; `res.json()` is `.catch(() => null)`; anything not an exact `TEAM_NOT_FOUND` envelope (non-JSON, other code, no code, non-object error, null body) falls to the generic message. Tests prove the server `message` and the URL team id are never rendered, and that a quiet refetch failure does not blank the screen. The pre-existing 403 branch still renders the server message; that is unchanged and the message strings are fixed server literals, so no new exposure.
8. Test strength (mutation view). If someone moved the name read above authorization, the participant-on-missing-team tests would flip to 404 and fail, and the zero-`teams`-query pins would fail. If someone added an audit row or event to the 404, the `auditInsertCalls`, `INSERT INTO audit_log`, `mockEmitAuditEvent` and real-DB `count(*)` delta assertions fail. If the floor moved after the send or was dropped, the call-order test fails. The byte-identical 403 comparison now names its normalization (correlationId, `date`), and the denial-row comparison (positional param 4 = team_id stripped) closes the second observable.

## Non-blocking findings

### N1. 500-on-failed-name-read tests do not assert error text is hidden (the reported gap) — fix before merge, low effort

In `content.test.ts` the new "failed team-name read" test rejects with `new Error("boom: leaked-detail")` but only asserts `res.body` does not contain `SECRET` and `Platform Squad`. Neither can ever appear: the name read is the query that failed, and the topic reads never run, so those two assertions are vacuous. The string that would actually leak (the thrown message, or the SQLSTATE `08006`) is never checked. The same applies to the reworked 3.4 membership-read test (`not.toContain("Platform Squad")`, again nothing that could leak).

Why it matters: the whole point of the fail-closed 500 is that a DB failure surfaces no internals. A future change to the error handler or a try/catch that forwards `err.message` would pass these tests.

Recommended: in both tests assert `res.body` does not contain `leaked-detail`, `boom`, `08006` or the SQL text (`FROM teams`), and that the body is the generic internal-error envelope (check `category`, no stack, no `code` leak). Run it for both facilitator and admin (the `it.each` already does). Add the same assertion to the 3.4 and role-set/insert failure siblings if cheap.

### N2. No test pins "unexpected role never reaches the name read" (low)

`assertTopic002AuthorizedRole` is unit-tested in isolation, but no handler-level test shows that a decision admitting an unexpected `actorGlobalRole` yields 500 with zero `teams` queries. The ordering relies on the call staying above the new SELECT. My design review (S6) asked for the zero-`teams` pin for participants and member-facilitators (done); this is the third unauthorized-ish path. Add one case if the mock makes it easy (stub the helper decision), otherwise note it as a residual.

### N3. Admin 404 vs 200 timing and the placeholder floor (informational, unchanged from design)

Admin 404 now does 2 queries (helper, name) vs about 8 for a 200 including the audit insert. The 150 ms floor masks this only while the 200 path stays under it, and `timing-oracle.ts` already blocks production on the unmeasured placeholder. The unit test proves placement, not indistinguishability. Callers are already authorized and learn one bit, so I accept it. Keep the dependency on the measured floor recorded; do not cite the spy test as timing evidence.

### N4. The failed-name-read 500 path has no floor and no `no-store` (pre-existing, informational)

A throw propagates to the global handler, bypassing `applyTimingFloor`. Previously the same read sat later in the flow, so this is not new, but the 404/500 split on an authorized caller now happens at the first data read. A fast DB error is distinguishable from a floored 404 only to a caller who can already see the 404; no action.

### N5. Test hygiene in the integration file (nit)

`topic-002-admin-audit-integration.test.ts`: a second `import { SENTINEL_TEAM_ID } from "./helpers/real-db.js"` duplicates the existing import from the same module (merge it; lint `no-duplicate-imports` may flag it), `delete headers["date"];` is mis-indented, and the denial-row query has trailing whitespace inside the SQL string. The deactivated-team unit test cannot mark a team deactivated; it pins the SQL text has no `deactivated_at`, which is an acceptable proxy but a real-DB deactivated-team 200 case would be stronger.

## Residuals carried (already recorded in design.md, merge gate 5.3)

- Admin probes of non-existent teams leave no durable trace and no log line (accepted risk, Brian to confirm).
- Existing #264 403-denial row flood for arbitrary team ids is untouched and needs a tracked follow-up with an owner.
- The API contract contains `PR_NUMBER_PLACEHOLDER` and `DATE_PLACEHOLDER` in the `team_found` cutover note; fill these at merge so the analyst-facing cutover reference is real.
