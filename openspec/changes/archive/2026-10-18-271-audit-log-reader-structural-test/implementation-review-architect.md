# Implementation review (Architect): 271-audit-log-reader-structural-test

Reviewer: Ingrid Sollenberger. Verdict: **approve, no blocking findings** against the design. Two non-blocking items to correct before merge.

## Verified
- Ran `vitest run` on the new test and `template-writer-structural.test.ts`: 252 tests pass (215 new, 37 existing unchanged), about 0.65 s. Well inside the 5 s ceiling.
- Boundaries: the diff to production code is limited to three `export` keywords in `template-writer-scanner.ts`. The new scanner imports `functionLabel` and `enclosingFunction` rather than copying them. No production, migration or API change. The scanner is a pure helper with no I/O, and the test owns the file reads, the inventory and the standing assertions.
- Pattern consistency with `template-writer-structural`: AST walk with function-keyed inventory, `file#function` keys, stale check, `productionSources()`, table-driven can-fail self-tests, and a header that carries the rules and limits.
- Design fidelity: D1 inventory with two separate objects; D2 touch, writer and tripwire (the fail-open INSERT...SELECT is asserted as a writer); D4a-d tokenizer, positive grammar, scope conjunct, caller check, statement count; D5 same-file const substitution and the unresolved-table, concat and tagged-template triggers; D6 protected set (check runs on exact-match only); D8 parse-diagnostic, empty-source and no-`audit_log` error paths plus the `packages/` and no-`.js/.sql` assertions; D9 standing no-switch assertion with fragment-assembled patterns; D10 messages carry rule, `file#function`, requirement name, test file name and step number. The header holds the extension procedure, the full known-limits list and the scenario map.
- Docs: the `deployment.md` sentence is accurate and not overclaiming (it states operators are out of scope). The archived #208 note says "partially mitigated", not "closed", and cites #312, which exists and is open.
- `tasks.md` ticks match the artefacts for 1.x, 2.x, 3.1-3.3, 4.1, 5.1-5.4 and 6.x. 1.8, 3.4, 5.5 and 5.6 are correctly left unticked (they depend on others or on archive).

## Non-blocking findings
1. **Task 0.2 is ticked but was not done.** It says "Send the owner questions now". `pr-notes.md` states they "could not be sent from this run; to be asked by a human". Untick 0.2, or reword it as "questions drafted in pr-notes.md" with the send left to the human. The tick should not claim a send that did not happen.
2. **Caller check is stricter than D4c.** The design allows `callers: string[]`. The judge requires exactly one caller and fails on zero or several. The header documents this ("exactly one file"), and it is the safer choice, but it is a recorded deviation. Add one line to the PR notes, or relax it if a second admin caller is ever legitimate.
3. **`gradeExactMatch` scope-conjunct and `op` identity check.** The scope check excludes the operation conjunct by object identity (`c === op`). It works today. A comment saying so would protect a later refactor.
4. **`findReferences` is by name over any Identifier.** This matches D4c and is documented as over-reporting. It re-parses each candidate file per admin entry. The cost is negligible today.
5. **Process residuals, already tracked.** CODEOWNERS is still open (the header says approval is by convention). The Security re-look (1.8, 5.6) and the independent message read (5.5) are still pending. I do not treat them as blocking implementation, but the PR should not merge without 5.6.

## Observations, no action
- The duplicate-key runtime check is justified because no CI step type-checks `__tests__`. This is the conditional case the task list allowed.
- The required-status-check finding in `pr-notes.md` (ruleset `main` requires `Unit Tests`) strengthens the "binding" claim. Make sure the PR description repeats it.
