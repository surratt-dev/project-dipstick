# Tasks Review: bulk-restore-default-topics (#218)

Reviewer: Marcus Delgado, Business Analyst. Scope: do the tasks, together, cover every capability in proposal.md and the #218 acceptance criteria, and is anything lost between requirement and task? Sources read: tasks.md, proposal.md, GitHub #218, the spec scenario headings across all five delta specs.

## Verdict

Approve with minor changes. Coverage is strong: nearly every spec scenario maps to a named test task, and the ritual constraints I care about (history retained, original ids reactivated, lock refused, no session-view trace, participants see nothing) have explicit assertions. There are no blocking omissions. There are a handful of small gaps where a spec scenario or proposal commitment has no test or has a weak verification, plus some task-bookkeeping inconsistencies that will cause traceability friction.

## #218 acceptance criteria trace

| AC | Task coverage | Note |
|---|---|---|
| 1. One action, one confirmation | 5.1, 5.3, 5.5 (one request on confirm, double activation), 7.3 | Covered. 7.3 is only a "confirm" (see finding 5). |
| 2. TOPIC-005 cascade, one unit of budget | 3.2, 4.1, 4.5 | Cascade covered. "One unit" is asserted only for the empty case (4.5). See finding 1. |
| 3. Template and locked teams refused like single restore | 4.1 (template byte-identical, both lock states; locked 409) | Covered. |
| 4. Audited, row says which topics came back | 3.1, 3.3, 4.7, 9.1 | Covered, with the ids-only reading routed to ratification. Good. |
| 5. Nothing archived: nothing, 200 | 4.5; locked variant in 4.1 | Covered, with the locked-team deviation (409) flagged in the proposal. See finding 6. |

## Capability trace (proposal "What Changes" and capabilities)

- New endpoint, cascade, body ignored: 3.2, 4.1, 4.6, 4.10. Covered.
- Duplicate rule D1: 2.1, 2.2, 4.3. Covered, including blank names, NFC/NFD, same-batch collision.
- Ordering D3/D4/D19: 2.2, 4.2, 4.14. Covered, including the bulk-equals-sequential table test.
- Audit D2 and metadata bounds: 3.1, 3.3, 3.4a, 4.7. Covered.
- Rate limit shared budget, values unchanged: 3.5, 4.11 (unchanged in diff), 4.1 (role refusal spends nothing). Partly covered, see finding 1.
- Timing floor on every exit including thrown: 3.2, 4.12, 4.12a, 7.4. Covered.
- Live session guarantee D8: 4.9. Covered.
- Concurrency and atomicity: 4.7, 4.8. Covered.
- Frontend control, dialog, result, live region, empty state: 5.1 to 5.5. Covered.
- Specs, use case 08, deployment runbook, BRD FR-8.6 note: 6.1 to 6.4. Covered.
- Follow-ups for each "known gap": 8.1 (single restore duplicate rule), 8.2 (thrown-path floor), 8.3 (trend gap), 8.5 (position base), plus 8.4 and 8.6. All four named gaps in the proposal have a draft. Covered.
- Ritual constraints: topic history (4.4), lock (4.1), no-manager rule (admin test in 4.1; endpoint touches no membership), not configurable (no task needed), participants see nothing (5.5), honest copy (5.1 forbidden-words test). Covered.

## Findings

1. **Single-unit budget and shared bucket are not directly tested (medium).** Spec topic-write-rate-limiting has "one request is one unit regardless of how many topics it restores" and "shared budget". Tasks assert only that an empty request consumes one unit (4.5) and that role refusal consumes none (4.1). Nothing asserts that a non-empty N=12 bulk consumes exactly one unit, or that bulk and single restore/Add draw from the same bucket. This is the heart of #218 AC2 (and the original 90-request motivation). Add to 4.1 or 4.5: a non-empty bulk consumes exactly one unit; a bulk followed by single restores draws down one shared counter.
2. **"Single restore is unchanged" scenario has no test (medium).** The restore-topic delta has the scenario "Single restore ignores the duplicate rule". Task 6.1 syncs the delta, but no test in section 4 pins that single restore still restores a name-colliding archived default (the proposal's "stricter than single restore" claim depends on it). 4.2 compares bulk to single restores but does not assert single restore is untouched. Add one regression test.
3. **"Response reports actual outcomes" and "restored singly between preview and confirm" (low-medium).** The spec has an explicit requirement that the response reflects what happened, not what the preview predicted. Backend: 4.8 covers bulk concurrent with single restore. Frontend: 5.3/5.5 mention "result line" and "delta line" but 5.5 does not list the stale-preview case (topic restored singly between dialog open and confirm, so the server restores fewer than the dialog said). Add it to 5.5's branch list. This is the scenario that most affects facilitator trust in the count.
4. **Empty-state frontend matrix is thin (low).** 5.4 says "extend `activeEmptyStateVariant` and its tests", but 5.5 does not list the two spec scenarios (restorable defaults exist in an empty team; nothing restorable in an empty team). Given the #200 overlap and my standing concern about the zero-topic state, name both cases explicitly in 5.4 or 5.5.
5. **7.3 is a confirmation with no mechanism (low).** "Confirm the success measure: N archived defaults restored with one confirmation and one request" has no stated evidence. Point it at the specific tests (4.5 statement-count plus 5.5 one-request-on-confirm) so it is verifiable rather than a checkbox that gets ticked on intent.
6. **Ratification list drift (low, traceability).** The proposal lists five ratification items; 9.1 lists four and folds the fifth (reading AC4 as ids, and AC5's 200 applying to unlocked teams only, locked-and-empty returns 409) into item 1's parenthetical. The AC5 deviation is the one the PO is most likely to want to rule on explicitly, because it departs from the literal #218 wording. Restate it as its own named item in 9.1.
7. **Task 1.2 gate is underspecified (low).** It requires counts of teams with archived defaults and name collisions "reported to the PO", but not how or where the numbers come from (production query, who has access, what "high" means). Without a threshold, "if the affected share is high" is not decidable. Suggest naming the data source and either a threshold or an explicit statement that the PO sets it on seeing the numbers.
8. **Cross-reference and ordering bookkeeping (low).** (a) Proposal says the use case 08 draft is "task 6.1"; in tasks.md it is 6.1a, and 6.1 is the spec sync. (b) 6.1a says "before section 5 starts" but sits inside section 6, which follows section 5; the build-order note at the top of tasks.md does not mention it. Move it to section 1 or add it to the order note. (c) Numbering is out of sequence in two places: 7.4 sits before 7.2, and 8.6 before 8.5. Harmless, but it undermines traceability by id.
9. **Usability test 7.1 has no owner or timing (low).** The scripted item is good (10-second criterion, "where will they land" signal feeding the order-preview keep/drop decision), but it is a post-build item with no owner. Since the preview and `displayOrder` field's justification rests on its result, name who runs it and where the outcome is recorded.

## Things done well (keep)

- 4.4 explicitly guards the topic-history property (original ids reactivated, no new rows, annotations/votes/session_topics untouched). That is the non-negotiable from discovery and it is a test, not a note.
- 4.9 pins the live-session guarantee, including the next-session snapshot.
- 5.1 and 5.5 test the copy for forbidden claims ("reset", "canonical", "trend", "history lost"), which protects the honest-copy constraint.
- Section 8 turns each inherited gap into an issue draft with acceptance criteria instead of letting them be silently absorbed or dropped.
- The gate in 1.2 puts data in front of the PO before the one ratification item (stricter skip rule) that could change the design.

## Required before build

Findings 1 and 2 (add the missing tests), and 8(a)/(b) (fix the 6.1/6.1a reference and placement). The rest are recommended and non-blocking.
