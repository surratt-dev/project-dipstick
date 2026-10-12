# Implementation Review: Solution Architect (Ingrid Sollenberger)

Change: topic002-unknown-team-404 (#265). Scope reviewed: git diff of audit-logger.ts, content.ts, TopicManagementPage.tsx, REST API Contract.md, and test changes.
Verification: content.test.ts and team-not-found-envelope-structural.test.ts pass (147 tests); TopicManagementPage.notFound.test.tsx passes (14 tests).

## Verdict: APPROVE, no blocking findings. Two non-blocking items to clear before merge.

## Conformance to design.md

- D1 order: the name read sits after the shared authorization check and `assertTopic002AuthorizedRole`, before the admin arm. A participant never reaches it, so there is no 404-vs-403 enumeration oracle. Existence logic stays in the handler and is not pushed into the shared helper (TOPIC-004 and the write routes are untouched). Conforms.
- D3 mechanism: the existing `SELECT name FROM teams` was moved, not duplicated. The facilitator SQL multiset is unchanged and no query was added. Conforms.
- D4: no `deactivated_at` filter, no template exclusion; keyed on `rows.length === 0`. Conforms.
- D5: `applyTimingFloor(startTime)` precedes `noStore(reply).code(404).send(teamNotFoundEnvelope())`, using the shared envelope helper (no literal). Consistent with the two existing call sites at lines 718 and 857. No audit row or event on the 404. Conforms.
- D6: `team_found` / `teamFound` removed from both the row metadata and the event payload, with no remaining non-test references in packages. The audit-logger contract comment and the handler comments are updated, so the two comments the design called out are no longer false.
- D7/REST contract: the TOPIC-001 vs TOPIC-002 sentence, the check order, and the audit and cutover text are present in the contract.
- D8 frontend: the change is confined to `loadTopics`. `hasEnvelopeCode` is a sibling helper, and `hasEnvelopeMessage` and the 403 branch are not widened. The copy comes from a literal constant and the team id is not echoed. A non-JSON, empty, or other-code 404 falls back to "Failed to load topics." This follows the existing defensive-parse pattern of the 403 branch.

Boundaries: no new module, no new SQL against `team_memberships`, no change to the shared helper or to the audit-logger's runtime types. Patterns match the surrounding code.

## Findings

### Non-blocking

1. PR_NUMBER_PLACEHOLDER / DATE_PLACEHOLDER remain in the REST API Contract (line ~706). They must be filled in at merge. The cutover record is what lets an analyst read the absence of `team_found: false` correctly (D6), so merging with placeholders defeats that purpose. Suggest a merge-checklist item.
2. Comment hygiene in content.ts: the relocated "Task 9.2/Decision 10" comment now sits directly after the 404 comment block, so the 404 explanation and the unrelated confirmation-copy rationale run together. One line in the 404 block ("...unaudited and, for an admin, runs no") is also visibly longer than the surrounding wrapped lines. Cosmetic; reflow and add a blank comment line before the Task 9.2 note.
3. Open merge-gate items from design.md (audit asymmetry; admin probe leaves no trace; follow-up issue for the 403 denial-row flood; AC 12 external `team_found` consumer check) are policy and process decisions, not code. I confirm the implementation follows the issue as written and that only the 404 branch would change if Brian's answer differs. The accepted residual should be recorded in the PR description so it is not lost.
4. Timing: the unauthorized-caller zero-`teams`-query pin test, which guards the enumeration property, is the only protection against a later refactor that joins `teams` in the helper. Keep it; do not let it be deleted as redundant.

### Blocking

None.
