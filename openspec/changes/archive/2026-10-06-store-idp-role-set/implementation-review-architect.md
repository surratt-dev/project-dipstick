# Implementation Review: store-idp-role-set (#245, expand step)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** implementation against `design.md` revision 2 (D1 to D13): boundaries, consistency with existing patterns in `packages/`, the D2 CHECK function, the D13 transitional trigger, and whether any authorization decision reads `roles`.
**Inputs:** `git diff main`, `packages/backend/migrations/21_users_roles.sql`, `22_audit_log_actor_roles.sql`, the two new integration test files, `tasks.md` "Records", `follow-ups.md`.

## Verdict

**Approve for merge, subject to the one gate the team already set itself (task 8.3).** The implementation matches the design closely, including the details the design reviews fought over. I found no architectural defect in the code. My blocking items are process gates that are open, not code changes.

## Blocking

**B1. Task 8.3 (manual staging gate) is not done, and the design says it gates merge.** Only the exit-code leg is recorded. The previous-build-serving leg is the only evidence that D13 works end to end against a running pre-#245 container, a live lobby and the re-authorization sweep. The shim's unit-level behaviour is well tested (task 3.3 issues the previous build's exact upsert SQL), so I expect this to pass. But D13 is the reason the upgrade procedure is unchanged for operators, and that claim is in `docs/deployment.md` now. It must be demonstrated before merge, not assumed.

**B2. Gate 0.4 was bypassed. H.5 and H.6(1) are unanswered.** `tasks.md` records honestly that the agent proceeded on documented defaults (keep `actor_roles`; `previousRoles` null in the concurrent-first-sign-in race). Both defaults are what I would choose, and the code is cleanly separable if a human chooses otherwise. However, H.6(1) changes the contract of an audit field, and that is a decision for a human, not for an agent. A human must record the answers under "Milestone decisions" before merge. I am not asking for any code change.

## Design conformance

| Decision | Status | Notes |
|---|---|---|
| D1 order (descending, de-duplicated) | Conforms | `byPrecedenceDesc` uses an explicit `RANK` comparator (S-a checklist item met). Tests assert exact arrays. |
| D2 CHECK function | Conforms exactly | Body is character-for-character the design: `plpgsql`, `IMMUTABLE PARALLEL SAFE SECURITY INVOKER`, not `STRICT`, `SET search_path = pg_catalog, public`, `public.user_role` qualified. Shape checks (ndims, lower bound, NULL element) come before `array_position` and the rule checks. The constraint is wrapped in `IS TRUE`. Negative tests cover all four rules and all four malformed shapes (`{}`, `{NULL}`, `{application_admin,NULL}`, `[0:1]=…`, `{{…}}`), each expecting `23514`. `22P02` is covered for `{toString}`. The one-off dump/restore check is recorded (1.1(c)). |
| D3 no DEFAULT; fixtures | Conforms (with the task-stage amendment) | `Fixture.user(string \| readonly GlobalRole[])`, `Fixture.setRoles`, exported `insertUser` / `setUserRoles`. Cleanup tracking is kept. See N1. |
| D4 resolver | Conforms | `resolveRoleSet` replaces `resolveGlobalRole` (no remaining callers; the frontend test comment is updated). `role-map.ts` is still a leaf with no imports. A fresh `[FALLBACK_ROLE]` array per call. `roles` is built from mapped output only. |
| D5 upsert, `text[]` read, `parseRoleArray` | Conforms | Same statement and same `prior` CTE, so the #244 D4 race-freedom carries over. Read with `::text[]`, write with `$6::user_role[]`, no global type parser. `previousRoles` is null if and only if `previousGlobalRole` is null, and the impossible combination throws. The returned arrays come from the database row (parsed and frozen), not from the resolver, so the audit reflects what was persisted. That is the right choice. |
| D6 audit | Conforms | `roles` on both rows and both events. `previousRoles` on `role_claim_mapped`. `actor_roles` on the two sign-in rows only. One frozen array feeds the row, the metadata and the event. The operation name is a constant per SQL string, never interpolated. |
| D7 firing condition | Conforms | The third disjunct is present, with the contract-step comment. `sameRoles(x, null) = false`. |
| D9 locking | Conforms | 21 touches `users` only (`lock_timeout 5s`); 22 touches `audit_log` only (`200ms`). Both `RESET lock_timeout`. `--no-single-transaction` is in the deployment doc. Measured hold: 87 ms on 10,002 rows, against a 1 s limit. The runner's per-file `BEGIN`/`COMMIT` is verified (1.1(a)). |
| D10 migration shape and tests | Conforms | Down order: trigger, shim function, constraint, column, helper. Scratch-schema Up, Down, Up harness. Migration 22 is tested against a scratch `audit_log`. |
| D11 enum order | Conforms | Both the CI-lane test (no Postgres) and the `pg_enum.enumsortorder` test exist. `database-schema.md` carries the re-check rule for future enum changes. |
| D12 no authorization read | Conforms | See below. |
| D13 shim | Conforms exactly | INSERT with `NEW.roles IS NULL` sets `ARRAY[global_role]`. UPDATE with `global_role` changed and `roles` not distinct from `OLD` sets the same. Otherwise no change. Same function hardening as D2. The stated-`roles` UPDATE that must fail `23514` is tested, so the masking property (S-b) is pinned. The revocation runbook writes both columns. |

## Does any authorization decision read `roles`?

**No.** I checked this independently, not only through the recorded grep.

- Production code changed in exactly three files: `auth/role-map.ts`, `auth/account-resolver.ts` and `routes/auth.ts`. Every new whole-word hit in those files falls under resolution, persistence, audit or comment. The annotation table in `tasks.md` matches the code.
- The only branching consumer of the set is `shouldEmitRoleClaimMapped`, which gates the audit row and event. It is not an access decision, and its new disjunct adds no firing case today (D7).
- The non-auth hits (`teams.ts`, `content.ts`) are unchanged from the baseline: comments and one error string.
- Backend `src` has no `SELECT *` from `users`, so `roles` cannot leak into an authorization object by accident.
- `/auth/session`, `buildSessionData` / the Redis session, `realtime/` and every client payload are untouched. `global_role` is still derived from the same resolution (`roles[0]`) and still the only value any check reads.

## Boundaries and pattern consistency

- **Leaf module preserved.** `role-map.ts` still imports nothing; `parseRoleArray` lives next to `GLOBAL_ROLES`, where it belongs.
- **One writer of `users`** is still true in production code. The only other writers are the seed migration (which runs before 21), the runbook (now writes both columns) and tests.
- **Transactional audit pattern unchanged.** The two inserts still run inside `withAuditTransaction`, after the upsert, so the lock order is still `users` then `audit_log` (the reason for D9's split).
- **`insertSignInAuditRow` is a new shape.** It is an exported helper in a route module with a constant-SQL map, where the other 50 sites inline `client.query`. It is justified: task 6.1 needs a real-Postgres test of the exact statement. It is confined to the two sign-in rows, and it is not a general `resolveActorRoles` helper, which the design ruled out. I accept it. See N4.
- **Migration style** matches the repo: `-- Up Migration` / `-- Down Migration` markers, a header that cites the design and the rollback, and unqualified table names like migrations 1 to 20. Recording the runner's section-marker regex (1.1(a)) is a useful operational note.

## Non-blocking

**N1. F1's fixture-migration text does not cover `Fixture.user(string)` itself.** With a string argument, the helper still inserts `global_role` only and relies on the shim. That covers about 64 call sites across 18 files, plus the `insertUser({ globalRole })` branch. F1's body says to migrate "raw `INSERT INTO users`" to `Fixture.user`, but `Fixture.user`'s string branch is itself a shim dependant. Once F1 drops the trigger, most of the real-DB suite will fail with `23502`. Amend F1's body: the string branch must write `roles = [role]` (or the parameter narrows to `GlobalRole | readonly GlobalRole[]`, as D3 originally said), and the `globalRole` option on `insertUser` goes away.

**N2. `docs/test-scripts/facilitator-entry-point-hands-on-check.md` (l.131, l.151) uses `UPDATE users SET global_role = …` only.** That works today through the shim and fails `23514` after F1. Add it to F1's list, or update it now to write both columns, which would match the runbook change.

**N3. `IMMUTABLE` on `users_roles_well_formed`.** Enum `>` depends on `pg_enum` sort order, which `ALTER TYPE … ADD VALUE … BEFORE` can change. D11 already records this risk and mandates the re-check, and `IMMUTABLE` is the conventional (and required, for some uses) marking for CHECK helpers. No change needed. I mention it so nobody later reuses the function in an index expression on the strength of the marking.

**N4. Pattern drift risk from `insertSignInAuditRow`.** If F1 or a later change threads `actor_roles` through other audit sites, it should either generalize this helper deliberately or keep inlining. It should not grow a second, slightly different helper. Note this in F1 or F2.

**N5. Naming in `database-schema.md`.** The doc says `global_role` is dropped by "follow-up F2". `design.md` calls this "contract step 2". Check that F2's drafted body is in fact that step, so the schema doc does not point readers at the wrong issue.

**N6. Small redundancy.** `account-resolver.ts` computes `globalRole = resolution.roles[0]!` while `resolution.role` holds the same value. This is harmless and arguably clearer for contract step 2. No action needed.

## Sign-off conditions

1. Task 8.3 is completed and recorded (B1).
2. A human records the H.5 and H.6 answers (B2).
3. Optionally, before F1 is filed (H.1): amend F1's body for N1 and N2.
