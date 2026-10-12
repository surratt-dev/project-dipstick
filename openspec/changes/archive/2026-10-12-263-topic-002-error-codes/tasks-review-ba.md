# Tasks Review (BA): 263-topic-002-error-codes

*Reviewer: Marcus Delgado, Business Analyst. Inputs: `tasks.md`, `proposal.md`, `design.md`, both spec deltas, issue #263.*

## Verdict

**Approve with 2 must-fix and 5 should-fix items.** The tasks cover all ten acceptance criteria and every follow-up, and they keep the ritual-adjacent constraint intact (the facilitator-from-another-team block stays a hard 403 with no way through). Nothing in the proposal's capability is dropped. The gaps are sequencing, one unnamed test location, and a few mislabeled or ambiguous items that would make an implementer ask "what did you mean".

## Coverage matrix (proposal AC to tasks)

| AC | Tasks | Result |
|---|---|---|
| 1 no facilitator role / global EM, code, message, no-store | 1.1, 1.4 | Covered |
| 2 active-member facilitator, named returning-facilitator test | 1.1, 1.3 | Covered (see S1) |
| 3 code equals audit reason, one envelope call | 0.1, 1.2, 1.4 | Covered; the "one call" half is review-only (see S2) |
| 4 audit fail/timeout still gives 403 with code | 1.2a | Covered |
| 5 order and floor unchanged, no existing assertion edited | 1.4, 1.6 | Covered |
| 6 named tests (a)-(d), fixture two insertions only | 1.1, 1.3, 1.5 | Covered |
| 7 scope guard | 0.1, 3.1 | Covered |
| 8 no config/override, spurious header/query test | 1.3a, 1.4 | Covered. 2.3 is labelled AC 8, which is wrong (S4) |
| 9 exactly two bodies, admin 200 has no `code` | 1.3, 1.3a | Covered; depends on an unnamed integration test (M2) |
| 10 docs and specs, grep, validate, lint/test/build | 2.1-2.3, 3.2 | Covered, but 2.2 cannot pass as sequenced (M1) |
| Follow-ups 1-5, #263 comment, Security decision | 0.2, 3.3 | Covered; sequencing and content gaps (M1, S3, S5) |

## Must-fix

**M1. Spec-delta sync is not owned by any task, so the AC10 grep (2.2) cannot pass.**
The "Reason names ... internal labels" sentence lives in the main spec `openspec/specs/topic-customization-lock/spec.md`. The change only edits it through the delta under `changes/263.../specs/`. Task 2.2 greps `openspec/specs` and says "(after sync/archive of the delta specs)", but no task performs or schedules the sync, and the PR-time grep would find the old sentence. Decide and write down one of:
- (a) the implement stage runs the sync (`openspec-sync-specs`) before 2.2, so the PR contains the main-spec edit; or
- (b) AC10's grep for `openspec/specs` is checked against the delta files at PR time and against main specs after archive, and the PR description says so.
Either is fine to me, but the task must say which, and who runs it. Otherwise AC10 is unverifiable at merge time, or the old "not envelope fields" sentence ships to main.

**M2. The existing-versus-non-existent-team test lives in "the real-Postgres integration test" with no file named.**
Task 1.3 moves the spec scenario "A participant gets the same code for an existing and a non-existent team" and AC9's body-equality claim out of the mocked test, into an integration test that is not named and is not listed in the proposal's Impact section (which lists only `content.ts`, `content.test.ts` and the fixture). An implementer will either skip it or pick a file at random. Name the file (or say "add to the existing TOPIC-002 integration suite at ..."), add it to Impact, and say whether it runs in CI (3.2) or only locally. If no such suite exists, say so and decide whether the scenario is verified by review instead.

## Should-fix

**S1. AC6 (c) and (d) look like the same test.**
1.1 has an "active-member facilitator" row and 1.3 adds a test titled `returning facilitator who is a member of the team gets FACILITATOR_IS_TEAM_MEMBER`. Say whether (d) is a separate fixture (a user who previously ran sessions for the team) or a rename of row (c). Also, the proposal states that a facilitator holding an engineering-manager *membership* role gets `FACILITATOR_IS_TEAM_MEMBER`; no task asserts it. Add it as one `CASES` row, or state that existing helper tests cover it.

**S2. AC3 "one `buildErrorEnvelope` call, no derivation from the message" has no verification step.**
1.4 makes the change but nothing checks it. Add a PR-description checklist line, "diff shows a single `buildErrorEnvelope("forbidden", message, decision.reason)` call and the message ternary is the only branch", so the review claim in AC3 is actually performed.

**S3. The Security sign-off decision is placed after the work it gates.**
The proposal says the repo owner decides "before the implement stage starts". It sits in 3.3, last in the list, "before merge". Move it to a 0.x gate item (a human gate, like 0.1-0.3) so the stage does not start without it. The rest of 3.3 can stay at the end.

**S4. Mislabeled coverage tags.**
- 2.3 (re-run `openspec validate`) is tagged AC 8; it belongs to AC 10.
- 0.3 and 2.3 duplicate each other; fine, but 0.3 should say it is a baseline check and 2.3 the final one.
- 3.2 covers AC 10's lint/test/build "in CI"; 1.6 runs only the backend suite. Add "run `npm run lint`, `npm run test`, `npm run build` locally before pushing", since the issue lists those three commands.

**S5. 3.3 does not carry the follow-up content into the filed issues.**
Follow-up 1 (next-step copy) holds the facilitator-review requirements (plain English for a non-engineer, inline in the existing error area with `role="alert"`, generic and non-JSON 403 fallback, 403 on refresh never clears loaded topics, open question on reaching the page from another team) and is "the only home" for them. 3.3 says "file the follow-up issues listed in the proposal" without saying to copy the requirements list into the issue body. Add that, and name the Milestone 03 ordering (item 1 ahead of other API-consistency items). Also note that the numbering in the proposal (1, 2, 5, 3, 4) is out of order, which will confuse the person filing; renumber or list them in 3.3 by title.

## Lost in translation (checked, no action beyond the above)

- Issue item 3 (frontend): proposal says no frontend change; 0.2 only inspects. Consistent.
- Issue item 2 (correlation id): deliberately closed; 3.3 and 2.1's "not searchable" sentence carry it.
- Proposal "Modified Capabilities" says the denial-baseline requirement "refers to the regenerated snapshot". The fixture is hand-edited, not regenerated (1.5, D4). The delta spec text itself says "hand-edited", so only the proposal wording is stale. Fix the proposal word so nobody regenerates the fixture from the handler, which would make the test circular.
- Admin 200 without `code`, exactly-two bodies, spurious header/query: all present in 1.3a.
- Fail-open pinned, not changed (1.2a), with the "other throws still 500" half left to existing behaviour. Acceptable.
- Not applicable here but noted for my own checklist: no "zero sessions" or trend-state concern, and no reveal mechanic is touched.

## Bottom line

Fix M1 and M2 before the implement stage, and fold S1-S5 in as one-line edits. Nothing requires a new design round.
