# Design Review — Full Stack Engineer (Marcus Oyelaran)

**Change:** phantom-em-relationship-detection (#117)
**Reviewing:** design.md, proposal.md, tasks.md
**Verified against:** `packages/backend/migrations/1_create_enums.sql`, `2_create_tables.sql`, `7_team_memberships_partial_constraint.sql`, `8_audit_log.sql`; `packages/backend/migrations-manual/8_rollback.sql`; `packages/backend/src/routes/teams.ts` (lines 780–1003, 1240–1329); `packages/backend/src/routes/content.ts`, `em-views.ts` (audit_log read paths); archived `restrict-team-005-em-promotion/design.md` Decisions G/H/I.

## Overall

This is implementable, and the schema/code facts design.md asserts all check out exactly — I found zero discrepancies between what design.md claims and what the code and migrations actually contain. The two-file split is the right call and the boundary between "detect" (pure read) and "annotate" (single guarded write) is clean. One gap needs to be closed before implementation starts (§1), one is worth a one-line documentation addition but is explicitly not this change's to fix (§2), and the rest are minor/non-blocking (§3).

## 1. Blocking: the annotate script's parameter mechanism is unspecified, and the SQL as drafted won't run as-is

Decision 6's `INSERT ... SELECT` uses bare placeholders:

```sql
SELECT
  :operator_user_id, :actor_global_role,
  'team.manager_established_retroactive_annotation',
  ...
```

`:operator_user_id` and `:actor_global_role` are `psql` variable references, substituted as **raw text**, not as quoted literals. As written, this either:
- errors outright (an unquoted UUID token like `3f2a...` is not valid SQL on its own), or
- if the variable is left unset when the script is invoked, `psql` leaves the literal token `:operator_user_id` in the query (or expands to empty, depending on settings), producing a confusing syntax error rather than a clear refusal.

Decision J's candidate resolution explicitly requires "the script fails or refuses to run if [`operator_user_id`] isn't supplied" — that's not what bare `:var` substitution does. Getting this right requires:
- Quoted-literal substitution: `:'operator_user_id'::uuid` and `:'actor_global_role'`, not `:operator_user_id` / `:actor_global_role`.
- An explicit existence guard using `psql`'s conditional syntax, e.g.:
  ```sql
  \if :{?operator_user_id}
  \else
    \echo ERROR: operator_user_id is required. Invoke with -v operator_user_id=<uuid>.
    \quit
  \endif
  ```
- A header comment giving the **exact, copy-pasteable** invocation, e.g.:
  ```
  dotenv -e ../../.env -- psql "$DATABASE_URL" \
    -v operator_user_id='<your users.id UUID>' \
    -v actor_global_role='system:production_data_engineer' \
    -f migrations-manual/8_phantom_em_annotate.sql
  ```

This matters because the established convention file, `8_rollback.sql`, only demonstrates a plain `psql -f` invocation with no `-v` flags. An implementer following that precedent literally (as tasks.md 3.1 instructs — "how to run it... references to Decision I") will reasonably copy that shape and ship a script that silently doesn't work, or worse, half-works with an empty/garbage actor value. Decision J itself sets the bar ("must land in the script's header as a literal, copy-pasteable instruction — not a description the operator has to interpret") — the `-v` invocation syntax and the `\if` guard are part of satisfying that bar, not an implementation detail below it.

**Recommendation:** add this to tasks.md 3.3/3.4 explicitly (the `\if :{?var}` guard and the quoted-literal substitution), and have design.md's Decision J resolution (once the Solution Architect confirms the values) include the exact `-v`-flag invocation string in its own text, so whoever writes the header comment is transcribing, not designing.

## 2. Non-blocking, inherited: the detection join has a real false-negative shape, but it's Decision G/H's shape, not this change's to fix

I traced through a scenario the join doesn't distinguish: user is legitimately established as EM via TEAM-006 (`team.manager_established` row written), later demoted to `participant` via TEAM-005, then re-promoted to `engineering_manager` via the pre-fix TEAM-005 bypass. `team_memberships` has no history — the row is mutated in place (`UPDATE team_memberships SET role = ...`, `teams.ts:906`) with no "role last changed at" column — so nothing distinguishes "this row's current EM status was legitimately established" from "this row was legitimately established once, then illegitimately re-asserted later." The LEFT JOIN in Decision 4 keys purely on `(user_id, team_id)`, so the old, real `team.manager_established` row satisfies it, and the later phantom promotion is never flagged — a false negative on exactly the case this detection control exists to catch.

I confirmed this is not something introduced by this change: I read the archived `restrict-team-005-em-promotion/design.md` Decision G directly (lines 101–117), and the query shape — "flag any `team_memberships` row with `role = 'engineering_manager'` and no corresponding `team.manager_established` `audit_log` entry for that `(user_id, team_id)` pair" — is quoted verbatim into this change's Decision 4. Re-deriving or improving that shape is explicitly out of this change's non-goals ("Re-litigating Decisions A through I... those are settled").

**Recommendation (in-scope, cheap):** add one sentence to the detect script's header comment stating this limitation plainly — a "0 found" result means "no pair-level gap," not "every current EM row's provenance is provably legitimate." This is consistent with Decision 7's own framing of `query-result.md` as a record an operator/auditor will read later without necessarily re-deriving the query's semantics from scratch. I'd flag this to the Solution Architect as worth a note for future backlog, but it does not block this change.

## 3. Minor / non-blocking

- **Naming collision (cosmetic only):** the two new files share the `8_` prefix with the existing `migrations-manual/8_rollback.sql`. Since `migrations-manual/` isn't auto-discovered, there's no functional risk, but a reader could wonder whether the `8_` ties to migration 8 for a reason. It does — both new scripts query `audit_log`, created in migration 8 — worth one clause in each header saying so, for the same "explain itself" reason Decision 2/7 already care about.
- **Concurrency edge case, not worth engineering around:** the annotate script's idempotency guard (`WHERE NOT EXISTS`) is correct under sequential execution but not against two concurrent runs (default read-committed isolation means both could pass the `NOT EXISTS` check before either commits). Given the actual operational model — one named on-call engineer, one terminal, running detect then annotate as two deliberate sequential steps — this isn't worth a `SELECT ... FOR UPDATE` or advisory lock. Noting it so nobody is surprised if it's raised later; agree with design.md's own framing that atomicity of the single statement is the property that matters, not exclusion of concurrent invocations.
- **Idempotency guard, verified correct:** `ann.metadata->>'annotated_audit_log_id' = al.id::text` — checked against the actual `audit_log.id` column type (`UUID`, `migrations/8_audit_log.sql:28`) and confirmed the comparison is type-sound (`jsonb_build_object` serializes the UUID as its text form; `->>'...'` extracts text; `al.id::text` matches). No issue here — this is the one place I most wanted to double-check given Decision 6's own "not inspected-and-assumed" bar, and it holds up.
- **No app-code coupling risk found:** I checked every `audit_log` read path in `content.ts` and `em-views.ts` — all use explicit equality filters on specific `operation` strings (e.g. `content.ts:561`'s own comment: "NEVER a wildcard or prefix match across `session.*`"). The new `team.manager_established_retroactive_annotation` operation cannot leak into any existing UI surface. This confirms proposal.md's "no application code changes" claim holds, not just for the write paths but for every read path too.

## Verified facts (no discrepancies)

Every schema/code claim in design.md checked out exactly against current source:
- `membership_role` enum, `team_memberships` columns (`role`, `removed_at`, `joined_at`), and the partial unique index — match `1_create_enums.sql:46-49`, `2_create_tables.sql:26-35`, `7_team_memberships_partial_constraint.sql:32-34`.
- `audit_log` columns (`operation`, `target_user_id`, `team_id`, `metadata`, `timestamp`) — match `8_audit_log.sql:27-45`. Append-only confirmed by inspection (no UPDATE/DELETE against it anywhere in `src/`).
- `team.manager_established` metadata (`{ is_new_association }`) and join keys — match `teams.ts:1282-1296` exactly.
- `team.role_changed` metadata (`{ from_role, to_role }`) — matches `teams.ts:958-973` exactly.
- `team.role_change_denied` metadata (`{ from_role, to_role, http_status }`, distinct operation from `team.role_changed`) — matches `teams.ts:827-845` exactly. Decision 5's stated collision risk is real and correctly guarded against.
- `8_rollback.sql` header/style convention (what it does, how to run it, prerequisites, `-- STOP:`-style warnings) is the correct precedent to follow, modulo the `-v`-flag gap noted in §1.

## Recommendation

Approve, contingent on resolving §1 before or during implementation (add the `\if :{?var}` guard and quoted-literal substitution to the annotate script's actual SQL, and the exact invocation string to its header). §2 and §3 are documentation nice-to-haves, not gates.
