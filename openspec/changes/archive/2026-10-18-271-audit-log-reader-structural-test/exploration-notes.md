# Exploration notes: #271 structural test, every audit_log reader filters operation by exact match

Perspective: Devon Calloway, Internal Champion. Explore mode only; nothing implemented.

## 0. Revision after review (Priya Nair, Marcus Delgado)

Status: revised. Sections 3 and 4 below remain as the exploration record; this section and section 8 hold the decisions. Where they differ, section 0 and section 8 win.

### 0.1 Vocabulary (closes BA C1, C2, C3)

- **Touch**: any SQL literal in the scanned roots that references `audit_log` in a position other than `INSERT INTO audit_log (...) VALUES`. Covers SELECT, JOIN, subquery, CTE, INSERT...SELECT, UPDATE, DELETE, TRUNCATE.
- **Inventory**: every touch in backend production source is listed, keyed by file + function, each with a non-empty reason. Inventory-style, not exceptions-only.
- **Classes**: `exact-match` (mechanically checked), `admin-only` (exempt from the filter check, reason names the constant and the route's admin guard), `mutator` (UPDATE/DELETE/TRUNCATE, no filter check, reason required).
- **What the test enforces** (this replaces the spec's "every query that serves a non-admin caller", which a test cannot decide): every touch is inventoried; every `exact-match` entry passes the filter rules and does not use a protected operation; `admin-only` and `mutator` entries are trusted on their reason.
- **Known limit, stated in the test header (C3)**: `admin-only` is trusted, not verified. An engineer could mislabel a reader. The control is Security review of the inventory diff. A mechanical check that an admin-only entry's file references an admin guard is logged as a follow-up, not built here.
- **Accepted limit (G4)**: entries are keyed by file + function, so a new statement added inside an already-inventoried function (e.g. a third statement in `readTemplateList`) is covered by the existing entry. Accepted; stated in the header. Keeping the key coarser than statement-level keeps the extension procedure light.

### 0.2 Decisions on the BA's blocking items

- **C4, approver and CODEOWNERS check (done).** Searched the whole repo (`find . -iname CODEOWNERS`, excluding node_modules) and `.github/`. There is no CODEOWNERS file anywhere; `.github/` contains only `workflows/`. Finding: approval of a new inventory entry is by **convention, not enforcement**. The requirement names a role ("Security reviewer"), not a person. The header and docs pointer say so plainly. Adding a CODEOWNERS entry for the test file is a possible follow-up; it is not part of this change and the proposal must not claim the review is enforced.
- **V5, protected-operation set (reconciled against spec).** The spec's "Audit visibility guard" requirement names exactly `admin.topic_config_accessed`, `topic.config_list_denied`, and historical `admin.topic_config_denied`. The other names in my earlier list (`admin.session_content_denied`, `admin.membership_list_accessed`, `admin.team_detail_accessed`) appear elsewhere in the spec as admin read/denial operations, and all carry the `admin.` prefix; they are not named by the guard sentence. Closed set for the test: the three named operations plus any operation with the `admin.` prefix. `topic.config_list_denied` has no `admin.` prefix, which is why it must be listed by name. Not allowed for `exact-match` entries. Deny-list is in scope (BA Q3); source of truth is the spec sentence, and the test header cites the requirement by name.
- **V1, unclassifiable statements.** A statement referencing `audit_log` that cannot be statically classified (dynamic table name, SQL assembled by concatenation or non-literal interpolation, SQL passed from a non-literal identifier) fails the test, naming file and function. This replaces "fail closed / conservative" in the notes.
- **V2, filter rules for `exact-match`.**
  - Pass: WHERE contains `operation = '<one string literal>'` (alias prefix permitted), no top-level OR in that WHERE, no other predicate form on `operation`.
  - Fail: no operation predicate; LIKE, ILIKE, SIMILAR TO, `~`, `^@`, starts_with, left, substr, position on `operation`; IN; `= ANY`; `<>` / `!=`; `= $n`; any top-level OR in the WHERE.
  - `= $n` is rejected outright. R2/R4 use `ANY($2::text[])` and are inventoried as `admin-only` for that reason.
- **V3, false-positive posture (promoted to requirement).** A false positive is resolved by fixing the scanner with a fixture, never by adding an inventory entry.
- **V4, non-vacuity.** The scan must detect today's touches and the test asserts each by file and function name, not by count: R1 `routes/content.ts#fetchConnectionRecoveries` (`exact-match`); R2/R3 `sessions/default-topic-maintenance.ts#readTemplateList` (two statements, one entry) and R4 `#readTemplateHistory` (`admin-only`).
- **Q4 and mutators.** UPDATE/DELETE/TRUNCATE count as touches and need the `mutator` class so the scanner does not give a misleading "no filter" failure.
- **Q5 scope.** Scanned root is `packages/backend/src` only, named in the header. `migrations-manual/` is explicitly out of scope (operator-run, human-reviewed). A new migration creating a view or function over `audit_log` is a **known gap**, logged as a follow-up, not half-built here. A new package that reads `audit_log` must extend the scanner roots (stated in the header).
- **Q6.** AST scanner beside `template-writer-scanner.ts`, no refactor of it. Requirement, not taste: the key is the enclosing function and comments must be ignored.
- **Q7.** The proposal context cites `fetchConnectionRecoveries` by name; the issue's "~L1115" has drifted. "The one reader" in the issue means the one non-admin reader, not the only reader.

### 0.3 Spec delta (G1, decided)

Yes: a small MODIFIED on the scenario "Application audit-log reads for non-admin callers filter by exact operation" (cite by name, not line number). It states the inventory model, the three classes, and that `admin-only` readers are enumerated and exempt on their stated reason. A test that quietly redefines the rule is the "constraints erode by exception" outcome I worry about; the spec should say what is actually checked. The requirement also links to the test by file name.

### 0.4 Acceptance conditions adopted (BA AC1 to AC12)

Adopted as written, as the proposal's starting set:
- AC1 inventory contents on the current tree; AC2 each failing form fails with rule and location (including JOIN, quoted and schema-qualified names, dynamic table name, `LIKE 'topic.default_%'`); AC3 passing fixtures (literal equality, aliases, multi-line templates); AC4 a correctly filtered reader not in the inventory fails with a message pointing at the extension procedure; AC5 an `exact-match` entry on a protected operation fails; AC6 stale entry fails; AC7 empty or whitespace reason fails; AC8 every failure message states rule, why (non-admin callers must not read admin audit rows), and how to proceed, verified by substring assertions in self-tests; AC9 comments and the roughly 60 INSERT-only writers produce no findings; AC10 `content.test.ts` pin unchanged; AC11 no production code, migration, or API change; AC12 no env var or skip flag can disable the test.
- V6 documentation checks: extension procedure (six steps) in the test header; one pointer sentence in `docs/deployment.md` naming the test file; spec requirement links to the test.
- V7: the file runs under the default backend `npm test` with no env vars, no DB, no skip path. Verified by running with DB env unset. Runtime expectation: a pure source scan plus fixture self-tests, similar to the not-found structural test, so well under a second of scanning; the implementer reports the measured time (answers Priya's flake and dev-loop question; no I/O beyond reading source files, so no flake source).
- G2: failure messages are written for a developer who has never heard of #208; the review stage includes a read by someone who has not read these notes.
- G3: closing D-5 is a task in the change (a traceability note in the proposal and a note on the archived review).

### 0.5 Facilitator feedback (Priya)

Accepted:
- Rationale gets one sentence naming the participant-facing consequence: people stop speaking honestly if they believe admin or diagnostic data about them can be surfaced, so the test protects the ceremony, not only compliance. This is a better justification than "Security asked for it" and goes in the proposal's why.
- R1's reason is recorded in facilitator terms as well: "serves the facilitator via session history; shows connection recoveries only."
- Stated explicitly: no facilitator-visible behavior changes (AC11); the `content.test.ts` pin stays; no usability testing is needed for this change.
- Backlog follow-up: check that session history never displays per-person diagnostic detail from audit rows to the room; R1 returns `actor_user_id` and timestamp, and the view should present recoveries as a session-level signal, not a per-person scoreboard. Also covers the `SELECT *` / column check (see V9).
- Her questions answered: adding a facilitator-useful operation (e.g. a "reconnect reason" or late joiners) means one new inventory entry with a reason plus a short Security review of a small diff, not a gate; the six steps are the whole procedure. The protected set only blocks `admin.*` and the named topic denial operations, so ordinary session signals are not blocked. If the cost is felt as disproportionate, that is feedback to simplify the procedure, never to add a bypass.

Pushed back / not adopted:
- None of her points compromise a constraint. The only tension is the idea of keeping process cost to "a short review"; accepted as a design intent, but the review is by convention (no CODEOWNERS), so the proposal must not promise a turnaround or an enforced gate.

### 0.6 BA suggestions not adopted or adjusted

- V8 adopted: the pipeline suggestion in section 9 is dropped as a requirement; classification is the team lead's call.
- V9 adopted: `SELECT *` / column check is a Non-goal with a follow-up issue reference (needs an issue number at proposal time).
- Q3 note: the deny-list stays in scope. If the team descopes it, the residual risk (an exact match on `admin.topic_config_accessed` passing the filter check, caught only by inventory review) must be written in the proposal.
- No suggestion was rejected on persona grounds. One adjustment: BA recommends `mutator` as a class, which I adopt; I also stress it must not become a general-purpose escape hatch, so a `mutator` reason must name why the mutation is legitimate, and any `mutator` entry added later is a Security review item like the others.

## 1. Why Devon cares (intent, not mechanics)

Devon does not care about audit_log plumbing. He cares about what the rows protect.

- The product rule he holds hardest: session data must never be surfaceable in a way that lets someone compare or watch individuals. The audit trail is the forensic record of who looked at team data (admin reads of TOPIC-002, managers who are also admins). If those rows leak to team members or EMs, two things break at once: (a) trust, because engineers learn that an admin looked at their team's topic config and who was a manager-admin; (b) the "audit rows are forensic, not monitored" framing (security review D-1) becomes a surveillance surface.
- His stated worry is "constraints get treated as configurable options / erode by exception". The same shape applies here: the exact-match rule is a spec-level constraint (team-content-access, "Audit visibility guard", spec L191, scenario L250-255) that today holds only by reviewer memory. A rule that holds by memory fails the day the original reviewers move on. He wants the knowledge carried by the build, not by Tomas or Marcus.
- He is explicitly not the help desk. The test's failure message must teach: say what rule, why, and how to fix or extend, without anyone phoning him.
- Success looks like: a future developer adds a "show recent session events" feature using `operation LIKE 'session.%'`, CI goes red with a message that names the rule, and nobody has to remember #208.

## 2. Ground truth: every audit_log reader today (not just routes)

Searched all of packages/backend (src, migrations, migrations-manual), frontend, docs, requirements. Writers (INSERT INTO audit_log) are many (roughly 60 sites across auth/, realtime/, teams/, routes/, sessions/) and are out of scope. Readers:

| # | Location | Query | Operation filter | Who it serves | Verdict |
|---|---|---|---|---|---|
| R1 | `src/routes/content.ts` ~L1202 `fetchConnectionRecoveries` (issue says ~L1115; the file has drifted, so do not cite line numbers in the test, cite the function) | SELECT actor_user_id, timestamp FROM audit_log | `operation = 'session.connection_recovered'` (literal equality, plus metadata scope/scopeId) | Facilitator via session history. The only non-admin reader. | Compliant. This is the one to name in the allow-list. Pinned by `content.test.ts` ~L313-319 (`toContain("operation = 'session.connection_recovered'")`, `not.toContain("like")`, `not.toContain("session.")`). |
| R2 | `src/sessions/default-topic-maintenance.ts` ~L626 `readTemplateList`, change query | SELECT DISTINCT ON ... FROM audit_log a LEFT JOIN users | `a.operation = ANY($2::text[])`, array built from `MAINTENANCE_AUDIT_OPERATIONS` minus reorder (a constant, not visible in the SQL text) | application_admin only (routes/admin-default-topics.ts, admin-only). | Not exact-match in the issue's literal sense: it is an IN-list by array. Legitimate because admin-only, and the five-name list is explicit and avoids `LIKE 'topic.default_%'` on purpose (docs/deployment.md ~L390 documents why `_` is a wildcard). |
| R3 | same file ~L632 `readTemplateList`, reorder query | SELECT timestamp FROM audit_log | `operation = 'topic.default_reordered'` literal equality | admin only | Compliant on the shape; admin-only. |
| R4 | same file ~L698 `readTemplateHistory` | SELECT ... FROM audit_log a LEFT JOIN users | `a.operation = ANY($2::text[])` with `[...MAINTENANCE_AUDIT_OPERATIONS]` | admin only | Same as R2. |
| M1 | `migrations-manual/8_rollback.sql` ~L77 | INSERT ... SELECT FROM audit_log | `operation = 'team.role_changed'` | operator rollback script | Not application code. Out of scope. |
| M2 | `migrations-manual/8_phantom_em_detect.sql` ~L55, `8_phantom_em_annotate.sql` ~L101-109 | joins / select on audit_log | `al.operation = 'team.manager_established'` | operator scripts | Out of scope (equality anyway). |
| D1 | `docs/deployment.md` ~L228, ~L321, ~L357, ~L394 | operator SQL snippets | equality, ANY(array), and `SELECT *` with `operation =` | humans with DB access | Not code. Note only. |
| F1 | `packages/frontend/src/pages/EmSessionHistoryPage.tsx` L23 | comment only | none | none | Not a reader. A frontend scan is unnecessary; the frontend cannot query the table. |

Also grep'd and found no reader of audit_log in: triggers/functions/views in migrations (migration 8 only creates the table, indexes and one trigger-style INSERT; 22 adds actor_roles; 23 inserts).

Main findings:

1. The issue says "any route file", but two of the three live reader queries are in `src/sessions/`, not `src/routes/`. A scan limited to `routes/` would miss exactly the second place a developer would plausibly put a reader, and would miss the shape that is not a plain equality (the array form). The scan must cover all backend production source (`productionSources()` already does this), with the allow-list keyed by file and function.
2. Today there is exactly one reader that serves a non-admin (R1). R2-R4 serve admins only, but the structure of the filter (`= ANY(array)`) is the very thing the spec forbids for non-admin callers ("`IN` list"). The test cannot tell who a query serves. This is the central design tension, see 3.
3. The issue text ("exact match") and the spec text ("equality on a single named operation") are stricter than what the code already does for admin readers. The test needs a policy for the admin-only readers: allow-list them explicitly with a justification (the style of `template-writer-structural.test.ts`), which doubles as the documentation that those readers exist and are admin-only.

## 3. Shape of the test (options, not decisions)

House style to follow:
- `team-not-found-envelope-structural.test.ts`: tiny, `productionSources()` from `routes/__tests__/helpers/backend-sources.ts`, an ALLOWLIST set, plus a "not vacuous" test that the owner still has the thing.
- `template-writer-structural.test.ts` + `helpers/template-writer-scanner.ts`: TypeScript-compiler-API scanner, allow-list keyed by file then function with a one-line justification, a `judge()` that also reports stale allow-list entries, plus self-tests proving the scanner can fail. This is the closer analogue because the problem is "find SQL statements that touch a table, judge each by function".

Detecting a reader (the false-negative risk is the whole value of the test):
- A statement reads audit_log if its SQL text matches `FROM audit_log`, `JOIN audit_log`, or a quoted/schema-qualified variant (`"audit_log"`, `public.audit_log`), including subqueries and CTEs. Do not match only `SELECT ... FROM audit_log` at line start; the real queries are multi-line template literals with aliases (`FROM audit_log a LEFT JOIN users u`).
- Exclude pure writers: `INSERT INTO audit_log ... VALUES`. But `INSERT ... SELECT ... FROM audit_log` must count as a reader (the rollback script does this; app code could too). The simplest rule is "any `FROM|JOIN audit_log`", so INSERT INTO alone does not trigger it.
- `UPDATE audit_log ... WHERE`, `DELETE FROM audit_log` : DELETE FROM matches a naive `FROM audit_log`; decide deliberately. The break-glass redaction is database-operator only, and a retention job would be an app-code mutator. Probably flag them too, as "touches audit_log other than INSERT", with the same allow-list. Open question for the team.
- Dynamic table name or SQL assembled by concatenation/interpolation: fail closed, as the topics scanner does ("a write whose table name is dynamic fails").
- SQL held in a shared constant (`FAIL_OPEN_TOPIC_AUDIT_INSERT_SQL`, `auth.ts` map of INSERT strings): the scanner works on literals, so constants are scanned where they are defined. Reader queries that reference a constant for the operation list (R2, R4) cannot be resolved statically.

Judging the filter, per reader:
- Pass: `operation = '<single literal>'` (also `a.operation`, `al.operation`), optionally `operation = $n` where the parameter is a single string (see risk below).
- Fail: no `operation` predicate at all; `operation LIKE`/`ILIKE`/`SIMILAR TO`/`~`/`^@`/`starts_with`/`left(operation, n)`/`substr`/`position`/`operation IN (...)`/`= ANY(...)`; `operation <> / !=` (negation selects everything else, including admin rows); `OR` branches that widen the predicate; comparison of a column other than operation.
- The sneaky case is a predicate that is present but not conjunctive, e.g. `WHERE operation = 'x' OR team_id = $1`, or one that only constrains inside a subquery. A regex is easy to fool here; a real SQL parse is heavy. This pushes toward a deliberately conservative rule: require the pattern `operation\s*=\s*'<literal>'` in the statement, forbid any LIKE/ILIKE/SIMILAR/regex/IN/ANY/`!=`/`<>` that mentions `operation`, and forbid `OR` in the WHERE of a reader. Better to over-flag and force an allow-list entry than miss a leak.
- `SELECT *`: the deployment doc has a `SELECT * FROM audit_log` operator snippet and design review D-5 mentioned "wildcard selects". Even with an exact filter, a non-admin reader that returns whole rows can leak `metadata`, `actor_roles`, `actor_ip`. The issue does not ask for a column check, but it is a cheap adjacent assertion. Flag as a candidate extension, not part of acceptance.

Where the "exact-match" check meets the allow-list:
- Everything outside the allow-list must be an exact-match reader or the test fails.
- Allow-list entry = (file, function) -> reason, mirroring the topics-writer test. Two kinds of entries could exist: (a) "exact-match, non-admin-facing" (R1 `routes/content.ts#fetchConnectionRecoveries`), which should also be verified by the filter check, and (b) "admin-only, explicit operation list" (R2-R4 in `sessions/default-topic-maintenance.ts`), which are exempted from the exact-match rule because of who they serve. Whether (a) needs an allow-list entry at all is a design question: the issue wants "the existing reader passes, and the test names it in its allow-list", so the issue expects it to be named. Cleanest reading: the allow-list is the complete inventory of audit_log readers; every entry still has to pass the filter check unless flagged as admin-only, and any reader not in the inventory fails even if its filter is exact (forces a human to confirm who it serves). Compare with "only non-exact readers need allow-listing", which is less conservative: a new, correctly filtered reader that serves participants of an admin-visible operation would sail through.

I lean (Devon) toward inventory-style: any new reader, even a compliant one, requires an explicit, justified allow-list line. The cost of a new audit_log reader is rare and significant; the friction is a feature. But the issue's acceptance bullet says a reader with prefix/no filter fails and the existing one passes; the inventory form satisfies both, and additionally closes the "exact filter but wrong operation" hole (see risks).

## 4. What could go wrong (ordered by how much Devon would worry)

1. Exact match on the wrong operation. `operation = 'admin.topic_config_accessed'` is an exact match and would pass a naive check while serving the very rows the guard protects. The spec scenario forbids matching the protected set. The test could carry a deny-list of protected operation names (`admin.topic_config_accessed`, `topic.config_list_denied`, `admin.topic_config_denied`, probably `admin.*` generally, `admin.session_content_denied`, `admin.membership_list_accessed`, `admin.team_detail_accessed`) and fail any non-allow-listed reader whose literal is in it. Inventory-style allow-listing already covers this by forcing review of new readers; the deny-list gives a second, mechanical line. Need to decide whether it is in scope or a follow-up. R1's literal is `session.connection_recovered`, which is itself something the content.ts comment says is facilitator-visible, whereas `session.access_revoked_live` and `session.token_refresh_failed_live` are not.
2. A reader that is invisible to the scanner. Candidate evasions: SQL built by `+` concatenation or array join; table name via variable; `db.query(sqlConstant)` where the constant lives in a different file; ORM/query-builder use (none today; confirm the codebase has no query builder); raw `client.query` inside a transaction helper (same file scan covers it); a view or SQL function in a new migration that selects from audit_log (migrations are out of the scan; consider scanning migrations for `CREATE VIEW|FUNCTION ... audit_log` as a separate cheap check, or document the gap). The non-vacuity tests (see 5) and a fail-closed rule for dynamic names reduce but cannot eliminate this. State the limit plainly in the test header, as the topics-writer test does: guards against mistakes, not against an attacker with SQL access or a developer who tries to hide a query.
3. Over-triggering and noise. Prose comments mention audit_log constantly (the content.ts comment even contains "audit_log also holds ..."). A text grep for the word would false-positive on comments and on ~100 INSERT sites. Use the TypeScript AST to look only at string and template literals (the topics scanner already does) and ignore comments; only match `FROM|JOIN` forms.
4. False sense of security via the unit test pin. content.test.ts asserts on the SQL string of a mocked db call by call index (`mock.calls[3]`), which is brittle, and the test's own comment admits the leak-prevention is "the string assertion in the previous test". The new structural test supersedes the idea, not replaces it; keep both. Do not delete the content.test.ts pin as "now redundant"; it pins the actual executed SQL, the structural test pins the source. Worth saying in the notes so a reviewer does not simplify them away.
5. The allow-list rotting. Entries pointing at renamed or deleted functions must fail (stale-entry check, as in `judge()`), or the allow-list becomes a graveyard of exemptions that quietly licenses a future function of the same name. Keying by file+function (not file alone) keeps the blast radius of an entry small; a file-only key would exempt any new reader added to `default-topic-maintenance.ts`, which is the file most likely to grow more readers.
6. The allow-list becoming "the way you bypass". An engineer under deadline adds an entry with a one-word reason. Mitigate with a required non-empty justification string, a comment in the test saying new entries require review by the Security reviewer role (by convention; no CODEOWNERS exists), and the extension procedure in section 6. This mirrors Devon's general principle: friction should be proportional to what is protected, and a bypass should be visible in the diff.
7. Parameterised operation. `operation = $1` with a caller-supplied value looks like exact match, but the caller can pass `'admin.topic_config_accessed'`. A static test cannot prove the argument is a safe constant. Rule options: reject `operation = $n` outright outside the allow-list (conservative; R2/R4 use `ANY($2::text[])`, which is rejected by default and so go on the allow-list anyway); or accept it only when the call argument at that position is a string literal / known constant. The conservative option is simpler and has no known cost today.
8. CI placement. `team-template-guard-structural.test.ts` requires infra and fails rather than skips in the integration lane. This new test is pure source scanning; it needs no DB, so it should run in the ordinary unit lane and cannot be skipped. Confirm that the unit lane picks up `routes/__tests__/*structural*` (the not-found structural test is in the same directory and runs there, so it should).
9. Self-test drift: a scanner that is never shown to fail is a scanner nobody trusts. Following the #216 test's "proves it can fail", include fixtures fed to the pure scanner: no operation filter, `LIKE 'admin.%'`, `IN (...)`, `!=`, `OR` widening, `JOIN audit_log`, dynamic table name, quoted/schema-qualified name; and passing fixtures: literal equality, aliased columns, multi-line template literals.
10. Backend-only scope. Source of truth is `packages/backend/src` via `backend-sources.ts`. A second package that reads audit_log (reporting, a worker, scripts/) would not be seen. Today none exists (checked frontend and repo). Name the scanned roots in the header so a future package forces a conscious decision.

## 5. Acceptance mapping (from the issue)

- "Adding a new audit_log reader that uses a prefix match, or no operation filter, fails CI." -> scanner fixtures prove each failing form; real tree scan is green only with the allow-list as is.
- "The existing reader passes, and the test names it in its allow-list." -> `routes/content.ts#fetchConnectionRecoveries` listed with the reason from the content.ts comment (SEC-25 revocation cause and participant auth-failure detail must not leak). Because R2-R4 exist, the allow-list will have more than one file in it; the issue's premise ("the one non-admin reader that exists today") is correct, but "the one reader" is not "the only reader". The notes/proposal should say so explicitly so the issue text is not read as an inventory.
- "Document the allow-list and how to extend it." -> in the test header and in docs (see 6).

Non-vacuity checks to include (same pattern as the not-found test): the scan finds R1; it finds the sessions/ readers; the allow-list has no stale entries; at least N readers are detected, so a regression in the scanner that finds nothing fails loudly.

## 6. Documentation and extension procedure (what Devon wants written)

Where: the test file header (authoritative, next to the data), plus one short pointer in docs/deployment.md near the audit section (~L292-311, where operators read about audit rows) and a pointer from the "Audit visibility guard" spec requirement so the next person following the spec finds the test. Do not create a separate doc file.

Content of the extension procedure, in plain words:
1. When you need a new reader of audit_log, first decide who it serves. If it serves anyone but an application_admin, it must filter `operation` by equality on one named operation, and that operation must not be one of the protected ones.
2. Add an entry keyed by file and function, with a one-line reason that states who the endpoint serves, which operation(s) it reads, and why that cannot expose admin rows.
3. Admin-only readers with an explicit operation list: say so in the reason, name the constant, and reference the route's admin check.
4. A new entry needs review by the Security reviewer role because it changes what audit data can leave the table. State in the header that this is by convention: the repo has no CODEOWNERS file (checked).
5. If the test fails and you think it is a false positive, fix the scanner (with a fixture), do not widen the allow-list.
6. If you delete a reader, delete its entry; the stale-entry check will tell you.

## 7. Relationship to other work and records

- #264 (non-admin TOPIC-002 denial row `topic.config_list_denied`) is CLOSED (2026-10-12), so the "best done alongside or after #264" precondition is satisfied. The protected set is now larger than #208's: `admin.topic_config_accessed`, `topic.config_list_denied`, historical `admin.topic_config_denied`. Spec L191 is already updated to include `topic.config_list_denied`; the test's protected-name list (if built) should come from that sentence.
- #208 security review D-5 ("visibility guard enforced by review only ... worth an automated source scan when #264 lands") is the origin. Section 3 note there says "no automated test scans for wildcard selects"; the closing of D-5 should be recorded when this lands.
- team-content-access spec scenario "Application audit-log reads for non-admin callers filter by exact operation" (L250-255) currently has no automated test behind it other than the R1 pin. This change makes it checkable. Whether it needs a delta spec: probably a small MODIFIED on that scenario to say the check is a structural test and to say that admin-only readers are enumerated and exempt, because as written ("every query ... that serves a non-admin") the scenario is not what the test can check (the test cannot tell who a query serves). That mismatch deserves an honest sentence in the spec rather than a silent gap.
- docs/deployment.md already tells operators "never LIKE 'topic.default_%'" (underscore is a wildcard). That is the same failure class one level down, and a good illustrative failure fixture (`LIKE 'topic.default_%'` matches `topic.defaults_assigned`).
- Retention: deployment.md says the five maintenance operations on the template are exempt from retention. If a retention job is ever added it will be a DELETE FROM audit_log in app code; deciding now that DELETE/UPDATE count as "touching audit_log" saves a later surprise.
- Persona-relevant guardrails: none of this adds a configurable switch. The allow-list is code, in a test, reviewed in a diff; there is no env var, no skip flag. Resist adding a "SKIP_AUDIT_READER_CHECK" escape hatch.

## 8. Open questions: RESOLVED

1. Inventory-style allow-list. Decided. Friction on every new reader is an accepted trade-off.
2. Admin-only readers (R2 to R4): inventory entries of class `admin-only` with a reason naming the constant and the route guard. The scanner does not trust `= ANY(constant)`. Trusted, not verified; mechanical check logged as follow-up (0.1).
3. Protected-operation deny-list: in scope, closed set from the spec sentence plus the `admin.` prefix (0.2).
4. UPDATE/DELETE/TRUNCATE: count, as class `mutator` (0.2).
5. Scope: backend `src` only; `migrations-manual/` out; migration views/functions a known gap with follow-up; future packages must extend roots (0.2).
6. AST scanner beside the existing one, no refactor (0.2).
7. Issue reference corrected: cite by function name; "the one reader" means the one non-admin reader (0.2).

## 9. Suggested size and shape (for whoever proposes)

Small, test-and-docs only; no production behaviour change; no migration; no API. Pieces: a pure scanner helper next to `template-writer-scanner.ts`, one structural test file next to `team-not-found-envelope-structural.test.ts` with the allow-list, scanner self-test fixtures, a short docs/deployment.md pointer, and a spec scenario tweak. Pipeline classification is left to the team lead. Security review (role, by convention; there is no CODEOWNERS) is relevant because the test encodes a security control.

Key files:
- packages/backend/src/routes/__tests__/team-not-found-envelope-structural.test.ts (style model)
- packages/backend/src/routes/__tests__/template-writer-structural.test.ts and helpers/template-writer-scanner.ts (closer model: AST scan, function-keyed allow-list, stale check, can-fail self-tests)
- packages/backend/src/routes/__tests__/helpers/backend-sources.ts (productionSources)
- packages/backend/src/routes/content.ts (fetchConnectionRecoveries, R1)
- packages/backend/src/routes/__tests__/content.test.ts (~L313 pin)
- packages/backend/src/sessions/default-topic-maintenance.ts (R2-R4)
- openspec/specs/team-content-access/spec.md (L191, L250-255)
- openspec/changes/archive/2026-10-08-208-member-admin-topic-writes/design-review-security.md (section 3 note, D-5)
- docs/deployment.md (audit sections ~L292-311, ~L390)
