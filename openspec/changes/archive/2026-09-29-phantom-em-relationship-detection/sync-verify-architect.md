# Sync Verification — Solution Architect (Ingrid Sollenberger)

**Scope:** confirm no drift between `specs/phantom-em-relationship-detection/spec.md` (delta), the promoted `openspec/specs/phantom-em-relationship-detection/spec.md` (main), and the shipped artifacts: `8_phantom_em_detect.sql`, `8_phantom_em_annotate.sql`, `phantom-em-relationship-detection.test.ts`, `query-result.md`.

## Delta vs. main spec

Byte-identical on requirement content. Main spec adds only the title header and a `## Purpose` paragraph, which is expected and correct for a first-time capability creation (no prior main spec existed to diff against). No drift here.

## Requirement-by-requirement against shipped code

All eight requirements checked line-by-line against the two SQL files and the test file. All match:

1. **Detection read-only/re-runnable** — single `SELECT`, no writes, joins to `users.email`/`teams.name`, `removed_at IS NULL` filter present. Matches.
2. **Annotation is a separate, non-invoking file** — two files, neither references the other. Matches.
3. **Targets exactly the mislabeled rows** — all four predicates present (`operation = 'team.role_changed'`, `from_role`/`to_role`, cutoff timestamp), with the required inline comment on the `operation` predicate stating the `team.role_change_denied` collision it guards against (`8_phantom_em_annotate.sql:77-84`). Matches.
4. **Additive/idempotent** — `INSERT` only, references `annotated_audit_log_id`, `WHERE NOT EXISTS` guard. Matches.
5. **Environment check first, labeled result count** — both scripts' first SQL statement is the `-- STOP:` sanity check; annotate's final output is the `new_annotations_inserted` labeled count via CTE. Matches.
6. **No remediation/revocation/scheduling** — confirmed no `UPDATE`/`DELETE` against `team_memberships`, no notification code path, no cron dependency in either file. Matches.
7. **Actor identity (the BA's newly-added requirement)** — see detailed check below. Matches.
8. **`query-result.md` template fields** — run date, environment confirmed, operator, Query 1 count/rows, Query 2 count, notification recipient/channel all present (`query-result.md:8-36`). Matches.

## Newly-added requirement (actor identity) — detailed check

Verified each clause of "Annotation script's actor identity is a real operator, not a parameter or a sentinel" against the actual shipped SQL, not the design.md draft:

- `actor_user_id` = operator's own `users.id`, mandatory `-v operator_user_id=<uuid>`, no default → `8_phantom_em_annotate.sql:92` uses `:'operator_user_id'::uuid`; header comment (`:16-23`) documents it as required with no default. Matches.
- Existence guard preceding any other statement → `\if :{?operator_user_id}` is the file's first construct (`:61-65`), ahead of the environment check. Matches.
- `actor_global_role` = fixed literal `'system:production_data_engineer'`, **hardcoded in the INSERT, not an operator-supplied `-v` parameter** → `8_phantom_em_annotate.sql:92` has the bare string literal `'system:production_data_engineer'` in the `SELECT` list, not `:'actor_global_role'`. The header's copy-pasteable invocation (`:15-19`) correspondingly passes only `operator_user_id` and `ON_ERROR_STOP`, no `actor_global_role` flag. Matches the requirement exactly.
- Identity-echo check, after environment check and before `INSERT` → `SELECT id, email FROM users WHERE id = :'operator_user_id';` at `:73`, positioned after the env check (`:69`) and before the guarded `INSERT` (`:89`). Matches, including the exact SQL text the requirement quotes.

**This requirement's wording tracks the corrected/shipped shape, not the earlier draft.** I confirmed this deliberately because design.md itself is internally inconsistent on this exact point (see Drift Found below) — the BA's requirement did not inherit that inconsistency.

## Drift found — not in spec vs. code, but in design.md vs. its own shipped decision

This is outside the direct ask (spec vs. shipped code, which is clean) but is worth recording since it's the exact seam the BA's new requirement was written to close, and a future reader of design.md alone would be misled:

**`design.md` Decision 6's `INSERT` example (lines 89-91) and Decision 8 point 4's invocation string (lines 152-157) both still show `actor_global_role` as a `psql -v` parameter** — `:'actor_global_role'` in the `SELECT` list, and `-v actor_global_role='system:production_data_engineer'` in the invocation. This reflects a pre-fast-follow draft. The shipped SQL does not do this: `actor_global_role` is a bare literal in the `INSERT`, and the invocation string omits the flag entirely.

Confirmed this was a deliberate, tracked correction, not an oversight: `tasks.md` task 3.1 explicitly calls it out — *"`actor_global_role` is a fixed literal hardcoded in the INSERT per design.md Decision 8, not an operator-supplied `-v` flag (**security fast-follow, 2026-09-29**)"* — and task 3.4 and the verification note at the bottom of section 4 both reference re-confirming behavior "after the `actor_global_role` hardcoding fast-follow." `tasks.md` and the shipped code and the spec are all consistent with the corrected (hardcoded) approach. Only `design.md`'s own Decision 6 SQL snippet and Decision 8's invocation-string snippet were never updated to match the fast-follow they themselves record happening.

**Recommendation:** update `design.md` Decision 6's `INSERT` example (line 91: `:'operator_user_id'::uuid, :'actor_global_role',` → `:'operator_user_id'::uuid, 'system:production_data_engineer',`) and Decision 8 point 4's invocation string (lines 152-157: drop the `-v actor_global_role=...` line) so design.md matches what it actually decided and what shipped. This is a documentation-only fix — no code or spec change needed, since the spec, tasks.md, and shipped SQL are already the source of truth and already agree with each other.

## Minor observation (not drift, informational)

Two scenarios in the new requirement — "Annotation refuses to run without an operator identity" and "A wrong operator UUID is caught before the write" — are implemented exactly as specified in the shipped SQL (`\if`/`\quit` guard; identity-echo `SELECT`), but neither has a dedicated automated test in `phantom-em-relationship-detection.test.ts` (which covers 4.2-4.4 only: detection match/exclusion, one annotation insert, idempotent re-run). This is not spec-vs-code drift — the described behavior exists in the code exactly as worded — it's a gap between "implemented" and "test-covered," on the same footing as tasks 2.4/3.5's inspection-only verification of the no-write guarantees. Flagging for completeness, not blocking.

## Conclusion

No drift between spec.md (delta or main) and the shipped SQL/test artifacts. The BA's newly-added actor-identity requirement's wording matches the actual shipped SQL — the hardcoded literal, the `\if` existence guard, and the identity-echo check are all worded and ordered exactly as implemented. The one inconsistency found lives entirely in design.md's own examples (a stale pre-fast-follow snippet), not between spec and code, and does not require any spec or code change — only a design.md documentation touch-up.
