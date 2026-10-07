# Tasks Review: store-idp-role-set (#245) — Business Analyst

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewed:** `tasks.md` against `proposal.md`, `specs/oidc-role-mapping/spec.md`, `specs/auth-error-handling/spec.md`, `specs/first-access/spec.md` and issue #245
**Question asked:** Do the tasks, taken together, cover every capability in the proposal and every scenario in the delta specs? Is anything lost between the requirements and the tasks?

## Verdict

Mostly yes. The schema work (CHECK rules, malformed arrays, shim, backfill, lock bounds), the resolver, the upsert and the firing clause are covered carefully, often more precisely than the specs. What is thin is the part a person would actually notice: the **TEAM-006 refusal** that #245's second problem bullet is about has a spec scenario in two capabilities but no test and no line in F1's body, and the **sign-in audit row is never written by the application against a real database**, so `actor_roles` and metadata `roles` are only checked through mocks. Four P2 items, eight P3 items. None needs a redesign; all are task wording or one extra test.

## Scenario-to-task trace

Legend: ✔ covered · ◐ covered in part or only by implication · ✘ no task

### oidc-role-mapping

| Requirement / scenario | Task(s) | Status |
|---|---|---|
| Precedence: admin + facilitator, EM + facilitator, admin + EM, facilitator + senior | 3.2 ("every existing precedence row") | ✔ if those rows exist today; 3.2 names only some explicitly |
| Duplicate and out-of-order values | 3.2 | ✔ |
| Single-string claim stores a one-element set | — | ◐ not named in 3.2 (see P3-1) |
| Admin + senior engineer: full set, **no discard line** | — | ◐ set via 3.2 at best; "no discard line" not in 4.3 (P3-1) |
| Fallback: nothing mapped; inherited property names; senior alone | 3.2, 1.2 | ✔ |
| Missing claim stores `[engineer]` | 1.2 (DB-level positive insert for `missing`) | ◐ no resolver-level assertion (P3-1) |
| Discard line: admin + fac, EM + fac, admin + EM | 4.3 | ✔ |
| Discard line: admin + EM + fac gives exactly one line with both | — | ◐ not in 4.3's list (P3-1) |
| Discard line: facilitator-only and fac + senior give none; `roles` still contains the outranked role | 4.3 (fields/scope), 3.2 | ◐ |
| Outranked roles in audit role set: returning and first sign-in, no discard flag | 5.1, 5.3 | ◐ no test names the admin + facilitator case with "no discard flag" (P3-2) |
| CHECK: disagreeing, empty, engineer-alongside, duplicate/ascending, malformed, `toString` | 1.2 | ✔ |
| No column default (omitting `roles` stores `[global_role]`) | 1.7(a) | ◐ behaviour covered through the shim; "no column default" itself never asserted (P3-3) |
| Backfill: existing admin gets `[application_admin]`, `global_role` unchanged | 1.4 | ✔ |
| Backfill: next sign-in replaces the backfilled set | — | ✘ (P2-2) |
| Fresh install passes the rule | 1.1(b) | ✔ |
| Previous build: first sign-in, role-changing, unchanged-role, new build never altered | 1.7 (a)–(c), 1.7 last sentence | ✔ |
| Rollback keeps sign-in working "at every step, before and after the optional down migration" | 6.2 (documented), 1.4 + 1.7 by composition | ◐ (P3-4) |
| Migration 21 fails cleanly on lock timeout, re-run succeeds | 1.8 | ✔ except "exits non-zero" (P3-5) |
| Live lobby survives the migration | 7.3 | ◐ re-authorization sweep may not fire during the window (P3-6) |
| Migration 22 fails cleanly within ~200 ms | 1.8 | ✔ |
| **Sign-in during the audit column migration succeeds** (waiting for *or holding* its lock) | 7.3 | ◐ the risky "waiting" case is not engineered (P2-3) |
| No authorization reads the set (grep) | 0.1, 7.1 | ✔ |
| Admin + facilitator still refused draft creation (403, message, no audit row) | 7.2 | ✔ |
| Admin + manager still excluded from participant registration (403, row, `actor_roles` NULL) | 7.2 | ✔ |
| **Admin + manager still gets 409 from TEAM-006** | — | ✘ (P2-1) |

### auth-error-handling

| Scenario | Task(s) | Status |
|---|---|---|
| First Access recorded transactionally, `actor_roles` = new set, metadata has `roles` | 5.1, 5.3 | ◐ mocked only (P2-4) |
| Failed audit write rolls back; failed connection acquisition | existing tests, unchanged | ✔ (assumes existing tests still pass with the extra column; 7.5) |
| Role claim mapping with prior values incl. `previousRoles`, `actor_roles = roles` | 4.2 (resolver, real DB), 5.1 (route, mocked) | ◐ (P2-4) |
| Brand-new user: no `previousRole` / `previousRoles` key | 5.3 | ✔ |
| Reversion to default, metadata and event | 5.2 (fires), 5.3 (identical arrays) | ✔ |
| Returning engineer, no change, no row | existing test | ✔ |
| Admin + facilitator: `roles` carried, no discard flag, no claim values | 5.3, 5.4 | ◐ (P3-2) |
| Set change without single-role change | 5.2 | ✔ |
| Concurrent first sign-in: both previous fields null | 4.1, 5.2, 5.3 | ✔ |
| Previous set reflects the row before this sign-in | 4.2 | ✔ |
| Row and event carry identical arrays | 5.3 | ✔ |
| **Worked backfill scenario (two sign-ins after upgrade)** | — | ✘ (P2-2) |
| Other operations leave `actor_roles` NULL | 5.3, 7.2 | ✔ |

### first-access

| Scenario | Task(s) | Status |
|---|---|---|
| Item 4/5 wording, firing wording | spec text only | ✔ |
| Group-style array claim gives `roles = {engineering_manager}` | — | ◐ existing #235 real-DB test not extended (P3-7) |
| EM removed at IdP: `roles` becomes `{engineer}`, `previousRoles` recorded | 5.2 (firing) | ◐ (P3-7) |
| Admin + manager recorded as a manager in the set; TEAM-006 outcome unchanged | 3.2 (set); TEAM-006 none | ◐ (P2-1) |

### Proposal items outside the scenarios

| Proposal item | Task(s) | Status |
|---|---|---|
| Docs: `database-schema.md` incl. stale comment | 1.6 | ✔ |
| Docs: UC 01 TEAM-006 note | 6.3 | ✔ |
| Docs: deployment conflict query, `--no-single-transaction`, revocation runbook, upgrade notes | 6.1, 6.2 | ✔ (see P3-8 on where upgrade notes live) |
| S1 / S4 re-run | 7.4 | ✔ |
| Follow-ups F1, F2, F4, F5; #241 comment; milestone decisions | 0.2, H.1–H.6 | ◐ F1 body omits TEAM-006 (P2-1); F2/F4/F5 bodies unspecified (P3-8) |
| Behaviour-neutral, no client exposure | 7.1 | ✔ |

## Findings

### P2 — should fix before implementation starts

**P2-1. The TEAM-006 refusal has two spec scenarios and no task, and its fix is missing from F1's body.**
`oidc-role-mapping` ("Manager who is also an admin still cannot be associated as a team's manager") and `first-access` ("TEAM-006's precondition outcome for this user is unchanged") both say an admin + manager still gets 409. Task 7.2 tests draft creation and participant registration but not TEAM-006. This is exactly #245's second problem bullet ("the person is not recognised as a manager (TEAM-006 and the manager history views)"), and task 6.3 tells operators in the use-case doc that the 409 persists "until F1". Two consequences:
- Nothing proves the behaviour-neutral claim for the one refusal the issue is about. Add to 7.2: a user with `Fixture.user(['application_admin','engineering_manager'])` (or signed in with that claim) is refused by `POST /api/v1/teams/:teamId/managers` with 409 and the `global_role` precondition error code, and no `team_memberships` row is created.
- The fix can be lost. Task 0.2 lists what F1's body MUST contain verbatim; it includes the facilitation blockers but not "TEAM-006's precondition and the manager history views move to `roles` so an admin + manager is recognised as a manager." Add it, and say whether the manager views (EM-*) are in F1's scope or a separate area. Otherwise #245 closes, F1 is filed without it, and the issue's second bullet is silently dropped while the use-case doc points at F1.

**P2-2. The worked backfill scenario has no test.**
`auth-error-handling` "First role-claim row after the upgrade shows the backfill as the previous set" (and `oidc-role-mapping` "Next sign-in replaces the backfilled set") were written as concrete GIVEN/WHEN/THEN at my request in the propose review, because F5 depends on that exact first-diff shape. Task 4.2 tests facilitator → EM + facilitator from a sign-in-created row, not a backfilled one. Add a real-Postgres test: insert a row as the backfill would (`global_role = 'application_admin'`, `roles = '{application_admin}'`, or via the shim), sign in with admin + EM, assert `previousRole = 'application_admin'`, `previousRoles = ['application_admin']`, `roles = ['application_admin','engineering_manager']`; sign in again, assert `previousRoles = roles = ['application_admin','engineering_manager']` and that the row still fires (non-engineer clause).

**P2-3. "Sign-in during the audit column migration succeeds" is not tested for the case that can actually fail.**
The scenario covers a sign-in arriving while migration 22 is *waiting for* its lock. That is the dangerous case: migration 22's ACCESS EXCLUSIVE request queues behind any open transaction on `audit_log`, and every new audit INSERT queues behind it, for up to 200 ms, against a 400 ms audit timeout. Task 7.3 applies the migrations "while a sign-in is in flight", which will almost always hit neither the waiting nor the holding window, so it passes by luck. Task 1.8 already holds a conflicting lock on a scratch `audit_log`; extend it so a third connection runs an INSERT into that scratch table with the production audit statement timeout while migration 22 is waiting, and assert the INSERT succeeds after the migration times out (or completes). That turns the 200 ms < 400 ms argument into evidence.

**P2-4. No test writes the sign-in audit row to a real database.**
The `audit_log` INSERT for the two sign-in operations lives in `routes/auth.ts` and is tested only in `routes/__tests__/auth.test.ts`, which mocks `db`, `audit-logger` and `account-resolver` (the existing `role-claim-persistence-integration.test.ts` says so in its header). Task 4.2 is real-Postgres but stops at the resolver. So the new `actor_roles TEXT[]` parameter, its position in the INSERT, the JS-array-to-`TEXT[]` binding, and the shape of `metadata->'roles'` in JSONB are never exercised against Postgres before task 7.3's manual gate, and 7.3 only signs in through the *previous* build. Task 6.1's auditor query is verified "against seeded audit rows", i.e. rows the tester shaped by hand, so it checks the query against an assumption rather than against what the application writes. Fix one of two ways: (a) add a real-Postgres test that drives the callback's audit-write path (or the transaction helper it uses) for both operations and reads back `actor_roles` and `metadata->'roles'`, then runs 6.1's query against those rows; or (b) add to 7.3 a sign-in through the *new* build after rollout, with a `SELECT actor_roles, metadata->'roles'` recorded under "Migration timing", and run 6.1's query against it. (a) is preferred because it runs in CI.

### P3 — tidy before or during implementation

**P3-1. Name the remaining resolver and discard scenarios in 3.2 and 4.3.** "Every existing precedence row" depends on what rows exist today. Name explicitly: single-string claim `"facilitator"` → `[facilitator]`; missing claim → `[engineer]` (resolver level, not only 1.2's DB insert); admin + senior → `[application_admin, senior_engineer]` with **no** discard line; admin + EM + facilitator → exactly one line listing both; facilitator + senior → no line and `roles` contains `senior_engineer`.

**P3-2. Pin the "no discard flag" scenarios.** 5.3 should include: returning admin + facilitator → `auth.role_claim_mapped` metadata has `roles = ['application_admin','facilitator']` and no discard-like key; first sign-in admin + facilitator → `auth.first_access_created` has the same `roles`, no discard key, and one discard log line. The existing "adds nothing to audit metadata" test is the natural place; say so.

**P3-3. Assert "no column default" directly.** The requirement title is "The role set has no column default", but the only test (1.7a) passes whether or not there is a default, because the shim fills first. Add to 1.4 an `information_schema.columns.column_default IS NULL` assertion for `roles`, so a later "helpful" `DEFAULT '{engineer}'` fails a test.

**P3-4. Say how the rollback scenario is verified.** The scenario claims sign-in works "at every step, before and after the optional down migration". Either add a rollback leg to 7.3 (redeploy the previous build, sign in, run down 22 then 21, sign in again; the stack is already up) or state in 7.3 that it is verified by composition of 1.7 (previous build on migrated schema), 1.4 (down restores the pre-21 shape) and 6.2 (documented order). Today no task claims it.

**P3-5. "Exits non-zero" is in the scenario but explicitly not asserted.** Task 1.8 excludes it as node-pg-migrate's behaviour. Fine, but then either drop "and exits non-zero" from the scenario or record it once in 7.3 (`npm run db:migrate` with a held lock; record `$?`). An operator's automation keys off that exit code.

**P3-6. Make sure 7.3 actually crosses a re-authorization.** "No client fails re-authorization" is only meaningful if the periodic re-authorization sweep runs during or just after the migration window. State the sweep interval in 7.3 and keep the lobby open past it, or trigger it.

**P3-7. Extend the existing #235 real-DB test rather than leaving `first-access` scenarios to mocks.** `auth/__tests__/role-claim-persistence-integration.test.ts` already covers group-style mapping and EM removal against real Postgres. Adding `roles` / `previousRoles` assertions there covers "Group-style array claim" (`{engineering_manager}`) and "EM role removed at IdP" (`{engineer}`, previous set recorded) at almost no cost, and keeps the constraint "Teams MUST NOT be promised EM history access until verified by CI" honest for the new column.

**P3-8. Smaller wording and sequencing points.**
- 0.2 spells out F1's body in detail but not F2's (drop `global_role`; `audit_log.actor_global_role` kept permanently), F4's (facilitator-actionable refusal message, scheduled with F1) or F5's (any role-history UI must annotate or suppress each user's first post-migration-21 diff). Add one line each; that content is in the proposal and nowhere else.
- 6.2 says "Write upgrade notes" without saying where. `docs/deployment.md` has an "Upgrading" section that currently describes only the #243 release; name it (a new #245 subsection) so the reviewer in 6.2 knows what to check.
- H.5 (defer `actor_roles`?) and H.6 (1) (`previousRoles` null in the race) change what 1.1, 4.1, 5.1 and 5.2 build. Mark them as "answer before section 1 starts", or they will be answered after the code exists.
- Human actions are numbered H.1, H.3, H.4, H.5, H.6, H.2. Reorder or renumber so a checklist reader does not think one is missing.

## What is done well

- The CHECK rules in 1.2 map one-to-one to the consistency scenarios, including the malformed arrays and the UPDATE that the shim must not swallow.
- The legacy-writer tests (1.7) cover all four upgrade-window scenarios, including the stale-set case, and the "new build never altered" check.
- 5.2's "deleting the clause fails the hand-built test" is the right way to prove a clause that adds no firing case today.
- 0.2 carries the capability rules, the precondition and the Risk 8 constraint verbatim into F1, which is what protects the no-manager rule when the contract step arrives.
- The "facilitators refused today are still refused" message reaches the upgrade notes (6.2), so nobody tells a facilitator their problem is fixed.
