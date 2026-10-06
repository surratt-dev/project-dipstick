# Spec Delta

## MODIFIED Requirements

### Requirement: Application provides a mechanism for assigning `global_role = 'engineering_manager'`

The application SHALL provide a documented, tested, and access-controlled mechanism by which a user's `global_role` is set to `engineering_manager`. This mechanism is a hard prerequisite for TEAM-006: without it, `POST /api/v1/teams/:teamId/managers` will always return `409 Conflict` because the precondition cannot be met.

**Resolved: Option A (IdP role claim mapping) selected per Decision 2 in design.md.** Options B and C are rejected. All five token validation requirements below apply to the implementation in `resolveOrCreateAccount`.

**Option A — IdP role claims in First Access (SELECTED):**

During the OIDC authentication flow, the application SHALL read a designated role claim from the signed ID token and map it to `users.global_role` through the deployment's role map, as defined by the `oidc-role-mapping` capability. The claim name is configured via the `OIDC_ROLE_CLAIM` environment variable (default: `role`). The claim may carry a single string or an array of strings. If the claim's values resolve to `engineering_manager`, the application SHALL set `users.global_role = 'engineering_manager'` for the user account — on account creation and updated on every subsequent sign-in.

**Five mandatory token validation requirements (all must be met before Phase 1 ships):**

1. **Claim name configuration:** The claim name that carries the role assignment is read from the `OIDC_ROLE_CLAIM` environment variable at startup. It is not hardcoded. The default value is `role`. Operators may configure a custom claim name (e.g., `https://myorg.example.com/role`, `groups`) to match their IdP's claim schema.

2. **Signed ID token only:** The role claim is read exclusively from the signed ID token returned in the OIDC code exchange (`tokens.claims()`). Claims from the userinfo endpoint are not signed and MUST NOT be used for role assignment. The implementation reads from `IdTokenClaims` — the object produced by `tokens.claims()` — never from a separate userinfo call.

3. **Absent claim behavior:** When the role claim is absent from the token (the claim key is not present, or the value is undefined/null, an empty string, an array with no non-empty string elements, or a non-string non-array value), the user receives the default role: `engineer`. A missing claim is not an error — it is the normal case for non-EM users. The application MUST NOT reject authentication when the role claim is absent, and MUST NOT log a warning for it, except the single `claim_overage` warning defined in `oidc-role-mapping` ("Role claim warnings at sign-in") when the token signals the claim was omitted for overage.

4. **Mapping, precedence and default:** The claim is normalized to a list of string values, and each value is looked up by exact, case-sensitive match against the keys of the deployment's role map (`OIDC_ROLE_MAP`, or the built-in identity default outside production). The only roles the map can produce are `application_admin`, `engineering_manager`, `facilitator` and `senior_engineer`. Values with no mapping are ignored. If several values map, the highest role wins in the fixed order `application_admin` > `engineering_manager` > `facilitator` > `senior_engineer` > `engineer`. If nothing maps, the user receives the default role (`engineer`), which is fixed and not configurable. A claim with at least one value but no mapped value produces exactly one structured-log warning per sign-in attempt that names the claim, carries the sign-in's `correlationId`, and contains no claim value (never an audit record — claim values may be attacker-controlled). A claim value of `'root'`, `'admin'`, or any other string the map does not contain is treated as absent.

5. **Re-evaluation on each interactive sign-in:** The role mapping is re-evaluated at every interactive sign-in (the OIDC callback), whether first or returning. It is NOT re-evaluated at token refresh: refresh replaces the access and refresh tokens only and does not call `resolveOrCreateAccount`. The `resolveOrCreateAccount` upsert sets `global_role` from the claim on every call. If an IdP administrator removes a user's EM role, the application reflects that change at the user's next interactive sign-in, which the 90-minute absolute session lifetime forces at the latest (see `oidc-role-mapping`, "Role map changes take effect at next sign-in"). The `global_role` value in the database is not a permanently fixed value; it tracks the IdP claim, as translated by the role map, at each interactive sign-in. `users.global_role` holds exactly one value.

**Constraints:**
- The mechanism is audited: every non-`engineer` role assignment via the claim mapping, and every role change including a change back to `engineer`, produces an audit log entry (`auth.first_access_created` for new accounts; `auth.role_claim_mapped` for returning users with a non-default role or whose role changed, including a change back to `engineer`)
- The mechanism is access-controlled: only the identity provider can cause a user to have `global_role = 'engineering_manager'` — the claim must come from a signed ID token, not from any application-layer input
- Teams MUST NOT be promised EM history access until the end-to-end path is verified by a passing CI test (the resolver tests in `account-resolver.test.ts` and the OIDC-callback route tests in `routes/__tests__/auth.test.ts`)

**Acceptance criterion:** Starting from a state where a user has never signed into the application, it is possible to reach a state where that user has `global_role = 'engineering_manager'` through a fully documented, access-controlled path — the user's IdP account has the role claim set, the user signs in, and the `users.global_role` column is `'engineering_manager'`.

#### Scenario: User arrives with engineering_manager global role set correctly

- **WHEN** a mechanism is in place for setting `global_role = 'engineering_manager'`
- **AND** the mechanism is applied to a user
- **THEN** that user's `users.global_role` value is `engineering_manager`
- **AND** an audit log entry records the assignment

#### Scenario: TEAM-006 precondition is satisfied after global role mechanism is applied

- **WHEN** a user's `global_role` has been set to `engineering_manager` via the chosen mechanism
- **AND** an authorized actor calls `POST /api/v1/teams/:teamId/managers` with that user's ID
- **THEN** TEAM-006 does not return `409 Conflict` due to the precondition failure
- **AND** the `team_memberships` row is created or updated successfully

#### Scenario: User without engineering_manager global role cannot satisfy TEAM-006 precondition

- **WHEN** no mechanism has been applied to a user (they have `global_role = 'engineer'` from First Access)
- **AND** an authorized actor calls `POST /api/v1/teams/:teamId/managers` with that user's ID
- **THEN** TEAM-006 returns `409 Conflict` with the global_role precondition error code
- **AND** no `team_memberships` row is created

#### Scenario: Teams are not onboarded with EM history access until the mechanism is verified end-to-end

- **WHEN** the global_role mechanism has not been implemented and tested end-to-end
- **THEN** no team is told that their Engineering Manager will have access to session history through the application
- **AND** EM history access is not presented as an available feature in team onboarding materials

#### Scenario: User with EM role claim receives engineering_manager global_role

- **WHEN** a valid ID token is received with the configured role claim set to `'engineering_manager'`
- **THEN** `users.global_role` is set to `'engineering_manager'` for the account (created or updated)
- **AND** TEAM-006's `global_role` precondition is satisfied for this user

#### Scenario: User without role claim receives default engineer global_role

- **WHEN** a valid ID token is received without the configured role claim (claim absent)
- **THEN** `users.global_role` remains `'engineer'` (the default)
- **AND** authentication succeeds normally

#### Scenario: Claim value not on allowlist is rejected silently

- **WHEN** a valid ID token is received with the configured role claim set to a value the role map does not contain (e.g., `'superuser'`)
- **THEN** the claim value is ignored; the user receives `global_role = 'engineer'`
- **AND** one structured warning is logged that names the configured claim and contains no claim value
- **AND** the unmapped value does not appear in any log line or audit record

#### Scenario: Group-style array claim is mapped through the deployment's role map

- **WHEN** `OIDC_ROLE_CLAIM=groups`, `OIDC_ROLE_MAP` maps `Eng-Managers` to `engineering_manager`, and a valid ID token carries `groups: ["All-Staff", "Eng-Managers"]`
- **THEN** `users.global_role` is set to `'engineering_manager'`
- **AND** TEAM-006's `global_role` precondition is satisfied for this user

#### Scenario: Facilitator role arrives through the role claim

- **WHEN** the deployment's role map maps a claim value to `facilitator` and a valid ID token carries that value
- **THEN** `users.global_role` is set to `'facilitator'` on every sign-in while the value is present
- **AND** the value is not reset to `engineer` at the user's next sign-in

#### Scenario: EM role removed at IdP is reflected at next sign-in

- **WHEN** a user previously had `global_role = 'engineering_manager'` (claim was present on prior sign-in)
- **AND** the IdP administrator removes the role claim from the user's account
- **AND** the user signs in again
- **THEN** `users.global_role` is updated to `'engineer'` at sign-in
- **AND** `auth.role_claim_mapped` records the change with `previousRole = 'engineering_manager'` and `globalRole = 'engineer'`
- **AND** the user's TEAM-006-established `team_memberships` rows are not automatically removed (those require an explicit TEAM-006 removal operation)
