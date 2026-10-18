# Security Design Review: 271-audit-log-reader-structural-test (#271)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewed:** `design.md`, `proposal.md`, `tasks.md`, the `team-content-access` delta, my D-5 note in the archived #208 `design-review-security.md`. Checked against `sessions/default-topic-maintenance.ts` (L620-700), `routes/content.ts` (~L1190-1210), `routes/__tests__/helpers/backend-sources.ts`, `packages/backend/package.json`, `.github/workflows/ci.yml`, and the current `team-content-access` spec.
**Verdict:** **Approve with changes.** The design is sound for what it actually targets: a literal-SQL reader in `packages/backend/src` with a bad `operation` filter. It does **not** close D-5 as I wrote it in #208 ("visibility guard enforced by review only"). It converts the "wildcard/prefix filter" half of the guard into a mechanical check and leaves the "who does this query serve" half to review, as before. The design is honest about that in D3, but the spec delta and the "Closes D-5" note are not. Items marked **[change]** I want in this change; the rest are decisions to record.

---

## 1. Does this close D-5?

D-5 said the guard holds by reviewer memory and an automated source scan would be worthwhile. After this change:

| Part of the guard | Before | After |
|---|---|---|
| A reader serving participants filters by single-name equality on a non-protected op | Review only (plus a string pin on one query) | **Mechanically enforced** for literal-SQL readers in `packages/backend/src` |
| A new reader exists at all | Review only | **Mechanically surfaced** (inventory), for statements the scanner recognizes |
| Whom a reader serves (admin vs non-admin) | Review only | **Review only** (`admin-only` is trusted) |
| Readers the scanner cannot see (views, functions, other packages, SQL built indirectly) | Review only | **Review only** |

So D-5 is **reduced and relocated**, not closed. I accept that as the right engineering trade, but the task 6.2 note on the archived #208 review must say "partially mitigated: mechanical for the filter rule; classification and invisible readers remain review/convention", not "D-5 closed". Do not let the issue's `Closes #271` flow through into a record that says the risk is gone. **[change]** reword 6.1/6.2 and the proposal heading "Closes security review D-5".

---

## 2. Bypass paths for the scanner

### B-1 (High, **[change]**): `admin-only` is keyed by the function that reads, not by who calls it

`readTemplateList` and `readTemplateHistory` are `export`ed. They read admin audit rows with `= ANY` and no column restriction on caller. The inventory classes them `admin-only` because `routes/admin-default-topics.ts` guards the route. Nothing checks that nothing else calls them. A developer who wants "last changed by" on the facilitator's topic screen imports `readTemplateList` from a non-admin route. The new test stays green: the touch is inventoried, the class is exempt, no new SQL exists. The data they return is maintenance rows (`topic.default_*`), which are not in the protected set today, but the class is a trust assertion that this design makes the sole exemption, so reuse of an exempt function is exactly the abuse case.

Ask: for each `admin-only` entry, add a mechanical **caller allow-list** (files that may import the function, e.g. `routes/admin-default-topics.ts` and the module's own tests). The scanner already walks the AST; an import/identifier check over `productionSources()` is a few lines and fails closed when a new file references the symbol. This turns "trusted, not verified" into "trusted for the reader, verified for the call sites", which is the part a static test can decide. If the team declines, record it in the proposal's Known limits as a named gap, not a silent one. Same applies to R1: `fetchConnectionRecoveries` is `exact-match` and safe by filter, so no caller check is needed there.

### B-2 (High, **[change]**): touch detection keys on the literal text `audit_log`

D2/D5 detect a touch when an SQL literal "references `audit_log`". Cases the design does not say it catches:

1. **Case.** Postgres folds unquoted identifiers, so `FROM AUDIT_LOG` and `Audit_Log` read the table. Detection must be case-insensitive. State it and add a fixture.
2. **Interpolated or assembled table name.** `FROM ${T}` where `T` is imported from another file, or built as `"audit" + "_log"`, or `["audit","log"].join("_")`. D5 fails when "the table name is not a literal", but the scanner cannot know the table name is the issue if the text `audit_log` never appears. Define the trigger positively: **any** SQL-looking literal (starts with SELECT/WITH/INSERT/UPDATE/DELETE/TRUNCATE/COPY/TABLE/MERGE, case-insensitive) with `FROM`, `JOIN`, `INTO`, `UPDATE`, `TRUNCATE`, `COPY` or `TABLE` followed by `${` or a non-resolvable substitution, fails as unclassifiable unless it resolves to a same-file literal. Today the repo has `${JOIN_LINK_ACTIVE_SQL}` and `LOCK_TEAM_TOPICS_SQL` fragments, so imported SQL fragments already exist as a pattern. A fragment from another file that contains `audit_log` is read by the *importing* file's statement. Either resolve imported string constants (cross-file, one hop) or fail the importing statement; the design as written does neither.
3. **A bare `"audit_log"` string anywhere else** (`const TABLE = "audit_log"`, an array of table names, `format('%I', ...)`). Cheap fail-closed tripwire: any non-comment string literal, template chunk, or identifier containing `audit_log` (case-insensitive) that is not a recognized touch or the column-listed INSERT is itself a finding. This costs nothing today because the only matches are comments and the writers.
4. **Constants substituted into the text.** D5 allows `${CONST}` of a same-file string literal. The scanner must substitute the constant value *before* touch detection and filter judgement, not just tolerate it. Say so, and add a fixture where the constant holds `audit_log`.
5. **Other SQL surfaces:** tagged templates, `.sql` files read at runtime via `readFileSync`, a query builder, `COPY audit_log TO`, `TABLE audit_log`, `LOCK TABLE`, `SELECT ... FROM ONLY audit_log`, `pg_dump` via a shell call. The verbs in D2 omit `COPY`, `TABLE`, `MERGE`, `LOCK`. Use the broader rule from item 3 and these fall out.
6. **File types.** `allBackendSources()` walks `.ts` only. A `.js`, `.mjs`, `.cjs` or `.sql` file under `src/` is invisible. The build is TypeScript so this is unlikely, but one `walk` extension is cheap, or add a one-line assertion that `src/` holds no other source extensions. At minimum, record it.

### B-3 (Medium, **[change]**): the SQL analysis method is unspecified

D7 says "AST scanner, not regex", but that applies to the TypeScript. D4's filter judgement is a parse of SQL text, and the design does not say how. This is where scanners get beaten. Specify the approach and add fixtures for:

- SQL comments `-- ...` and `/* ... */` hiding or imitating predicates (`WHERE operation = 'x' -- AND ...`, `/* OR */`).
- String literals containing keywords or parentheses (`metadata->>'k' = 'a OR b'`, `'(' `), dollar-quoted strings, `E'...'`.
- **Paren depth for OR.** "Any top-level OR" is ambiguous for `WHERE (operation = 'a' OR true)`. State that the operation equality must be a top-level AND conjunct of the WHERE, and any OR that is not strictly inside a different conjunct fails.
- **Alias binding.** `operation` unqualified is ambiguous when another table in the FROM also has an `operation` column; `x.operation = 'ok'` where `x` is not `audit_log`. Require that the alias in the predicate resolves to the `audit_log` alias in the same FROM, or that no other table in the statement exposes the column (the former is simpler).
- **Multiple reading statements.** `UNION`/`UNION ALL`, CTEs and subqueries each reading `audit_log`: every branch that reads the table must satisfy the rule, not "the statement" once. Fixture: one branch correct, one with no filter.
- Casts and parens around the literal (`operation = 'x'::text`, `operation = ('x')`): pass or fail, but decide.
- Multi-statement strings (`;`).
- `IS NOT DISTINCT FROM`, `= ANY(ARRAY['x'])`, `IN ('x')` with one item: all fail under D4 (no single-equality form). Say so, because a developer will hit `IN ('x')` first.

Prefer a **positive grammar** (the WHERE conjunct list must contain exactly one `operation = '<literal>'` conjunct, and every other construct that mentions `operation` fails) over a blacklist of bad forms. A blacklist (D4's long fail list) is the shape that leaks the first form nobody thought of; "the only accepted form is X" fails closed.

### B-4 (Medium, record or fix): invisible readers

- **Views, functions, triggers, RLS, materialized views in migrations.** A migration `CREATE VIEW audit_summary AS SELECT * FROM audit_log` plus an app query on the view is a full bypass; the app SQL never says `audit_log`. The proposal treats it as a noted gap. The detection is a text scan of `packages/backend/migrations/*.sql` (not `migrations-manual`) for `audit_log` in a `CREATE [OR REPLACE] VIEW|MATERIALIZED VIEW|FUNCTION|POLICY|TRIGGER` body, with an inventory like the TS one. Existing migrations touch `audit_log` only in DDL (8, 16, 22, 23); this is a small test. I would put it in this change; if declined, it belongs among the filed follow-ups, not the "noted in header only" list. A bypass that needs only a normal migration PR is more likely than most items on that list.
- **New packages.** The scanner root is `packages/backend/src`. `packages/` holds `backend`, `frontend`, `shared` today. Make the test fail closed when a new directory appears under `packages/` that is not in a known list (one assertion), instead of relying on a developer reading a header note. **[change]**, trivial.
- **Dynamic `db.query` wrappers.** Anything that forwards a SQL string passed from another module (D5 handles identifiers resolving in-file; confirm that a function parameter `sql: string` forwarded to `db.query` is flagged only if it is a literal containing `audit_log`, which it is not). This is the same B-2 class; the positive rule in B-2.3 covers it for callers that spell the table.

### B-5 (Low): the scanner root and what "production" means

`productionSources()` excludes any path containing `__tests__/` or ending `.test.ts`. A production module placed under a `__tests__` directory is skipped entirely. Practically unlikely, but it is a trivial hiding place with no review signal. Add an assertion that no non-test import graph reaches a `__tests__` file, or simply that no file outside `.test.ts`/helpers in `__tests__` is imported by production sources. The existing limiter import-graph test is a precedent. Low, record if not fixed.

---

## 3. The trusted-not-verified `admin-only` class

D3 is candid, and I accept human review of the classification in principle. Three things around it are weaker than the text suggests:

1. **B-1 above.** The exemption covers a function, not its callers.
2. **The reason is free text, non-blank only.** The design says the reason "names the constant or operation and the route's admin check" (procedure step 2) but the test checks only non-blank. A reason of "x" passes. I accept "quality is human review" (M4), but the cheap mechanical check is to require the reason to contain the name of an existing source file that the scanner can confirm contains an `application_admin` check, or at least to require a `guardedBy: "<file>#<symbol>"` field and assert that the file exists and mentions `application_admin`. It would not prove correctness, but it makes a drive-by `admin-only` entry cost a visible, falsifiable claim instead of a sentence. If declined, say plainly that the exemption is a free-text assertion.
3. **The admin-only class has no protected-operation or scope constraint at all.** An `admin-only` reader of `admin.topic_config_accessed` is the intended shape; but nothing distinguishes "reads admin rows for admins" from "reads everything for everyone" except the sentence. Fine for now; B-1 is the compensating control worth building.

**Approval is by convention.** I have read the "no CODEOWNERS" statement. As the person named as reviewer, I am recording: I am not a gate, I do not receive notification of PRs, and a reviewer role without a mechanism will not be exercised on a busy week. The proposal is honest about it. I would take a one-line `.github/CODEOWNERS` entry for the test file and scanner (`@<security-team>`) as the cheapest real gate, and I recommend it be done here rather than left as an unfiled idea. If the team cannot name a handle, record that as an open decision with an owner, not a limit.

---

## 4. Protected-operation set versus the spec's Audit visibility guard

The spec guard protects: `admin.topic_config_accessed`, `topic.config_list_denied`, and historical `admin.topic_config_denied`. The design protects: any `admin.` prefix plus the two exact names. That is a **superset** of the spec, which is correct (the historical `admin.topic_config_denied` and `admin.session_content_denied` fall under the prefix). Confirmed consistent. Remaining points:

- **P-1 (Medium, decision to record):** `topic.config_list_denied` is protected by exact name only, and D6 deliberately lets `topic.config_other` pass. The spec's own phrase is `admin.topic_config_*` for the admin side but exact for the topic side, so a future sibling denial row (`topic.config_*_denied`) would be unprotected and an exact-match reader of it would pass. No reader needs any `topic.config_` operation. Protect the prefix `topic.config_` and fail closed; the near-miss fixture then asserts a *different* near-miss (`topic.configure`). The cost is zero today.
- **P-2 (Medium, decision to record):** the protected set is a hard-coded list that is not tied to what the audit logger can emit. Add a test (a few lines) that extracts audit operation literals written by the existing writers and checks that every literal starting `admin.` or `topic.config_` is covered by the protected predicate. It is a check that the constant did not drift from the writers, and it needs no new scanning machinery beyond the operation-literal extraction.
- **P-3 (Medium, decision to record): what the guard does not cover but D-5 implies.** The spec's concern is audit data about admins' access. Rows that identify admin actors in other forms (`topic.*` write rows by an admin, `topic.default_*` maintenance rows, `team.role_changed`, `auth.*` sign-in rows with `actor_ip` and `actor_roles`) are not protected and an `exact-match` entry on them passes. That is consistent with the spec as written. But the exact-match class permits **any** non-protected operation with **any** scope, so the real protection of those rows is the reason text plus review. This is the same gap as the `SELECT *` follow-up, and it is bigger than that follow-up states: a non-admin `exact-match` reader on `auth.*` returns other people's IPs even with explicit column listing. The proposal files only `SELECT *`. Widen the follow-up to "column-level and scope-level (team_id / scopeId) check for non-admin readers", because the leak is not only `metadata`.
- **P-4 (Medium, **[change]**): scope is not checked.** An `exact-match` reader passes if it filters `operation = 'session.connection_recovered'` and nothing else. R1 additionally filters `metadata->>'scopeId' = $1` (session) and the session is reached via facilitator history. A reader copy-pasted without that predicate returns every team's connection recoveries to any facilitator. This is a cross-tenant leak that the test blesses. The minimal fix is to require, for `exact-match`, that the WHERE also contains a `team_id = ...` or `metadata->>'scopeId' = ...` conjunct (any value, including `$n`), and declare an explicit entry flag for the rare legitimately global reader. If not done, record in Known limits that exact-match does not guarantee row scoping.

---

## 5. Allow-list (inventory) abuse

D1 is the right call (inventory over exceptions). The abuse paths:

- **Function-level key (Known limits).** A new statement inside `readTemplateHistory` or `fetchConnectionRecoveries` is covered by the existing entry. For `exact-match`, the filter judgement still runs on every statement, so a *new* statement in an `exact-match` function is checked. Confirm that: the judge must run per statement, not per entry. For `admin-only`, a new statement is silently exempt, including one that reads protected rows and returns them from a function that is imported elsewhere (see B-1). Key `admin-only` entries by statement count or by a statement fingerprint (hash of the normalized SQL), so a new or edited statement forces a review. Low cost: the scanner already has the text.
- **Reclassification diff.** Changing `exact-match` to `admin-only` on an existing entry is a one-word change that removes all mechanical checking. It is visible in a diff but is the cheapest abuse in the design. Add the entry class to a snapshot (a small expected-classes table in the test that must match), so a class change is a second edit the reviewer sees in a different place.
- **Rename to evade.** Function-keyed stale+uninventoried failures fire on rename (D8), good. An arrow function assigned to a `const` inside an object, or a class method, needs defined keys: specify the naming for anonymous functions, methods, and module-top-level statements. An unnamed enclosing scope must have a deterministic key or the statement fails as unclassifiable.
- **Shadow entries.** Inventory entries are keyed by `file#function`; if two functions in a file share a name (overloads, nested functions), the key collides. TypeScript object-literal keys catch exact duplicates, but not a nested function with the same name. State that duplicate keys fail.
- **D9 holds**: false positives are fixed in the scanner, no env var, no skip. The grep for `process.env` and `.skip` is a one-time check (task 2.5). Make it a standing assertion inside the test (read its own source and the scanner's, fail on `process.env`, `.skip`, `.only`, `describe.runIf`, `skipIf`) so a later edit cannot add one. Cheap, and the existing structural tests set the precedent of testing their own sources.

---

## 6. Fail-closed behavior

Good, to be kept:

- Unclassifiable statements fail (D5); UPDATE/DELETE/TRUNCATE fail (D2); stale entries fail; non-vacuity asserts specific readers by name (D8).

Gaps:

- **F-1 (Medium, **[change]**): scanner failure modes.** State what happens when a file does not parse (TypeScript's `createSourceFile` is tolerant and returns a tree with errors; the scanner then silently sees garbage). A syntactically broken file should fail the test, not be skipped. Add `parseDiagnostics` checking or an explicit "no diagnostics" assertion.
- **F-2 (Low): zero files scanned.** D8 covers it only through the named readers. Add `expect(productionSources().length).toBeGreaterThan(N)` style sanity too; D8 would already fail, so this is belt and braces for a clearer message. Optional.
- **F-3 (Medium, decision to record): the CI claim.** Task 5.1 verifies the file is under `npm test`. The workflow runs `test:coverage -w packages/backend`, and the vitest config excludes `__tests__` from coverage only, not from running. Fine. But a one-time manual injection proof is not a standing guard: nothing prevents a later change to `vitest.config.ts` `include`/`exclude` from dropping the file, or the `test` job from being made non-required. Say in the PR whether the job is a required status check on `main`; if it is not, the whole control is advisory, and that should be written next to the "approval by convention" limit.
- **F-4 (Low): runtime ceiling of 5 seconds** is a good fail-closed-ish choice only if exceeding it is not "fixed" by narrowing the scan. Say so.

---

## 7. The spec delta weakens the requirement (**[change]**)

The existing guard sentence is an obligation on the system: "no application query that serves a non-administrator caller SHALL select from `audit_log` using a wildcard, prefix, pattern, or `IN` list on `operation` ... Every such query SHALL filter `operation` by equality on a single named operation." The delta **replaces** that obligation with a description of what the test enforces and an explicit statement that the test cannot know whom a query serves. The result is that the normative text now covers *less* than before: the MUST on non-admin queries is gone, and the surviving MUST ("SHALL NOT be exposed through any endpoint or screen") has no checkable definition. A spec should state the obligation; a test provides evidence for it. Keep the original obligation sentence, **add** a sentence that says the structural test mechanically verifies the filter-shape portion and that classification of who a query serves, and queries it cannot see (views, functions, other packages), are verified by review. The proposal's own reasoning ("the old wording is something a test cannot decide") is an argument for adding honesty, not for dropping the requirement. This also keeps the spec from being cited later as "the test passes, therefore the requirement is met".

Also: the scenario that replaces the old "every query that serves a non-admin caller" scenario should be reviewed for the same effect; I would keep both scenarios (the old behavioral one and the new structural one).

---

## 8. Deferred or implicit security decisions

| # | Decision | State | My position |
|---|---|---|---|
| S-D1 | `admin-only` exemption covers callers | Implicit (function-keyed) | **Change**: caller allow-list (B-1) or record as named gap |
| S-D2 | Detection depends on the literal `audit_log` | Implicit | **Change**: positive trigger and tripwire (B-2) |
| S-D3 | SQL parsing method | Unspecified | **Change**: specify, positive grammar, fixtures (B-3) |
| S-D4 | Views/functions over `audit_log` | Deferred (header note) | Add the migration scan here, or file a follow-up (B-4) |
| S-D5 | New package under `packages/` | Deferred (header note) | **Change**: one assertion on the package list |
| S-D6 | Gate is a role by convention, no CODEOWNERS | Explicit | Acceptable only with an owner named for adding CODEOWNERS; I recommend doing it here |
| S-D7 | `exact-match` does not check row scope or columns | Implicit (scope) / explicit (`SELECT *`) | **Change**: scope conjunct (P-4); widen follow-up (P-3) |
| S-D8 | `topic.config_*` siblings unprotected | Explicit in D6 | Recommend prefix protection (P-1) |
| S-D9 | Protected set not tied to emitted operations | Implicit | Add drift test (P-2) |
| S-D10 | Spec obligation replaced by test description | Implicit | **Change** (section 7) |
| S-D11 | "Closes D-5" overstated | Explicit | **Change**: mitigated, not closed (section 1) |
| S-D12 | Test is only as binding as CI branch protection | Implicit | State in the PR (F-3) |
| S-D13 | R1 returns `actor_user_id` + timestamp to the facilitator | Raised to product owner | Agreed it is not a test gap. It is a privacy decision and I want the product owner's answer recorded, since it is a per-person signal. No action here |

## 9. Summary of asks

| ID | Severity | Ask | Blocking? |
|---|---|---|---|
| B-1 | High | Caller allow-list for `admin-only` functions (or record as named gap) | Yes unless recorded |
| B-2 | High | Case-insensitive detection; positive trigger for unresolved table names; tripwire for any other `audit_log` literal; substitute same-file constants before detection; broaden verbs | Yes |
| B-3 | Medium | Specify SQL analysis; positive grammar; fixtures for comments, quotes, paren depth, alias binding, UNION/CTE branches | Yes |
| P-4 | Medium | Require a scope conjunct for `exact-match` or record as limit | Yes unless recorded |
| Sec. 7 | Medium | Keep the original obligation in the spec; add verification wording | Yes |
| Sec. 1 | Medium | Reword "Closes D-5" to "mitigated, residual stated" in proposal and 6.2 | Yes |
| F-1 | Medium | Fail on files with parse diagnostics | No |
| B-4 | Medium | Migration view/function scan, or file a follow-up; fail on unknown `packages/*` | No (package assertion: do it) |
| P-1, P-2 | Medium | Protect `topic.config_` prefix; protected-set drift test | No |
| P-3 | Medium | Widen the follow-up beyond `SELECT *` | No |
| Sec. 5 | Low-Med | Statement fingerprint for `admin-only`; class snapshot; standing no-skip assertion; key naming rules | No |
| S-D6 | Low | CODEOWNERS entry now, or a named owner and date | No |
| B-5, F-2, F-3, F-4 | Low | As described | No |

I will re-review the revised design for B-1 to B-3, P-4, and the spec wording; the rest I will take on the author's recorded decision.

— Tomás Ferreira
