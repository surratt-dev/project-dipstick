# Tasks review: Solution Architect (Ingrid Sollenberger)

Change: 263-topic-002-error-codes. Focus: task ordering against dependencies, and tasks that should be split or reordered.

## Verdict

The design is sound and small. I have no architectural objection to the decisions (D1-D6): one source for the code (`decision.reason`), the envelope built at the send site with ordering untouched, and the server as sole authority. The task list needs ordering fixes in section 1, plus two tasks with hidden dependencies and several that bundle unrelated work. None is blocking, but items 1, 2 and 3 should be fixed before implement starts.

## Must fix (ordering and hidden dependencies)

1. **Fixture edit (1.5) comes after the handler change (1.4) and after tests that read the fixture (1.1, 1.2a, 1.3a).**
   - Tests 1.2a and 1.3a compare to "the snapshot" and "the fixture strings". Handler change 1.4 turns every `expectBaseline403` test red until 1.5 lands.
   - So the red phase in 1.1 is red for the wrong reason (fixture lacks `code`), and the suite is red between 1.4 and 1.5.
   - Reorder: hand-edit the fixture and its two comments first. This is the independent statement of the contract, and the design says it must not be derived from the handler. The existing baseline tests are then red because the handler lacks `code`. Then write the new tests, then make the handler change (green).
   - Suggested order: 1.5, 1.1, 1.2, 1.2a, 1.3, 1.3a, 1.4, 1.6.

2. **Task 1.3 has an undeclared dependency on an integration harness.**
   - The existing-versus-non-existent participant assertion is placed in "the real-Postgres integration test", with "if no such integration case exists yet, add it there".
   - That file is not in the section 1 header (`routes/content.ts`, `__tests__/content.test.ts`) or in the proposal's Impact list. It may mean building or extending a harness, which is a different size of work.
   - Split it into its own task. Open with a discovery step: locate the #264 integration test and confirm it can run in CI. State the fallback if it cannot, since the AC 9 coverage claim rests on it. Add the file to Impact.

3. **Task 3.3's decision on Security sign-off must precede implement but sits last.** 3.3 says "before implement starts, decide whether Security sign-off is wanted". That is a gate, so move it into section 0 as a human gate. The follow-up filing ("before merge") can stay at the end. Follow-up 3 (the 403-on-refresh bug) depends on the output of 0.2, which is correctly earlier.

4. **Task 2.2 depends on a step outside this task list.** It greps `openspec/specs` "after sync/archive of the delta specs", but sync and archive are not tasks here. Run before them, the grep finds the old sentences and the task cannot pass. Either:
   - grep the delta specs under the change directory and `requirements/design` now, and defer the main-spec grep to the archive step; or
   - add an explicit "sync/archive" task and place 2.2 after it.

## Should fix (split or clarify)

5. **Task 1.3a bundles three independent tests:** exactly-two-bodies, the spurious header/query negative, and the admin-200-has-no-`code` check. Split it. They fail for different reasons, and AC 8 and AC 9 map to different ones. The negative test and the admin test do not depend on the fixture, so they can be written in parallel with it.

6. **Task 1.3 bundles a titled test, an integration test, and a "point the spec scenario at existing tests" documentation step.** Beyond the integration split in item 2, the spec re-pointing belongs with the spec work in section 2, not in the test task.

7. **Task 2.1 does four jobs:**
   - the Code column and the 403 row;
   - replacing the false sentences;
   - adding the MUST NOT / MAY / fallback and the two Security sentences;
   - grepping the Validation Report.

   Split into 2.1a (table and sentence replacement), 2.1b (the Security sentences), and a separate grep task for the Validation Report. The grep is a read-only check and belongs with the 2.2 checks.

8. **The delta specs have no authoring task.** 0.3 validates them as if they already exist, and "fix any error" makes the "read-only" Gate section write to them. The proposal's Capabilities text says the denial-baseline requirement refers to "the regenerated snapshot", but D4 says the fixture is hand-edited and explicitly not regenerated. Add a task, or an explicit note, that the delta specs are already drafted and need that wording corrected. Move the validation step out of the read-only gate, or label it as allowed to edit specs.

9. **2.3 maps to AC 8, which is the wrong criterion.** Validation is part of AC 10. Minor, but the traceability should be correct.

## Observations (no change required)

- Section 0 as a read-only gate before code is the right shape. 0.1 and 0.2 correctly precede any change.
- The docs work in section 2 has no dependency on section 1 and could run in parallel. Keep it after the code only if you want the contract text to describe shipped behaviour. Either order is acceptable. The ordering rule is that 2.2/2.3 verification must follow the edits, and it does.
- 3.1 (diff stat) correctly follows all edits. 3.2 (CI) and 3.2a (PR text) are correctly last. 3.2a should cite the 1.6 result, which it does implicitly.
- 1.6 mixes verification with the check that the existing timing tests cover both reasons through `CASES`. That is fine as a final gate, but if the check fails, the remedy (a new timing test) falls outside the task. State that the remedy is to add one, so the task cannot silently pass.
- Architectural properties I checked: server-side enforcement is unchanged; no new boundary, config or flag; the fail-open audit is pinned by test and not changed; and the correlation-id limitation is documented, which makes the system's behaviour explainable. These are acceptable.

## Proposed order

0. Gate: 0.1, 0.2, Security sign-off decision (human), validate the delta specs (with the D4 wording fixed).
1. Fixture and comments (old 1.5).
2. Mocked tests: code per case, code equals audit reason, audit-failure, exactly-two, negative, admin-200 (old 1.1, 1.2, 1.2a, 1.3 title, split 1.3a). All red.
3. Handler change (old 1.4). All green.
4. Integration test for participant existing versus non-existent (split from 1.3).
5. Full suite and additions-only check (old 1.6).
6. Docs: contract table and sentences, Security sentences, grep checks. Then the post-archive grep, if the archive step is added.
7. Scope guards, CI, PR text, human follow-up filing.
