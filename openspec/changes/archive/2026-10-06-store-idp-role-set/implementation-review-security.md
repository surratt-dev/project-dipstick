# Implementation review (security): Store the IdP role set in `users.roles` (#245)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-10-06
**Scope:** `git diff main` on `agent-team/245-store-idp-role-set` plus untracked files: `auth/role-map.ts` (`resolveRoleSet`, `byPrecedenceDesc`, `parseRoleArray`), `auth/account-resolver.ts`, `routes/auth.ts` (`shouldEmitRoleClaimMapped`, `insertSignInAuditRow`), `migrations/21_users_roles.sql`, `migrations/22_audit_log_actor_roles.sql`, `docs/deployment.md`, the new and changed tests, and `tasks.md` / `follow-ups.md` as they bear on R3/R4.

**Tests I ran:** unit lane (`role-map`, `account-resolver`, `routes/auth`): 252/252 pass. Real-Postgres lane (`REQUIRE_DB=1`: `users-roles-schema-integration`, `sign-in-audit-role-set-integration`, `role-claim-persistence-integration`, `admin-session-exclusion-integration`): 41/41 pass, including the 5 s lock-timeout leg.

## Verdict

**Approve. No blocking findings.** All five required changes from my design review (R1 to R5) and both "should" items (S-a, S-b) are implemented and covered by tests that I ran. The S1 and S4 re-runs hold against the actual code. I have signed off in `security-review.md`. The non-blocking notes below are hardening suggestions and accepted risks for the record.

---

## 1. Design-review findings: verification

| ID | Required | Implemented | Evidence |
|---|---|---|---|
| R1 | CHECK rejects NULL elements, non-1 lower bound and multi-dimensional arrays, and never evaluates to NULL | **Yes** | `users_roles_well_formed` returns `false` for NULL inputs, `array_ndims IS DISTINCT FROM 1` (catches 2-D and `'{}'`), `array_lower <> 1`, `array_position(r, NULL) IS NOT NULL`, in that order, before any element comparison. So `r[1] <> g` and `r[i] > r[i+1]` never see NULL. The function is not `STRICT`, and the constraint is wrapped `IS TRUE`. Four shape rows (`{NULL}`, `{application_admin,NULL}`, `[0:1]=…`, `{{facilitator}}`) expect and get `23514`. |
| R2 | Pinned `search_path`, `SECURITY INVOKER`, no dynamic SQL, dump/restore check | **Yes** | Both functions declare `SECURITY INVOKER` and `SET search_path = pg_catalog, public`, and qualify `public.user_role`. There is no `EXECUTE`. The one-off `pg_dump -Fc` / `pg_restore --exit-on-error` round trip with a multi-role row is recorded in `tasks.md` 1.1(c). A permanent CI check was not added (H.6(2), see N4). |
| R3 | F1 precondition: deny-side semantics, anchor to the latest `run_on` of migration 21 and to `users.roles` | **Yes** | The text in `tasks.md` under "Contract step 1 precondition" is copied verbatim into `follow-ups.md` F1. It has all three conditions and the deny-side sentence, and it carries the R3.3 recommendation (reset failing rows in F1's first migration) as non-binding. |
| R4 | Runbook writes both columns, and this is carried into F1 | **Yes** | `docs/deployment.md` step 2 is now `SET global_role = 'engineer', roles = '{engineer}'`, and shim test (d) runs that statement. F1 says "keep it that way" and explains why. |
| R5 | `::text[]` plus element validation, fail closed, exact-array real-PG assertion | **Yes** | `RETURNING roles::text[]` and `(SELECT roles::text[] FROM prior)` are used. `parseRoleArray` throws on a non-array, an empty array, a non-string element or a non-`GLOBAL_ROLES` element, and returns a frozen copy. The raw string `"{a,b}"`, `[]`, `["toString"]`, a null element, an array-like object, `null` and `undefined` are all rejected. A prior row with `global_role` set but `roles` NULL throws as an integrity error and is never defaulted (§8 of the design review). The real-PG tests use element-by-element `expectRoleArray`. |
| S-a | Explicit precedence comparator | **Yes** | `byPrecedenceDesc = (a, b) => RANK.get(b)! - RANK.get(a)!`, used on `[...new Set(mapped)]`. The comment explains why the comparator is load-bearing. There is no bare `.sort()`. |
| S-b | An UPDATE that states an inconsistent `roles` is not swallowed by the shim | **Yes** | The "UPDATE that changes global_role while stating an inconsistent roles fails 23514" test passes, and the row is unchanged afterwards. Every rule-2 negative test states `roles` explicitly. |

Additional checks I made against the code:

- **Enum order equals precedence.** `user_role` is declared in migration 1 as `engineer < senior_engineer < facilitator < engineering_manager < application_admin`, which matches `RANK_RECORD` (1 to 4, with `engineer` unranked). So rule 4 (`r[i] > r[i+1]`) and the JS comparator agree. The D11 test pins `pg_enum.enumsortorder` to `GLOBAL_ROLES`.
- **This build never relies on the shim.** The only production write to `users` is the resolver upsert, and it states `roles` in both the INSERT and the `DO UPDATE` (`roles = EXCLUDED.roles`). A grep finds no other production `INSERT INTO users` or `UPDATE … global_role`. Because `roles[1]` must equal the new `global_role`, the shim's UPDATE branch cannot fire for this build's upsert. `role-claim-persistence-integration` asserts this.
- **D12 (nothing reads `roles` for authorization).** A whole-word grep of `roles` outside the three resolution, persistence and audit files returns only comments and unrelated "member roles" text in `routes/teams.ts` and `routes/content.ts`. `roles` is not in `/auth/session`, `buildSessionData`, the Redis session, or any client or WebSocket payload.
- **Audit SQL.** `insertSignInAuditRow` picks one of two constant SQL strings by a typed key, so no operation text is interpolated. `actor_roles` is passed as a bound `$5::text[]` from the same frozen array as `metadata.roles` and the post-commit event. The write stays inside `withAuditTransaction`. Claim values and map keys stay out of every log line and audit field: the #243 S7 spy test was extended to `actor_roles` and passes.
- **`shouldEmitRoleClaimMapped`.** The added `!sameRoles(...)` disjunct only widens emission, and `sameRoles(x, null)` is treated as changed, so it cannot suppress an audit row. It adds no firing case today, as the comment says.

## 2. S1 re-run (manager + admin collapse) against the code

**Holds.** `resolveRoleSet` on admin + manager yields `roles = [application_admin, engineering_manager]` and `role = application_admin`. The discard line still fires `[engineering_manager]`. Manager status is now durable in `users.roles`, `metadata.roles` / `previousRoles` and `actor_roles`, which closes the "invisible" half of S1 for sign-ins after migration 21. Exclusion is still provided by D11's admin exclusion and not by the set: E1 to E4 are unchanged and green. The new real-PG tests show a stored `{application_admin, engineering_manager}` user refused participant registration (403, audited with `actor_roles` NULL), `{application_admin, facilitator}` refused draft creation, and TEAM-006 still returning 409. The carry-forward into F1 (deny-side semantics, Risk 8 constraint) is recorded verbatim. One under-recording case remains, by design: backfilled admin + manager rows are `{application_admin}` until the user's next sign-in. It is harmless while D11 holds, and the R3 text keeps F1 from trusting those rows.

## 3. S4 re-run (own-key target validation) against the code

**Holds.** `PERMITTED_TARGETS` and `RANK` are still a `Set` and a `Map` built from a `Record`. `mapValues` uses `Map.get`, and `resolveRoleSet` builds `roles` only from `mapValues` output, never from `normalizeClaim` output. Sorting and discard computation use `RANK.get`. There are three later barriers: `parseRoleArray` rejects any non-`GLOBAL_ROLES` element on read-back, `user_role[]` rejects `'{toString}'` with `22P02`, and CHECK rule 4 rejects any mis-ordered or duplicate set with `23514`. The tests for boot failing on `{"A":"toString"}` and `{"A":"__proto__"}`, and for the prototype-name claim resolving to `[engineer]`, pass.

## 4. Non-blocking notes

- **N1 (Low, suggestion): `parseRoleArray` validates membership, not shape.** It does not check that `roles[0] === global_role` or that the order is descending, and relies on the CHECK for that. That is correct today, because the value is read back from a constrained column. F1 will read `roles` for authorization, possibly on paths that bypass this resolver, so consider adding an `assert roles[0] === globalRole` in the resolver now, or a shared validated reader in F1. A cheap belt-and-braces check.
- **N2 (Info): `search_path = pg_catalog, public`.** `public` remains on the path. Both functions are `SECURITY INVOKER`, `pg_catalog` comes first, and the only user type is schema-qualified, so I see no hijack or escalation path. If a later migration adds anything to these bodies, qualify it too, or drop `public` from the path.
- **N3 (Info): the enum order stays load-bearing and is not revalidated.** `ALTER TYPE … ADD VALUE … BEFORE` would change rule 4's meaning without rechecking rows. The D11 test is the only control here. It is mandatory, and it is green.
- **N4 (Accepted, track): no permanent dump/restore check.** H.6(2) defaulted to the one-off check. I accept that for this step, because the functions are small, pinned and verified. Revisit if either function body changes (F1 drops the shim, so that is a natural point to repeat the check once).
- **N5 (Accepted, record): shim lifetime and its masking of rule 2 on the UPDATE path.** These last until F1, which is unscheduled (H.4). The shim only ever writes `ARRAY[global_role]`, so it fails closed. The `23502` "omitted roles" protection is deferred to F1.
- **N6 (Accepted, record): unaudited writes.** Manual runbook writes and shim writes change `users.roles` with no `audit_log` row. The comment widening #244 follow-up 7 is drafted in `follow-ups.md`. Post it when the follow-ups are filed.
- **N7 (Accepted, documented): `actor_roles` is application-guaranteed `TEXT[]` with no constraint, and NULL on every other operation.** The column comment and `docs/deployment.md` both say that NULL means "not captured", not "no roles".
- **N8 (Process): milestone gates H.3 to H.6 are unanswered by a human.** The implementation proceeded on documented defaults. None of the defaults weakens a security control. If a human changes H.5 (defers `actor_roles`), migration 22 and its audit uses are cleanly separable. That would reduce audit visibility of S1, but it is not a blocker.

## 5. Threat model delta (as built)

No new external surface and no new trust input. `users.roles` is a new authorization-relevant column for F1 onward, and its integrity is now enforced in the database (type, shape, consistency, order) and validated on read. Availability risk is bounded: migration 21 times out after 5 s and fails without applying anything (exit code 1 verified), and migration 22 times out after 200 ms, below the audit write timeouts. The rollback order is documented, and a wrong order fails closed (sign-in 500), not open.
