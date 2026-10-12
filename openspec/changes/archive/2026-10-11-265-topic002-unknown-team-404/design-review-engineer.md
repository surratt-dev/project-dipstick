# Design review: topic002-unknown-team-404 (#265) -- Full Stack Engineer

Reviewer: Marcus Oyelaran. Read against `routes/content.ts` (TOPIC-002 handler, ~L806-1170), `routes/topics.ts` `checkWritableTeam` (L188), and `TopicManagementPage.tsx` `loadTopics` (L655) / `fetchAllTopics` (L700).

## Verdict

Implementable as written, small, and the boundaries are clean. Approve with the amendments below. None is blocking; items 1-3 should be fixed in the design before implementation because they would otherwise surface as surprises in review of the PR.

## What checks out against the code

- D3 (move the existing `SELECT name FROM teams` earlier, add no query) is correct and is the practical choice. The current SELECT sits at roughly L1002 after the admin arm; the move is a cut and paste plus a three-line branch. A facilitator's SQL multiset is unchanged. Rejecting a separate `SELECT id` (as `checkWritableTeam` does) is right for the read path.
- D1 ordering is coherent with the handler: non-canonical 404 -> `checkStandingFacilitatorOrAdminAuthorization` (403, audited) -> `assertTopic002AuthorizedRole` -> name read -> admin arm. `assertTopic002AuthorizedRole` is a pure check, so placing the name read between it and the arm costs nothing.
- D5 mirrors the existing non-canonical and 403 paths exactly (`await applyTimingFloor(startTime); return noStore(reply).code(404).send(teamNotFoundEnvelope())`). Note `checkWritableTeam` omits `noStore`; the read route correctly uses it. Fine, but worth one line saying the divergence from `checkWritableTeam` is intentional.
- D8 matches the existing 403 branch pattern (defensive `res.json().catch(() => null)`). `loadTopics` already has the `finally { setLoading(false) }`, so no empty-shell flash. `fetchAllTopics` truly never calls `setError`, so the "test, not code" claim for quiet refetch holds.
- `teamResult.rows.length > 0` is used in only one place (`teamFound`, ~L1122), so removing `team_found` is a clean deletion.

## Findings

### 1. In-code comment contradicts the new order (must update) -- medium
The handler comment above the admin arm states: "Both reads run before any team-name/topic/lock read; a failed membership read emits no admin.audit_write_failed". After D1 this is false for the name read, and "Every admin request runs the same prefix (helper row -> membership row -> role-set row)" becomes "name row -> membership row -> role-set row". The design/tasks update the `audit-logger.ts` comment but never mention this one, which is the load-bearing comment for the fail-closed story. Add it to the task list explicitly. Also the comment says the arm "runs ONLY when the shared decision admitted an application_admin ... facilitators gain no query"; keep that, it stays true.

### 2. Failure-mode change on the admin path needs a stated position -- medium
Today, for an admin, a failing membership/role-set read yields a 500 before the name read; after D1 a failing name read yields a 500 before those reads. Both are fail-closed 500s with no data and no audit row, so the safety property is preserved, but there is a behavioural difference: a name-read failure previously could not occur *before* an `admin.audit_write_failed`-eligible stage. D5 states "name read throws -> existing 500 path, no audit row". Good, but add that this applies identically to a facilitator and an admin, and add a test for the admin case (name read rejects -> 500, no audit insert, no membership query). The proposal lists no such test among the AC.

### 3. Admin test fixtures will break in more places than the design lists -- medium
`content.test.ts` has a mock helper (L~940, "null = the team-name SELECT returns no row") that is query-order-sensitive for admins. Moving the SELECT changes the mock call sequence for every admin test, not only the `team_found` ones. The design hedges ("if the #259 tests pin the admin query order, they are updated deliberately"). It does pin it (the helper dispatches on query text or position; confirm which). Budget this as a real task: audit the mock for positional dispatch before editing the handler. If it dispatches by SQL text, the cost is small; if positional, it is a mechanical but wide diff. I would resolve this in task 0.x rather than leave it conditional.

### 4. 403 vs 404 asymmetry between TOPIC-002's own two branches -- low, accepted
`FACILITATOR_IS_TEAM_MEMBER` (403) can never co-occur with a missing team (FK), so the proposal's claim holds. But note the shared authorization helper does a membership lookup keyed on `teamId` for a non-existent team: it returns "not a member", which authorizes a facilitator. Confirm in the code (it reads `team_memberships`, which has an FK to `teams`, so no row) and add one test: standing facilitator + unknown team -> 404, not 403. AC 1 covers it implicitly; make it explicit since that is the one real path.

### 5. D2 audit decision: implementation hygiene, not a design flaw
The 404 branch is isolated and removable, so overruling is cheap. One practical caution: the structured `emitAuditEvent` for denials is separate from the DB row. Make explicit that the 404 emits no `topic.*` denial event either (AC 3 says "no admin.* log event"; broaden to "no audit event of any kind" or a reader will wonder about log-only events such as `topic.config_read_denied_role`, which is TOPIC-001's, not this route's -- say so).

### 6. D4 mid-request deletion race -- low
Name read then later data reads: if a team vanished in between, the reply is an empty 200 with a real name. Accepted in the design and consistent with the code (no route deletes teams). No action; the "observed property" wording is honest.

### 7. D6 consumer verification -- low
My grep of `packages/` and `docs` finds `team_found` only in `audit-logger.ts` comments, `content.ts`, and tests (content.test.ts, topic-annotation-integration.test.ts, topic-002-admin-audit-integration.test.ts). The design lists three test files; `topic-annotation-integration.test.ts:364` and `content.test.ts:1871` use `toMatchObject`, so they would not fail on removal of the key but would fail on `team_found: true` expectations. Update those assertions too (they are not "exact key set" tests, easy to miss). SIEM or dashboard consumers outside the repo cannot be greped; the task correctly flags it as a recorded acceptance condition.

### 8. Frontend: a non-canonical teamId in the URL -- low
A mistyped URL such as `/teams/abc/topics` also returns `TEAM_NOT_FOUND` from the boundary check, so the screen will now say "Team not found." for it. That is desirable; mention it so the test matrix includes it (one fetch mock with the same envelope).

### 9. Frontend: add a small typed helper -- low
`hasEnvelopeMessage` already checks for a string message but not `code`. Do not widen it; add a sibling `hasEnvelopeCode(body, "TEAM_NOT_FOUND")` (or inline condition) so the 403 branch behaviour stays untouched. Use the envelope's own message only if it equals the literal; D8 says the string is exactly "Team not found." -- prefer the literal constant over `body.error.message` so a server wording change cannot silently alter the copy (and so the structural test about "never the literal string" on the backend does not need a frontend twin).

### 10. Structural test note -- low
D5 says "Never the literal string (structural test)". Confirm `team-not-found-envelope-structural.test.ts` scans `content.ts` for 404 sends; the new send uses `teamNotFoundEnvelope()` so it passes, but the scan may count call sites. Run it early.

## Hidden coupling

- Backend and frontend are coupled only through the envelope code; rollout order is independent, as the migration plan says. Good.
- The shared helper `checkStandingFacilitatorOrAdminAuthorization` is also used by TOPIC-004 (topics.ts). The change deliberately does not touch it. Keep it that way; do not push the existence check into the helper (it would change TOPIC-003..007 and the write routes' order with `checkWritableTeam`).

## Missing error paths

- Name read rejects (admin and facilitator): covered in prose, needs an explicit admin-side test (finding 2).
- `applyTimingFloor` rejecting: same as every other path; no change.
- Frontend 404 with a body that is JSON but `error` is not an object: handled by a defensive parse; add to the non-envelope 404 test cases.

## Summary of requested amendments

1. Add the stale handler comment (L~940-ish "Both reads run before any team-name...") to the doc/comment tasks.
2. Add an admin-side name-read-throws test (500, no audit, no membership query).
3. Resolve in task 0 whether the `content.test.ts` mock is positional; size the test churn.
4. Add explicit standing-facilitator + unknown-team = 404 test and widen AC 3 to "no audit event".
5. Update the `toMatchObject` `team_found: true` assertions in the two files named in finding 7.
6. Frontend: use a literal "Team not found." constant and a separate code check; test the non-canonical URL case.
