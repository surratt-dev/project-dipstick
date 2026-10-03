# Implementation Review: Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `topic-001-authz-contract-reconcile` (#187)
**Scope reviewed:** uncommitted diff on `agent-team/187-topic-001-authz-contract-reconcile`: `team-content-access-helper.ts`, `audit-logger.ts`, `content.ts`, `shared/types/topic.ts`, `REST API Contract.md`, and the four test files.
**Verification run:** `vitest run content.test.ts team-content-access-helper.test.ts` passes (83 tests). `tsc --noEmit` shows no errors on lines this change added. The errors it does report in `content.test.ts` (lines 46, 172, 174, 302), `e2e-content-auth.test.ts` and `topics.test.ts` are already on `main`. `grep -rn "admits engineering" requirements packages/*/src` returns nothing. The only frontend use of `/api/v1/teams/:teamId/topics` is a `POST` (TOPIC-003), which supports the claim that TOPIC-001 has no UI caller.

## Verdict: Approve. No blocking findings.

The code makes the decision I took at design review (Decision 1, Option B), and it does nothing beyond that decision. The boundaries are where we said they would be. I checked the specific architectural points one by one.

## Conformance to design

| Design point | Implementation | Status |
|---|---|---|
| D1: the read is exported from the helper module, returns a fact, and `content.ts` runs no SQL against `team_memberships` | `readActiveMembershipRole` is in `team-content-access-helper.ts` and uses the same `removed_at IS NULL` predicate as the helper. `content.ts` only imports it. `evaluateTeamAccess` and Decision E are untouched. | Met |
| D1: fail closed on a read failure, no `try/catch` | The handler awaits the read without a catch. Test 4.12 pins the `500` and shows the topics and lock queries did not run. The helper test shows the rejection propagates. | Met |
| D1: the PR does not claim "no new query" | Nothing in the code or the contract makes that claim. | Met (recheck in the PR body, task 6.5) |
| D2: exact signature, pure, private, `switch` with a `never` default, equality on `grant.role` and on `liveMembershipRole` | Matches the design word for word. There is no `await`, `db.`, `process.env` or `config.` in the body. It is not exported. | Met |
| D2: handler order (404, grant, null, admin, membership read, predicate, topics, lock) | Matches. The membership read runs only when `grant.path === "member"`. | Met |
| D3: OR semantics, with only `actorGlobalRole` on the facilitator arm | Matches. The facilitator arm denies one value; it is not an allow-list of global roles. | Met |
| D4: admin 403 and audit row unchanged | Unchanged. Test 4.4 covers it, including precedence over an admin's EM membership. | Met |
| D5: snake_case kept, contract note plus tripwire | The contract has the "As built (#187)" note. The tripwire test now asserts `200` first. | Met |
| D6: log-only event with the given name, the six fields and `reason` precedence, and no content | The union member is added with a comment. `reason` is worked out only after the deny, and the membership signal wins when both are EM. The exact key set is asserted. | Met |

## Pattern consistency

- The EM check is an OR check that lives in the handler. That matches the precedent in `sessions.ts` and `teams.ts`. The new part, a second read after the helper's read, is the trade-off we accepted on the record, and it fails closed whenever the two reads disagree.
- `emitAuditEvent(request.log, …)`, the `*_denied_role` naming, `applyTimingFloor` placed before `denyAccess`, and `noStore` all follow the existing conventions in `content.ts`. No new abstraction was added. The predicate is private, so the policy cannot spread to other endpoints. That matters while the "Decision E elsewhere" question is still open.
- The shared type `TeamAccessGrant` is unchanged. The blast radius stays inside one handler and one helper export, as intended.

## Test quality

The tests are meaningful, and their assertions would fail if the behaviour regressed:
- Denial tests prove the topics and lock queries did not run by call count plus SQL text, never by mock position. That was the main fragility risk from design review.
- The true path 2 case (`engineering_manager` / `engineering_manager`) now exists. The old test was path 2' with the wrong label, and that is fixed.
- The `200` regressions include `senior_engineer` and the global-facilitator/participant-membership case. Those are what would catch an over-tight allow-list.
- The timing test holds the floor promise open and asserts the response has not gone out. That is stronger than the "called once" check the tasks asked for.
- The envelope-parity test compares every header except `date`, and the whole body except `correlationId`.
- The integration tests run against real Postgres and cover path 2', global-EM/participant, and the template team. The S1 canary still checks that the annotation text is not in the body.

## Contract consistency

The REST API Contract update matches the code:
- **403 row:** correct.
- **404 row:** correct. A well-formed id for a nonexistent team gives a `null` grant, which leads to `denyNullGrant` and a 403. I verified this.
- **Matrix row:** correct.
- **"Path id shape" note:** correct. The canonical-id guard in TOPIC-001 already existed from #184.
- **"Corrected" note:** makes no claim that TOPIC-002 is audited (security B2 is honoured).

Two gaps remain, and both are already listed as non-goals:
- The matrix's facilitator cell ("Teams with active session") still differs from the grant's real window (follow-up 3).
- The main spec's content matrix still shows admins with read-only topic configuration, which is still true through TOPIC-002.

## Non-blocking findings

1. **The cited requirement name is wrong.** The predicate comment in `content.ts` and the new `describe` header comment in `content.test.ts` both say they implement the `team-content-access` requirement "Topic configuration read denies engineering managers". The delta spec has no requirement with that name. The real name is "The active-topics endpoint admits only non-manager participant members and eligible session facilitators". After archive, someone searching for the cited name will find nothing. Fix both comments.
2. **The decision citation in the helper comment is wrong.** `readActiveMembershipRole`'s comment says "Live read, no cache (Decision 6)". Freshness of the signals is Decision 3. Decision 6 is the denial event.
3. **A comment in test 4.2(c) is wrong.** The comment says "No membership read on the facilitator path: one fewer call", but `calls: 2` is the same count as the member cases (the helper read plus the facilitator-session read). The behaviour is still protected indirectly: an unexpected membership read would get no queued row and return `500`. Either correct the comment, or make the skip explicit by asserting that no call's SQL matches `SELECT role FROM team_memberships`. The second is preferable, because it turns an indirect guard into a stated one.
4. **Test 4.10 queues rows it never uses.** It queues two `mockResolvedValueOnce` rows and then calls `mockReset()` at the end. If an earlier assertion fails, those rows leak into later tests, which is the stale-queue hazard from tasks-review N2. `mockReset` also clears implementations, not just the queue. The test proves its point without queuing anything, so drop the `arrange` and the reset.
5. **One integration assertion is weak.** The template-team test's `expect(res.body).not.toContain("topics")` passes on any 403 envelope and would also pass on a body that leaks rows under another key. `expect(res.json().topics).toBeUndefined()`, or a check that a template topic name is absent (as the annotation integration test does), would say what is meant.
6. **One helper comment no longer tells the whole story.** The header comment on `evaluateTeamAccess` (around lines 71–77) still says the single combined query means there is "no TOCTOU gap". That stays true for the helper itself. Add a one-line pointer saying that TOPIC-001 deliberately does a second read (`readActiveMembershipRole`, #187 Decision 1), so a future reader does not take the gap analysis to cover the whole request.

## Carry-forward (not for this change)

- Before `teamAnnotation` is added to any member-readable endpoint, the global-role freshness window from Decision 3 must be looked at again. The contract's release-note line covers the messaging side. The engineering side is follow-up 6 (A1) together with Decision 3.
- If a second endpoint ever needs path 2' detection, that is the trigger to move to A1 (a required `membershipRole` on the grant), not a second copy of this read-then-OR pattern.

## Implementation review disposition

Applied by Marcus Oyelaran (Full Stack Engineer).

| Item | Disposition |
|---|---|
| Architect 1 (requirement name) | Fixed in the `content.ts` predicate comment and the `content.test.ts` describe header: both now cite "The active-topics endpoint admits only non-manager participant members and eligible session facilitators". |
| Architect 2 (Decision number) | `readActiveMembershipRole` comment now cites #187 Decision 3. |
| Architect 3 (4.2(c) comment) | Comment corrected; the test now also asserts no call's SQL matches `SELECT role FROM team_memberships` on the facilitator path. |
| Architect 4 (4.10 unused rows) | Removed the queued rows and the `mockReset()`; the test queues nothing. |
| Architect 5 (weak template assertion) | Replaced `not.toContain("topics")` with `expect(res.json().topics).toBeUndefined()`. |
| Architect 6 (TOCTOU pointer) | Added a pointer in `evaluateTeamAccess`'s header comment to TOPIC-001's deliberate second read (#187 Decision 1). |
| Security N1 (app-wide error handler) | Not fixed here; added as Follow-up 9 in proposal.md. |
| Security N2 (demotion race) | design.md Decision 1 sentence corrected to describe the code's stricter fail-closed behaviour. |
| Security N3 (field name) | `topic.config_read_denied_role` now uses `globalRole`, matching `team.access_grant_mismatch`; audit-logger comment, design.md Decision 6, the team-content-access delta spec and tests updated. |
| Security N4 (deployment doc) | `topic.config_read_denied_role` added to the log-only events list in `docs/deployment.md` (count updated). |
