# Implementation Review — Security

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** Shipped SQL and test coverage for `phantom-em-relationship-detection`, checked against my own Decision 8 and Decision 9 resolutions in `design.md`. Read the actual files, not the design doc's description of them.

**Verdict: Approved.** Both of my design-stage decisions are implemented exactly as resolved, the one correctness property this whole change exists to get right is intact, and the append-only invariant holds. One new finding below — not a blocker, a hardening recommendation surfaced only now that real SQL exists to look at.

---

## 1. Decision 8 — actor identity for script-generated audit rows

Checked against `packages/backend/migrations-manual/8_phantom_em_annotate.sql`, all four mechanical requirements:

- **Existence guard, first.** Lines 60–64: `\if :{?operator_user_id}` / `\else` `\echo ERROR...` `\quit` / `\endif`, ahead of every other statement. Correct psql syntax (`:{?name}` is the defined-test form), correct placement.
- **Quoted-literal substitution everywhere.** Grepped both shipped files for every occurrence of `operator_user_id` and `actor_global_role`: line 72 (`:'operator_user_id'`, identity echo), line 91 (`:'operator_user_id'::uuid, :'actor_global_role'`, the INSERT). Zero bare-form occurrences (`:operator_user_id` / `:actor_global_role` without the surrounding quotes) anywhere in either file. The bug both Marcus and I flagged at design review — bare substitution in the original Decision 6 draft — is not present in the shipped SQL. No regression.
- **Identity-echo check, correctly ordered.** Lines 70–72, after the environment sanity check (lines 66–68) and before the guarded INSERT (line 74 on) — matches the statement order I specified: `\if` guard → environment check → identity echo → INSERT.
- **Fixed `actor_global_role` literal.** The value `'system:production_data_engineer'` appears correctly in the header's copy-pasteable invocation (line 18) and in `query-result.md`. See the finding below, though — "fixed" in the header is not "fixed" in the SQL.

**Test coverage for this decision** (`phantom-em-relationship-detection.test.ts`): the suite doesn't directly test the `\if` guard's refusal path (no test invokes the annotate script without `-v operator_user_id`), but it does exercise the full happy path with a real operator UUID and confirms the identity-echo query's target row exists (fixture users created in `beforeAll`, lines 90–106). The missing negative-path test (guard refusal) is a gap, not a defect — the guard's logic is simple enough (`\if`/`\else`/`\quit`) that I'm not blocking on it, but I'd rather see it than infer it.

## 2. The `operation = 'team.role_changed'` filter — the one property this change exists to get right

Re-verified directly against the shipped SQL, not the inline comment's claim:

`8_phantom_em_annotate.sql:101` — `WHERE al.operation = 'team.role_changed'` — present, unchanged, exactly as I required at design review (Decision 5).

Confirmed this is load-bearing, not decorative, via the test fixtures rather than trusting the comment:
- Fixture 3 (`test.ts:139–151`) inserts a `team.role_change_denied` row with **identical metadata shape** (`from_role: participant`, `to_role: engineering_manager`) and, deliberately, a **pre-cutoff timestamp** — the same timestamp used for the legitimate fixture. This is the correct adversarial test: it isolates the `operation` predicate as the thing doing the exclusion, not the timestamp predicate. A post-cutoff denial row would be excluded either way and would let a silently-dropped `operation` filter pass undetected; this fixture would not.
- Test 4.3 (`test.ts:191–213`) asserts exactly one new annotation row after running the script against fixtures 1, 3, and 4 combined — the denied row (fixture 3) contributing zero. If the `operation` filter were ever dropped or weakened in a future edit, this assertion count would go to 2 and the test would fail.

This is a real, executed test on real Postgres proving the filter does what the comment claims, not just an inspected `WHERE` clause. I have no further concern here — this is the strongest piece of coverage in the whole test file, appropriately so given what it protects.

## 3. Append-only invariant

`8_phantom_em_annotate.sql` contains exactly one DML statement: the `INSERT INTO audit_log (...) SELECT ... FROM audit_log al WHERE ... AND NOT EXISTS (...)` at lines 88–112. No `UPDATE`, no `DELETE`, anywhere in the file. The subquery and the `NOT EXISTS` guard both only read from `audit_log`; the write path touches no existing row. Confirmed. `8_phantom_em_detect.sql` is read-only in its entirety (a single `SELECT`, no DML at all) — consistent with its own header's claim.

## 4. Decision 9 — notification sentence, verbatim, in the artifacts operators actually use

Compared byte-for-byte (ignoring markdown backtick formatting) across three locations:

- `design.md:173`
- `8_phantom_em_annotate.sql:49–51`
- `query-result.md:30–32`

All three read: *"Query 1 flagged N phantom EM relationship(s) in `<environment>` as of `<timestamp>`. This is a notification, not a request for action — no remediation has been taken and none is authorized by this message."* — identical. `query-result.md` also correctly names Rachel Okonkwo, VP of Engineering, as the fixed recipient (lines 23, 34) and carries the escalation-not-remediation framing again at the bottom (lines 38–40), matching Decision 9's requirement that this not be a design-doc-only boundary. No drift.

## 5. New finding — `actor_global_role` is parameterized, not actually fixed

Decision 8 says `actor_global_role` = "the fixed literal `'system:production_data_engineer'`." What's shipped is a value the *operator* supplies via `-v actor_global_role='system:production_data_engineer'` (header, line 18) and the script accepts whatever string is passed — there's no `\if` check, no `CHECK` constraint (the column is plain `TEXT NOT NULL`, confirmed in `migrations/8_audit_log.sql`), nothing that verifies the supplied value actually equals the literal Decision 8 specifies. A mistyped or stale invocation (copy-pasted from an older doc, a shell history entry, a different script) would silently write a different `actor_global_role` into an audit row whose entire purpose is auditability.

This isn't a regression from design — the design's own Decision 6/8 SQL snippet used the same `:'actor_global_role'` substitution form, so the implementation matches what was specified. It's a gap that was easier to miss when this was a code snippet in a markdown doc than it is now, looking at the real invocation string an on-call engineer will actually copy-paste under time pressure.

**Recommendation (non-blocking):** hardcode the literal directly in the SQL —
```sql
'system:production_data_engineer',  -- actor_global_role, per design.md Decision 8 -- not operator-supplied
```
in place of `:'actor_global_role'` in the INSERT at line 91, and drop `actor_global_role` from the `\if` guard's concerns and from the required `-v` flags entirely. This is exactly the "secure default that doesn't require discipline to maintain" pattern I look for generally: `operator_user_id` *must* vary per-operator, so a mandatory parameter with a guard is the right control for it; `actor_global_role` never varies by design, so making it a parameter at all is an unforced opportunity for drift. I'd rather the script not be able to write the wrong value than trust every future invocation to type it correctly.

I'm not blocking merge on this — it's a one-line hardening change with zero behavioral risk, and the current state matches what was actually decided at design review. Worth a fast-follow before this reaches the on-call engineer's hands, since fixing it after the fact means finding and correcting every invocation instance already run.

## 6. Secondary observation — `-v ON_ERROR_STOP=1` absent from the documented operator invocation

The header's copy-pasteable invocation (both scripts) omits `-v ON_ERROR_STOP=1`; the test harness adds it itself (`test.ts:67`) but that flag isn't part of what an operator would actually copy-paste from the script header. Without it, psql's default behavior on a mid-script error is to print the error and continue to the next statement rather than abort — low actual risk here given the script is a short, mostly-linear sequence with no error-prone statements before the guarded INSERT, but it's a one-token addition that costs nothing and removes a "what if" I'd otherwise have to reason through by hand. Suggest adding it to both header invocation strings as a fast-follow alongside the item above.

---

## Summary

| Item | Status |
|---|---|
| Decision 8 (mandatory param, quoted substitution, identity echo, guard ordering) | Implemented exactly, no regression |
| `operation = 'team.role_changed'` filter | Present, correct, and provably load-bearing via adversarial fixture (3/3 real tests pass) |
| Append-only invariant | Holds — annotate script contains one INSERT, no UPDATE/DELETE |
| Decision 9 (notification sentence + recipient) | Verbatim in all three artifacts |
| New finding | `actor_global_role` should be hardcoded, not operator-supplied — non-blocking, recommend fast-follow |
| Secondary observation | Add `-v ON_ERROR_STOP=1` to documented invocations — non-blocking |

No blocking findings. Cleared to ship to the on-call Production Data Engineer as-is; the two items above are worth a quick follow-up edit but do not need to hold this change.
