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
The Docker Compose environment SHALL include a `node-oidc-provider`-based OIDC server that supports the authorization code flow with PKCE and issues refresh tokens. It SHALL be pre-configured with at least four test user accounts covering each application role.

#### Scenario: OIDC discovery endpoint is available
- **WHEN** `GET http://localhost:4011/.well-known/openid-configuration` is called
- **THEN** the response is a valid OIDC discovery document including `authorization_endpoint`, `token_endpoint`, and `jwks_uri`

#### Scenario: Authorization code flow completes
- **WHEN** the backend initiates an authorization code flow with the simulated provider
- **THEN** the flow completes and the backend receives a valid ID token containing `sub`, `email`, and `name` claims

#### Scenario: Pre-seeded test accounts are available
- **WHEN** a developer logs in using the simulated OIDC provider
- **THEN** they can select from pre-seeded accounts: `engineer@example.com`, `facilitator@example.com`, `manager@example.com`, `admin@example.com`

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
