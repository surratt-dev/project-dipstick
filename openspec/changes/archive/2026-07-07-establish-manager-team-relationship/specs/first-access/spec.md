# first-access (delta)

## Purpose

This delta spec adds a requirement to the `first-access` capability: the application must provide a mechanism for a user to be assigned `global_role = 'engineering_manager'`. This is a hard prerequisite for the `manager-team-association` capability — TEAM-006 requires its target user to have `global_role = 'engineering_manager'`, but First Access currently creates all new users with `global_role = 'engineer'` and no path exists to change it.

This delta does not modify any existing first-access requirements. Existing scenarios are unchanged.

## ADDED Requirements

### Requirement: Application provides a mechanism for assigning `global_role = 'engineering_manager'`

The application SHALL provide a documented, tested, and access-controlled mechanism by which a user's `global_role` is set to `engineering_manager`. This mechanism is a hard prerequisite for TEAM-006: without it, `POST /api/v1/teams/:teamId/managers` will always return `409 Conflict` because the precondition cannot be met.

**Resolved: Option A (IdP role claim mapping) selected per Decision 2 in design.md.** Options B and C are rejected. All five token validation requirements below apply to the implementation in `resolveOrCreateAccount`.

**Option A — IdP role claims in First Access (SELECTED):**

During the OIDC authentication flow, the application SHALL read a designated role claim from the signed ID token and map it to `users.global_role`. The claim name is configured via the `OIDC_ROLE_CLAIM` environment variable (default: `role`). If the claim value maps to `engineering_manager`, the application SHALL set `users.global_role = 'engineering_manager'` for the user account — on account creation and updated on every subsequent sign-in.

**Five mandatory token validation requirements (all must be met before Phase 1 ships):**

1. **Claim name configuration:** The claim name that carries the role assignment is read from the `OIDC_ROLE_CLAIM` environment variable at startup. It is not hardcoded. The default value is `role`. Operators may configure a custom claim name (e.g., `https://myorg.example.com/role`, `groups`) to match their IdP's claim schema.

2. **Signed ID token only:** The role claim is read exclusively from the signed ID token returned in the OIDC code exchange (`tokens.claims()`). Claims from the userinfo endpoint are not signed and MUST NOT be used for role assignment. The implementation reads from `IdTokenClaims` — the object produced by `tokens.claims()` — never from a separate userinfo call.

3. **Absent claim behavior:** When the role claim is absent from the token (the claim key is not present, or the value is undefined/null), the user receives the default role: `engineer`. A missing claim is not an error — it is the normal case for non-EM users. The application MUST NOT reject authentication when the role claim is absent.

4. **Allowlist validation:** The claim value MUST be validated against an explicit allowlist of permitted role strings before the mapping is applied. The allowlist is: `['engineer', 'engineering_manager', 'application_admin']`. Any claim value not on the allowlist MUST be rejected: the claim is ignored, the user receives the default role (`engineer`), and a warning is emitted to the structured log (never to the audit trail — the claim value may be attacker-controlled and must not appear in audit records). A claim value of `'root'`, `'admin'`, or any other unlisted string is treated as absent.

5. **Re-evaluation on each authentication:** The role mapping is re-evaluated on every authentication — both initial sign-in and token refresh / re-login. The `resolveOrCreateAccount` upsert sets `global_role` from the claim on every call. If an IdP administrator removes a user's EM role, the application reflects that change at the user's next authentication. The `global_role` value in the database is not a permanently fixed value; it tracks the IdP claim at each sign-in.

**Constraints:**
- The mechanism is audited: every assignment of `global_role = 'engineering_manager'` via the claim mapping produces an audit log entry (`auth.first_access_created` for new accounts; `auth.role_claim_mapped` for returning users whose role is updated)
- The mechanism is access-controlled: only the identity provider can cause a user to have `global_role = 'engineering_manager'` — the claim must come from a signed ID token, not from any application-layer input
- Teams MUST NOT be promised EM history access until the end-to-end path is verified by a passing CI test (see tasks 2.3 and 2.4)

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
