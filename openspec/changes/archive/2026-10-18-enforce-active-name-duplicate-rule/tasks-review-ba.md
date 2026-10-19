# Tasks Review (Business Analyst): enforce-active-name-duplicate-rule (#299)

Reviewer: Marcus Delgado, Senior Business Analyst
Inputs: proposal.md, tasks.md, four delta specs (add-custom-topic, restore-topic, bulk-restore-default-topics, topic-management-screen), design.md headings.

## Verdict

Approve with a small set of fixes. Coverage is strong. Every "What Changes" bullet, all four modified capabilities, the #218 reversal, the BRD/use-case/contract updates, and nearly every spec scenario map to a task. The gaps are mostly test-side: a few spec scenarios and assertions are stated in the specs but have no task that would catch their regression. Nothing in the tasks contradicts the specs. One wording drift (bulk "shares the one function") needs a decision.

## Capability coverage

| Capability / proposal item | Tasks | Result |
|---|---|---|
| add-custom-topic: new 409 rule, body shape, no audit/gap, admin no exemption, rate limit, 503, concurrency | 3.1, 4.2, 4.4 | Covered |
| add-custom-topic: check-order MODIFIED (lock before name, 422 before name, floor on 409) | 3.1, 4.2 (floor, 422, lock) | Covered |
| restore-topic: new 409 rule, swap, blank name, same-topic concurrency, TOPIC_ALREADY_ACTIVE precedence | 3.2, 4.3, 4.4 | Covered, see G2/G3 |
| restore-topic: REMOVED requirement | 4.5 (flip tests), 8.2 (sync) | Covered |
| bulk-restore: unchanged behaviour, shared rule, parity | 2.2, 3.3, 4.1 | Covered, see G5/G6 |
| topic-management-screen: active-name block, no "Add anyway", prompt-edit rule, server 409, restore-row message | 5.1 to 5.4, 6.1 to 6.3 | Covered, see G4/G7/G8 |
| Docs: REST contract, use case 08 (+ known limitation), BRD OQ-3, FR-8.6/FR-8.2 | 7.1 to 7.3a | Covered |
| #218 reversal stated plainly; follow-up issue proposed not created | 7.4 | Covered |
| Writer inventory, security/threat-model note, no new audit op | 1.2, 3.4, 3.5 | Covered |
| Legacy duplicates untouched | 4.6 | Covered |
| PO confirmations (look-alike, FR-8.6 reading) | 7.2, 7.3a | Recorded in docs; see G9 |

## Gaps (spec behaviour with no task that verifies or delivers it)

**G1 (should fix). Restore 409 timing-floor assertion missing.** The restore-topic MODIFIED requirement says `applyTimingFloor` is invoked on the `TOPIC_NAME_ACTIVE` rejection. Task 3.2 implements it; 4.2 asserts it for Add, but 4.3 has no equivalent. Add "applyTimingFloor called on the 409" to 4.3.

**G2 (should fix). Restore rejection side-effects only partly asserted.** The spec says no `display_order` is consumed and `restored_by` is unset. 4.3 lists "stays archived, `restored_at` unset, no `topic.restored` row" only. Add `restored_by` unset and no display_order change (the next restore or add gets the next unused position).

**G3 (should fix). Archived-only match on restore is not tested.** The spec says "a name matching another archived topic is not a conflict". 4.2 has the Add equivalent ("archived-only match accepted"); 4.3 has no restore equivalent. "Two same-named archived topics restored in turn" tests the second restore being rejected after the first becomes active, not the case where only archived siblings exist. Add it.

**G4 (should fix). Blank-name rendering on the client is untested.** The spec requires "a topic with no name" in place of the quoted name for both the Add blocking message and the restore-row message. 5.2 and 5.4 say "fixed text from the spec" but no test in section 6 exercises an empty `conflictingName`. Add one case to 6.2 or 6.3.

**G5 (should fix). No explicit bulk regression assertion.** The proposal makes a strong claim, "byte-for-byte unchanged, `NAME_ACTIVE` never unified". 3.3 is a "confirm" step and 4.1 only checks verdict parity. Add a test that the bulk response for a name collision still uses reason `NAME_ACTIVE`, status 200, and the same shape as before. The other bulk scenarios (blank-named, history-ignoring winner, skip-is-not-failure, Equipe/NFC) are existing behaviour, so existing tests carry them as long as `plan-default-restore.test.ts` stays green (2.4 does require that).

**G6 (decision needed). "One shared function" wording drift.** Proposal and the bulk spec say bulk "now shares the one comparison function". Task 2.2 deliberately keeps `planDefaultRestore` on its own seen-set and shares only the normalizer, with parity enforced by the 4.1 table. That is a sound design call (D1) but it is a narrower claim than the proposal. Either soften the proposal/spec sentence to "shares the normalizer", or note in 2.2 that the table is the guard against drift. Without this, a later reader will think bulk is routed through `findActiveNameConflict`.

**G7 (should fix). Client precedence and retry-exemption scenarios not listed in 6.1.** Specs state: (a) archived-match message shown when both archived and active prompt-only match; (b) active name match governs even when the prompt matches an archived topic; (c) the retry exemption "never applies to an active name match". 5.1 implements (b) but no test names (a), (b) or (c). Add them to 6.1.

**G8 (minor). Restore-row message announcement and bulk skip wording untested.** 6.3 checks fixed text, persistence and clearing but not that the row message is announced to assistive technology, which the spec requires. 5.4 requires the `restoreDefaults` skip report to match the shared phrase; no test checks that wording. Add to 6.3.

**G9 (minor). PO confirmations are an unowned precondition.** 7.3a is marked "subject to the PO confirmations", and the proposal records both as given. Fine, but the BRD note will cite them; add a line to 7.3a or 7.4 saying the PR description links the confirmations (PO name/date) so the BRD note is traceable. The FR-8.6 [HARD] narrowing is the one item here that touches a hard requirement, so I want that trace to exist.

## Spec ambiguity surfaced by the tasks (not a task defect)

**S1. Disabled-reason precedence on Submit.** The existing interlock requirement says Submit shows "the first applicable reason" among dirty reorder, dirty definition, open Remove/Restore. The new active-name block also disables Submit with its own inline reason. Neither spec nor tasks say which is shown when both apply, or whether both show. Likely harmless (the name block is inline at the field, interlock reasons are at Submit), but tasks 5.2 and 6.1 should state the intended behaviour so an implementer does not guess. Recommend: both visible, name block inline at the Name field, interlock reason at Submit.

## Priority items I checked and found preserved

- Customization-lock gate ahead of the name check, and lock 409 never leaking conflicting fields (1.1, 4.2, 4.3, 6.2).
- Branch on `code`, never bare 409, for all three callers (5.3, 5.4, 6.2).
- No override path for any role, `force` ignored (3.3, 4.2, 4.3).
- Handled-exit rollback (single ROLLBACK, no double in catch) is specified in 3.1.
- Rate limiter unavailable returns 503, never 409 (4.2, 4.3).
- No log line or response containing the names (3.1, 3.2, 4.7).
- Optional scope (4.4a, 5.5, 5.6) matches the "declined/optional" disposition in the proposal; the must-have core is correctly separated.

## Recommended edits to tasks.md

1. 4.3: add timing-floor called, `restored_by` unset, no display_order consumed, archived-only sibling is not a conflict (G1 to G3).
2. 6.2/6.3: add empty `conflictingName` rendering, row-message announcement, bulk skip-report phrase (G4, G8).
3. 6.1: add archived-over-prompt-only, active-over-archived, and no-retry-exemption-for-active-name cases (G7).
4. 4.x: add explicit bulk `NAME_ACTIVE` response-shape regression (G5).
5. 2.2 or proposal: reconcile "shared function" wording (G6).
6. 5.2: state the Submit disabled-reason behaviour when the name block and an interlock coincide (S1).
7. 7.3a/7.4: link the PO confirmations in the PR (G9).
