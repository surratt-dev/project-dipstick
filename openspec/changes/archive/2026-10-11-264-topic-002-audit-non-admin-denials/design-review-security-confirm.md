# Security Confirmation: #264 revised design (single-statement audit insert)

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Reviewed: revised design.md (D1-D10), tasks.md, both delta specs, proposal.md, against my earlier `design-review-security.md`; checked schema in `migrations/8_audit_log.sql`, `21_users_roles.sql`, `22_audit_log_actor_roles.sql` and the admin-arm insert in `routes/content.ts`.

## VERDICT: APPROVED

Approved with two small must-fix items in tasks/design that do not need another design round (A1 explicit casts, A2 test wording; section 4). Neither changes a decision.

---

## 1. Single-statement approach and skipping `parseRoleArray`: CONFIRMED

**Single statement.** The Engineer's E1 objection was correct: my two-step ruling ("role read fails => row with NULL roles + two events") was incompatible with one shared 500 ms budget, because the usual role-read failure is a timeout, leaving the insert nothing. I withdraw that ruling. The replacement keeps all the invariants I cared about:
- A row is still written whenever the insert itself can run. `FROM (SELECT 1) s LEFT JOIN users u ON u.id = $n` always produces exactly one row (the left side is one row; `users.id` is the primary key so the join cannot multiply it). A missing users row gives `u.roles` NULL, so `actor_roles` is NULL, which is the "not captured or unavailable" meaning I required. A NULL roles value cannot occur anyway (see below), so NULL means "no users row" in practice.
- Fail-open scope is now narrower and cleaner: one failure point, one stage (`audit_insert`), one timeout. My hard requirement 3 (scope of fail-open is exactly the audit step) is easier to hold.
- Nothing is lost on the security side: if the statement fails there is no row, which is what I already accepted for "insert also fails".
- Bonus: the role set and the row are read and written in one snapshot, so no TOCTOU between role read and insert.

**Skipping `parseRoleArray`: confirmed, and the justification can be stronger than the design states.** `users.roles` is `user_role[] NOT NULL` with the `users_roles_well_formed` CHECK constraint (migration 21), so the database itself enforces the content, not only "code that writes it". The value is a verbatim copy into a NULL-tolerant audit column that feeds no decision and no metadata. A throwing validator would add a failure point whose only effect is a lost row. The admin arm correctly keeps `readActorRoleSet` plus `parseRoleArray` (fail-closed, uses the roles). Please make two wording corrections in D4 (non-blocking, do with A2): say the content is guaranteed by the column constraint (not only by application code), and drop "or the roles column was NULL" (the column is NOT NULL; the sentence is harmless but misleading).

`u.roles::text[]` is a valid cast from `user_role[]` and matches the `TEXT[]` target (migration 22: audit history must survive enum changes). Order is preserved, so the "stored order" assertion in 3.6 is meaningful.

## 2. Changed event key sets: CONFIRMED

- **Denial event emitted on every denial with `rowWritten`**: confirmed, and an improvement. It means the log copy of "who was refused and why" survives exactly when the DB copy is lost, which is the case that previously needed the failure event to carry everything. `actorRoles: null` when no row was written is correct (it comes from `RETURNING`, so it is only present when the row exists).
- **Denial event keys** (`actorUserId, actorGlobalRole, actorIp, teamId, endpoint, httpStatus, reason, actorRoles, rowWritten`): content-free, closed enums and ids only. No team name, topic or annotation text. Accepted. Pinned by exact equality in 3.1 and the spec.
- **Failure event keys** (`actorUserId, teamId, endpoint, operation, stage, reason, failureMode, errorCode`): this also closes my F3 (`reason` added, non-blocking item 5). `stage` is the constant `"audit_insert"`, `failureMode` is `error|timeout`, `errorCode` is SQLSTATE or null. No `err.message` or `err.detail`; one shared `sqlstateOf` is a good consolidation. Accepted.
- One consequence to note, not a defect: on insert failure there are now two log events (denial with `rowWritten: false`, and the failure event). That is intentional and consistent across design D1, task 3.3 and the spec. Both carry only the content-free fields above.
- Log level of the failure event: error, documented in D5 and task 1.2 (my item 6): satisfied.

## 3. Reflection of my four merge-blocking conditions: CONFIRMED (all four)

| # | My blocking condition | Where reflected | Status |
|---|---|---|---|
| 1 | Replace PENDING markers in D3/D4/D5 with the rulings; add the issue-heading discrepancy note | D3 is marked RULED and carries the "Fail closed heading vs fail-open text" note; D5 RULED; D4 RULED (Architect, superseding my role-read sub-ruling, which I accept); no "PENDING" string remains in design, tasks, proposal or specs (grep). Task 0.1 checked. | Satisfied |
| 2 | Correct "administrators only" wording (F1) in D9, proposal, spec | D9 now reads "not read by any application endpoint or screen, for administrators or anyone else: access is database and log-sink operators only"; spec requirement "Denial rows are not exposed..." says "access is database and log-sink only". No "administrators only" phrasing remains (grep of proposal, design, tasks, both specs). | Satisfied |
| 3 | Floor-clock assertion (F4) in 3.1/3.3 | Task 3.1 has the fake-timer test (helper plus audit 20 ms still responds at about 150 ms, not 170 ms); D7 states the floor is measured from handler entry; spec scenario "the floor is a minimum, measured from handler entry". 3.3 adds "floor not extended". | Satisfied |
| 4 | State `request.ip` / `trustProxy` check and edge rate-limit answer in the PR | Task 3.9 (both), D10 and the Risks section require the PR to record both. This is a PR-time obligation, so it stays open until the PR exists; the task is the correct vehicle. | Satisfied in artifacts; verify in the PR |

My non-blocking items also landed: 5 (`reason` in failure event) yes; 6 (error level) yes; 7 (follow-up issues) as #TBD-A/#TBD-B placeholders, tracked by task 5.2 (must be real numbers before the issue closes); 8 (sweep covers migrations, views, export/search routes, log sinks) yes, in D8 and 3.8.

## 4. SQL shape: injection safety and the missing-row case

**Injection: PASS, conditional on the implementation matching the sketch.** Every dynamic value is a bound parameter (`$n`) through `db.query(text, values)`: actor id, role, ip, operation, team id, metadata JSON. Nothing is interpolated into the SQL text. The `$actor` in the design sketch is shorthand and must be a numbered placeholder in the code (the same value may be bound twice or reuse one number). Metadata is `JSON.stringify` of a fixed-shape object of constants and a closed enum. The query text itself is a constant. Tests should assert the SQL text is a constant string (no template interpolation of request data); please add one line to 2.1 / 3.1 for that.

**Missing / NULL users row still yields a row: PASS.** Walked through: `(SELECT 1) s` gives one row; the LEFT JOIN preserves it when no `users` row matches; `u.roles` is NULL; `actor_roles` is written NULL; `RETURNING actor_roles` returns that one row with NULL. `actor_global_role` is supplied from the decision (`'unknown'`), not from the join, so it does not depend on the join. Spec scenario "A caller with no users row" and task 3.3 cover it.

**A1 (must fix before the implementation merges, cheap): explicit casts on every parameter in the SELECT list.** The admin arm uses `VALUES ($1 ... $7::text[])`, where Postgres infers each parameter's type from the target column. In `INSERT ... SELECT`, bare parameters in the SELECT list have no target-column inference; Postgres resolves unknown-typed parameters there as `text`, and the insert then fails with "column ... is of type uuid (or inet, jsonb) but expression is of type text". The target columns are `actor_user_id UUID`, `actor_ip INET`, `team_id UUID`, `metadata JSONB`. Written naively, this insert fails every time, and because the path is fail-open the only symptom is a stream of `topic.audit_write_failed` events with no rows, in production, while the 403 keeps working. Required: `$1::uuid, $2::text, $3::inet, $4::text, $5::uuid, $6::jsonb`, with the join parameter also typed (`u.id = $1::uuid`). Add to task 2.1 and design D4's SQL sketch. The real-Postgres integration tests in 3.6 are the proof (a mocked `db.query` would not catch this), so 3.6 must stay mandatory, not substitutable by unit tests, for the two normal denial cases. `request.ip` that is not a valid inet would also fail the insert (fail-open, event emitted); acceptable, same as the admin arm.

**A2 (wording/test hygiene, with A1):** the integration test for the "role-set unavailable" semantics is now only the missing-users-row case (NULL is otherwise unreachable); keep the unit-test fallback in D10 as written. Also fix the two D4 sentences noted in section 1.

## 5. Residual risks (unchanged by this revision, still accepted by Security)

Log-only detectability of audit failure (#131); unbounded-but-attributable denial row volume until #TBD-A lands; pool pressure from abandoned timed-out queries (F2). The single-statement design does not worsen any of these; it slightly improves pool pressure (one query per denial instead of two).

## 6. Conditions of this approval

Before implementation merge:
1. A1: explicit `::type` casts on all parameters in the INSERT ... SELECT, in 2.1 and D4; real-Postgres test 3.6 mandatory.
2. A2: D4 wording corrections (column-constraint justification; remove "or the roles column was NULL"); add a constant-SQL-text assertion.
3. Carry in the PR: `trustProxy` finding and edge rate-limit answer (3.9), and the visibility sweep with commands (3.8).

Before closing the issue: #TBD-A and #TBD-B replaced by real issue numbers (5.2).

**APPROVED**, subject to the above.
