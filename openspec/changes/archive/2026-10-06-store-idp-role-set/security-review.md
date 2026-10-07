# Security review re-runs for #245 (store-idp-role-set)

Task 8.4. Re-runs of #244's security checks S1 and S4 (archived `2026-10-05-configurable-oidc-role-map/design-review-security.md`), as design "Security checks re-run" requires. Each line cites the test that proves it. Recorded by the implementer (Marcus Oyelaran); security sign-off by Tomás Ferreira on 2026-10-06 (see "Security sign-off" below).

Test files (backend, relative to `packages/backend/src/`):

- `auth/__tests__/role-map.test.ts` (unit lane, no Postgres)
- `auth/__tests__/account-resolver.test.ts` (unit lane)
- `routes/__tests__/auth.test.ts` (unit lane)
- `auth/__tests__/users-roles-schema-integration.test.ts` (integration lane)
- `auth/__tests__/role-claim-persistence-integration.test.ts` (integration lane)
- `auth/__tests__/sign-in-audit-role-set-integration.test.ts` (integration lane)
- `routes/__tests__/admin-session-exclusion-integration.test.ts` (integration lane)

## S1: manager + admin collapses to `application_admin`

| Check | Result | Test |
|---|---|---|
| Claim mapping to admin + EM gives `roles = [application_admin, engineering_manager]`, `global_role = application_admin` | Pass | `role-map.test.ts` › claim resolution › `precedence for ["Dipstick-Admins","Eng-Managers"] → application_admin, roles ["application_admin","engineering_manager"], discarded ["engineering_manager"]` |
| The discard line still fires with `[engineering_manager]`, fields and scope unchanged; the written set keeps the outranked role | Pass | `account-resolver.test.ts` › sign-in logging (task 3.3) › `[admin, engineering_manager] returning (S1) logs exactly one precedence-discard line` |
| Manager status is now durable in audit (`metadata.roles`, `actor_roles`), with no discard flag | Pass | `auth.test.ts` › no discard flag in audit metadata (task 4.2) › `returning user [admin, engineering_manager]: auth.role_claim_mapped metadata keys are unchanged plus previousRole, roles, previousRoles` |
| D11 E1 to E4 unchanged and green (admin still excluded by admin exclusion, not by the set) | Pass, test files unmodified | `admin-session-exclusion-integration.test.ts` › `resolves to application_admin, discards engineering_manager, and is refused at registration, subscriber grant and roster`; E1/E2 in `routes/__tests__/sessions.test.ts`, E3 in `auth/__tests__/session-subscriber-access-helper.test.ts`, E4 in `routes/__tests__/facilitator-sessions.test.ts` (full backend suite green) |
| A user stored as `{application_admin, engineering_manager}` is refused participant registration (403, `invalid_request`), audited with `actor_global_role = application_admin` and `actor_roles` NULL | Pass | `admin-session-exclusion-integration.test.ts` › `a user whose claim maps to admin + manager is refused participant registration, audited with actor_roles NULL` |
| A user stored as `{application_admin, facilitator}` is still refused draft creation (403, `forbidden`), no audit row | Pass | `admin-session-exclusion-integration.test.ts` › `a user whose claim maps to admin + facilitator is refused draft creation (403 forbidden), with no audit row` |
| Still open for F1: TEAM-006 cannot associate an admin + manager as a team manager (409 `GLOBAL_ROLE_PRECONDITION_NOT_MET`) | Pinned as today's behaviour | `admin-session-exclusion-integration.test.ts` › `TEAM-006: a target user stored as {application_admin, engineering_manager} still gets 409 GLOBAL_ROLE_PRECONDITION_NOT_MET` |
| D8 deny-side wording carries S1 into F1 | Recorded | `tasks.md` "Contract step 1 precondition", copied verbatim into `follow-ups.md` F1 |

## S4: own-key targets and lookups

| Check | Result | Test |
|---|---|---|
| `PERMITTED_TARGETS` and `RANK` stay `Set` / `Map` (no change to `role-map.ts` constants) | Pass | `role-map.test.ts` › role-map constants › `PERMITTED_TARGETS is the four non-engineer roles and RANK orders them` |
| Boot fails on `{"A":"toString"}` and `{"A":"__proto__"}` | Pass | `role-map.test.ts` › parseRoleMap: shape validation › `rejects unknown target in {"A":"toString"} naming the key and listing permitted targets (S4)` (and the `{"A":"__proto__"}` row) |
| Claim `["toString","__proto__","constructor"]` gives `roles = [engineer]` | Pass | `role-map.test.ts` › claim resolution › `prototype names → roles [engineer] (outcome unmapped)` |
| A raw insert of `'{toString}'::user_role[]` raises `22P02` | Pass | `users-roles-schema-integration.test.ts` › users_roles_consistent (task 3.1) › `a label outside the enum fails with 22P02` |
| `parseRoleArray` rejects any element outside `GLOBAL_ROLES` | Pass | `role-map.test.ts` › parseRoleArray › `rejects a prototype name` (and the other rejection rows) |
| No claim value or map key reaches a log line, audit metadata or `actor_roles` (#243 S7 spy test, extended) | Pass | `auth.test.ts` › role set on sign-in audit › `no log line, audit metadata or actor_roles value contains a claim value or a map key (real resolver)` |

## Other design items for the reviewer checklist

| Item | Evidence |
|---|---|
| D4 explicit comparator (no bare `.sort()`) | `auth/role-map.ts` `byPrecedenceDesc`, used by `resolveRoleSet`; review item |
| D12 no authorization read of the set | `tasks.md` "Grep after change", each new hit annotated |
| D2 CHECK cannot pass on NULL / malformed arrays | `users-roles-schema-integration.test.ts` › `rejects shape: …` rows (`23514`) |
| D13 shim never adds a role; stated-`roles` UPDATE not swallowed | `users-roles-schema-integration.test.ts` › legacy-writer shim (task 3.3); `an UPDATE that changes global_role while stating an inconsistent roles fails 23514` |
| D2 function hardening / dump-restore | One-off `pg_dump -Fc` / `pg_restore --exit-on-error` round trip with a multi-role row, recorded in `tasks.md` "Migration timing" |

## Accepted risks to confirm at sign-off

- The legacy-writer shim (`users_roles_fill_legacy`) lives until F1, which may be unscheduled (H.4). It never adds a role and never fires for this build's writes.
- Manual runbook writes and shim writes produce no `audit_log` row; #244 follow-up 7 is widened to cover `users.roles` (comment drafted in `follow-ups.md`).

## Security sign-off

**Signed off:** Tomás Ferreira, Senior Application Security Analyst, 2026-10-06. **Approved, no blocking findings.**

- S1 and S4 re-runs confirmed against the code, not only the cited tests. I re-ran the unit lane (252/252) and the real-Postgres lane for the four security-relevant integration files (41/41).
- Design-review items R1 to R5, S-a and S-b are implemented and verified. Details are in `implementation-review-security.md`.
- Accepted risks confirmed: (1) the legacy-writer shim lives until F1, which is unscheduled (H.4). It only writes `ARRAY[global_role]`, so it fails closed, and the `23502` guarantee and loud rule 2 behaviour on the UPDATE path are deferred to F1. (2) Manual runbook writes and shim writes produce no `audit_log` row. The #244 follow-up 7 widening must be posted when the follow-ups are filed. (3) `actor_roles` is application-guaranteed and NULL outside the two sign-in operations, and this is documented for auditors. (4) Only the one-off dump/restore check was run (H.6(2)). Repeat it when F1 changes the function or trigger set.
- Conditions carried into F1, verbatim in `follow-ups.md`: the contract step 1 precondition (deny-side semantics, migration 21 `run_on` anchor, equality with `users.roles`), the Risk 8 constraint, no caching of `roles` in the session or exposure to the client without a disclosure review, and the runbook writing both columns.
