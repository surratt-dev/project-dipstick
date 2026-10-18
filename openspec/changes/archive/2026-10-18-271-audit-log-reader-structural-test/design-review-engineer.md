# Design review (engineering): 271-audit-log-reader-structural-test

Reviewer: Marcus Oyelaran (Full Stack Engineer). Inputs read: design.md, proposal.md, `template-writer-scanner.ts`, `template-writer-structural.test.ts` pattern, `backend-sources.ts`, `team-not-found-envelope-structural.test.ts`, and every non-test `audit_log` string in `packages/backend/src`.

## Verdict

Implementable and the shape is right (pure AST scanner + inventory test, same house style, no new dependency; `typescript` is already a root devDependency). But the design is **wrong about the writer set**: one real production writer is a touch under D2 and is not in the inventory, so the test as specified fails on day one with no legitimate class to put it in. Several scanner rules (D4/D5) also lack a stated mechanism and have holes. Fix the blockers below before tasks are cut.

## Blockers

### B1. `auth/fail-open-topic-audit.ts` is an INSERT...SELECT writer and breaks the test as written

`FAIL_OPEN_TOPIC_AUDIT_INSERT_SQL` (module-level exported const, line 32) is:

```
INSERT INTO audit_log (cols...) SELECT $1::uuid, ... u.roles::text[]
FROM (SELECT 1) s LEFT JOIN users u ON u.id = $1::uuid RETURNING actor_roles
```

D2 says a touch is any reference other than a column-listed `INSERT ... VALUES`, and "INSERT...SELECT" is explicitly a touch. So this writer is an uninventoried touch. It cannot be `exact-match` (there is no `audit_log` read, no WHERE, no operation filter) and `admin-only` would be a false label. Its enclosing key would be `auth/fail-open-topic-audit.ts#<module>` (the SQL is a module const executed elsewhere, so there is no function name to key on). Proposal line 14 ("every column-listed INSERT...VALUES writer produces zero findings") is true but is not the whole writer population. Every other writer (about 45 sites; `SIGN_IN_AUDIT_SQL` in routes/auth.ts is an object of two column-listed VALUES literals) is VALUES-shaped.

Fix: define a writer as a column-listed INSERT whose row source is VALUES **or a SELECT that does not itself reference `audit_log` in a table position**. Touch status is then decided by "does `audit_log` appear in a table position anywhere other than the INSERT target". That also correctly catches `INSERT INTO audit_log (cols) SELECT ... FROM audit_log` (a real read). Add fixtures: this exact shape (pass, no touch) and the self-reading variant (touch). State the pass condition as "all production writers", not "VALUES writers".

### B2. D2/D5 do not say what makes a string literal a "touch"; prose in strings will false-positive

D7 correctly moves to AST because comments mention `audit_log` constantly (about 100 hits). But string literals can too (log messages, error text such as "audit_log write failed"). Today there are none outside SQL, but the first one added would be a touch that is also unclassifiable, i.e. a test failure the developer cannot fix except by hacking the scanner. Define a touch as: the literal contains `audit_log` as a whole word (not `audit_logs`, `audit_log_x`; allow `"audit_log"` and `public.audit_log`) in a **table position** (after FROM, JOIN, INTO, UPDATE, TRUNCATE [TABLE], ONLY, or a comma in a FROM list, e.g. `FROM users u, audit_log a`). Prose that merely mentions the word is ignored. Add fixtures for the prose string, `audit_logs`, `audit_log_archive`, and the comma-join.

### B3. D4 requires a WHERE-clause analyzer but never says how it is built

"The WHERE of the statement that reads audit_log", "top-level OR", "only in HAVING or a JOIN ON", "wrapping of the column" all need statement and clause structure. There is no SQL parser in the repo and none should be added. The only workable approach is a small tokenizer with paren-depth tracking, and it has to be specified because it is where the bugs will be:

- Tokenizer must strip SQL comments (`--`, `/* */`) and respect quoted strings (`'it''s'`), quoted identifiers, `E'...'`, `U&'...'` and `$$...$$`. Without this, `-- operation = 'session.x'` inside the literal satisfies the pass rule. Add that as a fixture; it is the cheapest bypass. Simplest rule: any `E'`, `U&'`, or dollar-quote inside an `exact-match` literal fails as unclassifiable.
- The `operation = '<lit>'` predicate must be at paren depth 0 of the WHERE (an `EXISTS (... operation = 'x')` or `(operation='x' OR y)` must not count).
- Reject UNION / INTERSECT / EXCEPT, CTEs and subqueries over `audit_log` for `exact-match`. Say `exact-match` is only defined for one flat `SELECT ... FROM audit_log [alias] [JOIN ...] WHERE ...`; anything fancier is unclassifiable and goes to the `admin-only` conversation. This removes most of the grammar.
- State the per-entry semantics: every `audit_log`-touching literal in an `exact-match` function must pass independently. A mixed function (R2 has one `= ANY` and one literal-equality statement) must be `admin-only` as a whole; the literal-equality statement in it is then unchecked. The design should say so in D3 so nobody expects R3 to be verified.

I would size the tokenizer plus clause splitter at roughly 150 lines, not "small". The two-day effort bound is plausible but this is the bulk of it.

## Verification of filter rules against the real readers

| Reader | Statement shape | Rule outcome | Matches design? |
| --- | --- | --- | --- |
| R1 `content.ts#fetchConnectionRecoveries` | flat `SELECT ... FROM audit_log WHERE operation = 'session.connection_recovered' AND metadata->>'scope' = 'session' AND metadata->>'scopeId' = $1` | passes D4 (unaliased column, literal, AND-only). The `=` inside `metadata->>'scope' = 'session'` is not an operation predicate; the scanner must key on the identifier `operation` (optionally `x.`-qualified), not any `=`. Value is not protected. | Yes |
| R2 change query `readTemplateList` | `a.operation = ANY($2::text[])` | fails D4 (`= ANY`), so function must be `admin-only` | Yes |
| R3 reorder query (same function) | `operation = 'topic.default_reordered'` plus `team_id = $1` | would pass on its own; unchecked because the entry is function-level `admin-only` | Yes, but see note above |
| R4 `readTemplateHistory` | `a.operation = ANY($2::text[])` | fails D4, `admin-only` | Yes |

Context errors: D5 says R2's `${MAINTENANCE_AUDIT_OPERATIONS}`-style interpolation is allowed for touch detection. R2 and R4 do **not** interpolate; the constant is passed as a bound parameter and the SQL has no `${}`. The pass-case fixture for D5(a) is still worth having, but do not cite R2 as the motivating example. Also, in the Context paragraph, the non-admin reader count is right (R1 only).

Writers verified: all multi-line `INSERT INTO audit_log\n (cols)` forms exist (about 40), so the "column-listed" detection must allow arbitrary whitespace and newlines between the table name and `(`. Add a fixture for the newline form; it is the dominant real shape.

## Smaller issues

1. **D5(c) is unimplementable as stated.** "SQL passed from an identifier that does not resolve to a literal in the same file" requires knowing which call arguments are SQL. The real `.query(identifier, ...)` sites are `FAIL_OPEN_TOPIC_AUDIT_INSERT_SQL`, `LOCK_TEAM_TOPICS_SQL`, `SNAPSHOT_SQL`, and `SIGN_IN_AUDIT_SQL[operation]`; the literals are scanned at their definitions anyway, so the identifier route adds nothing. Drop (c). Record in the header limits that SQL assembled across files (`+`/`concat` on non-literals, or a helper in another file) is a known blind spot, and keep (a) (`${}` of non-constants) and the concat check, which are decidable per literal.
2. **D5(b) wording is confusing.** `$1`-style placeholders are not template substitutions (`${}`), so they never reach the check. Delete (b) or reword to "a literal containing `$n` is fine".
3. **Hidden coupling / duplication with `template-writer-scanner.ts`.** The new scanner needs `literalText`, `functionLabel`, `enclosingFunction` exactly as the existing one defines them (including the `route <VERB> <path>` label and `<module>`). Those are unexported there. "Beside, not refactored" will mean copy-paste and two labelers that drift. Recommend adding `export` to those three (zero behavior change, the existing tests still guard it) rather than copying. If you refuse to touch the file, say that duplication is accepted and add a fixture pinning label format. Note the keys `<module>` and `route GET /x` must be allowed in inventory keys; document that.
4. **Function-keyed ambiguity.** Two same-named functions in one file (nested helpers, or two arrow handlers named by a variable) collapse to one key. Acceptable, but the stale check should key on (file, function) set, and the duplicate-label case should be a documented limit.
5. **Parse failures are an unspecified error path.** If a source file has syntactic diagnostics (`sf.parseDiagnostics`), the scanner must throw naming the file, never silently skip. Also guard the walk: the non-vacuity check (D8) covers an empty source set, but say that `productionSources()` returning zero files with `audit_log` fails with a message about `BACKEND_SRC`.
6. **Performance.** Prefilter on `text.includes("audit_log")` before creating a SourceFile AST (the existing scanner parses everything; here about 25 files qualify). That makes the 5-second ceiling trivially safe.
7. **D6 interaction with `= $n` rule.** Fine and consistent: `operation = $1` fails, so protected-value checks only ever see literal operations. Confirm the protected check also runs on `admin-only`? No (trusted). Say so explicitly so a reviewer does not assume protected values are scanned there.
8. **Case and quoting.** D4 says "any keyword case, quoted"; `AUDIT_LOG` as table name is unquoted-case-insensitive in Postgres but `"AUDIT_LOG"` is a different table. Specify: unquoted match is case-insensitive, quoted match is exact-lowercase only.
9. **Test layout.** Put the scanner at `routes/__tests__/helpers/audit-log-reader-scanner.ts` and keep the inventory data in the test file (as designed). `admin-only`/`exact-match` as a string-literal union keeps duplicate/unknown-class checks in the type system, as the proposal says; make the inventory a `Record<string, {class, reason}>` keyed by `file#function` so duplicates are a compile error.
10. **Self-test count.** D4 + D5 + D6 + the new B1/B2/B3 fixtures is on the order of 35 to 40 fixture cases. Each is tiny, but plan tasks around a table-driven `it.each`, as the existing structural test does, so the file stays readable.

## What is good (keep)

- Inventory-over-allow-list with the deviation recorded (D1).
- Honest guarantee statement (D3) and "fix the scanner, never the inventory" (D9).
- Non-vacuity by named reader, not count (D8).
- Failure-message substring assertions (D10).
- Rules living in the test header, not the spec (D11).

## Requested changes summary

1. Redefine writer vs touch (B1) and add the fail-open INSERT...SELECT fixture; fix the proposal's pass-condition sentence.
2. Define table-position detection and ignore prose strings (B2).
3. Specify the tokenizer, depth-0 rule, comment/quote handling, and flat-SELECT-only scope for `exact-match` (B3).
4. Drop D5(c), fix D5(b), correct the R2 interpolation claim.
5. Decide export-vs-duplicate for the shared scanner helpers.
6. Add parse-failure and empty-source error paths.
