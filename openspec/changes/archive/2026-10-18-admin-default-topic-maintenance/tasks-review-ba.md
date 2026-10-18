# Tasks review: admin-default-topic-maintenance (#216)

Reviewer: Marcus Delgado, Business Analyst. Scope: do tasks.md, taken together, cover every capability in proposal.md, every spec scenario, and every issue #216 acceptance line, and is anything lost between requirement and task?

**Verdict: approve with five small required edits (R1 to R5) and four recommended ones.** Coverage is strong. Every issue line and all four capabilities map to tasks. The findings are one real coverage gap in the `default-topic-provisioning` delta, a handful of spec scenarios with no named test, and task-list hygiene that will hurt traceability.

## 1. Issue #216 traceability

| #216 line | Task(s) | Result |
|---|---|---|
| Dedicated admin-only endpoints: add, edit, archive, restore, reorder | 2.3, 3.3, 4.2, 4.6 | Covered (seven routes: five writes plus two reads) |
| Own authorization, Application Administrator only | 3.3, 4.1 | Covered |
| Own audit events, separate from `topic.write_denied_template` | 3.1, 3.2, 4.3 | Covered, including a test that denial rows do not match the maintenance operation set |
| Define effect on existing teams (new teams only), confirm against requirements | 4.4, 6.1, 6.2, 6.3 (cites use case 08 and BRD 6.4) | Covered |
| Display positions unique so a team copied from the template can always be created | 2.2 (dense normalization, invariant backstop), 2.3, 2.5, 4.2 | Covered, but see R2 and R3 |
| Admin maintains the set without a migration, every change audited | 2.2, 4.3, 8.1 | Covered. The "no migration" claim has no explicit task (R5) |
| #188 guard and structural test pass unchanged | Preamble, 4.6, 5.1 | Covered |
| Non-admins get 403 | 4.1 | Covered |
| One audited function for every template write | 2.2, 4.7 | Covered |
| One `audit_log` row per template write | 2.2, 4.3 | Covered, including a forced audit failure and no row for no-ops |
| Trigger reconsidered | 6.6 (outcome in the design) | Covered. Written outcome recorded in the PR |
| Invariants baseline updated in the same change | 4.9 | Covered, with the E6 reinterpretation flagged for PO ack in 1.1 |

Nothing in the issue is dropped. The one place a requirement is changed rather than dropped is E6 (the baseline cannot be updated by a runtime edit). It is correctly surfaced in 1.1 and 7.2.

## 2. Proposal capability coverage

- **admin-default-topic-maintenance (new):** Covered by sections 2 to 4. Each spec requirement block has an implementing task and a test task, except the scenarios listed in section 3 below.
- **default-topic-provisioning (modified):** Only partly covered. See R1.
- **audit-logging-operations (modified):** 3.1, 3.2, 3.6, 4.3. Covered.
- **topic-write-rate-limiting (modified):** 3.3, 4.8, 4.8a. Covered.

Proposal "What Changes" items with no task or only an indirect one: the "Constraints preserved" statement that first-session lock, membership and facilitator rules get no admin control (covered only indirectly by the 4.6 inventory; acceptable). Everything else is present.

## 3. Findings

### Required edits

**R1. Provisioning-delta scenarios have no tasks (real gap).** The `default-topic-provisioning` spec carries scenarios for: gaps in template positions not reaching the new team; an archived and an active default at one position not failing creation; duplicate active positions not failing creation; a single active default; active and archived defaults of one name; "No active defaults raises no non-contiguous anomaly"; and "Each anomaly type is detected" (minus `non_active_default`). Task 3.5 removes `non_active_default`, and 4.10 adds only "an archived default raises no anomaly and is not copied". The rest of these are not named in any task. These are the scenarios that protect the issue's "a team copied from it can always be created" line, which is the most user-visible failure of this feature (a team that cannot be created). Add a test task, or extend 4.10, to cover each provisioning-delta scenario explicitly, and have 1.5 or 2.2 state whether `copyCanonicalDefaults` needs any code change for the archived-at-same-position case or is verified as already correct.

**R2. Numbering and ordering defects in tasks.md.** 3.6 appears before 3.5. 4.12 appears between 4.7 and 4.8a. 4.8a appears before 4.8. Task 4.8a refers to "the 5.4a rule", and there is no task 5.4a (section 5 has only 5.1). A reader or agent following the list cannot find the rule, and the rate-limit mock requirement may be lost. Renumber in order, and fix the reference to point at the real task (probably 4.8a itself or 4.1).

**R3. Position-uniqueness is asserted only indirectly.** The issue names it as its own scope line. Tests exist for dense renumber on archive and a gapped template being repaired, but no task says "after every one of the five operations, active positions are exactly 1..N and unique", run as an assertion across all operations including restore, add at capacity and reorder. Add that as an explicit line in 4.2 or 4.3.

**R4. #216 closure wording.** The issue acceptance reads "An admin can maintain the default set without a migration". The proposal says FR-8.1 is only "partially met, API only". Task 7.2 states the FR status but does not say whether the PR closes #216 or leaves it open pending the screen issue. Add to 7.2: the PR description states explicitly that the issue's acceptance is met at the API level, that FR-8.1 is not met as administrator self-service, and whether the issue closes on merge (my recommendation: it closes; the screen issue carries the remainder).

**R5. No task proves "without a migration".** Add one check to 5.1 or 4.6: the change set contains no file under the migrations directory and no schema change. It is one line, and it is an issue acceptance line.

### Recommended

**N1. Task 1.4 is not an agent-completable task.** It is a human action that gates BA sign-off. It is correctly flagged. Add it to the 7.2 PR checklist as a blocking item ("acceptance not signed while any follow-up number is `#TBD`") so it cannot be lost if the PR is opened before the numbers exist. 6.3 also depends on the screen issue number; say that 6.3 is completed after 1.4 or lands with a placeholder that 1.4 replaces.

**N2. Spec scenarios with no named test.** "Works with no teams" (zero real teams in the database), "Edit it back" (recovery from a before-value, currently only the manual dry run in 8.1), and "Sentinel id is not accepted as input" (4.6 covers the inventory but not a request carrying the sentinel id in a body or query). Name each in 4.2, 4.4 or 4.12. The "Edit it back" scenario matters to me most: it is the sole recovery path (D3, D13), so an automated round-trip test (edit, read history, patch back to the before-value, confirm the live row equals the original) is worth more than the manual dry run.

**N3. Topic-history preservation (persona hard requirement).** Archive-not-delete is the guarantee I cannot let be cut. It is protected indirectly by the "exactly seven routes" inventory in 4.6. Make it explicit: add to 4.6 that no route accepts DELETE and that the archive operation leaves the row, its id and its audit history intact.

**N4. Prompt-writing guidance is a documentation-only control.** 6.4 carries it, and the proposal accepts the residual risk. Good. But the guidance should also appear where the first real users will look: put the same good and bad examples in the `docs/deployment.md` runbook entry (6.5) or cross-reference them, since API-only means the first users read the runbook, not the REST contract.

## 4. Lost in translation: items verified as preserved

- Scope statement text, exact rename notice string, and "never call restored topics canonical": preserved in 3.3, 4.5, 6.4.
- Success statuses (201 for add, 200 otherwise): 3.3, 4.2.
- Three-way "partially met, API only" language: 6.3, 7.2, and in the preamble ("never as administrator self-service"). Good.
- Ratification items from the proposal (assumptions 1 to 9): 1.1 lists D2, D3, D6, D7, E6 and E2a; 7.2 adds edit-of-archived refusal, `lastChangedAt` excluding reorders, the 403 code name and retiring `non_active_default`. D1 (archive not delete) and D5 ("canonical" meaning) are not in the 1.1 list but are in the 6.3 and 7.2 text. Acceptable, but add D1 and D5 to the 1.1 list so the ratification record matches proposal assumptions 5 and 6.
- Dry run and threat-model revisit: 8.1, correctly marked as a pre-first-production-edit checklist item and not a merge gate. Recorded outcome is required. Good.

## 5. Sign-off position

Not signing until R1 to R5 are applied. R1 is the only one that changes test scope; the rest are edits to the task text. N1 to N4 are recommended and I will not block on them. My acceptance of the whole change remains conditional on the four follow-up issue numbers being filed (task 1.4).
