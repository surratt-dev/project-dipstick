# BA review of exploration notes, #271 audit_log reader structural test

Reviewer: Marcus Delgado, Business Analyst
Question asked: are the ideas specific enough to become requirements?

## Overall verdict

The notes are strong on ground truth (reader inventory, evasion modes, house style) and weak on decisions. Sections 3 and 4 are written as options and worries. A proposal needs testable statements. Roughly 80% of the content converts to requirements once the open questions below are closed. The remaining 20% is where I would stop a proposal from being written.

Traceability, which I care about: the chain is issue #271 -> spec "Audit visibility guard" (L191, scenario L250-255) -> security review D-5 -> this test. That chain is good. Preserve it in the proposal by citing the scenario by name, not by line number (the notes themselves say lines drift).

## 1. Clarifications needed (blocking)

C1. What counts as "reader"? The notes use "reader" for three different things: a SELECT, anything that touches the table (UPDATE/DELETE), and anything that names the table (INSERT...SELECT). The proposal must fix one definition. Recommended: a "touch" is any SQL literal in `packages/backend/src` that references `audit_log` in a position other than `INSERT INTO audit_log (...) VALUES`. The inventory then covers SELECT, JOIN, subquery, CTE, INSERT...SELECT, UPDATE, DELETE, TRUNCATE.

C2. "Non-admin reader" is not decidable by the test, and the notes say so (section 3, point 2; section 7). Therefore the spec scenario ("every query that serves a non-admin caller") and the test are not the same requirement. The proposal must state what the test actually enforces. Recommended wording: "Every audit_log touch in backend production source is listed in an inventory. Each entry declares a class, either `exact-match` or `admin-only`. Entries of class `exact-match` are mechanically checked for a single-literal equality filter. Entries of class `admin-only` are exempt from the filter check and carry a justification naming the admin guard." Ship the spec MODIFIED to match.

C3. Is the `admin-only` class trusted or verified? As written, an engineer can label anything admin-only and bypass the filter check. Either (a) accept this and rely on Security review of the diff, or (b) add a mechanical check that the file of an admin-only entry references an admin guard. Recommended: (a) for this change, stated explicitly as a known limit in the test header, with (b) logged as a follow-up. Do not leave it implicit.

C4. Who is the approver for a new allow-list entry? "Security review (Tomas)" is a person. Requirements should name a role ("Security reviewer") and say whether it is enforced (CODEOWNERS) or by convention. The notes say "check whether the repo has one". That check is a pre-proposal task, not a design question. Do it before the proposal.

## 2. Vague areas and suggested rewrites

V1. "Fail closed" and "conservative" (section 3, section 4.2). Never acceptable in an acceptance criterion without a list. Rewrite as: "A statement that references audit_log and cannot be statically classified (dynamic table name, SQL assembled by concatenation or non-literal interpolation, SQL passed from a non-literal identifier) causes the test to fail, naming file and function."

V2. Filter judging rules (section 3, "Judging the filter"). Mix of must and might. Convert to a table the test must satisfy:
- PASS: WHERE contains `operation = '<one string literal>'` (alias-prefixed permitted), AND no OR in the same WHERE, AND no other predicate form on `operation`.
- FAIL: no operation predicate; LIKE, ILIKE, SIMILAR TO, `~`, `^@`, starts_with, left, substr, position on `operation`; IN, `= ANY`; `<>` or `!=`; `= $n`; any OR at top level of the WHERE.
Decision needed: is `= $n` rejected outright (note says conservative, I agree)? Recommended yes, and document that R2/R4 are allow-listed as admin-only for this reason.

V3. "Over-flag and force an allow-list entry." The cost of a false positive is a code change by the developer. State the acceptable false-positive posture: a false positive is resolved by fixing the scanner with a fixture, never by adding an inventory entry (the notes say this in section 6 step 5; promote it to a requirement).

V4. Non-vacuity "at least N readers". N is unspecified. Set it: the scan must detect at least 4 touches today (R1, R2, R3, R4) and the test must assert each by file and function name, rather than a count alone. A count alone permits silent substitution.

V5. Deny-list of protected operations. The notes list candidate names and "probably admin.* generally", which is a guess. The requirement needs a closed source. Recommended: the protected set is exactly the operations named in the "Audit visibility guard" requirement text (`admin.topic_config_accessed`, `topic.config_list_denied`, historical `admin.topic_config_denied`) plus any operation with the `admin.` prefix; the test may not exempt them for class `exact-match` entries. Reconcile the list with the spec sentence before the proposal, since the notes include names (`admin.session_content_denied`, `admin.membership_list_accessed`, `admin.team_detail_accessed`) that I cannot trace to the spec from this document alone.

V6. "Documentation": section 6 is concrete about content but not about acceptance. Add: the extension procedure (six steps) appears in the test file header; docs/deployment.md contains a pointer sentence naming the test file; the spec requirement links to the test by file name. Each is a checkable diff item.

V7. "CI placement: confirm the unit lane picks it up." Convert to an acceptance condition: the test file runs under the default `npm test` backend unit command with no env vars, no DB, and no skip path. Verification: run with DB env unset and observe pass.

V8. Section 9 "Likely a lightweight pipeline." Not a requirement; leave it to the team-lead classification. It should be dropped from the proposal body.

V9. "SELECT * flagged as candidate extension." Out of scope for this change; list it under Non-goals with a follow-up issue reference, so it is not re-litigated or silently dropped.

## 3. Suggested acceptance conditions (proposal-ready)

AC1. Given the current tree, the test passes, and its inventory contains exactly R1 (`routes/content.ts#fetchConnectionRecoveries`, exact-match) and R2-R4 (`sessions/default-topic-maintenance.ts#readTemplateList` (two statements) and `#readTemplateHistory`, admin-only), each with a non-empty reason.
AC2. Given a fixture reader with no operation filter, the scanner reports a failure naming rule and location. Same for each failing form in V2, plus JOIN audit_log, quoted and schema-qualified names, dynamic table name, and `LIKE 'topic.default_%'`.
AC3. Given fixtures with literal equality, aliased columns, and multi-line template literals, the scanner reports no failure.
AC4. Given a correctly filtered reader that is not in the inventory, the test fails with a message saying to add an entry and referring to the extension procedure.
AC5. Given an `exact-match` entry whose literal is a protected operation, the test fails.
AC6. Given an inventory entry whose file or function no longer contains a touch, the test fails as stale.
AC7. Given an entry with an empty or whitespace reason, the test fails.
AC8. The failure message for every rule states: the rule, why it exists (non-admin callers must not read admin audit rows), and how to proceed. Verifiable by asserting message substrings in the self-tests.
AC9. Comments mentioning audit_log and the roughly 60 INSERT-only writers produce no findings.
AC10. `content.test.ts` pin remains unchanged (state as a constraint, since the notes warn about "simplify away").
AC11. No production code, migration, or API change in the diff.
AC12. No environment variable or skip flag can disable the test.

## 4. Recommended answers to open questions (section 8)

Q1. Inventory-style or exceptions-only? Inventory-style. Reason: it matches the issue's acceptance ("the test names it in its allow-list") and closes the unreviewed-new-reader gap. Record the trade-off (friction on every new reader) as accepted.

Q2. How to represent admin-only readers? Allow-list entries with class `admin-only` and a reason naming the constant and route guard. Do not teach the scanner to trust `= ANY(constant)`. Answer to C3 applies.

Q3. Protected-operation deny-list in scope? In scope, but minimal: the closed set from the spec text (V5). It is small, mechanical, and without it the exact-match check passes the most important wrong case (an exact match on `admin.topic_config_accessed`). If the team judges the list too uncertain, descope it explicitly and state the residual risk in the proposal; do not leave it unmentioned.

Q4. Do UPDATE/DELETE/TRUNCATE count? Yes, under C1. A retention job later is foreseeable and the cost now is near zero. Exact-match filtering does not apply to them; they must be inventoried as their own class (`mutator`) with a reason. Add this class to the inventory vocabulary or the scanner will give a misleading failure.

Q5. Scan beyond backend src? Backend `src` only, with scanned roots named in the header. `migrations-manual/` explicitly out of scope (operator-run, human-reviewed). Migrations creating a view or function over audit_log: record as a known gap with a follow-up issue unless the check is trivial; I do not want it half-built here. Future packages: header states a new package reading audit_log must extend the scanner roots.

Q6. Regex or AST? AST, beside the existing scanner, no refactor of it. Reason is a requirement, not taste: the allow-list is keyed by function, and only the AST can name the enclosing function and ignore comments (AC9). Reuse of the proven pattern lowers delivery risk.

Q7. Correct the issue's line reference? Yes, in the proposal's context section: cite `fetchConnectionRecoveries` by name; note the issue's "~L1115" has drifted. Also add the sentence from section 5 that "the one reader" in the issue means the one non-admin reader, not the only reader.

## 5. Additional gaps the notes did not raise

G1. Spec delta scope. The notes say "probably a small MODIFIED" to scenario L250-255. Decide now: yes. The current scenario promises something the test cannot verify; shipping a test that quietly redefines the rule is exactly the "constraints erode by exception" outcome Devon fears. The delta states the inventory model and the admin-only exemption.

G2. Failure-message audience. AC8 covers content, but the persona needs a stated reader: a developer with no knowledge of #208. Add a "reviewed by someone who has not read the notes" check during the review stage.

G3. Closing D-5. The notes mention recording closure of D-5. Make it a task in the change: add a note to the archived review or the proposal's traceability table. Otherwise it will not happen.

G4. Reconcile R2's two statements. The notes list R2 and R3 as separate readers in one function; the allow-list is keyed by function, so one entry covers both statements and a future third statement in `readTemplateList` would be silently exempt. State that this is accepted, or require key granularity of file + function + statement count. Recommended: accept, and note it as a known limit.

## 6. Blocking items before proposal

1. Repo CODEOWNERS check (C4).
2. Reconcile protected-operation names with spec text (V5).
3. Decisions on C1, C2, C3 (the vocabulary the whole proposal rests on).

Everything else is writable as stated above.
