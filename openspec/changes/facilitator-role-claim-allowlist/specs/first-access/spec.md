## MODIFIED Requirements

### Requirement: Application provides a mechanism for assigning `global_role = 'engineering_manager'`

The application SHALL provide a documented, tested, and access-controlled mechanism by which a user's `global_role` is set to `engineering_manager`. This mechanism is a hard prerequisite for TEAM-006: without it, `POST /api/v1/teams/:teamId/managers` will always return `409 Conflict` because the precondition cannot be met.

**Resolved: Option A (IdP role claim mapping) selected per Decision 2 in design.md.** Options B and C are rejected. All five token validation requirements below apply to the implementation in `resolveOrCreateAccount`. The same mechanism assigns every other global role (`senior_engineer`, `facilitator`, `application_admin`); see "The IdP role-claim allowlist is closed" and "Facilitator designation comes only from the IdP and persists across sign-in" below.

**Option A — IdP role claims in First Access (SELECTED):**

During the OIDC authentication flow, the application SHALL read a designated role claim from the signed ID token and map it to `users.global_role`. The claim name is configured via the `OIDC_ROLE_CLAIM` environment variable (default: `role`). If the claim value maps to `engineering_manager`, the application SHALL set `users.global_role = 'engineering_manager'` for the user account — on account creation and updated on every subsequent sign-in.

**Five mandatory token validation requirements (all must be met before Phase 1 ships):**

1. **Claim name configuration:** The claim name that carries the role assignment is read from the `OIDC_ROLE_CLAIM` environment variable at startup. It is not hardcoded. The default value is `role`. Operators may configure a custom claim name (e.g., `https://myorg.example.com/role`, `groups`, `roles`) to match their IdP's claim schema.

2. **Signed ID token only:** The role claim is read exclusively from the signed ID token returned in the OIDC code exchange (`tokens.claims()`), after its JWS signature has been verified against the IdP's JWKS (`oidc-auth`, "OIDC callback and token validation"). Claims from the userinfo endpoint are not signed and MUST NOT be used for role assignment. The implementation reads from `IdTokenClaims` — the object produced by `tokens.claims()` — never from a separate userinfo call.

3. **Absent claim behavior:** When the role claim is absent from the token (the claim key is not present, or the value is undefined/null), the user receives the default role: `engineer`. A missing claim is not an error — it is the normal case for users without a non-default role. The application MUST NOT reject authentication when the role claim is absent, and SHALL NOT emit a warning for an absent claim.

4. **Allowlist validation:** Every claim value MUST be validated against the closed allowlist defined by "The IdP role-claim allowlist is closed" (exactly `engineer`, `senior_engineer`, `facilitator`, `engineering_manager`, `application_admin`) before the mapping is applied, using exact string equality. A claim value not on the allowlist MUST be ignored: it contributes nothing to the mapping, and if no allowlisted value remains the user receives the default role (`engineer`). A warning is emitted to the structured log carrying the claim name and counts only — never the claim value itself, in the log or in the audit trail, because the value may be attacker-controlled. A claim value of `'root'`, `'admin'`, `'superuser'`, or any other unlisted string is treated as absent. Array-valued claims are handled per "Multi-valued role claims resolve by fixed precedence".

5. **Re-evaluation on each authentication:** The role mapping is re-evaluated on every authentication — both initial sign-in and re-login. The `resolveOrCreateAccount` upsert sets `global_role` from the claim on every call. If an IdP administrator removes or changes a user's role, the application reflects that change at the user's next authentication. Token refresh does not re-read the role claim. The `global_role` value in the database is not a permanently fixed value; it tracks the IdP claim at each sign-in.

**Constraints:**
- The mechanism is audited: every assignment of a global role via the claim mapping produces an audit log entry — `auth.first_access_created` for new accounts, and `auth.role_claim_mapped` for a returning user whose mapped role is not `engineer` or differs from their previous role (see `auth-error-handling`, "First Access and role-claim-mapping events are durably recorded"). This covers the privileged values `facilitator`, `engineering_manager`, and `application_admin`, and every demotion from them.
- The mechanism is access-controlled: only the identity provider can cause a user to have `global_role = 'facilitator'`, `'engineering_manager'`, or `'application_admin'` — the claim must come from a signed ID token, not from any application-layer input
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

#### Scenario: User with EM role claim receives engineering_manager global_role

- **WHEN** a valid ID token is received with the configured role claim set to `'engineering_manager'`
- **THEN** `users.global_role` is set to `'engineering_manager'` for the account (created or updated)
- **AND** TEAM-006's `global_role` precondition is satisfied for this user

#### Scenario: User without role claim receives default engineer global_role

- **WHEN** a valid ID token is received without the configured role claim (claim absent)
- **THEN** `users.global_role` is `'engineer'` (the default)
- **AND** authentication succeeds normally
- **AND** no allowlist warning is logged

#### Scenario: Claim value not on allowlist is rejected silently

- **WHEN** a valid ID token is received with the configured role claim set to an unrecognized value (e.g., `'superuser'`)
- **THEN** the claim value is ignored; the user receives `global_role = 'engineer'`
- **AND** a structured warning is logged carrying the configured claim name and the count of ignored values
- **AND** the unrecognized value does not appear in that warning, in any other log line, or in any audit record

#### Scenario: EM role removed at IdP is reflected at next sign-in

- **WHEN** a user previously had `global_role = 'engineering_manager'` (claim was present on prior sign-in)
- **AND** the IdP administrator removes the role claim from the user's account
- **AND** the user signs in again
- **THEN** `users.global_role` is updated to `'engineer'` at sign-in
- **AND** the demotion is audited per `auth-error-handling` scenario "Demotion from engineering manager or application admin is recorded"
- **AND** the user's TEAM-006-established `team_memberships` rows are not automatically removed (those require an explicit TEAM-006 removal operation)

## ADDED Requirements

### Requirement: The IdP role-claim allowlist is closed

The set of role-claim values the application maps to `users.global_role` SHALL be exactly `{engineer, senior_engineer, facilitator, engineering_manager, application_admin}` — the five values of the `user_role` enum — and no other value. Widening or narrowing this set requires a spec change. The implementation SHALL hold the allowlist and the precedence order (see "Multi-valued role claims resolve by fixed precedence") in a single ordered constant, and a unit test SHALL assert that the allowlist is set-equal to a literal five-element set written out in the test.

`facilitator`, `engineering_manager`, and `application_admin` are privileged values. `facilitator` permits creating Health Check sessions (`session-creation`) and editing a team's standing topics (`add-custom-topic`, `remove-topic`, `restore-topic`, `reorder-topics`, `topic-annotation`), each subject to the facilitator-from-another-team rule. `engineer` and `senior_engineer` are non-privileged.

Allowlist membership SHALL be decided by exact string equality. The application SHALL NOT trim, case-fold, split on delimiters, or otherwise normalise a claim value before comparing it.

#### Scenario: The allowlist is exactly the five enum values
- **WHEN** the allowlist constant is compared with the set `{engineer, senior_engineer, facilitator, engineering_manager, application_admin}`
- **THEN** the two sets are equal, and adding or removing any value fails the test

#### Scenario: facilitator claim maps to facilitator
- **WHEN** a valid ID token carries the configured role claim with the string value `'facilitator'`
- **THEN** `users.global_role` is set to `'facilitator'` and no allowlist warning is logged

#### Scenario: senior_engineer claim maps to senior_engineer
- **WHEN** a valid ID token carries the configured role claim with the string value `'senior_engineer'`
- **THEN** `users.global_role` is set to `'senior_engineer'` and no allowlist warning is logged

#### Scenario: Near-miss values are not normalised
- **WHEN** the role claim is `'Facilitator'`, `' facilitator'`, or `'facilitator,engineer'`
- **THEN** each is one non-allowlisted value; the user receives `global_role = 'engineer'`; an allowlist warning is logged without the value

---

### Requirement: Multi-valued role claims resolve by fixed precedence

The role claim MAY be a string or an array. The application SHALL treat a string as a single candidate value and an array as one candidate per element; any other JSON type (number, boolean, object) SHALL be treated as a single non-allowlisted value. The application SHALL NOT coerce a non-string value or array element to a string.

Candidates not on the allowlist SHALL be ignored. If at least one candidate is ignored, or if no candidate is allowlisted (including an empty array), the application SHALL emit one structured warning per authentication carrying the claim name, the claim shape (`string`, `array`, or `other`), the number of ignored candidates, and the number of allowlisted candidates — and SHALL NOT include any candidate value.

Among the allowlisted candidates the application SHALL select the highest by this precedence, and no other: **`application_admin` > `facilitator` > `engineering_manager` > `senior_engineer` > `engineer`**. If no candidate is allowlisted, the user receives `engineer`.

Candidates are counted per element: duplicates are not collapsed, so `["facilitator","facilitator"]` has two allowlisted candidates and nothing ignored (no warning). Only an absent claim (key missing, or a top-level `undefined`/`null`) is "absent"; a `null` **element** inside an array is a non-string candidate and is ignored with a warning, so `[null]` maps to `engineer` with `ignoredCount: 1`, `allowlistedCount: 0`.

When `engineering_manager` is among the allowlisted candidates and a higher-precedence role is selected, the application SHALL emit one structured warning naming the applied role and the outranked allowlisted roles. `outrankedRoles` SHALL list every distinct allowlisted candidate other than the applied role — not only `engineering_manager` — once each, in precedence order (highest first). This warning is log-only; it writes no `audit_log` row and raises no alert. Because these names are allowlisted enum values, not raw input, logging them does not violate the raw-value rule above.

**Known consequence (accepted).** A user sent both `engineering_manager` and `facilitator` resolves to `facilitator`. For that user, the no-manager rule is enforced only through `team_memberships.role = 'engineering_manager'` rows, not through `global_role`. The deployment documentation SHALL warn operators not to assign `facilitator` to anyone who manages people.

#### Scenario: Array with a higher allowlisted role
- **WHEN** the role claim is `["senior_engineer", "facilitator"]`
- **THEN** `users.global_role` is `'facilitator'` and no warning is logged

#### Scenario: Facilitator outranks engineering manager
- **WHEN** the role claim is `["facilitator", "engineering_manager"]`
- **THEN** `users.global_role` is `'facilitator'`
- **AND** one warning names `appliedRole: 'facilitator'` and `outrankedRoles: ['engineering_manager']`

#### Scenario: Application admin outranks every other role
- **WHEN** the role claim is `["engineer", "facilitator", "application_admin"]`
- **THEN** `users.global_role` is `'application_admin'`

#### Scenario: Non-allowlisted element is ignored, allowlisted element applies
- **WHEN** the role claim is `["superuser", "facilitator"]`
- **THEN** `users.global_role` is `'facilitator'`
- **AND** one warning carries `ignoredCount: 1` and `allowlistedCount: 1`
- **AND** `superuser` appears in no log line and no audit row

#### Scenario: Empty or wholly non-allowlisted array falls back to engineer
- **WHEN** the role claim is `[]`, or `["superuser", "root"]`
- **THEN** `users.global_role` is `'engineer'` and one warning is logged without any element value

#### Scenario: Non-string elements are ignored, not coerced
- **WHEN** the role claim is `[42, {"role": "facilitator"}, "senior_engineer"]`
- **THEN** `users.global_role` is `'senior_engineer'` and the warning carries `ignoredCount: 2`

#### Scenario: Duplicate allowlisted elements are counted, not collapsed
- **WHEN** the role claim is `["facilitator", "facilitator"]`
- **THEN** `users.global_role` is `'facilitator'` and no warning is logged
- **AND WHEN** the role claim is `["facilitator", "facilitator", "superuser"]`
- **THEN** `users.global_role` is `'facilitator'` and one warning carries `ignoredCount: 1` and `allowlistedCount: 2`

#### Scenario: A null array element is ignored, not treated as an absent claim
- **WHEN** the role claim is `[null]`
- **THEN** `users.global_role` is `'engineer'`
- **AND** one warning carries `claimShape: 'array'`, `ignoredCount: 1`, and `allowlistedCount: 0`

#### Scenario: Every outranked role is listed in precedence order
- **WHEN** the role claim is `["engineering_manager", "facilitator", "application_admin", "facilitator"]`
- **THEN** `users.global_role` is `'application_admin'`
- **AND** exactly one outranked warning names `appliedRole: 'application_admin'` and `outrankedRoles: ['facilitator', 'engineering_manager']`

#### Scenario: Senior engineer plus facilitator persists across re-sign-in
- **WHEN** a user signs in twice, each time with the role claim `["senior_engineer", "facilitator"]`
- **THEN** after each sign-in the database row has `users.global_role = 'facilitator'` (verified by the real-PostgreSQL integration test through `resolveOrCreateAccount`)

---

### Requirement: Facilitator designation comes only from the IdP and persists across sign-in

`users.global_role = 'facilitator'` SHALL be set only by the sign-in role-claim mapping. No application endpoint, UI, seed migration, or script SHALL write `facilitator` (or any other value) to `users.global_role` for a person's account. **Pre-existing system row:** the non-person `system` user that `packages/backend/migrations/4_seed_data.sql` inserts with `global_role = 'application_admin'` (id `00000000-0000-0000-0000-000000000001`, `oidc_subject = 'system'`, `oidc_issuer = 'system'`), as the owner of the default-topic template team, is outside this rule. It is not a person, and it cannot be reached by sign-in, because accounts are matched on `(oidc_subject, oidc_issuer)` and no configured IdP issues tokens with issuer `system`. This carve-out covers only that existing row; no new seed or script SHALL add another `users` row with a non-default `global_role` under it. **Test-fixture exception:** automated tests MAY insert or update a `users` row directly to establish a "previous role" precondition (for example, the integration tests that verify demotion); such writes are confined to test setup, are never shipped, and are never documented as a way for a person to obtain a role. An in-app designation mechanism is permitted only as a fallback for a supported IdP that cannot send a custom role claim, and requires its own change.

A user whose ID token carries `facilitator` SHALL hold `global_role = 'facilitator'` after every such sign-in, and `GET /auth/session` SHALL report `canFacilitateSessions: true` for them. Persistence across sign-in SHALL be verified by an integration test that runs `resolveOrCreateAccount` and the audit-row write against a real PostgreSQL database (not only by mocked unit tests). A user whose ID token no longer carries `facilitator` SHALL be demoted at their next completed `/auth/callback`, and the demotion SHALL be audited as specified in `auth-error-handling`, "First Access and role-claim-mapping events are durably recorded" (the single home for the demotion audit assertions).

**Accepted limitation — latency.** A role change takes effect at the user's next completed `/auth/callback`. Token refresh is not authentication for this purpose: it does not re-read the role claim. A session established before the change keeps the prior role until the user completes `/auth/callback` again, bounded by the 90-minute absolute session lifetime (`oidc-auth`). This applies to revocation as well as grant. Revoking the user's refresh tokens at the IdP ends the application session at its next refresh attempt (classified as `revoked`); the application provides no in-app control to end another user's session sooner. The 90-minute absolute session lifetime SHALL be the control mechanism that bounds role-change latency, revocation included; no faster revocation mechanism is required.

#### Scenario: Facilitator persists on re-sign-in
- **WHEN** a returning user whose `users.global_role` is `'facilitator'` signs in again with an ID token carrying `facilitator`
- **THEN** `users.global_role` remains `'facilitator'`
- **AND** `GET /auth/session` returns `canFacilitateSessions: true`

#### Scenario: First sign-in as facilitator
- **WHEN** a user with no account signs in with an ID token carrying `facilitator`
- **THEN** the new account has `users.global_role = 'facilitator'`
- **AND** the `auth.first_access_created` audit row has `metadata.globalRole = 'facilitator'`

#### Scenario: Facilitator demoted when the claim is removed
- **WHEN** a returning user whose `users.global_role` is `'facilitator'` signs in with no role claim
- **THEN** `users.global_role` becomes `'engineer'`
- **AND** `GET /auth/session` returns `canFacilitateSessions: false`
- **AND** the demotion is audited per `auth-error-handling` scenario "Demotion from facilitator is recorded"

#### Scenario: Role change does not reach an existing session before re-authentication
- **WHEN** an IdP administrator grants `facilitator` to a user who is already signed in
- **THEN** that user's `users.global_role` is unchanged until their next completed `/auth/callback`, which happens no later than the end of the 90-minute absolute session lifetime

#### Scenario: Facilitator revocation does not reach an existing session before re-authentication
- **WHEN** an IdP administrator removes `facilitator` from a user who is already signed in
- **THEN** that user's `users.global_role` stays `'facilitator'`, and `POST /api/v1/teams` keeps succeeding for them, until their next completed `/auth/callback`, which happens no later than the end of the 90-minute absolute session lifetime
- **AND WHEN** the administrator also revokes that user's refresh tokens at the IdP
- **THEN** the application session ends at its next refresh attempt, classified as `revoked`

---

### Requirement: `senior_engineer` is non-privileged

`senior_engineer` is an allowlisted, non-privileged global role. Every authorization check in the application SHALL treat `global_role = 'senior_engineer'` identically to `global_role = 'engineer'`. For this change, that claim is verified by exactly the endpoints in the scenarios below (`GET /auth/session`, `POST /api/v1/teams/:teamId/sessions/draft`, `POST /api/v1/teams/:teamId/topics`, `POST /api/v1/teams`); this list is exhaustive for this change. Like any other role, `senior_engineer` is removed at the next completed `/auth/callback` once the IdP stops sending it, and that demotion is audited per `auth-error-handling`.

#### Scenario: senior_engineer persists on re-sign-in
- **WHEN** a returning user whose `users.global_role` is `'senior_engineer'` signs in again with an ID token carrying `senior_engineer`
- **THEN** `users.global_role` remains `'senior_engineer'`

#### Scenario: senior_engineer cannot facilitate
- **WHEN** a user with `global_role = 'senior_engineer'` calls `GET /auth/session`
- **THEN** the response carries `canFacilitateSessions: false`

#### Scenario: senior_engineer cannot create a session
- **WHEN** a user with `global_role = 'senior_engineer'` and no membership on Team A calls `POST /api/v1/teams/:teamA/sessions/draft`
- **THEN** the response is `403`, identical to the response for `global_role = 'engineer'`

#### Scenario: senior_engineer cannot administer standing topics
- **WHEN** a user with `global_role = 'senior_engineer'` and no membership on Team A calls `POST /api/v1/teams/:teamA/topics`
- **THEN** the response is `403`, identical to the response for `global_role = 'engineer'`

#### Scenario: senior_engineer cannot create a team
- **WHEN** a user with `global_role = 'senior_engineer'` calls `POST /api/v1/teams`
- **THEN** the response is `403` with the same body (`error.category = 'forbidden'`, same message; `correlationId` excepted) as for `global_role = 'engineer'`
- **AND** an `audit_log` row with `operation = 'team.creation_denied_role'` and `actor_global_role = 'senior_engineer'` is written
- **AND** no team, topic, or session row is created

#### Scenario: senior_engineer demoted when the claim is removed
- **WHEN** a returning user whose `users.global_role` is `'senior_engineer'` signs in with no role claim
- **THEN** `users.global_role` becomes `'engineer'`
- **AND** the demotion is audited per `auth-error-handling` scenario "Demotion from senior engineer is recorded"

---

### Requirement: Deployment documentation describes the role claim

`docs/deployment.md` SHALL contain a role-claim section that a reviewer can check item by item, and SHALL NOT grow into a per-IdP tutorial. It SHALL contain exactly these items, plus the manager warning:

1. `OIDC_ROLE_CLAIM` (default `role`) and the five-value allowlist, with `facilitator` marked privileged and `senior_engineer` marked as identical to `engineer`, and a statement that the claim must be one only IdP administrators can set (for example Entra app roles), never a user-editable attribute.
2. String-versus-array handling (exact match, no normalisation) and the precedence order `application_admin` > `facilitator` > `engineering_manager` > `senior_engineer` > `engineer`.
3. One Entra app-roles example. No other IdP walkthrough is required in this change.
4. Latency and revocation: a change applies at the next sign-in, within the 90-minute session lifetime; IdP refresh-token revocation is no faster than the IdP's access-token lifetime; there is no in-app control; a revoked facilitator keeps running any session they have already opened until it ends.
5. A troubleshooting entry titled "I was given facilitator but still see the join-link page".

The manager warning in proposal.md ("Do not assign `facilitator` to anyone who manages people. …") SHALL appear word for word.

#### Scenario: Deployment docs pass the role-claim checklist
- **WHEN** a reviewer reads the role-claim section of `docs/deployment.md`
- **THEN** each of items 1–5 above is present, exactly one IdP example (Entra) is given, and the manager warning matches proposal.md character for character
