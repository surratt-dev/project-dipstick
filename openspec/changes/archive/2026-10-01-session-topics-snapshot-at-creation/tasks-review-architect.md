# Tasks Review: session-topics-snapshot-at-creation (#175)

**Reviewer:** Ingrid Sollenberger (Solution Architect)
**Date:** 2026-10-01
**Inputs:** `tasks.md`, `design.md`, `proposal.md`. I spot-checked code at `c4585cc`: the four lock sites in `topics.ts`, the `AuditOperation` union in `auth/audit-logger.ts`, and `integration.yml`.
**Focus:** dependency order between tasks, tasks to split or reorder, and steps that only a human can do.

## Verdict

**Approve with changes.** The architecture in design.md holds up. The snapshot helper takes only a session id, there is one canonical lock key, the conditional `UPDATE` guarantees correctness, and the audit content boundary is explicit. The task list mostly follows the dependency graph. It has four real ordering defects, though: a task is tested before it is built, a section turns CI red on purpose for several tasks, a CI-flake fix lands after the change that causes the flake, and a test helper is never created. The release tasks also mix agent work with human-only steps and do not mark which is which. None of these needs a design change. All of them should be fixed in `tasks.md` before an implementing agent starts.

---

## A. Ordering defects (blocking)

### A1. 3.7 (live-role enforcement) is built after the tasks that test it

3.6 asks for mock tests of "live-role 403 and its audit row". 3.4's error-ordering cases assume the final pre-transaction check order: 404, 403 team, 403 creator, 403 live role, then 422. Task 3.7 is what builds that check, moves the `global_role` read, and adds `session.advance_denied_role` to the `AuditOperation` union. That union is a typed string union, so 3.6 will not even compile against it until 3.7 is done.

**Fix:** make 3.7 the first task in section 3, before 3.1, so `/advance` gets its pre-transaction auth order settled before the transaction is restructured. Or fold it into 3.1 as "pre-transaction checks". The design's ordering rule that "the lock is taken only after every authorization check" can then be tested from 3.1 on.

### A2. Section 3 breaks the unit lane from 3.1 until 3.6

design.md Risks says it plainly: `makeMockClient` returns `rowCount` undefined. As soon as 3.1 adds the explicit `rowCount === 1` check, every existing `/advance` happy-path mock test hits the 0-row 422. As soon as 3.2 lands, any test that gets past that hits `NoActiveTopicsError`. The positional mock fixes in `facilitator-sessions.test.ts`, `http-session-expiry-no-partial-execution.test.ts` and `facilitator-error-state-2-restricted-role.test.ts` are put off until 3.6. That leaves three tasks during which `ci.yml` is red by design. An agent working task by task will either "fix" this ad hoc or fall back on the 90% gate.

**Fix:** split 3.6. Each of 3.1, 3.2, 3.3 and 3.7 should carry its own mock-sequence update and its own new-branch mock tests, with "unit lane green" as its exit condition. Whatever is left of 3.6 becomes a coverage check only.

### A3. 4.1 has the same problem, and nothing budgets for it

4.1 adds two statements to `POST /teams` (the lock and the snapshot `INSERT ... RETURNING`). The existing `POST /teams` mock happy-path tests will then get an empty `RETURNING` and go to the 500 path. 3.6's list of mock-sequence updates is written for `/advance`. 4.4 adds only the empty-template test. No task says "update the existing `POST /teams` positional mocks."

**Fix:** add that work to 4.1 explicitly, covering every file that drives `POST /teams` through a mock client.

### A4. 4.5 (atomic template swap) must come before 4.1, not after

The design's Risks section says that after this change, a concurrent `POST /teams` that runs during the non-atomic template swap in `default-topic-provisioning-integration.test.ts` returns 500. That means the integration lane can flake from the moment 4.1 merges. 4.5 is a precondition, not a cleanup.

**Fix:** move 4.5 to the top of section 4, or into section 1 as test-infra preparation. It changes only test code, so nothing stops it from landing first.

### A5. The lock-as-gate concurrency helper has no task of its own

3.4 says "uses a shared lock-as-gate helper" and 3.5 says "using the same lock-as-gate helper", but no task creates that helper. It is not trivial. It needs a dedicated client, `pg_advisory_xact_lock(hashtext($1::uuid::text))`, `pg_locks` polling for `granted = false` from two other backends with a timeout, then commit and await. It also has to use the same key expression as `lockTeamTopics`. If the test helper and production disagree on the key, the concurrency tests pass without the two requests ever overlapping.

**Fix:** add a task between 2.3 and 3.4, for example "2.4 Shared test helper `withTeamLockGate(teamId, fire)`". Its key should come from the production `lockTeamTopics` SQL, either imported or kept as a shared constant, not retyped. Give it a self-test that fails if the polling times out.

### A6. 7.1 depends on 7.2

One of 7.1's four outcomes is "N = 0 shows the disabled state". 7.2 is the task that builds the disabled state.

**Fix:** put 7.2 before 7.1, or merge them.

### A7. The verification run (10.4) comes after the walkthrough (10.3), and there is no deploy-to-dev task

The walkthrough in 10.3 happens "on dev", so it needs code that passes the full suite (10.4) and has been deployed with migration 20 applied. No task covers that deploy, and design.md Migration Plan steps 1 and 2 (migration first, then backend and frontend together) do not appear in `tasks.md`.

**Fix:** reorder to 10.4, then a new "deploy migration 20 and then the code to dev, per the Migration Plan order" task, then 10.3. Reproducible deployment is one of my standing criteria. The deploy order in the design should be a step someone checks off, not prose.

---

## B. Tasks to split or tighten (should fix)

### B1. 2.1 and 2.3 both define `lockTeamTopics`

2.1 exports `lockTeamTopics`, and 2.3 gives its implementation. Keep the definition and its case-folding test in 2.1. Make 2.3 only the migration of the four `topics.ts` call sites (L780, L925, L1127, L1288, confirmed to be `hashtext($1::text)` today). Add one test to that migration: a malformed, non-UUID `teamId` on each of the four routes is still rejected before the lock and never surfaces as a 22P02 500. The design asserts that each site validates first. A test proves it.

### B2. 2.2 has to run on real Postgres, and the helper still needs coverage in the unit lane

Gap renumbering through `row_number()`, the cross-team isolation and annotation copying cannot be checked against a mocked `db.query`. Mark 2.2 as an integration test under the `REQUIRE_DB` rule. Also add a small mock test of the helper for the `ci.yml` 90% gate (zero rows throws `NoActiveTopicsError`, and `topicIds` is sorted by `display_order`).

### B3. 1.4's list of hard-fail tests is incomplete

1.4 names 3.4, 3.5, 6.3 and 8.1. 2.2, 2.3's lock test, the integration half of 4.4, 5.3, 8.2, 8.3, 8.4 and 8.5 are real-DB tests too. Whether every one must fail under `REQUIRE_DB` is your call. The simplest rule an agent can follow without asking is: "every new real-DB test file in this change uses the `REQUIRE_DB` throw." Write that rule, or list the exceptions.

### B4. 1.5 should say where `DEFAULT_TOPICS_TEAM_ID` lives

Both consumers, `facilitator-sessions.ts` and `content.ts`, are route plugins. design.md Decision 2 already says `routes/` holds only Fastify route plugins. Exporting a constant from one route plugin into another works against that boundary. Name a non-route home, for example `src/sessions/` beside the snapshot helper or a small `src/topics/` constants module, so the agent does not choose one by default.

### B5. 3.7 and 4.6 overlap

3.7 registers `session.advance_denied_role` in `audit-logger.ts`, which is required because the union is typed. 4.6 also documents it. Make 4.6 cover only the metadata-contract comments for `session.state_changed` and `team.created_with_session`, and run it before or with 3.3 and 4.3, so the contract is written down before the code that emits it.

### B6. 10.1 mixes three actors

Split it into:
- **10.1a (HUMAN, operator):** run the detection query with a read-only role in every non-dev/CI environment and record yes or no in the release notes.
- **10.1b (AGENT, conditional, blocked on 10.1a = "yes"):** write `src/scripts/backfill-session-topics.ts` with every control from Migration Plan step 3, including the import-boundary check in CI and the `session.topics_backfilled` audit registration. If 10.1a is "no", mark it N/A.
- **10.1c (HUMAN, operator, conditional):** dry-run the script, then run it with `--write` using secret-store credentials, and record who ran it, when, and the session ids.

As written, an agent may assume the answer to 10.1 and build the script anyway, or skip it. Neither is acceptable.

### B7. The copy approved in 10.3 is coded and tested in 4.2, 4.4, 7.1 and 9.6

If Priya changes the `POST /teams` 500 message or the confirm copy in the walkthrough, the asserts in 4.4 and 7.5 and the REST contract text in 9.6 all change late. Either take the copy approval early and asynchronously (send her the strings before section 4 starts), or add an explicit task after 10.3: "apply walkthrough copy changes to code, tests and contract".

---

## C. Human-only steps (mark them in tasks.md)

Prefix these with **[HUMAN]** so that `/opsx:apply` or the implementing agent stops and hands off instead of attempting them.

| Task | Who | Why an agent cannot do it | What an agent can do around it |
|---|---|---|---|
| 10.1a | Operator | Needs read-only credentials for non-dev/CI environments and an accountable yes/no answer | Prepare the query and the release-notes template |
| 10.1c | Operator | Privileged write to the voting record, secret-store credentials, recorded actor | Nothing; the script dry-runs by default |
| 10.2 (in part) | Product owner / security lead | Follow-up 1 "is not filed without" a named owner and target date, and an agent cannot assign either | Draft all five issue bodies with labels; file them once a human supplies the owner and date |
| 10.3 | Priya Nair plus a facilitator-side operator | A walkthrough, a copy judgment and a sign-off. The release gate belongs to her | Draft the threat-model revisit checklist from the "Security notes" table, for human review |
| New deploy-to-dev task (A7) | Whoever owns dev deploys | Environment access | Write down the commands and the migration-first order |
| 9.8 | Agent, at archive only | Not human-only, but tied to the archive step | Mark it **[AT ARCHIVE]** so it is not done during apply |

Everything in sections 1 to 8, 9.1 to 9.7, 10.1b and 10.4 is agent-executable.

---

## D. Dependencies I checked that hold

- 1.1 (column) comes before 3.1, 4.1 and 5.2. 1.2 (shared type) comes before 5.1 and 7.x. 1.3 (envelope) comes before 3.2 and 4.2. All correct.
- Section 2 comes before sections 3 and 4. 2.3, the canonical key at the existing sites, comes before 3.5, the reorder-versus-open test. That is correct and it matters: without 2.3, 3.5 could pass for lower-case URLs only.
- Section 6 (R5) does not depend on 3 or 4 for code. 6.3 and 8.1 depend on the real snapshot (section 2) and on begin-voting, which has already shipped. Correct.
- 8.1 relies on reorder, archive, restore and annotate. All of them have shipped (#52 to #54, #53, #55). The "existing team that has completed a session" precondition will need a SQL seed, because the full ritual cannot produce one until this change lands. Say so in 8.1, the same way 3.4 says "seed zero active topics with SQL."
- Section 9 is correctly marked as not gating release.

## E. Suggested order (summary)

1.1, 1.2, 1.3, 1.4, 1.5, then 4.5 (moved up). Then 2.1 (with the `lockTeamTopics` definition), 2.2, 2.3 (call-site migration only), then the new 2.4 (lock-gate helper). Then 4.6 (contracts). Then 3.7, 3.1, 3.2, 3.3, each with its own mock updates, then 3.4, 3.5, and 3.6 as a coverage check. Then 4.1 (with the `POST /teams` mock updates), 4.2, 4.3, 4.4. Then 5.x, then 6.x. Then 7.2, 7.1, 7.3, 7.4, 7.5. Then 8.x. Then 10.4, a new deploy-to-dev task, 10.1a [HUMAN], 10.1b (conditional), 10.1c [HUMAN, conditional], 10.3 [HUMAN], walkthrough copy follow-ups, and 10.2 (drafted by the agent, owners filled in by a human). Then 9.1 to 9.7, and 9.8 [AT ARCHIVE].
