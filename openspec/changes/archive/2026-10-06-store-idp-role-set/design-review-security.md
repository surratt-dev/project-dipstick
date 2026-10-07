# Design review (security): Store the IdP role set in `users.roles` (#245)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-10-06
**Reviewed:** `design.md`, `proposal.md`; checked against `tasks.md` (F1 precondition, tasks 1.2, 1.7, 7.4), the current `auth/role-map.ts`, `auth/account-resolver.ts`, `routes/auth.ts`, `docs/deployment.md` (revocation runbook), and the archived #243/#244 security review (`archive/2026-10-05-configurable-oidc-role-map/design-review-security.md`, `security-review.md`).

## Verdict

**Approve with required changes.** The expand step is the right shape. Nothing reads `roles` for authorization, the role set is built only from validated map output, and the database enforces consistency instead of relying on code conventions. That last point is what I asked for in #243, and I'm glad to see it. My concerns are about how strong the integrity controls actually are. The CHECK as specified can be satisfied by malformed arrays because of SQL NULL semantics. The F1 precondition, which is the only thing standing between a stale or under-recorded role set and an authorization decision, has two holes. And the manual revocation runbook keeps working today only because of the shim, which nobody has said out loud. None of these needs a redesign.

---

## 1. Re-run of #244 security check S1 (manager + admin collapse)

**Original finding:** a user in both the manager and admin groups resolves to `application_admin`, the no-manager checks compare only against `engineering_manager`, and the person could participate. Nothing recorded it. It was closed by D11 (admins are excluded from live sessions), plus the discard log line and the docs rule.

**Against this design:**

| Element | Status after #245 | Assessment |
|---|---|---|
| Resolution | `roles = [application_admin, engineering_manager]`, `global_role = application_admin` (D1, D4) | Correct. Precedence is computed once, from the same sorted array. |
| Exclusion | D11 (E1 to E4) unchanged; no check reads `roles` (D12) | **Still closed, and for the same reason as before:** admin exclusion. This change does not make it any more structural. |
| Visibility | Durable in `users.roles`, audit metadata and `actor_roles` | **Improved.** The "invisible" half of S1 is resolved for sign-ins after migration 21. |
| Discard line | Unchanged, still fires `[engineering_manager]` | Correct. Keep it for sign-ins before migration 21. |
| TEAM-006 | Still 409 | Accepted non-goal, documented (task 6.3). |

**New S1-adjacent risks this design introduces (required, see R3):**

- **Under-recorded manager status on admin rows.** The backfill and the shim both write `ARRAY[global_role]`. For an admin who is also a manager, that is `{application_admin}`, so the manager role is missing. Today that is harmless, because D11 bars admins. The design's own Risk 8 constraint ("if admins may participate, the rule must still deny `engineering_manager ∈ roles`") depends on `roles` being complete for exactly these rows. The F1 precondition says an unresolved user gains "no capability from `roles` beyond what `global_role` already grants". That covers grant rules. It does not cover deny rules. For a deny rule, an unresolved set without `engineering_manager` is **not evidence that the user is not a manager**. If admins are ever allowed to participate through `global_role`, an unresolved admin + manager gets in.
- **A down/up cycle breaks the precedence test.** Rollback with the optional down migration, followed by re-applying migration 21, re-backfills `roles = ARRAY[global_role]`. That user's most recent sign-in audit row still carries a full `roles` field from before the rollback, so the precedence test calls them "resolved". F1 then trusts a backfilled `{application_admin}` that is missing `engineering_manager`. The precedence test must be anchored to the latest application of migration 21, not just to whether the audit row has a `roles` field.

**S1 re-run result:** passes for this step. Design's listed checks are sufficient as tests. Add the two F1 text changes in R3.

## 2. Re-run of #244 security check S4 (own-key target validation)

**Original finding:** targets and `RANK` must be own-key (`Set`/`Map`), so `toString`, `__proto__` and `constructor` can never pass as roles.

**Against this design:**

- `roles` is built from `mapValues` output only, which is `Map.get` over operator keys whose targets were validated with `PERMITTED_TARGETS.has`. It is never built from `normalizeClaim` output (D4). **Holds.**
- Sorting uses `RANK.get`, never `obj[role]` (D4). **Holds.**
- The database is a second barrier: `user_role[]` rejects non-labels with `22P02` (task 1.2), and CHECK rule 4 rejects a wrongly ordered array with `23514`. **Good defence in depth.** A resolver bug fails closed at sign-in rather than storing a bad set.
- The design's listed tests (boot fails on `{"A":"toString"}` / `{"A":"__proto__"}`, claim `["toString","__proto__","constructor"]` → `[engineer]`, raw `'{toString}'::user_role[]` → `22P02`) are the right ones.

**One trap for the code reviewer (should, S-a):** the alphabetical order of the four mappable labels (`application_admin < engineering_manager < facilitator < senior_engineer`) happens to equal descending precedence. If `.sort()` is called without a comparator, or with a string comparator, every test passes today and the code silently depends on spelling. Require an explicit `RANK.get(b)! - RANK.get(a)!` comparator and make it a reviewer checklist item. CHECK rule 4 would catch the bug once a label is added, but only as a 500 at sign-in.

**S4 re-run result:** passes.

## 3. Integrity controls: the CHECK constraint (D2)

### R1. [High, required] The CHECK can pass on malformed arrays (NULL semantics and array shape)

A Postgres CHECK passes when its expression evaluates to **NULL**, not only when it evaluates to true. The four rules as written leave three gaps:

- **NULL elements.** `roles = '{NULL}'`: `cardinality = 1` is true, `roles[1] = global_role` is NULL, and rule 3 is NULL. The conjunction is NULL, so **the row is accepted**. The same happens with `'{application_admin,NULL}'`, depending on how the helper compares neighbours.
- **Non-1 lower bound.** Postgres arrays can have arbitrary bounds. For `'[0:1]={application_admin,facilitator}'`, `roles[1]` is the *second* element, so `global_role = 'facilitator'` satisfies rule 2 even though the "first" element is admin. A helper that loops `1..cardinality` also skips or misreads elements.
- **Multi-dimensional arrays.** `'{{facilitator}}'` has `cardinality = 1`, but `roles[1]` is NULL, which again gives NULL and the row passes.

Only a buggy writer or someone with direct DB access can produce these today, and nothing reads `roles` yet. But the design's stated goal is that the column "cannot disagree with `global_role` whoever writes the row", and F1 will put authorization on top of it. The control should be airtight before anything depends on it.

**Required:**
1. Add to the constraint (or to the helper): `array_ndims(roles) = 1`, `array_lower(roles, 1) = 1`, and `array_position(roles, NULL) IS NULL`.
2. The helper must return `false`, never NULL, for any input. Do not declare it `STRICT`. Wrap the whole constraint expression with `IS TRUE` or `COALESCE(…, false)` so a NULL result means rejection.
3. Add negative tests to task 1.2, each expecting `23514`: `'{NULL}'`, `'{application_admin,NULL}'`, `'[0:1]={application_admin,facilitator}'` with `global_role = 'facilitator'`, and `'{{facilitator}}'`.

### R2. [Medium, required] Pin the helper's `search_path`, and harden both functions

`users_roles_well_formed` runs inside a CHECK. `pg_dump` restores with `search_path = ''`, and its CHECK constraints are checked during the data load. If the helper's body refers to anything unqualified (for example `'engineer'::user_role` or another function in `public`), **a restore of `users` fails**. That is a backup and recovery failure, which is an availability problem. Required:

- Schema-qualify every reference in both function bodies, or declare `SET search_path = pg_catalog, public`.
- Declare both functions `SECURITY INVOKER` explicitly. Neither may use dynamic SQL.
- Add a `pg_dump | pg_restore` round-trip of a migrated database to CI, or at minimum to task 1.1's verification.

### Notes (no change required)

- The enum order is load-bearing for rule 4. The D11 test covers it. `ALTER TYPE … ADD VALUE … BEFORE` does not revalidate existing rows, so the D11 test is the only control here. Keep it mandatory.
- A table owner or superuser can still drop the constraint, or disable the trigger with `session_replication_role = replica`. That is the same trust level as `global_role` today, and it is out of scope for this change.

## 4. Integrity controls: the transitional trigger (D13)

The shim is well bounded. It only ever writes `ARRAY[global_role]`, so it can never add a role that `global_role` does not already grant. It fires only for writes that leave out `roles`, and it has a named removal point. I accept it, with these observations.

### R4. [Medium, required] The manual revocation runbook depends on the shim; make that explicit

`docs/deployment.md` step 2 of urgent revocation runs `UPDATE users SET global_role = 'engineer' WHERE id = …`. While the shim exists, that statement now also sets `roles = '{engineer}'`, which is correct but implicit. Once F1 drops the shim, the same statement fails CHECK rule 2. That failure is loud, but it lands during an incident. And once F1 moves checks to `roles`, any revocation that updates `global_role` alone would not revoke what `roles` grants. **Required:** change the runbook in task 6.2 now to `SET global_role = 'engineer', roles = '{engineer}'`, and add "runbook writes both columns" to F1's body. The existing accepted gap still applies: this manual write produces no `audit_log` row, and neither does the shim's change to `roles`.

### S-b. [Low, should] The shim masks rule 2 on the UPDATE path, so test accordingly

For any UPDATE that changes `global_role` but leaves `roles` alone, the shim *coerces* the row instead of letting the CHECK reject it. A buggy writer in this build that does that becomes a silent rewrite to a single-element set, not a `23514`. The coercion goes in the safe direction (it never adds a role), but D2's claim that "drift is loud" holds only for INSERTs and for UPDATEs that state `roles`. Required for test validity: every rule 2 negative test in task 1.2 must state `roles` explicitly. They do as written, so keep it that way. Also add one UPDATE that states an inconsistent `roles` and expects `23514`, to show that the shim does not swallow it.

### Notes

- **Shim lifetime is tied to F1, which is unscheduled (H.4).** That is acceptable, because the shim only writes fail-closed sets. But the `23502` "omitted `roles`" protection and the loud rule 2 behaviour on the UPDATE path wait for F1 too. Record this in the security sign-off as an accepted risk with an F1 link, so it does not get lost.
- **Stale-shrink case.** A user signed in by the previous build, with `global_role` unchanged and a smaller IdP set, keeps their old `roles`. The only case where that would grant something under F1's rules is `{application_admin, facilitator}` → `{application_admin}`: the user keeps facilitation after the IdP revoked it. The F1 precedence test catches it as written, provided the test is implemented exactly (R3).

## 5. F1 precondition (deferred security decision)

### R3. [High, required, text change to `tasks.md` F1 precondition]

The precondition is the main security control for the contract step, and it is deferred to F1. That is the right place for it, but as written it has two holes (see §1). Amend the verbatim text:

1. **Deny-side semantics.** Add: "For a user who is unresolved, the absence of a role from `roles` is not evidence that the user lacks it. Deny rules (any rule that refuses because of `engineering_manager` or `application_admin`) must treat an unresolved user as if the denying role may be present, or must fall back to `global_role`-based denial that is at least as strict as today's."
2. **Anchor to the latest application of migration 21.** Change "most recent … audit row carries a `roles` field" to "most recent … audit row carries a `roles` field, **was written after the latest `run_on` of migration 21 in `pgmigrations`, and its `roles` equals `users.roles`**". This closes the down/up re-backfill case and also catches any out-of-band write.
3. **Prefer enforcement over a runtime convention.** Recommend that F1's first migration (the one that drops the shim) *applies* the precedence test, resetting `roles = ARRAY[global_role]` for every user who fails it. Each F1 check then still has to treat those users as unresolved. A one-off migration is easier to verify than a condition every check has to remember. This is a recommendation for F1, not a requirement here.

## 6. Authentication flow and data access boundaries

- **Role resolution point is unchanged.** Roles come from the signed ID token at interactive sign-in only, and the ~90-minute revocation bound is unchanged. I checked that `buildSessionData` stores only `userId` and tokens in the Redis session, not the role or the role set. So authorization keeps reading the database on every request and on WebSocket re-authorization. **F1 must keep it that way:** caching `roles` in the session would turn the 90-minute bound into a stale-authorization window. Add that sentence to F1.
- **D12 grep plus review** is adequate evidence that nothing reads the set for authorization in this step. It includes SQL thanks to the whole-word match. Keep it as a reviewer checklist item.
- **API contract unchanged.** `roles` must not be added to `/auth/me` or any client payload in this step. If a later UI needs it (FU-3), that is a disclosure decision: a user's full IdP-derived role set reveals group membership, and it should be reviewed then.

## 7. pg array parsing (D5)

### R5. [Medium, required] Parse fail-closed

If `user_role[]` comes back as the string `{a,b}` and code indexes it, `roles[0]` is `"{"`. Then `sameRoles` misfires and audit metadata carries garbage. D5 already requires explicit handling. Tighten it: use `roles::text[]` in `RETURNING` so node-postgres parses it natively, then **validate every element against `GLOBAL_ROLES` and throw on any mismatch, empty array or non-array** (a sign-in 500, which fails closed). Do not hand-split the string. The real-Postgres test in D5 must assert an exact array, element by element.

## 8. Audit logging

- **Good:** the row and the event come from one in-memory array (D6). `previousRoles` is captured in the same statement as the upsert, the same race-freedom as #244 D4. The audit write is transactional with the upsert (`withAuditTransaction`), and that is what makes the stale-case detection in D13 reliable. Claim values stay excluded (S7 spy test extended).
- **Accepted, but record in the sign-off:** `actor_roles` is application-guaranteed, `TEXT[]`, with no constraint. It is NULL on the other 50 insert sites, and the `COMMENT ON COLUMN` wording is correct. Auditors must not read NULL as "no roles". Put that in the `docs/deployment.md` audit-query section too.
- **Gap (existing, now slightly wider):** writes by the shim and manual runbook writes change `users.roles` with no audit row. The trail can detect previous-build sign-ins (the audit row has no `roles` field), but not manual ones. This is follow-up 7 from #244, unchanged. Note in that follow-up that it now covers `roles` as well.
- **`previousRoles` "never null":** guaranteed by NOT NULL plus the backfill/shim. If the code ever sees NULL for a returning user, treat it as an integrity error (throw). Do not default it to `[]` or `[engineer]`, which would forge an audit history.

## 9. Threat model impact

| Area | Change | Impact |
|---|---|---|
| Trust boundary | None. The IdP claim is still the only input, and it is still mapped through a validated map | No new external surface |
| Data at rest | New authorization-relevant column (for F1 onward) | Its integrity becomes a security boundary in F1. R1 and R2 harden it before that happens |
| Insider / DB write | The same trust level as `global_role` | Unchanged. Out of scope |
| Availability | ACCESS EXCLUSIVE lock with a 5 s timeout and a 1 s hold limit (D9); restore risk (R2) | D9 is acceptable. Check that node-pg-migrate wraps the SQL file in a transaction under `--no-single-transaction` (it does per migration by default), or `SET LOCAL` does nothing |
| Rollback | Order is mandatory; the down migration is optional | Acceptable. The down/up re-backfill interaction is covered in R3.2 |

## Deferred or implicit security decisions

| # | Decision | Where it lives now | Disposition |
|---|---|---|---|
| D-1 | The F1 precedence test, including deny-side semantics and the migration anchor | `tasks.md`, verbatim text into F1 | **Amend (R3)** |
| D-2 | Admins may participate? (Risk 8 constraint) | F1 text | Accepted as deferred. Depends on R3.1 |
| D-3 | Shim lifetime (removal unscheduled) and the deferred `23502` guarantee | F1, H.4 | Accept as a recorded risk in the sign-off |
| D-4 | `actor_roles` is application-guaranteed and NULL on 50 sites | D6 | Accept, and document it for auditors |
| D-5 | No audit of manual writes or shim writes | #244 follow-up 7 | Accept. Widen that follow-up's scope to cover `roles` |
| D-6 | `roles` never cached in session or exposed to the client | Implicit | **Make explicit in F1 (§6)** |
| D-7 | Runbook writing both columns | Implicit, works only through the shim | **Fix now (R4)** |

## Summary of required changes

| ID | Severity | Change |
|---|---|---|
| R1 | High | CHECK rejects NULL elements, non-1 lower bounds and multi-dimensional arrays. The helper never returns NULL. Four new negative tests |
| R2 | Medium | Pin `search_path` / schema-qualify the helper and shim, `SECURITY INVOKER`, and add a dump/restore check |
| R3 | High | F1 precedence test: deny-side semantics, anchor to migration 21's latest `run_on` and to `users.roles` |
| R4 | Medium | Revocation runbook writes `global_role` and `roles`. Carried into F1 |
| R5 | Medium | `::text[]` plus element validation, fail closed |

Should: S-a (explicit sort comparator as a review item), S-b (UPDATE-path test that the shim does not mask rule 2).

S1 and S4 re-runs: **both pass** against this design, subject to R3 for S1's carry-forward into F1.
