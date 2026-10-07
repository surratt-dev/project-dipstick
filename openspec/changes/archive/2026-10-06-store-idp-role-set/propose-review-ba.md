# Propose Review: Business Analyst (Marcus Delgado)

**Change:** `store-idp-role-set` (#245, expand step)
**Reviewed:** `proposal.md`, delta specs (`oidc-role-mapping`, `auth-error-handling`, `first-access`), GitHub issue #245, checked against `requirements/use cases/01 - Identity and Access - Use Cases.md`, `01b - Designate a Facilitator - Deferral.md`, `requirements/design/database-schema.md`, and `docs/deployment.md` (migration procedure). I looked at `design.md` and `tasks.md` only to check where the proposal defers detail.

## Verdict

**Approve with changes.** The proposal is unusually honest about what it does *not* fix. "Facilitators refused today are still refused" is exactly the sentence I want in front of anyone tempted to tell Sam the problem is solved. Most capabilities can be built as written. The CHECK-constraint scenarios and the role-set ordering scenarios are concrete enough to become tests verbatim.

There is one real gap (P1), the mixed-version deploy window, which contradicts the "no user has to sign in again / live sessions not disturbed" constraint. There are also a handful of places where the acceptance condition is implied rather than stated. Details follow.

---

## P1: must resolve before design is accepted

### P1-1. Sign-in breaks between running migration 21 and deploying the new build

`docs/deployment.md` (l.243, l.299) tells operators to run migrations *before* starting the application, and on Kubernetes to run them as a pre-upgrade Job. During a rolling upgrade, the **old build keeps serving after migration 21 has applied**. The old `resolveOrCreateAccount` upsert (`account-resolver.ts:144`) writes `global_role` only:

- **New user (First Access):** the INSERT omits `roles`. `roles` is `NOT NULL` with **no default**, so the insert fails with a not-null violation. That user cannot sign in at all until the new pods are live.
- **Returning user whose role changed** (e.g. `facilitator` → `engineer`): `ON CONFLICT … SET global_role = 'engineer'` leaves `roles = {facilitator}`. `users_roles_consistent` rejects it, and the sign-in fails.
- **Returning user, unchanged role:** succeeds.

The proposal's Constraints section says "no user has to sign in again" and "live sessions are not disturbed". Those statements hold for people already in a room. They do not hold for a facilitator whose 90-minute session expires mid-upgrade and who needs to re-authenticate, or for a new engineer joining by link. "No column default" was chosen deliberately (every writer states the set), and that choice is exactly what makes old writers fail.

**Ask:** the proposal must pick one of these and state it as a requirement with a scenario:

1. **Two-phase migration.** Migration 21 adds `roles` with a transitional default or trigger that derives it from `global_role`, so old code keeps working. A later migration (or F2) removes the default.
2. **Stop-the-world upgrade.** State in the upgrade notes, as a *requirement* rather than a recommendation, that the old build must be stopped before migration 21 runs. Accept that the "outside session hours" advice becomes mandatory, and update the Constraints section to match.
3. **Make the old code compatible first.** Ship a build that writes `roles` before the migration lands. This doesn't really work here, because the column doesn't exist yet.

Proposed scenario, whichever option is chosen:
- **WHEN** migration 21 has applied and the previous build is still serving
- **THEN** a first sign-in and a role-changing returning sign-in each either succeed, or the documented procedure guarantees that the previous build is not serving at that point

The same applies to rollback. Design says "run the down migration *then* redeploy the previous build". The reverse order (previous build first) would break in the same way. The upgrade notes should state the order as mandatory.

---

## P2: vague language and implicit acceptance criteria

### P2-1. "Live sessions are not disturbed" is not testable, and "does not delay" contradicts D9

The proposal says migration 21 "does not end, fail re-authorization for, **or delay** any open lobby or live session". Design D9 takes an ACCESS EXCLUSIVE lock on `users`, which every live check and the re-auth sweep reads, with `lock_timeout = '5s'`. Readers *will* queue for up to the duration of the lock. That is a delay. The spec scenario ("no participant … is disconnected, refused … or asked to sign in again") also gives no way to check it.

**Concrete conditions to substitute:**
- Migration 21 holds its lock on `users` for at most **N ms** against the 10,000-user seed (design measures this but sets no threshold; pick one, e.g. ≤ 1 s).
- If the lock is not acquired within 5 s, the migration fails, rolls back with no schema change, and exits non-zero. The upgrade notes say "re-run it". Add this as a scenario: **WHEN** a long transaction holds `users` **THEN** migration 21 fails within ~5 s, `users` has no `roles` column, and `global_role` is unchanged.
- Reword the constraint from "does not delay" to "does not delay any session request by more than the lock duration bound above".
- Verification: name the test. If none is feasible, say this is verified by construction (no session code path reads `roles`, and re-auth reads `global_role`, which the migration doesn't change), and treat the duration measurement as the evidence.

### P2-2. "Refused exactly as it was before" needs the observable outcome

In `oidc-role-mapping`, "The role set does not drive authorization in this step":
- *Facilitator who is also an admin is still refused draft creation.* Spell out what is asserted: the HTTP status, the error code and the message "Only a facilitator can create a draft session.", plus whatever audit row is written today. Otherwise "exactly as before" means a snapshot test nobody has defined.
- *Manager who is also an admin is still excluded.* "Same response and audit row as before" should name them: 403, the same body as an EM receives (UC 01, l.337), and the audit row's `actor_roles` is NULL (it is not a sign-in row). The last point follows from the "Other operations leave actor_roles empty" scenario and should be cross-referenced.

### P2-3. Backfill-artefact scenario uses "can reflect"

`auth-error-handling`, "First role-claim row after the upgrade can reflect the backfill": "can" and "carry no such artefact" are not assertable. Replace with a worked example:
- **GIVEN** a user backfilled with `roles = {application_admin}` whose claim maps to `application_admin` and `engineering_manager`
- **WHEN** they next sign in
- **THEN** the row has `previousRole = 'application_admin'`, `previousRoles = ['application_admin']`, `roles = ['application_admin','engineering_manager']`
- **AND WHEN** they sign in again with the same claim **THEN** the row has `previousRoles = roles = ['application_admin','engineering_manager']`

This is also the case F5 (role-history UI) has to annotate, so having it concrete now helps there.

### P2-4. The zero-hit grep proves less than the constraint claims

The constraint says "Zero authorization code paths read `roles` … a grep proves it." Task 0.1's pattern (`\.roles\b|\broles\s*(=|@>|&&|\[)|…`) will not catch SQL such as `SELECT roles FROM users` or `RETURNING roles`. Task 7.1 also expects hits in `routes/auth.ts`, which is a route file. Either:
- widen the pattern (e.g. any `\broles\b` in `packages/backend/src` outside tests) and list the expected hit files and lines, or
- reword the constraint as "the grep, plus review of the listed hit sites, shows that…". The grep alone is not proof.

### P2-5. "Recommended outside session hours" vs. what an operator decides

This is tied to P1-1. If option 2 is chosen, it is no longer a recommendation. If not, give operators the decision rule: the measured lock duration, and what users see if they overlap (a sign-in waits up to X s; a live vote is unaffected).

---

## P3: gaps against requirements and traceability

### P3-1. Issue #245's second problem bullet is not resolved by this step, and that should be said explicitly

Issue #245 says the admin + manager user "is not recognised as a manager (TEAM-006 and the manager history views)." After this change, TEAM-006 still returns **409** for that user, because its precondition reads `global_role` (UC 01, l.259/272/287–288). The `first-access` scenario "TEAM-006's precondition outcome … is unchanged" covers this, but the proposal's Why and Non-goals sections only talk about facilitators. Add a Non-goal: "An admin who is also a manager still cannot be associated with a team via TEAM-006 (409). Deferred to F1." Otherwise the issue reads as closed when it isn't.

Related: UC 01's TEAM-006 remediation text (l.272) tells the admin to "ensure the EM's IdP role claim is correctly configured". For the admin + manager user the claim *is* correct, so that advice now sends people the wrong way. The operator can now see `roles @> '{application_admin,engineering_manager}'`. A one-line note in UC 01 (or in the deployment.md conflict checklist, task 6.1) would close that loop. I'm not asking for an API change.

### P3-2. Stale requirements text in `database-schema.md`

`requirements/design/database-schema.md` l.36–39 says: "A user may have multiple roles if they are both a facilitator and an engineer on their own team. The role column on users captures their primary/global role." After this change "multiple roles" has a precise and different meaning (`users.roles`). The proposal lists `database-schema.md` under Docs but only for the `users` / `audit_log` table definitions. Make sure this comment is rewritten too, and note that `global_role DEFAULT 'engineer'` (l.101) no longer helps any writer, because `roles` has no default.

### P3-3. `first-access` Constraints bullet still describes single-role firing

The "Constraints" list under the first-access requirement still says `auth.role_claim_mapped` fires "for returning users with a non-default role or whose role changed". Since the delta adds an explicit set-change clause to `auth-error-handling`, change the wording to "whose role or role set changed" so the two specs don't describe the trigger differently. This matters most at F2, when "role" stops being a column.

### P3-4. Missing scenarios worth one line each

- **Single-string claim:** `role: "facilitator"` (not an array) → `roles = [facilitator]`. Every scenario uses arrays today.
- **Admin + senior engineer:** `roles = [application_admin, senior_engineer]`, no discard line (senior engineer is out of the discard scope). This confirms that the full set is stored even for roles the discard log ignores.
- **Seed and fresh install:** `4_seed_data.sql` inserts `users` without `roles`. On a fresh database, migration 21's backfill covers it. State this, or add a CI assertion that every seeded user passes `users_roles_consistent` after migration 21, so a future seed migration doesn't break silently.
- **`actor_roles` content:** it is `TEXT[]` with no constraint. Add a sentence that its values and order are guaranteed by the application only (identical to `roles`), so auditors don't assume database enforcement.

### P3-5. Docs deliverables have no acceptance condition in the specs

The deployment.md audit query, the upgrade notes and the `database-schema.md` edits have done-conditions only in `tasks.md` (6.1 is good: "verify the query runs against seeded audit rows"). That's acceptable for docs. Make sure the upgrade notes task carries the P1-1 and P2-1 outcomes: mandatory step order, lock bound, and retry on failure.

---

## What is already buildable as written (no change needed)

- CHECK-constraint scenarios (empty, mismatch, `engineer` alongside another role, duplicate/ascending, omitted, non-enum value). Each one is a direct negative test.
- Role-set ordering scenarios in "Fixed precedence", including the duplicate/out-of-order claim example.
- `previousRoles` semantics (captured in the same statement as `previousRole`, always present on `role_claim_mapped`, absent on `first_access_created`).
- The firing-condition clause. I checked it: with `global_role` derived as the first element and `engineer` allowed only as the sole element, a set change without a `global_role` change can only happen when `global_role` is not `engineer`, and that case already fires. The proposal's "no new firing case" claim holds.
- The audit-row / structured-event parity scenario.
- The structural no-manager rules are carried forward verbatim to F1 and are not implemented here. This is correct, and it protects the ritual's core rule.

## Summary of asks

| # | Severity | Ask |
|---|---|---|
| P1-1 | Must | Resolve the old-build-after-migration sign-in failure (two-phase default, or a mandatory stop-the-world order), with a scenario; make rollback order mandatory |
| P2-1 | Should | Replace "not disturbed / does not delay" with a lock-duration bound, a lock-timeout failure scenario, and a named verification |
| P2-2 | Should | Name the status, code, message and audit row in the "refused exactly as before" scenarios |
| P2-3 | Should | Rewrite the backfill-artefact scenario as a worked GIVEN/WHEN/THEN |
| P2-4 | Should | Widen the D12 grep, or reword "proves" |
| P3-1 | Should | Add a Non-goal: admin + manager still gets TEAM-006 409; fix the misleading UC 01 remediation text |
| P3-2 | Should | Rewrite the stale "multiple roles" comment in `database-schema.md` |
| P3-3 | Could | Align the first-access Constraints firing wording |
| P3-4 | Could | Add single-string, admin + senior, seed-consistency and `actor_roles` scenarios or sentences |
