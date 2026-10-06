# Spec Delta

## MODIFIED Requirements

### Requirement: Simulated OIDC provider
The Docker Compose environment SHALL include a `node-oidc-provider`-based OIDC server that supports the authorization code flow with PKCE and issues refresh tokens. It SHALL be pre-configured with at least four test user accounts covering each application role. Of these, the `manager-001`, `admin-001` and `facilitator-001` accounts SHALL carry an OIDC `role` claim (`engineering_manager`, `application_admin` and `facilitator` respectively) so that signing in as any of them, via the role-claim-to-`global_role` mapping under the default role map (no `OIDC_ROLE_MAP` set), produces a user with the corresponding real application role. The `participant-001` account SHALL NOT carry a `role` claim; signing in as it produces a default user with no seeded application role.

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

#### Scenario: Facilitator account carries the facilitator role
- **WHEN** a developer signs in as `facilitator-001` with no `OIDC_ROLE_MAP` set
- **THEN** the resulting user's `global_role` is `facilitator` on every sign-in
- **AND** that user can create a draft session

#### Scenario: Participant account remains unseeded
- **WHEN** a developer signs in as `participant-001`
- **THEN** the resulting user has no seeded `global_role` beyond the default, identical to today's behavior

#### Scenario: ID token issuance succeeds on every exchange
- **WHEN** the backend completes an authorization code exchange with the simulated OIDC provider
- **THEN** a signed ID token is returned; token issuance does not fail due to an inadequate signing key

#### Scenario: Role claim is delivered on the ID token, not via userinfo
- **WHEN** a developer signs in as `manager-001`, `admin-001` or `facilitator-001`
- **THEN** the `role` claim is present directly on the signed ID token, and the backend maps it to `global_role` without calling the OIDC `/userinfo` endpoint

### Requirement: Environment variable configuration
A `.env.example` file SHALL exist at the project root documenting all required environment variables with example values for local development. A `.env` file SHALL be git-ignored. The backend SHALL read all configuration from environment variables and fail fast with a descriptive error if required variables are absent.

#### Scenario: .env.example covers all required variables
- **WHEN** a developer copies `.env.example` to `.env` without modification
- **THEN** the backend starts successfully against the Docker Compose services

#### Scenario: .env is excluded from source control
- **WHEN** `git status` is run after creating a `.env` file
- **THEN** the `.env` file does not appear as a tracked or untracked file

#### Scenario: Absent required variable fails fast
- **WHEN** the backend starts without `SESSION_SECRET` set
- **THEN** the process exits immediately with an error message identifying `SESSION_SECRET` as missing

#### Scenario: Required OIDC variables
- **WHEN** the backend starts
- **THEN** the following environment variables are required: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `NODE_ENV`. Optional variables include `TOKEN_ENCRYPTION_KEY`, `APP_ORIGIN`, `OIDC_ROLE_CLAIM` and `OIDC_ROLE_MAP`.

#### Scenario: Production-mode guards
- **WHEN** `NODE_ENV=production`
- **THEN** the application requires `APP_ORIGIN` to be set, `SESSION_SECRET` to be at least 32 characters, `OIDC_ISSUER` to not point to a local/private address, and `OIDC_ROLE_MAP` to be set with at least one key targeting `engineering_manager` (see `oidc-role-mapping`)

#### Scenario: Real IdP requires a role map in every environment
- **WHEN** the backend starts with `OIDC_ROLE_MAP` unset and an `OIDC_ISSUER` that is not a local/private address, whatever its `NODE_ENV`
- **THEN** the process exits at startup with an error stating that `OIDC_ROLE_MAP` is required when `OIDC_ISSUER` is not a local address

#### Scenario: Local development needs no role map
- **WHEN** a developer copies `.env.example` to `.env` (whose `OIDC_ISSUER` is the local stub, `http://localhost:4011`, and whose `OIDC_ROLE_MAP` line is commented out) and starts the backend with a non-production `NODE_ENV`
- **THEN** the backend starts and uses the built-in identity role map
