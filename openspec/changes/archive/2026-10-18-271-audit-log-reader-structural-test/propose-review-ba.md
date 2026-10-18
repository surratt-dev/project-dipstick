# Propose Review (Business Analyst) - #271 audit-log reader structural test

Reviewer: Marcus Delgado, Senior BA. Reviewed: proposal.md, design.md, tasks.md, specs/team-content-access/spec.md, issue #271, BRD/requirements for audit content.

## Verdict

Approve with required clarifications (4 must-fix, 6 should-fix). The proposal is well beyond the issue's wording and the capability is implementable. The gaps are mostly measurable pass/fail conditions that live in design.md but not in the proposal or spec scenarios, plus a few places where the spec and the issue disagree.

## Traceability to issue #271 acceptance

| Issue checkbox | Covered by | Assessment |
|---|---|---|
| New reader with prefix match or no operation filter fails CI | Spec scenario (filter rules), tasks 3.1 fixtures | Covered. Fixture list is explicit. But see M1: "fails CI" depends on the test being in the CI-run suite; task 5.1 only checks local `npm test`. |
| Existing reader passes and is named in the allow-list | Inventory entry R1, task 2.2, 2.4 | Covered. |
| "Document the allow-list and how to extend it" (Proposed change) | Task 4.1 header, six-step procedure | Covered. |
| "Fails if any **route file** outside an allow-list queries audit_log" | Scope widened to all `packages/backend/src` | Deliberate and good (R2-R4 live in `sessions/`). Should be stated as a deliberate deviation from the issue text. |

Deviation to record: the issue says "allow-list"; the change uses an "inventory" (everything listed, including compliant readers). Fine, but the issue/archive note (task 6.x) should say so, so nobody later reads the issue and expects compliant readers to be free.

## Must-fix

**M1. CI gate is not verified.** The issue acceptance is "fails CI". Task 5.1 only runs the file locally. Add a condition: the test file is matched by the backend test glob that the CI workflow in `.github/workflows/` runs (name the workflow/job), and a deliberately injected prefix reader makes `npm test` exit non-zero (one-off manual proof recorded in the PR). Without this, "fails CI" is an assumption.

**M2. "Cannot be classified statically" is not defined.** Proposal and spec scenario say a statement that cannot be statically classified fails. Design D5 lists examples, but the testable boundary is not given. Concrete conditions to add to the spec scenario or design:
- Fails: table name not a literal; SQL built by `+` or `concat`; template literal with `${}` interpolation that is not a named string-literal constant; SQL passed from an identifier that does not resolve to a literal in the same file.
- Passes: template literal whose only substitutions are placeholders `$n` text or resolve to literal constants (state which). Say explicitly whether `${MAINTENANCE_AUDIT_OPERATIONS}`-style interpolation of constants is allowed, since R2 uses one.
- Add fixture tasks for each fail and pass case (3.1 has only "dynamic table name; concatenated SQL").

**M3. Spec says "no application query that serves a non-administrator caller" but the test cannot know who a query serves.** The scenario now (correctly) admits this, but the requirement text above it still reads as a universal guarantee. Make the requirement sentence itself say: "checkable guarantee is: every touch of audit_log is inventoried and every inventory entry not marked admin-only or mutator uses equality on one non-protected operation." Otherwise a reader of the requirement alone is misled. Also state in the spec who decides serving-class (review by Security reviewer role, by convention).

**M4. "Reason" quality has no acceptance condition.** Only "non-empty, non-whitespace" is tested. Required content is stated in tasks 2.2 and the extension procedure, but not checkable. Either (a) accept this explicitly as human-review territory (the spec already half-says it), or (b) add a minimum mechanical rule, for example: `admin-only` reason must contain the name of a constant or operation literal and the string `application_admin`; `mutator` reason must exceed a minimum length. Pick one and write it down; "non-empty" alone permits "ok".

## Should-fix (vague language and missing conditions)

**S1. "roughly 60 INSERT-only writers"** is imprecise and unverifiable. State the pass condition instead: writers matching `INSERT INTO audit_log (cols) VALUES` produce zero findings. Specify the INSERT form precisely: what about `INSERT INTO audit_log VALUES` with no column list, `INSERT ... ON CONFLICT`, or `INSERT ... RETURNING`? Say whether each is a "touch". Add fixtures. INSERT...SELECT is a touch; confirm `INSERT ... VALUES (...) RETURNING *` is not.

**S2. "Exact match filters `operation` by equality on one string literal" - edge cases.** Define outcomes for: `operation = 'x'` joined by AND to other predicates (pass); `operation = 'x'` inside a subquery or CTE on a different table alias; `operation` compared in HAVING or in a JOIN ON clause rather than WHERE; case/whitespace variants (`OPERATION`, `"operation"`, `audit_log.operation`); `operation = 'x' OR operation = 'y'` (fail per top-level OR rule, confirm); `NOT (...)`; `COALESCE`/function wrapping on the column. Each should be a fixture with expected result.

**S3. Protected-set matching rules.** "Any operation with the `admin.` prefix" - specify case sensitivity and that the literal `admin.` followed by anything, including an empty remainder, is protected. Also what about a literal that is a prefix of a protected value (e.g. `'admin'`) with equality? Equality on `'admin'` matches nothing today; say pass/fail. Also state that `topic.config_list_denied` and `admin.topic_config_denied` are matched exactly, not by prefix, to avoid false positives on `topic.config_*` rows that are legitimate.

**S4. Failure messages are required to "teach" but only substrings are asserted.** Task 3.3 should list the required substrings so the criterion is objective: the rule name, the file#function, the phrase naming the "Audit visibility guard" requirement, the path to the test header, and the extension step number. Task 5.3 ("someone who has not read the exploration notes") needs a named role and a pass condition (reviewer can state what to do next without asking).

**S5. Non-vacuity (2.4/D8) vs stale check.** Clarify the interaction: if R2/R3 are refactored into a different function the test fails twice (stale + uninventoried). Acceptable, but the message should say "renamed or moved?" to guide. Also R2 and R3 are "one entry" with "two statements": define whether a function with two touches needs one entry (yes, per key) and that it is accepted limit that a third statement is silently covered. That limit is stated; good. Consider whether the scanner should at least report the touch count per entry as informational.

**S6. Unfiled follow-ups with "pending" numbers.** Tasks 7.1/7.2 leave issue numbers pending. The SELECT-star leak (`metadata`, `actor_roles`, `actor_ip` exposure by R1) is a real exposure of the same data class. Add a condition: issues are filed before this change is archived, and numbers are written into the proposal. "Known limits" without a tracked issue tend to be lost (the very problem this change fixes). Note R1 also returns `actor_user_id` with timestamp: facilitators seeing who had a connection recovery is a participant-privacy matter, not only a test gap. I flag it as a requirement question, not a blocker for this change.

## Smaller observations

- Terminology: "Security reviewer" role appears in the requirement but the repo persona is "Security Analyst" (Tomás Ferreira). Use one name in the spec, header, and procedure.
- Spec MODIFIED header restates a long unrelated requirement ("Application Admin access is limited to administrative data") verbatim, per delta format. Add a task to diff the restated text against `openspec/specs/team-content-access/spec.md` and confirm only the "Audit visibility guard" paragraph and the scenarios changed, since a silent drift in the other paragraphs would be a requirement change by accident.
- Spec guard text names `admin.topic_config_*` as a pattern, while the protected set is closed with named exceptions. Align wording: "any `admin.` operation, `topic.config_list_denied`".
- Proposal says "Do not remove [content.test.ts pin] as redundant". Put the same sentence in the spec or test header so it survives; proposals are archived and not read by future developers.
- Task 6 "Close D-5": add acceptance: the issue #271 is closed by the PR via `Closes #271` and the D-5 note exists in the archived review file.
- "Runtime: report measured time" has no threshold. Suggest a ceiling (for example under 5 seconds in default config) so a regression is detectable.

## Suggested concrete conditions per capability (summary)

1. Scanner detection: fixture matrix of touch forms (FROM, JOIN, subquery, CTE, INSERT...SELECT, UPDATE, DELETE, TRUNCATE, quoted, schema-qualified, comment-only, string in a comment) each with expected finding or none.
2. Classification: unclassifiable cases enumerated (M2).
3. Filter rule: pass/fail table (S2) with one fixture per row.
4. Protected set: exact vs prefix semantics (S3) with fixtures for each named op, `admin.x`, `admin.`, and a near-miss `topic.config_other` (expected pass).
5. Inventory integrity: uninventoried fails; stale fails; empty reason fails; duplicate key fails (add this, it is not mentioned); unknown class value fails (not mentioned); `exact-match` on protected op fails.
6. Gate: CI executes it (M1); no skip/env switch (task 2.5: specify how verified, for example grep the test file for `process.env` and `.skip`).
7. Docs: header contains the six steps verbatim, the named limits, the requirement name; `docs/deployment.md` sentence present.

## Requirements cross-check

BRD/architecture audit sections concern admin read logging and FR-8.2 write auditing; nothing in them conflicts with this change, and no new functional requirement is introduced. The change protects the ceremony-honesty property (no surfacing of admin or diagnostic data about participants) which fits my "protect the ritual's intent" concern. No facilitator-visible behavior changes, which the proposal states and 5.2 verifies.
