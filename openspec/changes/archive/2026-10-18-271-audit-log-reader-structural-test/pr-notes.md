# PR notes for #271 (items for the PR description; none blocks merge of the implementation)

Closes #271. Deviations from the issue text: its "allow-list" became an **inventory** (every touch listed, compliant readers included); its "route file" scope became **all of `packages/backend/src`** (R2 to R4 live under `sessions/`). Security review D-5 is **mitigated, not closed**: the filter-shape half is mechanical; whom a reader serves, invisible readers, scope-value correctness and column exposure remain review. Follow-up issue: **#312** (one bundled issue).

## Measured results
- Runtime: the production scan takes about 120 ms; the test file runs in about 145 ms standalone and about 580 ms inside the full `npm run test:coverage -w packages/backend` run (ceiling 5 s, scan not narrowed).
- Files: 67 production `.ts` files under `packages/backend/src`; 25 parsed after the prefilter; 54 writer literals recognised (equals the 54 `INSERT INTO audit_log` literals in production code); 4 touching statements in 3 functions; 0 tripwires; 0 unclassifiable.
- Discovery run (2.1b): exactly `routes/content.ts#fetchConnectionRecoveries`, `sessions/default-topic-maintenance.ts#readTemplateList` (2 statements) and `#readTemplateHistory` (1 statement). `readTemplateList` and `readTemplateHistory` are referenced from `routes/admin-default-topics.ts` (plus the internal `readTemplateList` call in the defining module, exempt).
- Full backend suite under the CI command (`npm run test:coverage -w packages/backend`): 138 files passed, 1 skipped; 2640 tests passed, 3 skipped; backend line coverage 96.74 % (threshold 90).
- 5.3 injected-reader proof: appending `SELECT * FROM audit_log WHERE operation LIKE 'session.%' AND team_id = $1` in a new function in `routes/content.ts` made the CI command exit 1 with `Audit visibility guard [uninventoried-touch] at routes/content.ts#injectedPrefixReader`. Reverted; `content.ts` is unchanged.
- 5.2: no CI step type-checks `__tests__` (`npm run build` uses `tsconfig.build.json`, which excludes them; `typecheck` is frontend only). Local `tsc` rejects a duplicated key in `EXACT_MATCH` (TS1117), and because CI would not, a runtime duplicate-key check (AST read of the test's own source) was added and fails on the same duplicate. Both verified, then reverted.

## Owner questions (0.2) -- could not be sent from this run; to be asked by a human
1. **Required status check.** Checked via `gh api`: the repository ruleset `main` (id 22933149, enforcement active, target default branch) requires the status checks **Lint, Type Check and Unit Tests** (strict). `Unit Tests` is the `test` job in `.github/workflows/ci.yml`, which runs this test. So the control is binding on `main`, not advisory, as long as the ruleset stays. (`GET .../branches/main/protection` returns 404 because protection is by ruleset, not classic branch protection.)
2. **CODEOWNERS handle.** Still open. No `CODEOWNERS` file exists (searched repo root and `.github/`). Question for the repository owner (Brian Surratt): name a handle for the test and scanner, or accept approval by convention (Security Analyst role). Recorded as an accepted limit in the test header until answered. Tracked in #314.
3. **Product-owner note on R1 (verbatim from the proposal).** `fetchConnectionRecoveries` returns `actor_user_id` with a timestamp to the facilitator. Question: does session history present connection recoveries as a session-level signal, or could it read as a per-person scoreboard of who had connection trouble? That is a participant-privacy question, not a test gap. It needs a named owner and a decision, or an explicit deferral. Filed after the run as #315 (the proposal had deliberately not filed one).
4. **Effort bound.** About three days including review, up from two (security-driven: tokenizer, positive grammar, caller check, about 215 test cases). Executive stakeholder to confirm, or the risk is accepted in this PR.

## Reviewer asks
- 5.5: a reviewer other than the author (Security Analyst role preferred), who has not read the exploration notes, should read the failure messages in `audit-log-reader-structural.test.ts` ("failure messages teach a developer who has never heard of #208") and confirm they can say what to do next without asking.
- 1.8 / 5.6: Security Analyst review of the grammar (D4), caller check (D4c), scope-conjunct rule, the header limits and the spec wording. Not performed by this run (no reviewer available).

## Follow-up applied after Security and Architect implementation reviews
- X-2 fixed: `findReferences` also matches string-literal element access (`m["readTemplateList"]`), with fixtures.
- X-1 fixed for same-file wrappers: `findWrappers` finds exported functions of the defining file that reach the admin-only function; each must be listed in the entry's `wrappers` (`writeTemplateTopics` for `readTemplateList`), and importers of a wrapper count as importers of the reader. Not followed (stated in the header): wrappers in another file, computed keys. Spec clause reworded to "referenced by name ...".
- Failure message for `uninventoried-touch` now leads with the admin vs non-admin decision and says a Security Analyst review follows. Header limits gained the wrapper/computed-key gaps and an imported-fragment example.
- Deviation from design D4c: the judge requires **exactly one** caller file per ADMIN_ONLY entry (design allowed a list). Stricter by choice; documented in the header and design.md.
- Task 0.2 is unticked: the owner questions are drafted above but were not sent.
- Tasks 1.8, 5.5 and 5.6 stay **unticked**. Security's review (implementation-review-security.md) says they "may be checked off on my side once W-1/W-2 are done (or X-1/X-2 are fixed)" and that nothing needs a second pass if fixed with fixtures; that is a conditional sign-off conditional on this follow-up being applied, not a recorded unconditional sign-off. Security signed off conditional on this follow-up being applied; it is now applied, and a human should confirm and tick them.

## Status update (owner review)
- Owner ticked 0.2, 5.5 and 5.6 and accepted the conditional Security sign-off. Task 1.8 (Security Analyst review of grammar, caller check, scope rule, spec wording) remains unticked and is tracked in #316 (milestone "10 - Polish"), together with the 5.5/5.6 follow-through.
- Follow-up issues: #312 (code gaps), #314 (CODEOWNERS), #315 (R1 product question), #316 (Security review).
