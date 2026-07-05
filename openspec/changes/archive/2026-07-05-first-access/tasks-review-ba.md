# Tasks Review: First Access
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-07-05
**Change:** first-access

---

## Summary

The task list is solid and well-reasoned. The framing — verify existing implementation, close two confirmed gaps, add tests for uncovered acceptance criteria — is accurate and the implementation tasks are precise enough to build from directly. That said, a detailed mapping of the acceptance criteria against the tasks reveals five gaps. Two of them are significant enough that I'd flag them before this task list is treated as complete. The others are smaller but correctable with targeted additions.

---

## Capability-by-Capability Assessment

### Capability 1: Automatic Account Creation

**Tasks:** Task 10 (audit logging verification), Task 12 (session fixation fix), Task 13 (audit event enrichment), Task 16 (schema validation).

Task 10 establishes that a `first_access_created` event fires for new users and not for returning users. That's the primary behavioral test for account creation. The coverage is reasonable.

**Gap — AC-7 has no test task.** AC-7 requires that if the database operation for account creation fails, no session is established and no partial state exists. There is no test task addressing this. The missing-claims path (Task 5) is a different failure mode — it rejects before the database is touched. AC-7 is specifically about what happens when `resolveOrCreateAccount` attempts the upsert and the database returns an error. A test case simulating that failure and asserting no session is created, no incomplete record persists, and the user receives a generic error is absent from the task list.

**Minor gap — AC-1 bullet 3 (no duplicate account on return authentication).** Task 9 verifies sub/iss matching and email-changed scenarios. It does not include a test that authenticates the same identity twice and asserts exactly one account record exists afterward. This is the clearest behavioral statement of AC-1's third bullet, and while it's arguably implied by the sub/iss matching tests, it is not stated.

---

### Capability 2: Subject/Issuer Identity Matching, Email Prohibition

**Tasks:** Task 9 (test verification/addition).

Task 9 is well-specified. It covers both behavioral assertions in AC-2: the changed-email scenario and the same-email-different-sub scenario. Both are present or required to be added.

**Gap — no implementation inspection task for the query itself.** The proposal's implementation notes are explicit: "The account lookup query must use only `oidc_subject` and `oidc_issuer` as match keys. Email must not appear in any query used for identity resolution. No executable behavioral test can directly observe the query path — this constraint is enforced by code review." The task list includes no task for a developer to open `account-resolver.ts`, read the SELECT query, and confirm email is absent from the WHERE clause and JOIN conditions. Task 9 adds behavioral tests, but a behavioral test cannot observe which columns the query uses — it only observes the outcome. The code review constraint from the proposal is not translated into any task. This creates a situation where Task 9 passes even if email is silently included as a secondary match key, as long as the right account happens to be returned.

This is worth a dedicated task: inspect the query, confirm email's absence, and document the finding in a comment adjacent to the query — the same mechanism Task 4 uses for the routing layer.

---

### Capability 3: Concurrent First-Access Handling via Upsert

**Tasks:** Task 11 (code comment on isNewUser constraint).

**Gap — AC-3 has no test task. This is the most significant omission.**

AC-3 states: "When two concurrent authentication callbacks arrive for the same `sub`/`iss` before any account exists for that identity, exactly one account record is created and both callbacks complete without error." The proposal explicitly notes this requires "a genuine concurrent or seeded-concurrency harness" and that "standard unit tests will not reproduce this."

Task 11 adds a code comment documenting the `isNewUser` race condition, but that addresses the *Out of Scope* flag on `isNewUser` reliability — it does not test whether the upsert itself functions correctly under concurrency. The upsert pattern is the mechanism that satisfies AC-3. Task 11 is defensive documentation about a downstream problem; it is not a test of the upsert behavior.

The task list appears to treat the upsert as already correct and moves on. That may be true, but AC-3 is explicitly untested. The proposal acknowledges the difficulty ("a genuine concurrent or seeded-concurrency harness is required") and the acceptance criterion is unambiguous. The task list needs a task that either implements the concurrent test, or explicitly documents why AC-3 is accepted without a concurrent test and what compensating control applies (e.g., the upsert constraint is verified by reading the migration and the query, and concurrency is deferred to a load test suite).

---

### Capability 4: No-Team Landing Page

**Tasks:** Task 2 (server-side redirect implementation), Task 3 (client-side guard implementation), Task 4 (routing layer inspection), Task 6 (callback redirect tests), Task 7 (guard tests), Task 8 (navigation regression test).

The coverage for AC-4a, AC-4b, and AC-4d is solid. Task 6a, 6b cover the callback redirect. Task 7b covers the bookmark/direct-navigation redirect.

**Gap — AC-4c and AC-4e are not explicitly tested.**

AC-4c: "A user whose team memberships are removed in the database is routed to `/no-team` on their next sign-in, regardless of what route they were directed to in their prior session."

AC-4e: "A user who previously held team memberships and from whom all memberships have been removed is routed to `/no-team` on their next sign-in."

These two criteria are materially the same scenario — a returning user with an existing account and prior session state, whose memberships have since been removed. Task 6a tests "a new user with no team memberships after account resolution" — a new user has no prior session state and no prior memberships to remove. The implementation note in the proposal is explicit: "A test for this constraint must create a discrepancy between session state and database state and confirm that the callback reflects the database."

No task in the list creates that discrepancy. The live-data constraint is documented in the proposal but has no corresponding test. Task 6a's scenario (new user) does not exercise the case where a session might cache a prior membership state, which is the point of AC-4c/AC-4e.

**Minor gap — AC-5 bullet 1 (exactly four elements) has no test.**

AC-5 requires the no-team page to render "the user's display name, a statement of no team membership, an instruction to request a join link, and a sign-out affordance." Task 7a says "the no-team page content is rendered" when there are no memberships. Task 8 checks that no navigation elements are present. Neither task asserts that the specific four required elements are present — display name, no-team statement, join link instruction, sign-out. A content assertion for these four elements is absent. This is lower priority than the other gaps (the elements are presumably rendered because the page exists) but the "exactly these four" positive assertion is not tested.

---

### Capability 5: Missing Claims Rejection

**Tasks:** Task 1 (implementation), Task 5 (tests), Task 14 (typed error class).

**Gap — Task 5 does not assert that the log entry names the missing claim.**

AC-6 requires: "a log entry naming the missing claim without including any claim values or identity attributes from the token." The proposal gives an explicit example: `missing_claim: sub`.

Task 5 instructs the test to assert "audit event emitted without PII." That covers the negative: no claim values present. It does not cover the positive: the claim name is present. A test that checks only for the absence of PII would pass even if the audit event contained no information about which claim was missing — a log entry that says "authentication failed" with no claim identification would satisfy Task 5 as written but would fail AC-6.

Task 5 should be updated to assert, for each test case, that the audit event or log entry includes the name of the missing claim (e.g., `claim: "sub"` for the empty-sub case, `claim: "iss"` for the empty-iss case).

---

## AC-to-Task Mapping

| Acceptance Criterion | Mapped Task(s) | Status |
|---|---|---|
| AC-1 bullet 1: new account created automatically, no memberships, no roles | Task 10 (partial — verifies event, not account attributes) | Partial |
| AC-1 bullet 2: account created as direct result of authentication | Task 10 (implicit) | Partial |
| AC-1 bullet 3: returning user matched to existing account, no duplicate | Task 9 (indirect via sub/iss tests) | Partial |
| AC-2 bullet 1: changed email matched to existing account | Task 9 | Covered |
| AC-2 bullet 2: same email, different sub → two accounts | Task 9 | Covered |
| AC-2 code constraint: email absent from resolver query | None | **Gap** |
| AC-3: concurrent callbacks → one account, both succeed | None | **Gap** |
| AC-4a: no memberships → server-side redirect to `/no-team` | Task 6a | Covered |
| AC-4b: has memberships → server-side redirect to `/team/:teamId` | Task 6b | Covered |
| AC-4c: memberships removed → `/no-team` on next sign-in (live data) | None | **Gap** |
| AC-4d: direct navigation to `/no-team` after joining → redirect to team | Task 7b | Covered |
| AC-4e: returning user, all memberships removed → `/no-team` on next sign-in | None | **Gap** |
| AC-5 bullet 1: page renders exactly four required elements | None (partial: Task 7a renders "content") | Partial |
| AC-5 bullet 2: page renders no navigation elements | Task 8 | Covered |
| AC-6 bullet 1: missing/empty sub → rejected, no account, no session, generic error, log names claim | Task 5a (partial — does not assert claim name in log) | Partial |
| AC-6 bullet 2: missing/empty iss → same behavior | Task 5b (partial — same gap) | Partial |
| AC-7 bullet 1: DB failure → no session, generic error | None | **Gap** |
| AC-7 bullet 2: no partial state after failed account creation | None | **Gap** |
| AC-8 bullet 1: first_access_created event with userId, oidcSubject, oidcIssuer | Task 10 | Covered |
| AC-8 bullet 2: no PII in failure log entries | Task 5 (partial — checks absence of PII, not presence of claim name) | Partial |

---

## Prioritized Gaps

**Must address before this task list is treated as complete:**

1. **AC-3 — No concurrent-handling test.** The upsert is the mechanism that satisfies a hard correctness requirement. The task list accepts it as already correct without verification. Add a task that either implements the concurrent test (or a seeded-concurrency simulation) or explicitly documents a reasoned acceptance of the gap with a compensating control.

2. **AC-7 — No database failure test.** AC-7 is a first-class acceptance criterion. A database failure during account creation is a realistic failure mode. Add a test task that injects a database error in `resolveOrCreateAccount` and asserts no session, no partial record, and a generic error response.

3. **AC-4c/AC-4e — No returning-user-lost-memberships test.** The live-data requirement is explicit in the proposal. The current Task 6 tests new-user scenarios and join-token scenarios but not the specific case that demonstrates the callback uses live data rather than session state. Add a sub-case to Task 6 (or a new task) that creates an existing user with a prior session state reflecting team membership, removes those memberships in the database, runs the callback, and asserts the redirect goes to `/no-team`.

**Address if the task list is revised:**

4. **AC-6 / Task 5 — Log assertion incomplete.** Task 5 should explicitly assert that the audit event or log entry contains the name of the missing claim (e.g., `claim: "sub"`), not only that it lacks PII.

5. **Capability 2 — Query inspection task.** Add a task to open `account-resolver.ts`, confirm email is absent from the identity resolution query's WHERE clause and any JOIN conditions, and document the finding in a comment — mirroring the approach used in Task 4 for the routing layer.

**Lower priority:**

6. **AC-5 bullet 1 — Four-element content test.** Task 7a could be extended to assert that the display name, no-team statement, join link instruction, and sign-out affordance are all present by test ID or accessible role, not only that "content is rendered."

7. **AC-1 bullet 3 / Returning user no-duplicate.** Task 9 could include a test case that authenticates the same identity twice and confirms the account count remains one.

---

## What Is Well-Covered

The following areas are handled clearly and the tasks are specific enough to execute without additional clarification:

- The implementation tasks (Tasks 1, 2, 3, 12, 13, 14) are precise: they name specific files, specific insertion points, and specific assertions. There is minimal ambiguity about what "done" looks like.
- The sub/iss identity matching tests (Task 9) cover both behavioral assertions in AC-2 with appropriate test case descriptions.
- The no-team redirect callback tests (Task 6a, 6b) and the client-side guard tests (Task 7) cover the mainline flow clearly.
- The navigation regression test (Task 8) is a well-designed structural test — it exists to catch future regressions, not just to verify the current state. The intent is documented in the task itself.
- Task 4 (routing layer inspection) is a code inspection task that explicitly documents its own output, which is the right pattern for a structural constraint that can't be fully tested behaviorally.
- Task 11 translates the `isNewUser` out-of-scope constraint into a code comment, which is the right mechanism to make the constraint discoverable during future work.

---

*Review complete. Five gaps identified; two are significant enough to block treating this task list as coverage-complete against the proposal.*
