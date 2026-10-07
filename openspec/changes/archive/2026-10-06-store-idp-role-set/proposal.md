# Proposal: Store the IdP role set in `users.roles` (#245, expand step)

**Proposer:** Devon Calloway, Internal Champion
**Source:** GitHub issue #245; `exploration-notes.md` (revision 2) and its reviews `explore-review-facilitator.md` (Priya Nair) and `explore-review-ba.md` (Marcus Delgado), all in this change directory. Revised after `propose-review-ba.md` (Marcus Delgado) and `propose-review-exec.md` (Rachel Okonkwo); see "Proposal feedback disposition" at the end. Aligned with design revision 2 after the design-stage reviews (see `design.md`, "Design review disposition"): the `audit_log` column moved to its own migration, the CHECK rejects malformed arrays, and the contract-step precondition was tightened.

## Why

The rule I care about most is that no manager takes part in a session. Today the application knows someone is a manager only if `users.global_role = 'engineering_manager'`, and that column is a lossy summary of what the IdP said. A manager who is also in the admin group is stored as `application_admin`, and the application forgets they manage anyone. #244 kept that person out of live sessions by barring admins (D11). That works, but it works because of where admins sit in the precedence order, not because the application knows the truth. The only trace of the lost roles is a `discardedRoles` log line with shorter retention than the audit log.

This change fixes the *knowledge* problem without changing any *decision*. It records every role the IdP mapped, keeps it consistent with `global_role` at the database level, and puts it in the audit trail. The contract steps that follow (moving checks to the role set, then dropping `global_role`) need that knowledge to exist first and to be trustworthy.

### Who feels this today, and what this change does not fix

The people who actually hit the collapse are **facilitators**. Someone who facilitates and is also in the admin group resolves to `application_admin` and is told "Only a facilitator can create a draft session." Someone who facilitates and is also in the manager group resolves to `engineering_manager` and is refused the same way, which is correct and must stay that way: a manager must never open a room.

After this change an operator can answer "why can't Sam facilitate?" from the audit trail (`roles = {application_admin, facilitator}`) instead of searching logs. **That is a diagnosis improvement only. There is no user-visible change: facilitators who are refused today are still refused.** Nobody should tell a facilitator their problem is fixed. The admin + facilitator case becomes able to facilitate only in contract step 1 (follow-up F1).

The same is true of #245's second problem bullet: **an admin who is also a manager is still not recognised as a manager by TEAM-006** (it still returns 409, because its precondition reads `global_role`). After this change the operator can see why (`roles @> '{application_admin,engineering_manager}'`); the fix is F1.

### Launch position

This change is behaviour-neutral: no authorization outcome, response, screen or configuration changes. No first-team launch scenario can depend on it, so by its behaviour it is not a first-team launch gate, and neither are F1 or F2 (#241, the last launch gate, is closed). Its only launch-time interaction is operational: migration 21 runs in whatever upgrade carries it (see "Upgrade safety"). #245 is currently assigned to the "02 - Session Setup" milestone. Whether that placement is right, and where F1 lands, are product decisions for a human (tasks H.3 and H.4), not something this proposal decides.

## What Changes

- **New `users.roles user_role[] NOT NULL` column** (migration `21_users_roles.sql`). It holds every mapped role once, ordered from highest to lowest precedence (`application_admin` first), or exactly `{engineer}` when nothing maps. No column default. Existing rows are backfilled with `ARRAY[global_role]`.
- **Database-enforced consistency with `global_role`.** A CHECK constraint guarantees: the set is a plain one-dimensional array with no NULL elements; it is non-empty; its first element equals `global_role`; `engineer` appears only as the sole element; elements are strictly descending in precedence (so no duplicates). The check is written so that it can never pass by evaluating to unknown. `roles` and `global_role` cannot drift, whoever writes the row.
- **A transitional legacy-writer shim so the previous build keeps working after migration 21.** Migration 21 also adds a `BEFORE INSERT OR UPDATE` trigger on `users` that acts only on writes that do not state `roles`: an INSERT with `roles` NULL gets `ARRAY[global_role]`, and an UPDATE that changes `global_role` while leaving `roles` untouched gets `ARRAY[global_role]`. This is exactly the write the previous build's upsert makes, and the result is the same fail-closed single-element set as the backfill. The new build never triggers it: it always supplies `roles`, and under the CHECK any change of `global_role` also changes `roles[1]`. The shim is removed by the first migration of F1 (design D13). Without it, every first sign-in and every role-changing sign-in served by the previous build between migration 21 and the new build going live would fail (not-null or CHECK violation).
- **One write path.** Sign-in resolves the role set from the claim and writes both columns in the existing single upsert statement. `global_role` is the first element of the set, so precedence is computed once. The previous role set is captured in the same statement, as `previousRole` is today.
- **Sign-in audit carries the set.** `auth.first_access_created` and `auth.role_claim_mapped` metadata, and their post-commit structured events, gain `roles`. `auth.role_claim_mapped` also gains `previousRoles` (always present; null only in the rare concurrent-first-sign-in race, together with `previousRole`, as `previousRole` already behaves today). `previousRole` is kept. Claim values and map keys still never appear.
- **New `audit_log.actor_roles TEXT[] NULL` column** (its own migration, `22_audit_log_actor_roles.sql`, so its lock on `audit_log` is never held together with the lock on `users`), populated only on the two sign-in rows in this step. NULL means "not captured", not "no roles". Its values and order are guaranteed by the application (identical to `roles` on the same row), not by a database constraint. In this step it duplicates metadata on the rows it fills; it is kept because #245 asks for it explicitly, and it gives SQL-queryable manager history without JSON paths (see disposition C3).
- **Firing condition made explicit, not widened.** `auth.role_claim_mapped` gains an explicit "role set changed" clause. It adds **no new firing case today**; every set change already fires. The clause exists so the rule survives when contract step 2 removes `global_role`.
- **"Discarded" now means "outranked", not "lost".** The precedence-discard log line, its scope (`engineering_manager`, `facilitator`) and its field names are unchanged. The outranked roles are now also recorded durably in the audit role set. There is still no discard flag and no conflict operation (#241).
- **Docs.** `requirements/design/database-schema.md` (`users`, `audit_log`, and the stale "A user may have multiple roles…" comment, which now conflicts with `users.roles`); `requirements/use cases/01 - Identity and Access - Use Cases.md` (a one-line note on TEAM-006's 409 remediation: an admin + manager is correctly configured but still refused until F1); `docs/deployment.md` (an audit SQL query for manager + facilitator conflicts after migration 21, alongside the existing log search for earlier sign-ins); upgrade notes (mandatory rollback order, lock bound, retry on lock timeout, outside-session-hours guidance).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `oidc-role-mapping`: "Fixed precedence across several mapped values" now requires the full role set to be stored, ordered and de-duplicated, with `global_role` as its first member, and adds `roles` assertions to each scenario (including single-string claims). "Fixed engineer fallback" states that `engineer` appears only as the sole element. "Precedence-discard signal" keeps the log line and scope and clarifies that "discarded" means "outranked for `global_role`". "Precedence discard is logged, not audited" is renamed to "Outranked roles are recorded in the audit role set" and rewritten. New requirements make the stored set and `global_role` consistent by construction, keep the previous build working through the upgrade window, fix the rollback order, bound the migration's effect on live sessions, add the audit column without failing audit writes, state that the set has no column default, and forbid authorization from reading the set in this step.
- `auth-error-handling`: "First Access and role-claim-mapping events are durably recorded" adds `roles` and `previousRoles` to the metadata field lists and structured events, `actor_roles` on both rows, the explicit set-change clause, and a worked backfill scenario for auditors. The "deferred to #241" sentence is narrowed to the conflict operation and notice.
- `first-access`: In "Application provides a mechanism for assigning `global_role = 'engineering_manager'`", item 4 adds that every mapped role is stored in `users.roles`, item 5's last sentence moves from "`users.global_role` holds exactly one value" to the `roles` / `global_role` wording, and the audit constraint's firing wording matches `auth-error-handling` ("whose role or role set changed").

`database-migrations` is deliberately unchanged: it lists tables, not columns, and has no per-migration requirements after migration 5. `role-assignment`, `manager-team-association`, `session-participation`, `session-creation` and the WebSocket authorization capabilities are unchanged because no check reads `roles` in this step.

## Constraints that must be preserved

- **No decision changes.** Every authorization check keeps reading `global_role` (and team membership) exactly as today. No authorization code path reads `roles`, `actor_roles` or `previousRoles`. Evidence is a whole-word grep recorded before and after the change: every new hit must be in `auth/role-map.ts`, `auth/account-resolver.ts` or `routes/auth.ts` and is reviewed line by line. The grep finds the sites; the review is what shows none of them is an authorization decision.
- **No-manager participation stays structural.** D11's admin exclusion and the dual manager check are untouched. The capability rules for the contract step ("can facilitate = has `facilitator` and not `engineering_manager`"; "can participate = has neither `engineering_manager` nor `application_admin`") are structural and must never become toggles. They are copied verbatim into follow-up F1, not implemented here.
- **The backfill and the shim never add a role.** `ARRAY[global_role]` can only under-record roles a user holds. Under-recording never grants anything: a backfilled admin is still excluded by D11, and a backfilled manager can't facilitate either way. There is one stale case the shim cannot see: if the previous build signs in a returning user whose `global_role` is unchanged but whose IdP set has shrunk, `roles` keeps the old set until their next sign-in under the new build. Nothing reads `roles` in this step. That case is always detectable, because the previous build writes that user an `auth.role_claim_mapped` row (their `global_role` is not `engineer`) with no `roles` field. Contract step 1 may therefore trust `roles` for a user only when their most recent sign-in audit row carries a `roles` field, was written after migration 21 was last applied, and matches the stored set; otherwise the user is unresolved. An unresolved user gains no capability beyond what `global_role` grants, and a role missing from their set is not evidence that they lack it, so deny rules must stay at least as strict as today's. The verbatim precondition is in `tasks.md`.
- **No claim values anywhere.** `roles` is built only from mapped internal roles, never from raw claim values. Own-key lookup (security check S4) still holds.

### Upgrade safety

- **The previous build keeps working against the migrated schema.** Between migration 21 and the new build going live (the normal rolling-upgrade window on Kubernetes, or migrating against a running Docker container), a first sign-in and a role-changing sign-in served by the previous build both succeed, via the shim. No operator procedure has to change.
- **Bounded effect on live sessions.** Migration 21 holds its ACCESS EXCLUSIVE lock on `users` for at most **1 second** measured against a 10,000-user seed (task 1.2; a larger measurement blocks the change until the migration is reshaped). It waits at most 5 seconds (`lock_timeout`) to acquire that lock. If it cannot, it fails, rolls back with no schema change, and exits non-zero, and the operator re-runs it. A request that reads `users` during the migration is therefore delayed at most once, by at most about 6 seconds. Migration 22 (`audit_log.actor_roles`) runs in its own transaction and waits at most 200 ms for its lock, below the 400 ms transactional audit timeout, so no audit write, and therefore no sign-in or join-link redemption, fails because of it. No open lobby or live session ends, no re-authorization is refused, and nobody has to sign in again because of the migration. This is verified by a manual staging gate (task 8.3, for the live-session, sign-in and join-link outcome) and by test (task 3.4, for the lock-timeout failures) and by construction: no session or re-authorization path reads `roles`, and the migration does not change `global_role`.
- **Rollback order is mandatory.** Redeploy the previous build first and confirm no new-build instance is serving. Only then, and optionally, run the down migrations (22, then 21). The previous build runs correctly on the migrated schema (shim), so the down migration is not needed for rollback. Running it while the new build is still serving would break sign-in, because the new build writes `roles`.

## Non-goals

- No change to what any facilitator, participant or manager sees or can do. **Facilitators refused today are still refused.**
- **An admin who is also a manager still cannot be associated with a team through TEAM-006 (409).** Deferred to F1.
- No authorization check moves to `roles`. `users.global_role` is not dropped. `audit_log.actor_global_role` stays permanently.
- `role_change_audit` gains no role-set column. `actor_roles` is not populated outside the two sign-in operations.
- `discardedRoles` scope is unchanged and the log line is not removed. No backfill-origin marker.
- No conflict operation, notice or stranded-draft handling (#241). No refusal-message change (F4). No role UI (FU-3).
- No change to precedence, the role map format, the fallback, or when roles are re-resolved (interactive sign-in only, about 90 minutes worst case).

## Relationship to #241

#245 claims none of #241's acceptance criteria. After this change the manager + facilitator conflict is derivable as `roles @> '{engineering_manager,facilitator}'`. A drafted comment for #241 is a human action (agents do not post to GitHub), recorded in `tasks.md`.

## Impact

- **Schema:** migration `21_users_roles.sql` (new `users.roles`, CHECK constraint and an IMMUTABLE helper function, the transitional legacy-writer trigger) and migration `22_audit_log_actor_roles.sql` (`audit_log.actor_roles`). Both reversible; `global_role` is untouched in both directions.
- **Code:** `packages/backend/src/auth/role-map.ts` (role-set resolution, still a leaf module), `packages/backend/src/auth/account-resolver.ts` (upsert writes both columns and returns `roles` / `previousRoles`), `packages/backend/src/routes/auth.ts` (metadata, `actor_roles`, firing clause).
- **Tests:** the existing `Fixture.user` helper in `routes/__tests__/helpers/real-db.ts` accepts a role set, plus `Fixture.setRoles`; existing raw test inserts keep working through the shim and move to the helper in F1. Malformed-array tests, scratch-schema migration tests (up, down, up). Negative tests per CHECK rule, legacy-writer tests, a lock-timeout test, an enum-order test, re-runs of security checks S1 and S4.
- **Operations:** a lock on `users` held at most 1 s, acquired within 5 s or the migration fails cleanly and is re-run; a lock on `audit_log` acquired within 200 ms (below the audit write timeouts) or migration 22 fails cleanly and is re-run. The deployment doc's migrate command gains `--no-single-transaction`, and the manual revocation runbook writes both `global_role` and `roles`. Applying it outside session hours is recommended, because a sign-in during the migration can wait up to about 6 seconds; it is not required. Mandatory rollback order (above). No new configuration.
- **API contract:** unchanged.
- **Security sign-off:** S1 and S4 from #244's security review are re-run against the new resolver and recorded with test names in `security-review.md`.

## Follow-ups

Filed by the human with numbers recorded in `tasks.md`: **F1** contract step 1 (checks move to `roles`, one area at a time, with the capability rules, backfill precondition and manager-exclusion constraint verbatim; its first migration drops the legacy-writer shim; acceptance notes include a multi-role local stub persona, which lands before F1's facilitator usability pass, formerly F3); **F2** contract step 2 (drop `global_role`); **F4** facilitator-actionable refusal message, scheduled with F1; **F5** a comment on FU-3's issue, not a separate issue (any role-history UI must annotate or suppress each user's first post-migration-21 diff). F3 is folded into F1 and no longer filed separately.

## Proposal feedback disposition

Reviews: `propose-review-ba.md` (Marcus Delgado, BA) and `propose-review-exec.md` (Rachel Okonkwo, VP Engineering).

### Accepted

| Item | Change made | Rationale |
|---|---|---|
| BA P1-1 (old build breaks after migration 21) | Option 1, a transitional legacy-writer trigger (design D13), with scenarios in `oidc-role-mapping` ("The previous build keeps working through the upgrade window"); mandatory rollback order (previous build first, down migration optional). | The finding is correct: the documented procedure (pre-upgrade Job during a rolling upgrade, or migrating against a running container) guarantees the mixed window. Option 2 (stop-the-world) would change the operator procedure and drop every live WebSocket, which is the opposite of what the constraint protects. Option 3 cannot work, as the BA notes. The shim writes only the same fail-closed `ARRAY[global_role]` the backfill writes, never fires for the new build (the CHECK makes a `global_role` change without a `roles` change impossible for a writer that states `roles`), and has a named removal point (F1's first migration). The one stale case (previous build, unchanged `global_role`, shrunken set) is detectable from the audit trail and is covered by a tightened F1 precondition. Trade-off: while the shim exists, a fixture that omits `roles` is filled rather than rejected, so the "omitting `roles` fails with 23502" guarantee moves to F1. The fixture grep in task 2.2 covers that gap in the meantime. |
| BA P2-1 (untestable "not disturbed / does not delay") | Lock hold ≤ 1 s on the 10,000-user seed as a blocking threshold; a lock-timeout failure scenario and test; constraint reworded to "delayed at most once, by at most about 6 s"; verification named (tasks 1.2, 3.4, 8.3, plus by-construction argument). | Agreed that D9's lock *is* a delay. The bound is the honest statement. |
| BA P2-2 (observable "refused as before") | Scenarios now name 403, `category: "forbidden"`, the exact message and that no audit row is written for draft creation; 403, `category: "invalid_request"`, "You are not eligible to participate as a voter in this session." and a `session.participant_registration_rejected` row with `actor_roles` NULL for the admin + manager participant. | Taken from the current handlers (`facilitator-sessions.ts` ~l.318, `sessions.ts` ~l.153). |
| BA P2-3 (backfill scenario uses "can") | Rewritten as the BA's worked GIVEN/WHEN/THEN with two sign-ins. | Directly testable, and F5 needs the concrete case. |
| BA P2-4 (grep does not prove) | Whole-word grep (`rg -nw`) with a recorded baseline (which includes existing comment hits); every new hit must be in the three named files and is reviewed. "Proves" removed. | The narrow pattern misses SQL such as `SELECT roles`. A whole-word baseline diff catches it, and the review does the proving. |
| BA P2-5 (operator decision rule) | Upgrade notes state the measured hold, the 6 s worst-case wait, that live votes are unaffected, and the retry rule. Outside session hours stays a recommendation, because the shim removes the need for a stop. | |
| BA P3-1 (TEAM-006 not resolved) | Non-goal added; Why section says so; UC 01 note added to docs (task 7.3). | Otherwise the issue reads as closed when it is not. |
| BA P3-2 (stale `database-schema.md` comment) | Added to task 3.5 and to Docs. | |
| BA P3-3 (first-access firing wording) | Aligned to "whose role or role set changed". | |
| BA P3-4 (missing scenarios) | Added: single-string claim; admin + senior engineer (full set stored, no discard line); fresh-install note (seed runs before migration 21; `ADD CONSTRAINT` validates every existing row, so CI fails if any seed row is inconsistent); `actor_roles` is application-guaranteed, not database-enforced. | |
| BA P3-5 (docs done-conditions) | Task 7.2 now carries the mandatory rollback order, lock bound and retry rule. | |
| Exec C1 (launch sequencing) | "Launch position" section: behaviour-neutral, so not a launch gate by behaviour; current milestone stated as fact; milestone placement recorded as human action H.3. | The factual part is stated here. Where #245 sits relative to launch work is a product decision, and I have not invented one. |
| Exec C4 (follow-up sprawl) | F3 folded into F1 as an acceptance note. F5 was already a comment on FU-3, not an issue; that is now explicit. Shim removal also goes into F1 rather than a new follow-up. | Fewer items to track, nothing lost. |
| Exec C5 (concrete operational line) | Upgrade notes carry the concrete bound and retry rule; the lock-timeout behaviour is tested (task 3.4). | |

### Partly accepted

| Item | Disposition | Rationale |
|---|---|---|
| Exec C2 (F1 must have a milestone) | Recorded as human action H.4: give F1 a target milestone when filing it, or record that it is unscheduled. Not decided here. | Milestones are a product decision. Factually, if F1 is never scheduled, this step still leaves durable, queryable manager status in the audit trail and on `users` (the no-manager rule's evidence no longer depends on precedence). The residual cost is a second column the CHECK keeps consistent, plus the shim. It cannot drift silently, so it is not pure cost, though most of the value does arrive with F1. |

### Rejected

| Item | Disposition | Rationale |
|---|---|---|
| Exec C3 (defer `audit_log.actor_roles`) | Kept. | #245's Proposal section asks for "a nullable `audit_log.actor_roles TEXT[]`" explicitly, so deferring it would deliver the issue partially and need the issue amended, which is a human call. It costs one nullable column added in the same migration (a metadata-only change; I am not claiming a lock saving as the reason), it is written on only two rows, and it lets auditors query actor role sets without JSON paths. It reads nothing and decides nothing. If the product owner prefers to trim it, it is cleanly separable: one migration statement, one line in task 6.1, the scenarios naming `actor_roles`. |
