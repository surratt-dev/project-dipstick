# Tasks review: Business Analyst (Marcus Delgado)

Scope: does `tasks.md` carry every capability and acceptance condition from `proposal.md`, `design.md`, the spec delta and issue #271, and was anything lost in translation. Checked against the repo where a task names a path.

## Verdict

Approve with required changes. Coverage is strong: the 7 task groups map onto D1 to D11 and nearly every proposal "Failures" bullet has a task and a fixture. Both issue checkboxes are covered. There are five gaps I want closed before implementation (R1 to R5) and several smaller fixture and wording items.

## Issue #271 acceptance, traced

| Issue checkbox | Tasks | Assessment |
|---|---|---|
| Adding a reader with a prefix match or no operation filter fails CI | 1.5, 2.3, 3.2 (no operation filter, LIKE incl. underscore, IN, ANY), 5.1 (default `npm test`, named workflow glob, one-off injected prefix reader exits non-zero, required-check status stated in PR) | Covered. "Fails CI" is proven by 5.1 rather than assumed. Good. |
| Existing reader passes and the test names it in its allow-list | 2.2 (`routes/content.ts#fetchConnectionRecoveries` in `EXACT_MATCH`), 2.4 (detected by file and function name) | Covered. |
| (Body) Document the allow-list and how to extend it | 4.1 (header with four-step procedure), 4.2 (pointer in `docs/deployment.md`; file and an audit section exist) | Covered, but see S3 on the header's limits list. |
| (Body) "route file outside an allow-list" and "allow-list" wording | 6.1 | Covered. The deviations (inventory, widened scope, D-5 mitigated) are recorded in the PR. |

## Required changes

**R1. Product-owner note on R1 (`actor_user_id` plus timestamp returned to the facilitator) has no task.** The proposal ends with an explicit note that this needs a named owner and a decision, and says it is flagged "so it is not lost". Nothing in `tasks.md` carries it. It is the participant-trust question I care most about in this change, and it is exactly the kind of item that evaporates at archive. Add a task (near 7.2) to put the question verbatim in the PR description and to ask the product owner to name an owner and record the answer or the explicit decision to defer. No issue needed, per the proposal; a PR note and a named owner are.

**R2. Executive confirmation of the effort increase has no task.** The proposal says the three-day bound is "up from two" and "the executive stakeholder is asked to confirm it." The tasks header repeats the bound but nothing obtains the confirmation. Add it to 7.2 or 6.1 (record the confirmation or the accepted risk in the PR). Otherwise the bound is an unreviewed commitment.

**R3. Duplicate-key and unknown-class protection depends on the compiler, and no task confirms the compiler sees the test.** 2.2 relies on `Record<"file#function", ...>` so duplicates are "compile errors", and the proposal drops explicit checks because "TypeScript types and object-literal keys" cover them. Vitest does not typecheck. `packages/backend/tsconfig.json` has `include: ["src"]` with no test exclusion, so `tsc` probably does cover it, but nothing in the tasks verifies that the CI path (build or a typecheck step) actually compiles `__tests__`. Add to 5.1: confirm a CI step type-checks the test file, and that a deliberately duplicated key in `EXACT_MATCH`/`ADMIN_ONLY` fails it. If it does not, add the cheap runtime duplicate check the proposal chose to omit. Also, a key present in both objects (same file#function in `EXACT_MATCH` and `ADMIN_ONLY`) is not prevented by either `Record`; that is the "reclassify with a one-word change" path D4d claims is closed. Add an assertion (or a fixture) that the two key sets are disjoint.

**R4. Header known-limits list (4.1) drops items the design and proposal state as limits.** 4.1 lists most, but omits: SQL assembled from fragments none of which spells `audit_log`; `.sql` files read at runtime and runtime query builders; other packages' source (guarded only by the `packages/` assertion); a caller file is not checked for an actual `application_admin` guard; caller check is name-based and can over-report (remedy is rename, not an inventory edit); the test guards against mistakes, not an attacker with SQL access or a migration PR; a legitimately global non-admin reader or JOIN reader is unclassifiable and needs a reviewed grammar extension; runtime ceiling. The header is the only place these survive archive (the spec deliberately defers detail to it), so "including" in 4.1 should become "all of", pointing at the Known limits section of `design.md` as the checklist. Also add the D9 rule to the header explicitly: a false positive is fixed in the scanner with a fixture, never by an inventory entry (this is procedure step 4, but 4.1 should name it, since it is the anti-bypass rule).

**R5. Fixture gaps against D4a/D4b/D5 rules that the tasks themselves implement.** Each rule in 1.3 to 1.7 should have at least one fixture, and these do not:
- Tokenizer: nested block comment (fail) and unterminated string or comment (fail, in both `exact-match` and touch detection text); double-quoted `"operation"` and `"AUDIT_LOG"`-as-quoted-identifier in the grammar (3.1 has the tripwire form only); `''` escape inside a string.
- Grammar: `INTERSECT`, `EXCEPT`, `LATERAL` (only UNION, CTE, subquery are listed); `GROUP BY`/`ORDER BY`/`LIMIT`/`FOR` terminating the WHERE (pass cases, since the clause splitter's end-of-WHERE logic is where a bug hides); `operation` appearing in SELECT list or ORDER BY only (irrelevant to the WHERE, so the grammar then fails for no operation conjunct, but it must not be mistaken for one); the alternative scope forms `team_id = <STRING|number>` and `metadata ->> 'scopeId' = $n` (3.4 lists "scope conjunct" generically); a non-SELECT first token that mentions `audit_log` in table position.
- Resolution (D5): recursively resolvable template constants (1.2 requires it, 3.1 does not list it); `let` or function-call substitution in table position (fail) versus outside table position (pass; 3.4 has only the latter generically); a template-literal `${CONST}` referencing a constant that does not itself contain `audit_log` (resolved, no finding).
- Tripwire: the design says identifiers and property names also trip it (`const audit_log = ...`, `row.audit_log`), but 3.1 only lists string forms. Add one identifier and one property-name fixture, and a negative: a recognised touch or writer must not also be reported as a tripwire (double-count).
- Labels (D7): a statement inside an anonymous function with no deterministic label is unclassifiable (stated in D7, no task, no fixture); two same-label functions collapse to one key (documented limit, optionally a fixture).
- Caller check: the defining file itself is exempt (the design relies on this for the internal `readTemplateList` call); a name collision in an unrelated file over-reports (documented behavior); property-access and export-specifier forms individually. 3.5 lists import, alias, namespace, barrel; add the defining-file exemption fixture and an `admin-only` function with zero or multiple `callers`.

## Smaller items (should fix, not blocking)

**S1. Writer pass condition has no positive end-to-end assertion.** The proposal states it as the testable pass condition ("every production writer produces zero findings") and the design calls the fail-open INSERT...SELECT a writer. 2.4 asserts R1, R2/R3, R4 are detected but nothing asserts the real writers were recognised as writers (versus the scanner simply not seeing them). Add: the scan of the real source classifies `auth/fail-open-topic-audit.ts` (`<module>`) and at least one VALUES writer as writers, so a scanner that silently ignores everything with `INSERT` cannot hide a regression.

**S2. 2.3 does not list the failure "an `admin-only` function with blank reason" vs `exact-match` blank reason separately, nor "entry in both classes".** Covered by R3's disjointness point; 3.6 says "blank reason" once. Run it for both objects.

**S3. 1.6 says "the two named values" without naming them; 3.3 does name all five cases.** Fine, but 1.6 should say they are `topic.config_list_denied` and `admin.topic_config_accessed` kept verbatim from the spec sentence (D6), and that the retired `admin.topic_config_denied` is covered by the `admin.` prefix (the spec scenario names it; add it to the 3.3 fixture list, since the spec scenario "none ... could match ... the retired `admin.topic_config_denied`" should be demonstrably tested).

**S4. Spec-to-test traceability.** The new spec scenario has four AND clauses (inventoried with non-blank reason; `exact-match` shape plus scope conjunct; unclassifiable fails; callers and statement count). 4.3 only says confirm the requirement links to the test by file name. Suggest one more line in 4.3: each AND clause of the new scenario maps to a named `it`/`it.each` block, noted in the test header or PR, so the scenario text and test names can be matched by a reader. This is the traceability I need.

**S5. Proposal says the spec delta adds "one structural scenario", the proposal prose elsewhere implies the original scenario may be reworded.** 4.4 handles it (original scenario stays, verbatim). Add the scenario to the 4.4 diff check explicitly: both scenario blocks present, original unchanged.

**S6. Sequencing.** 7.1 says write the follow-up issue number into `proposal.md` before archiving, but 6.1 and 6.2 (PR text, archived-file note) are written earlier and 6.2's note refers to residuals that the follow-up lists. Do 7.1 before 6.2, or have 6.2's note cite the issue number. Also 2.2 says "confirm the real call sites before fixing `callers`" and "`statements`: 2 / 1"; make that an explicit grep-based confirmation task step (the design's claim that R2 is also called internally in the defining module is the thing to verify).

**S7. 5.1 test-runtime ceiling.** Good, and "not met by narrowing the scan" is carried. Also state which scan root files count were parsed (about 25 per D7), so a prefilter regression that drops files is visible.

## Checked and fine

- All "Failures" in the proposal map to tasks: uninventoried touch (2.3), stale (2.3), blank reason (2.3), protected on `exact-match` (1.6, 2.3), caller or statement mismatch (1.7, 2.3), unclassifiable (1.5, 2.3), parse failure and empty set (1.2, 2.4, 3.6), unknown `packages/` dir and non-`.ts` source (2.5), no-switch check (2.5).
- Protected set (`admin.`, `topic.config_`, two named values) with near-misses `topic.configure` and bare `admin` passing: 1.6, 3.3, 3.4.
- Inventory contents match the proposal (R1 `exact-match`; R2 with `statements: 2`; R4 with `statements: 1`; shared `callers`). The mixed-function note (R3 unverified) is carried into the 4.1 header.
- Out-of-scope items are correctly out: no `mutator` class, no fingerprint, no cross-file resolution, no global-reader flag; the single bundled follow-up (7.1) lists the five deferred items from the proposal.
- D-5 honesty: 6.1/6.2 prohibit "closed" and carry the residual wording. `Closes #271` closes the issue, not the risk. Good.
- Message quality: 3.7 asserts the D10 substrings, and 5.3 requires an independent reviewer who has not read the exploration notes, which is my "build teaches the developer" condition.
- Referenced paths exist: `docs/deployment.md` (has audit content), and the archived `design-review-security.md` for 6.2.
