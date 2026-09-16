# local-dev-environment

## Purpose

Defines requirements for the local development environment, including Docker Compose services, the simulated OIDC provider, environment variable configuration, and the unified startup command.

## Requirements

### Requirement: Docker Compose services for local development
A `docker-compose.yml` SHALL be provided at the project root that starts PostgreSQL, Redis, and a simulated OIDC provider as named services. A single `docker compose up` command SHALL bring all local services to a ready state.

#### Scenario: All services start successfully
- **WHEN** `docker compose up` is run at the project root
- **THEN** PostgreSQL, Redis, and the simulated OIDC provider all reach a healthy state within 60 seconds

#### Scenario: Services use non-default local ports
- **WHEN** the Docker Compose services are started
- **THEN** PostgreSQL is mapped to host port 5433, Redis to 6380, and the OIDC provider to 4011, to avoid conflicts with locally installed instances

#### Scenario: Services include health checks
- **WHEN** `docker compose ps` is run after services start
- **THEN** all three services report a healthy status

---

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

---

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
- **THEN** the following environment variables are required: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `NODE_ENV`. Optional variables include `TOKEN_ENCRYPTION_KEY` and `APP_ORIGIN`.

#### Scenario: Production-mode guards
- **WHEN** `NODE_ENV=production`
- **THEN** the application requires `APP_ORIGIN` to be set, `SESSION_SECRET` to be at least 32 characters, and `OIDC_ISSUER` to not point to a local/private address

---

### Requirement: Local development startup command
A `npm run dev` command at the project root SHALL start the backend (Fastify) and frontend (Vite) concurrently with output labeled by package. The command SHALL be documented in a local setup section of the README or equivalent.

#### Scenario: Concurrent startup
- **WHEN** `npm run dev` is run at the project root
- **THEN** both the Fastify backend and Vite frontend dev server start, and their log output is displayed with labeled prefixes distinguishing which process produced each line

#### Scenario: Frontend proxies API requests to backend
- **WHEN** the frontend dev server is running and makes an API request to `/api/*`
- **THEN** Vite's dev proxy forwards the request to the Fastify backend at `localhost:3000`
