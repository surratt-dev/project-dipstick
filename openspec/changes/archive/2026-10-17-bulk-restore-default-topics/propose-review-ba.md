# BA review of proposal: bulk-restore-default-topics (#218)

*Reviewer: Marcus Delgado, Senior Business Analyst. Inputs: proposal.md, design.md, tasks.md, the five spec deltas, issue #218, BRD FR-8.2 / FR-8.3 / FR-8.6 / FR-2.7, use case 08.*

## Verdict

Approve with conditions. This is a strong proposal. The backend capability is buildable as written: the cascade, ordering, duplicate rule, audit shape and concurrency are explicit and testable, and every acceptance criterion in #218 has a matching requirement. The weak area is the frontend capability, where several requirements are phrased in prose that two developers would implement differently. There is also one real contradiction in the cascade order. Nothing here needs another discovery round. Items 1 to 4 below should be fixed before build starts. The rest can be settled during build or tasks.

## 1. Check against #218 acceptance criteria

| #218 criterion | Where covered | Explicit? |
|---|---|---|
| One action, one confirmation restores all archived defaults | Spec `bulk-restore-default-topics` req 1; `topic-management-screen` "One request on confirm" | Yes |
| Follows TOPIC-005 cascade, consumes one limiter unit | Cascade req; `topic-write-rate-limiting` scenarios | Yes, but see 2.1 |
| Template team and locked teams refused like single restore | Cascade scenarios (template byte-identical, locked 409) | Yes |
| Audited; row says which topics came back | `audit-logging-operations` | Yes by id and position. Names are deliberately absent (ratification item 1). The AC wording "says which topics" is met only if ids count. Get the PO to confirm that reading explicitly. |
| Re-run with nothing archived: nothing, 200 | "Nothing to restore is a successful, stateless response" | Yes |

Two deviations from the issue text are made silently or half-silently and should be called out in the proposal:

- **Cascade order.** The issue lists "canonical teamId 404, then authorization 403". The proposal and spec put identity and role first and the canonical-teamId 404 after. See 2.1.
- **Locked team with nothing archived.** Re-running on a locked team returns 409, not the 200 in the last AC. That is consistent with the cascade and the issue's own "locked teams are refused", but a reader of AC 5 could expect 200. Add one sentence, and a scenario: "locked team, nothing archived, returns 409".

## 2. Contradictions and gaps (fix before build)

### 2.1 The cascade puts the role check before the "no query" teamId check
The cascade requirement orders (2) role authorization before (3) non-canonical `teamId` 404 "before any query". The role check delegates to `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)`, which needs the team id and, for facilitators, reads membership. A non-canonical id would therefore reach a query, or the check would have to special-case it. The scenario "non-canonical team id is 404 before any query" cannot be true for a facilitator caller under this order.

**Condition:** state the observable behavior for each caller class when the id is non-canonical and the caller is (a) unauthenticated, (b) not a facilitator, (c) a facilitator. Then make the test assert it. If the live single-restore code really behaves this way, say that "no query" means "no team or topic query", and say what the role helper does with a malformed id. If #218's order is the intent, reorder. Either way, record the decision.

### 2.2 Audit-failure response is unspecified
The audit requirement says the caller "receives a generic failure without database detail". Design D17 says 500. Put the status code and the body shape (the standard error envelope with correlation id) in the spec scenario. The same applies to the "row count differs from plan" rollback.

### 2.3 "Empty or reduced `restored`" is not a testable assertion
The concurrency scenario "two concurrent bulk requests" ends with the later request returning "an empty or reduced `restored`". Pin it: with the same starting state, exactly one request returns the full set and the other returns `restored: []`. Which one wins may vary, so the assertion should be "the union equals the set, the intersection is empty".

### 2.4 Frontend visibility predicate is undefined
"Only to callers who can act on the team's topics" appears in the spec but not what the frontend knows. The scenario hides it from an "ordinary team member" but says nothing about a member facilitator, a non-member participant, or an admin. Define the predicate once, by reference to the exact one single Restore uses (task 5.2 says "same predicate", but the spec should say so too), and list the matrix in the spec: admin (any membership) shown, non-member facilitator shown, member facilitator hidden, participant hidden.

### 2.5 Locked team on the screen
What does the screen show on a locked team that, via legacy data, holds archived defaults? The planner would say "restorable", the control would render, and the server would answer 409. Specify one of: control hidden while the team is locked, or shown and the 409 handled. The error mapping says "409 locked refetches", which implies it can happen. State it as a scenario.

## 3. Vague language to tighten

| Where | Phrase | Problem | Concrete condition |
|---|---|---|---|
| `topic-management-screen` dialog | "a scrollable list that does not truncate" | Is every name rendered in full, wrapped? Max-height? | Every restorable name is rendered in full (wrapped, not ellipsized); list region has a max height and is keyboard-focusable; 12 entries all reachable by keyboard. |
| Dialog | "a plain reason" / "in plain words" | Copy is deferred to task 5.1 and not testable | Fix the literal string for `NAME_ACTIVE` in the spec, e.g. `"<name>: a topic with this name is already in your list"`. Tests assert the string. |
| Dialog | "5 topics will be added" | Singular and zero not specified | "1 topic will be added"; zero cannot occur because the control is hidden. State both. |
| Result line | "for example 'Restored 4 topics (1 was already restored)'" | "For example" is not a requirement | Give the exact template and the rule: delta line shown whenever `restored.length` differs from the previewed restorable count. Say what is shown when the difference is caused by something other than a prior single restore (e.g. a new active name appeared, so a previewed topic is now skipped). |
| Result | "skipped topics with the reason in plain words" | Same as above | Same literal string as the dialog. |
| Highlight | "transient ... cleared on the next interaction or navigation" | "Interaction" undefined (click, keypress, focus?) | Cleared on any click, keydown, or route change, or after a fixed timeout. Pick one. MAY is fine, but then the test cannot require it; either drop MAY or make the cleared-state testable. |
| Control disabled | "another topic dialog is open" | Cannot be true while a modal dialog traps focus and the control is behind it | Drop the clause or say what non-modal state is meant. |
| Control disabled | "a reorder is unsaved" | The spec says this; the proposal and design mention only dirty draft and dialog | Make all three states consistent across proposal, design D20 and spec. |
| Empty state | "primary action" / "secondary action" | Visual hierarchy, not behavior | Define as: restore control is first in DOM order and uses the primary button style; assign control uses the secondary style. Add exact copy for "fresh copies". |
| Dialog | "points to restoring topics one at a time to bring back only some" | No copy, no link behavior | Literal sentence; no link needed. |
| Dialog | "SHALL NOT make any trend claim" | Untestable as stated | Add a test: dialog and result text contain none of the words reset, canonical, trend, history lost. |
| `bulk-restore-default-topics` atomicity | "number of SQL statements independent of the number of topics" | How is it tested? | State the assertion: statement count for N=1 equals N=12 (using a query counter in the test), excluding BEGIN/COMMIT. |
| Response | `reason` is `NAME_ACTIVE` | Only value, but stated as a closed set | Say whether new reasons are an additive change and that the client must tolerate an unknown reason (render generic text). |
| Response | order of `skipped` | `restored` is ordered by `displayOrder`; `skipped` is not | Order `skipped` by the same restore-order sort (prior `display_order`, then `id`). |
| Rate-limit | "same 429 those routes return" | Includes `Retry-After`? | State "same status, body and headers". |

## 4. Edge cases not covered (add scenarios or declare out of scope)

1. **Archived default with a blank or whitespace-only name** (legacy data). Normalized name is empty; two such rows collide as duplicates. State whether they restore or are skipped.
2. **Active topic whose normalized name equals an archived default's, but the active topic is itself a restored default.** Covered implicitly; add one scenario for the second bulk run after a successful first run (idempotence: second run returns `200` both empty).
3. **Name-matching archived defaults that differ only in non-ASCII case or Unicode normalization form.** The rule is `trim().toLowerCase()` with no locale, so "É" vs "e" differ and NFC/NFD forms differ. This is a decision, not an oversight, so say it in the spec so nobody later "fixes" it unilaterally.
4. **Team has a session in `draft` state.** Design says the restore is picked up at room open. Add a scenario so the draft case is explicit, since the live-session requirement only names `lobby` and in progress.
5. **Skipped but not restorable ever (name permanently active).** The control is hidden and the topic is only reachable by single restore. Confirm that single restore remains reachable for such a topic from the archived list, as the dialog copy promises.
6. **Archived default belonging to the same name as another archived default in a different case where one has votes and one does not.** The first by prior order wins, regardless of history. This can strand the version with more history. Either accept it explicitly (and mention it in the ratification list) or order by "has history" first. I recommend accept, but record it.
7. **Very large N.** Design V3 says bounded by template size; no cap is enforced. Add a defensive upper bound or state that none is intended. If none, state the largest N the test exercises.
8. **Stale `displayOrder` on archived items.** Migration 18 says archived positions are "not maintained". Restore order therefore reflects the position at archive time, possibly with gaps and ties. The spec handles ties; add a scenario with a gap (prior orders 2, 9, 40) to prove gaps are irrelevant.

## 5. Traceability notes

- **FR-8.6 [HARD]** is correctly stated as partially met, and the clause table in the proposal is the clearest I have seen for this requirement. Keep it. Add a row for "archived default with a non-matching name that the team has edited": it returns with the edited name, so the "canonical" set is not what is restored. The table has the canonical-wording row; make the dialog copy a traceable item to it (a spec scenario asserting no "original wording" claim).
- **FR-8.3** (history retained): covered by the "Original rows are reactivated" scenario. Good. The scenario names votes and `session_topics`; add action items (FR-8.5 context) since they key on topic and are what a facilitator would ask about.
- **FR-2.7** (order before room open; first session canonical): the append-to-end rule means a restored baseline is not in canonical order if customs exist. The proposal says so and ratification item 3 covers it. Make sure the dialog sentence ("They will be added to the end of your list, in this order") is a spec scenario assertion, not only prose. It is, in the "Dialog states what changes" scenario. Good.
- **Use case 08:** task 6.2 adds a use-case extension. Its acceptance criteria should be written now, in this change, as checkboxes mirroring the scenarios (as the existing Re-Add use case does). Right now the use case is only a task item. The BA artifact that implementers consult is the use case, so the extension should be drafted as part of this change, not left until after build.
- **Traceability gap:** the usability-test item (7.1) says "can tell what happened without reading the list". Make it measurable (e.g. "facilitator states the number restored and where they went, within 10 seconds, without scrolling the list").

## 6. Structure and process observations

- The new-capability spec packs many obligations into single SHALL paragraphs (the cascade requirement has seven ordered checks plus the timing floor and an inherited-gap disclaimer). Split it into: (a) authorization, (b) cascade order, (c) timing floor. Smaller requirements make failing tests point at one sentence.
- The "Routing" scenario is a test detail, not a behavior. Fine to keep, but label it as a regression guard.
- Proposal, design and spec are consistent with each other on D-numbers, except the disabled-state list noted in section 3. A single source for the disabled conditions would remove that.
- Ratification list: add a fourth item, "first-by-prior-order wins among same-named archived defaults, regardless of history" (edge case 6), and a fifth, "audit row identifies topics by id only; AC 4 of #218 read as ids".
- Task 1.2 is "informational"; if the count of teams with name conflicts is high, ratification item 2 changes weight. Make it a gate: report to the PO before build, not after.

## 7. Suggested concrete conditions to add (summary, ready to paste)

1. Cascade: for a malformed `teamId`, a request from each of unauthenticated, non-facilitator, member facilitator, non-member facilitator and admin returns the same `404` and issues zero SQL (or document why the role check cannot meet that and relax the "no query" claim).
2. `500` envelope on audit failure and on row-count mismatch.
3. Locked team with nothing archived returns `409`, not `200`.
4. Concurrent bulk pair: union of the two `restored` arrays equals the full set; intersection empty; exactly one `audit_log` row.
5. Literal copy for: dialog count (singular/plural), `NAME_ACTIVE` reason, result line, delta line, "Nothing to restore.", fresh-copies sentence, single-restore pointer.
6. Frontend visibility matrix for four caller classes and for locked vs unlocked teams.
7. Disabled-state list defined once and used in proposal, design and spec.
8. `skipped` ordered by restore order.
9. Idempotence: second consecutive bulk request returns `200` with both arrays empty (when no skips) and no audit row.
10. Blank-name archived default behavior stated.
11. Draft-session restore scenario.
12. Statement-count test defined as N=1 versus N=12 equality.

## 8. Disposition

Backend capability: ready, subject to 2.1 to 2.3. Frontend capability: needs the copy and predicate tightening in sections 2.4, 2.5 and 3 before the frontend tasks begin; the dialog copy is the main thing a facilitator will actually experience, and "settled in task 5.1" is too late for a spec scenario to depend on. Use-case 08 extension should be drafted in this change. I am available to draft it.
