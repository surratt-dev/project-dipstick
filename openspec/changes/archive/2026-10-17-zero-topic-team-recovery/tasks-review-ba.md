# Tasks Review (Business Analyst): zero-topic-team-recovery (#200)

Reviewer: Marcus Delgado, Senior Business Analyst
Scope: Do tasks.md, taken together, cover every capability and acceptance criterion in proposal.md? Is anything lost in translation?

## Verdict

Good coverage. All 17 acceptance criteria and all five modified capabilities map to at least one task, and the "Covers:" tags are mostly accurate. The pre-build gate, ratification gate and cut order carry over from the proposal faithfully. I found no missing endpoint, screen or message behaviour. The gaps are in verification (behaviours specified but not tested), in traceability of the FR-8.6 caveat, and in two ratification and doc items. None is a blocker; items B1 to B3 should be fixed before the build starts because they are cheap now and expensive as late scope disputes.

## AC-by-AC coverage

| AC | Tasks | Assessment |
|---|---|---|
| 1 Result | 2.0, 2.1, 2.2, 2.4 | Covered, including archived rows unchanged, lock unchanged, annotation nulls. |
| 2 Refusals / check order | 2.1, 2.2, 2.7 | Refusal classes covered. The check order (id, auth, rate limit, team lookup, precondition) is implemented in 2.2 but no task tests the order (see B1). |
| 3 Concurrency | 2.4 | Covered, including lock release after forced 500 and the blocked `/advance`. |
| 4 Empty template | 2.3 | Covered. |
| 5 Audit (success) | 2.2, 2.5 | Covered, including post-COMMIT emit and none on refusal. |
| 6 Audit (denial) | 2.9 | Mostly covered. See B1 for event-emission assertions. |
| 7 `canAssignDefaults` | 3.1, 3.2, 5.1 | Covered, including the eight-row truth table and refetch. |
| 8 Tenancy | 2.4 | Covered. |
| 9 Lock untouched | 2.1, 2.6, 6.1, 7.2 | Covered, except "no notification is sent and no undo exists", which is not asserted anywhere (minor). |
| 10 Room open | 4.1, 4.2 | Covered well, including the draft-stays-draft and no new session row. |
| 11 Screen | 5.1 to 5.3 | Covered. The verbatim strings for the success line and the 500 message are not explicitly called out as verbatim assertions (only the empty-state strings in 5.1 are). |
| 12 Accessibility | 5.3 | Implemented, but "component tests for each outcome" does not name assertions for status/alert roles, focus on the Active Topics heading, or the in-flight accessible state (see B2). |
| 13 Runbook | 6.2 | Covered, with a good verify step (run the query verbatim). |
| 14 Usability pass | 7.3 | Covered, correctly non-gating and conditional on 1.4. |
| 15 Auth source / request surface | 2.1, 2.6 | Covered (demotion, spoofed flag, body/query, invariant from one topic to zero). |
| 16 Restorable-defaults listing | 2.10 | Covered. |
| 17 Existing behaviour intact | 2.0, 2.9 | Covered. |

Capability coverage: `topic-customization-lock` (2.x, 3.x, 6.3), `audit-logging-operations` (2.5, 2.9, 2.3), `topic-management-screen` (5.x), `session-creation` (4.x), `default-topic-provisioning` (2.0, 2.3, 2.7). All five are touched. Note that no task says "author or update the five delta specs"; tasks assume they exist and 1.2/6.4 only validate them (see G1).

## Blocking-before-build findings

**B1. Specified behaviours with no test task.** These appear in the proposal's ACs or outcome table but no task verifies them:
- Check order (AC 2): nothing proves a non-admin on a missing team gets 403 before any rate-limit or lookup, nor that rate limiting runs before the team lookup. 2.1 tests the 403-on-missing-team result, but not the order against the limiter. Add one ordering test.
- Denial event emission (AC 6): 2.9 tests rows, the bound and fail-open, but does not assert that an event is emitted on a denial, that the 11th denial emits the log-only `topic.denial_audit_suppressed`, or that a failed insert emits only `topic.audit_write_failed`. AC 6 states all three.
- Timing floor: 2.2 requires `applyTimingFloor` on every return, but no task tests it. If sibling endpoints have such a test, say "copy the sibling's test"; otherwise note it is untested by decision.

**B2. AC 12 (accessibility) is implemented but not verifiably tested.** 5.3 describes the status/alert regions, focus move and in-flight exposure, then says "component tests for each outcome". Persona note: a requirement that is accurate but ambiguous generates rework. State in 5.3 that the tests assert the live-region roles, focus on the heading after a 201, and the disabled/aria state while in flight, and that a double click sends one request.

**B3. FR-8.6 must not be recorded as satisfied (proposal Why, ratification item 6).** The proposal's strongest commitment is that this change closes only the zero-active state. The tasks create the follow-up issue (7.4) but no task ensures the requirement-tracking artifacts (BRD status, any traceability matrix, the use-case traceability line in Appendix A, the PR description, the archive note) say "FR-8.6 partially met". 6.1 covers the use case wording only. Add an explicit check in 6.1 or 7.4: no document or status field marks FR-8.6 as done, and the traceability line says "zero-active case only".

## Gaps and drift (non-blocking, fix if cheap)

**G1. No task owns the delta specs.** The proposal says every AC "maps to delta-spec scenarios" and lists new scenarios (the 403 audit, the dropped admin room-open variant removed, the `topic-management-screen` scenario that deferred copy to #200 being replaced). Tasks only validate (1.2, 6.4). Add a one-line task or a note in 1.2: confirm each AC has a scenario in a delta spec, and that the replaced and dropped scenarios (admin room-open variant, "defers administrator copy to #200") are actually gone. This is the traceability chain I care about: requirement, AC, scenario, test.

**G2. Ratification item 4 has the wrong owner in the task.** 1.3 assigns all eight ratification items to "repo owner / product owner". Proposal item 4 (empty-template audit row) needs a recorded response from compliance or the security owner for audit retention, and item 5 is conditional on security's bounded-limiter condition. Split 1.3 so item 4 names the compliance role and its recorded answer, and state what happens to the S4 failure row if compliance declines (it falls back to log-only plus the runbook search per the proposal, which also affects 2.3 and 6.2).

**G3. Cutting the 403 audit has unlisted fallout.** The cut order ends with "drop the 403 audit (design D9 fallback)". Dropping it removes AC 6, much of 2.9 and the helper extraction that AC 17 and the S4 row depend on, and it changes ratification items 4 and 5. Tasks should list which tasks and ACs fall away so a cut under time pressure does not leave orphaned tests or an AC claimed but unbuilt.

**G4. Docs coverage is narrower than the change.** 2.8 updates the REST contract for the new endpoint only. The contract also changes for TOPIC-002 (`canAssignDefaults`) and for the advance handler (the lock-state-specific `NO_ACTIVE_TOPICS` message). 5.5 is conditional ("if the docs list them"). Extend 2.8 to cover those two, so the API doc does not drift from the specs.

**G5. Conditional work and the time-box.** 1.5 may add a `/start` guard task with a test, and 1.4 may add a script proposal. Neither is estimated against the three-to-four-day box. Add a note: a guard task added by 1.5 counts against the time-box and is not cuttable (the proposal says it "cannot be silently dropped").

**G6. Minor traceability items.**
- Proposal header cites FR-8.2; no task or "Covers:" tag references it. Either tag it (likely 2.4/5.x) or drop it from the proposal header.
- AC 9's "no notification, no undo" has no assertion. A one-line negative test (no emit other than the audit event) would close it.
- 2.1 covers "unlocked zero-topic team gets 201", and 5.1 covers the unlocked admin with no Assign button, but nothing checks that the unlocked admin sees the archive action as AC 9 states. Low risk; mention in 5.1's matrix.
- 6.3 (Purpose sentence at sync) is easy to miss because it executes at archive time. The Workflow follow-up section should list "run 6.3" as an explicit archive precondition rather than leaving it only in group 6.

## What was translated well

- The pre-build gate with its decision rule (count 0 or rows > 0) is preserved intact, including the conditional that cannot be dropped.
- The never-cut list (endpoint, flag, button, room-open message, live role read, lock and isolation tests, 2.10) matches the proposal and protects the ritual constraints.
- The lock-untouched requirement is made permanent through a source test rather than a one-time diff check, which is the right way to keep "exactly one carve-out" honest.
- Real-Postgres requirements for concurrency and the audit casts are explicit, with the fail-open-hides-cast-errors rationale.
- The dropped admin room-open variant stays dropped; no task resurrects it.

## Recommendation

Proceed after addressing B1 to B3 and, ideally, G1 and G2. The rest can be handled as inline edits to existing tasks and do not change scope or the time-box.
