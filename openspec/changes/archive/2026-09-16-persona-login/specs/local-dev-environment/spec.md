## MODIFIED Requirements

### Requirement: Simulated OIDC provider
The Docker Compose environment SHALL include a `node-oidc-provider`-based OIDC server that supports the authorization code flow with PKCE and issues refresh tokens. It SHALL be pre-configured with at least four test user accounts covering each application role. Of these, the `manager-001` and `admin-001` accounts SHALL carry an OIDC `role` claim (`engineering_manager` and `application_admin` respectively) so that signing in as either account, via the existing role-claim-to-`global_role` mapping, produces a user with the corresponding real application role. The `facilitator-001` and `participant-001` accounts SHALL NOT carry a `role` claim; signing in as either produces a default user with no seeded application role.

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

#### Scenario: Manager and admin accounts carry real application roles
- **WHEN** a developer signs in as `manager-001` or `admin-001`
- **THEN** the resulting user's `global_role` is set to `engineering_manager` or `application_admin` respectively, on every sign-in, via the existing OIDC role-claim mapping

#### Scenario: Facilitator and participant accounts remain unseeded
- **WHEN** a developer signs in as `facilitator-001` or `participant-001`
- **THEN** the resulting user has no seeded `global_role` beyond the default, identical to today's behavior

#### Scenario: ID token issuance succeeds on every exchange
- **WHEN** the backend completes an authorization code exchange with the simulated OIDC provider
- **THEN** a signed ID token is returned; token issuance does not fail due to an inadequate signing key

#### Scenario: Role claim is delivered on the ID token, not via userinfo
- **WHEN** a developer signs in as `manager-001` or `admin-001`
- **THEN** the `role` claim is present directly on the signed ID token, and the backend maps it to `global_role` without calling the OIDC `/userinfo` endpoint
