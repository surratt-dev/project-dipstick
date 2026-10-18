# Tasks review (Solution Architect): 271-audit-log-reader-structural-test

Reviewer: Ingrid Sollenberger. Focus: dependency ordering, nothing assumes something unbuilt, split/reorder candidates. Read `tasks.md`, `design.md`, `proposal.md`; spot-checked the backend source.

## Verdict

Section order (scanner, test and inventory, fixtures, docs, verification, record, follow-up) is broadly right and the content is traceable to D1-D11. There is one real ordering defect (fixtures last, scanner untested until section 3), one task that mixes pure-scanner and inventory-dependent work (1.7), and several small dependency gaps. None needs design rework. Approve with the changes below.

## Blocking (reorder or split before implementation starts)

**T-1. Fixtures (section 3) come after the whole scanner and test (sections 1-2). Interleave them.**
Tasks 1.3 to 1.7 are the risk-bearing part (about 150 lines of tokenizer, positive grammar, caller check), and D9 says false positives are fixed "in the scanner with a fixture". Building 1.3-1.7 and 2.x blind, then writing 40-50 fixtures, means the first signal that the tokenizer is wrong arrives after the judge is also written, and failures cannot be localized. Reorder so each scanner task is paired with its fixtures:
- 1.3 tokenizer with its comment/quote/`E'`/dollar-quote/unterminated fixtures (from 3.2 and 3.4).
- 1.4 detection with 3.1 and the detection half of 3.4 (including the fail-open INSERT...SELECT writer, which is the real regression anchor).
- 1.5 grammar with 3.2 and the grammar half of 3.4.
- 1.6 with 3.3.
- 1.7 with 3.5.
- 2.x judge with 3.6 and 3.7.
Keep section 3 as the catalogue if preferred, but add an explicit "fixtures for 1.n land with 1.n" rule and state that 3.x are not a separate phase. Fixture-first (write failing `it.each` rows, then implement) is the natural fit for a table-driven scanner.

**T-2. Task 1.7 mixes two dependency levels. Split it.**
- 1.7a (pure scanner, belongs in section 1): `findReferences(name, files)` returning the files that reference an Identifier / import or export specifier / property-access of that name, outside the defining file; and `countTouchingLiterals(function)`. Both take plain arguments and need no inventory.
- 1.7b (belongs in section 2, after 2.2): the comparison against `callers` and `statements`. This needs the `ADMIN_ONLY` shape from 2.2. As written, 1.7 "caller check for admin-only ... against `statements`" references fields that do not exist until 2.2. Today's order is therefore 1.7 before 2.2, which is a forward reference. Either split as above or move the whole of 1.7 after 2.2.
Note the count in 1.7a reuses the touch set from 1.4; say so, so the implementer does not build a second detector.

**T-3. Inventory (2.2) is hand-asserted before the scanner has ever run on real source. Add a discovery step between 1.x and 2.2.**
Insert "2.1b: run the scanner over `packages/backend/src` with an empty inventory and record the touches it reports; the list must equal R1, R2/R3, R4 (three function keys) plus zero writers and zero tripwires." This replaces the parenthetical "Confirm the real call sites before fixing `callers`" buried in 2.2, and it is the first real-world non-vacuity and false-positive check. I spot-checked the source: the only non-INSERT `audit_log` code matches today are `sessions/default-topic-maintenance.ts` lines 626, 632, 698 and `routes/content.ts` line 1202, which matches the design, and no UPDATE/DELETE/TRUNCATE exists. Callers: `readTemplateList` is referenced in `routes/admin-default-topics.ts` (lines 15-16, 194, 486, 491) and internally at line 546 of the defining module; `readTemplateHistory` only in `admin-default-topics.ts`. So `callers` as written is correct today. Order matters because a wrong `statements` count (the 632 literal is a separate template from 626, so 2 is right only if both are counted as touching literals) is cheap to find here and confusing to find in 2.3.

## Non-blocking (fix in the task text)

**T-4. 1.2 and 1.4 overlap on SQL-looking and substitution logic.** 1.2 builds substituted text and prefilters; 1.4 adds the "positive trigger for unresolved substitution in table position" which depends on both the substitution (1.2) and the tokenizer (1.3). Dependencies run the right way (1.2 then 1.3 then 1.4), but 1.4 is a very large task (detection, writer, touch, tripwire, three positive triggers). Split 1.4 into 1.4a table-position/touch/writer, 1.4b tripwire, 1.4c D5 positive triggers (unresolved substitution, `+`/`.concat`, tagged template). Each has its own fixture group in 3.1 and can land separately.

**T-5. 1.1 export of helpers: confirm before 1.2, and make the verification explicit.** Order is right (1.1 before use in 1.2). Add: run `template-writer-structural.test.ts` after the edit, and note that the lint step in CI may include an unused-export or import-order rule; the new `export`s are used by 1.2 so that is fine only if 1.1 and 1.2 land in the same commit or 1.1 is not committed alone. State that.

**T-6. 2.4 non-vacuity and 2.5 standing assertions have no dependency on the judge (2.3).** 2.5 can be done at any point, and doing it first (the no-skip check on test/scanner source) is cheap and makes D9 real before the code it guards exists. 2.4 needs the scanner and the inventory but not 2.3; it must assert detection of R1/R2-R3/R4 by function key, which T-3 already produces. Order suggestion: 2.5, 2.1, 2.1b (discovery), 2.2, 1.7b, 2.3, 2.4.

**T-7. 3.7 (failure-message substrings) depends on the messages existing, and the D10 substring "procedure step number" depends on the 4.1 header's step numbering.** The test header (4.1) is written after the code, but 2.3 messages must cite "step N". Either fix the four-step numbering now (it is already fixed in design "Extension procedure": steps 1-4) and say the messages use those numbers, or move the header skeleton (procedure only) into 2.1. Recommend the latter: header skeleton at 2.1, remaining limits text at 4.1.

**T-8. 5.1 names "the named workflow" without naming it.** CI is `.github/workflows/ci.yml`, job `test`, which runs `npm run test:coverage -w packages/backend`, not `npm test`. Verification should run the coverage command, since coverage instrumentation and the default vitest/jest include glob can differ from `npm test`; confirm the new file is in that glob and that the 5 second ceiling is measured under the coverage run too. Also check `integration.yml` does not need the test (it should not, it is DB-free) and that nothing about the file location under `routes/__tests__/helpers/` is picked up as a test file (the helper has no tests, but a `helpers/` glob match would be harmless; verify it is not excluded from `tsc`/lint config either).

**T-9. 5.4 (Security re-review of grammar, caller check, scope conjunct, spec) is a gate that should precede 5.2/5.3 implementation freeze, and part of it is available earlier.** Spec wording (4.3/4.4) can be reviewed as soon as the delta exists. Order the Security review of the grammar after fixtures are green (end of 1.5) rather than at the very end, so a grammar objection does not unwind sections 2-4.

**T-10. 4.3 and 4.4 are in the wrong order.** 4.4 (diff the restated delta against the main spec, verify verbatim obligation) validates the delta; 4.3 syncs it at archive time. Do 4.4 first, then 4.3; and 4.3 happens at archive, which is after 6 and 7. Mark it "at archive" so it is not checked off in the PR.

**T-11. 7.1 writes the follow-up number into `proposal.md`, but the proposal currently says `#pending-at-filing`.** Order is fine (7.1 before archive) but 6.1 (PR text) and 6.2 (note on the archived #208 review) reference residuals that the follow-up issue lists. File 7.1 before opening the PR so 6.1 and 6.2 can cite the number; otherwise they will need a second edit. Recommend moving 7.1 ahead of section 6, or at least before 6.1.

**T-12. 7.2 (CODEOWNERS decision) and the 5.1 "required status check" statement are both unresolved owner decisions that sit last.** They are not blockers to implementation but should be requested at the start (ask Brian Surratt now), since 4.1's header must say "approval by convention" or name an owner, and the header text depends on the answer. Move "ask" to the start of section 4, keep "record the answer" in 7.2.

## Dependency summary (recommended order)

1. 7.2 ask (non-blocking), 2.5 standing assertions.
2. 1.1 export, 1.2 scanner shell and substitution, 1.3 tokenizer + fixtures.
3. 1.4a/b/c detection + fixtures (3.1, 3.4 writer cases).
4. 1.5 grammar + fixtures (3.2, 3.4); 1.6 protected + fixtures (3.3).
5. 1.7a reference/statement-count primitives + fixtures (3.5 scanner part).
6. 2.1 test file with header skeleton; 2.1b discovery run on real source.
7. 2.2 inventory; 1.7b caller/statement comparison; 2.3 judge; 3.6, 3.7; 2.4 non-vacuity.
8. Security review of grammar (early 5.4); 4.1 full header; 4.2 doc sentence; 4.4 then 4.3 (at archive).
9. 7.1 file follow-up; 6.1, 6.2; 5.1 (coverage run, CI job, required check statement), 5.2, 5.3, 5.4 remainder.

## Not a finding

Effort estimate of three days is plausible only if T-1 is adopted; with fixtures at the end the tokenizer debugging typically lands in the fourth day. Task scope itself (test and docs only, no production change) is verified as consistent with the source I inspected.
