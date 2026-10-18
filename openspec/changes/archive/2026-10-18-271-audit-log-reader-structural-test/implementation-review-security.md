# Security Implementation Review: 271-audit-log-reader-structural-test (#271)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Covers:** tasks 1.8 (grammar, caller check, scope rule, spec wording), 5.5 (failure messages read cold), 5.6 (final re-review).
**Reviewed:** `helpers/audit-log-reader-scanner.ts`, `audit-log-reader-structural.test.ts`, `design.md`, my `design-review-security.md`, the spec delta, `docs/deployment.md` and archived #208 note diffs.
**Method:** throwaway vitest probe over about 75 SQL and TypeScript shapes against `scanSource` + `judge`, plus four temporary files injected into the real `src/` tree and run through the real test. All probes and injected files were removed; `git status` afterward shows only the original six entries and `git diff --stat` shows only the pre-existing three modified files (no edits to production or test files by me).

**Verdict: Approve with one non-blocking-by-me but recommended fix (X-1/X-2, two caller-check bypasses) and header wording changes. D-5 is mitigated as the proposal claims ("mitigated, not closed"), with the caveat that the admin-only caller check is weaker than the spec scenario's sentence reads.** No blocking findings.

---

## 1. Bypass attempts

### Held (fails closed or is correctly classified)

| Probe | Result |
|---|---|
| New reader in a new file with `LIKE 'admin.%'` (injected into real tree) | Real test fails: `uninventoried-touch` with the SQL quoted. |
| Same reader added to an inventoried function name | Fails via grammar: `operation-form`. |
| No operation filter | `operation-missing` |
| Comment-hidden predicate (`-- AND operation = ...`, `/* ... */`) | `operation-missing` (comments stripped before judging) |
| `OR true` top level; `(operation = 'x' OR true)` | `or-in-where`; `operation-form` |
| `= ANY($2)`, `IN ('x')` (single item), `NOT`, `lower(operation)`, `operation::text`, `starts_with(...)`, quoted `"operation"` with wrong form | `operation-form` / pass only for `"operation" = 'x'`, which is equivalent |
| Alias confusion (`b.operation = ...` where `b` is not the table) | `operation-form` |
| Duplicate operation predicate (`operation='ok' AND operation='admin.x'`) | `operation-duplicate` |
| Subquery, `UNION`, CTE, comma FROM, `NATURAL JOIN`, `LIMIT (SELECT ...)`, `INSERT ... SELECT ... FROM audit_log`, `VALUES ((SELECT ... FROM audit_log))` | `shape` (single SELECT, no JOIN/WITH/UNION) or `uninventoried-touch` |
| Protected literal (`admin.topic_config_accessed`, `admin.zzz`) | `protected-operation` |
| `FROM AUDIT_LOG` | Detected (case-insensitive); judged normally |
| `FROM "Audit_Log"`, `other.audit_log`, `format('%I','audit_log')`, `to_jsonb(audit_log)` | `tripwire` (fails closed) |
| `const T="audit_log"` then `"... FROM " + T` or `${T}` | `tripwire` plus `concatenation`/grammar finding |
| Imported `${T}` in table position | `unresolved-table` |
| `"audit" + "_log"`, `["audit","log"].join("_")` | `concatenation` |
| Same-file const fragment `FROM audit_log` spliced via `${FRAG}` | Substituted before detection; caught |
| `TABLE audit_log`, `SELECT ... INTO x FROM audit_log`, `ALTER TABLE audit_log`, tagged template, `;`-separated, `$$..$$`, `E'..'` | `shape` / `non-read` / `tagged-template` / tokenizer codes |
| Reader as class arrow property (no named ancestor) | `anonymous-function` plus uninventoried |
| Real tree: non-admin file importing `readTemplateList` | `caller-mismatch` naming both files |
| Real tree: `export const TBL = "audit_log"` in a new file | `tripwire` with a message that tells you to inline the table name |
| Real tree baseline | 215 tests pass |

The positive grammar does what B-3 asked. The B-2 items (case, constants substituted before detection, tripwire, extended verbs) all hold. B-1 is implemented but see X-1 and X-2.

### Bypasses found

**X-1 (Medium, recommended fix): wrapper in the defining file defeats the caller check.** `findReferences(name, files, definingFile)` skips the defining file entirely. Appending `export function leakWrap(db, t) { return readTemplateList(db, t); }` to `sessions/default-topic-maintenance.ts` and importing `leakWrap` from a non-admin route leaves the whole test green: no new `audit_log` statement (count unchanged), the only reference to `readTemplateList` outside the defining file is still the admin route. I confirmed this in the real tree. It is the same abuse case as B-1 (reuse of an exempt reader by a non-admin route), one hop removed. Cheapest mitigation: in `findReferences`, also count references to `name` inside the defining file that sit in an exported function other than `name` (or: fail if an exported symbol of the defining file other than the entry's functions contains the identifier). If not fixed, the header's limits must say the check does not follow wrappers.

**X-2 (Low-Medium): string-keyed property access is invisible to `findReferences`.** `import * as m from "..."; m["readTemplateList"]()` (or a dynamic `import()` with bracket access) is not an `Identifier`, so it is not found. Confirmed green in the real tree. Fix is two lines (also match `StringLiteral`/`NoSubstitutionTemplateLiteral` equal to `name` in element access). Same header remedy if declined.

Neither X-1 nor X-2 is an attack on the filter rule itself; both relocate to "admin-only is trusted", which the design already names. They are blocking only if the team wants the spec scenario's sentence ("each `admin-only` function is referenced only from the files its entry lists") to be literally true. As written that sentence overstates: it is true for direct, named, dot or import references from other files. See Section 3.

### Residual limits I confirmed are real and honestly stated

- In-place edit of an admin-only statement is not detected (count only). Stated.
- Imported SQL fragment `${FRAG}` that spells `audit_log` but is spliced outside table position (e.g. `SELECT 1 ${FRAG} WHERE 1=1`): scanner sees nothing. Header lists "SQL assembled from fragments none of which spells `audit_log`", which covers it; the wording could say "an imported fragment" explicitly, since that is the more likely real-world form.
- `exact-match` passes `SELECT *` and a constant scope (`team_id = 1`), and `HAVING ... OR` after GROUP BY. Scope-value and column checks are stated as limits and deferred to #312.
- A function that mixes shapes is admin-only as a whole (R3). Stated.
- A file under `__tests__/` is skipped by `productionSources()`. Stated.

## 2. Failure messages, read cold (task 5.5)

I read the real messages produced by two injected readers and the caller-mismatch case without the exploration notes. Each message names the rule, `file#function` and line, quotes the offending SQL, states why, says what to do, and cites the header step. After reading, I could say what to do next in each case (inventory it with an `EXACT_MATCH` entry in the accepted form, or inline the table name for a tripwire) without asking anyone.

Non-blocking wording notes:
- For `uninventoried-touch`, the "what to do" begins with the exact-match recipe and mentions `ADMIN_ONLY` only as a trailing clause. A developer who wrote an admin reader will read the first sentence and may try to force it into the grammar. Lead with the decision ("who does this reader serve?") the way header step 1 does.
- No message says approval is by convention (header step 3). One clause ("then ask for a Security Analyst review") would stop a self-merged inventory edit.
- The tripwire message fires twice for one cause when a constant holds `audit_log` and is also used (string-value tripwire plus the dependent finding). Acceptable; both point to the same fix.

Pass for 5.5, with those suggestions.

## 3. Spec, header and docs wording (task 5.6)

- The original guard obligation sentence is preserved and the verification paragraph is added; it states plainly that the test does not establish the obligation. This answers my Section 7 objection. Good.
- The new scenario's last-but-one clause, "each `admin-only` function is referenced only from the files its entry lists", is stronger than the implementation (X-1, X-2). Recommend "...is referenced by name only from..." or fix X-1/X-2.
- "Verification of the guard" says Security Analyst by convention and no CODEOWNERS. Consistent with the header. No handle was supplied; this remains an open decision recorded in the proposal. Acceptable as stated.
- Header "Known limits" is thorough and honest. Add two bullets: the caller check does not follow wrappers or string-keyed access (until X-1/X-2 are fixed), and an imported fragment is a named instance of the fragment limit.
- `docs/deployment.md` sentence is accurate and scoped ("Database and log-sink operators are outside its scope").
- Archived #208 note says "partially mitigated", names the residuals, and cites #312. Meets my D-5 ask. It does not say "closed".
- Protected set follows my P-1 (prefix `topic.config_`). Scope conjunct (P-4) is implemented as a presence check, with the value-correctness limit stated.

## 4. Is D-5 mitigated as claimed?

Yes. D-5 was "visibility guard enforced by review only". Now:

- A new reader of `audit_log` anywhere in `packages/backend/src` production TypeScript, in any literal form the scanner can see (including case variants, constants, schema qualification, concatenation, tagged templates), fails until inventoried. Confirmed by injection.
- A non-admin reader that filters `operation` by anything other than `= '<one non-protected literal>'`, or lacks a scope predicate, or uses JOIN/CTE/subquery/UNION/OR, fails. Confirmed by probe.
- Admin-only readers are verified for direct callers by name and statement count (X-1/X-2 gaps noted), and trusted for the rest.
- What the test does not establish is stated in three places (header, spec paragraph, #208 note) and matches what I found. No residual I found is missing from the stated list apart from X-1, X-2 and the "imported fragment" example.

It is a mistake-catcher, not a control against an adversarial developer, and the documents say so. The control is advisory unless the `test` job is a required check, and no CODEOWNERS exists; both are disclosed.

## 5. Summary

| ID | Severity | Finding | Blocking? |
|---|---|---|---|
| X-1 | Medium | Wrapper in the defining file bypasses the admin-only caller check | No; fix or add to header and soften spec clause |
| X-2 | Low-Medium | `m["readTemplateList"]` bypasses `findReferences` | No; fix or state |
| W-1 | Low | Spec scenario "referenced only from" overstates the check | No; reword |
| W-2 | Low | Header: name wrapper/string-key and imported-fragment limits | No |
| W-3 | Low | Lead `uninventoried-touch` message with the admin-vs-non-admin decision; mention review | No |
| Tasks | | 1.8, 5.5 and 5.6 may be checked off on my side once W-1/W-2 are done (or X-1/X-2 are fixed) | |

Nothing here needs a second pass from me if X-1/X-2 are either fixed with a fixture each or recorded in the header.

— Tomás Ferreira
