## MODIFIED Requirements

### Requirement: Simulated OIDC provider
The Docker Compose environment SHALL include a `node-oidc-provider`-based OIDC server that supports the authorization code flow with PKCE and issues refresh tokens. It SHALL be pre-configured with at least four test user accounts covering each application role. Of these, the `facilitator-001`, `manager-001`, and `admin-001` accounts SHALL carry an OIDC `role` claim (`facilitator`, `engineering_manager`, and `application_admin` respectively) so that signing in as any of them, via the existing role-claim-to-`global_role` mapping, produces a user with the corresponding real application role. The `participant-001` account SHALL NOT carry a `role` claim; signing in as it produces a default user (`engineer`). No local-dev account's role SHALL depend on a manual database update.

`facilitator-001` SHALL be a member of no team in the seeded data, so that the facilitator-from-another-team rule never blocks it by default. The only seeded team is the `__default_topics__` template team, which cannot host a session; a team that `facilitator-001` can run a session for is created through the existing new-team flow (`POST /api/v1/teams`), which does not make its creator a member.

The provider's signing key SHALL be adequate to successfully sign and issue an ID token on every authorization code exchange. Requested-scope claims, including the `role` claim, SHALL be delivered directly on the signed ID token rather than requiring a separate `/userinfo` call, since the backend reads claims from the ID token only and does not call `/userinfo`.

#### Scenario: OIDC discovery endpoint is available
- **WHEN** `GET http://localhost:4011/.well-known/openid-configuration` is called
- **THEN** the response is a valid OIDC discovery document including `authorization_endpoint`, `token_endpoint`, and `jwks_uri`

#### Scenario: Authorization code flow completes
- **WHEN** the backend initiates an authorization code flow with the simulated provider
- **THEN** the flow completes and the backend receives a valid ID token containing `sub`, `email`, and `name` claims

#### Scenario: Pre-seeded test accounts are available
- **WHEN** a developer logs in using the simulated OIDC provider
- **THEN** they can select from pre-seeded accounts: `participant-001`, `facilitator-001`, `manager-001`, `admin-001`

#### Scenario: Facilitator, manager and admin accounts carry real application roles
- **WHEN** a developer signs in as `facilitator-001`, `manager-001`, or `admin-001`
- **THEN** the resulting user's `global_role` is set to `facilitator`, `engineering_manager`, or `application_admin` respectively, on every sign-in, via the existing OIDC role-claim mapping

#### Scenario: Participant account remains unseeded
- **WHEN** a developer signs in as `participant-001`
- **THEN** the resulting user has the default `global_role` (`engineer`), identical to today's behavior

#### Scenario: Local facilitator can run a session with no SQL step
- **WHEN** a fresh `docker compose up` has run with migrations and seed data applied
- **AND** a developer signs in as `facilitator-001` through the persona login page and creates a new team through the session-creation entry point
- **THEN** `POST /api/v1/teams` returns `201` with `status: 'lobby'`, and the `sessions` row named by the response's `sessionId` has `status = 'lobby'` and `facilitator_id` equal to `facilitator-001`'s user id
- **AND** `team_memberships` has zero rows for (`facilitator-001`, the new team)
- **AND** `facilitator-001`'s `users.global_role = 'facilitator'` was written only by `/auth/callback`; no SQL statement was run by hand at any step
- **AND** neither `docs/local-development.md` nor any hands-on test script under `docs/test-scripts/` instructs the developer to run `psql` or `UPDATE users` to obtain the facilitator role

#### Scenario: Facilitator role survives signing out and back in
- **WHEN** a developer signs in as `facilitator-001`, signs out, and signs in again
- **THEN** `users.global_role` is still `facilitator` and `GET /auth/session` returns `canFacilitateSessions: true`

#### Scenario: ID token issuance succeeds on every exchange
- **WHEN** the backend completes an authorization code exchange with the simulated OIDC provider
- **THEN** a signed ID token is returned; token issuance does not fail due to an inadequate signing key

#### Scenario: Role claim is delivered on the ID token, not via userinfo
- **WHEN** a developer signs in as `facilitator-001`, `manager-001`, or `admin-001`
- **THEN** the `role` claim is present directly on the signed ID token, and the backend maps it to `global_role` without calling the OIDC `/userinfo` endpoint
