# project-structure

## ADDED Requirements

### Requirement: Backend authentication middleware
The backend SHALL include authentication middleware that validates the session cookie on every protected request. Requests without a valid session SHALL receive a 401 response. The middleware SHALL be registered globally with explicit exclusions for public routes (health endpoints, OIDC callback, join link entry point).

#### Scenario: Protected route without session
- **WHEN** a request without a valid session cookie is sent to a protected API route
- **THEN** the application responds with 401 Unauthorized

#### Scenario: Health endpoint remains public
- **WHEN** a request without a session cookie is sent to `GET /health/live` or `GET /health/ready`
- **THEN** the application responds normally without requiring authentication

### Requirement: Backend authentication route module
The backend SHALL include route handlers for `GET /auth/login` (initiates OIDC redirect), `GET /auth/callback` (handles IdP response), `POST /auth/logout` (sign-out), and `GET /auth/session` (returns current session info). These routes SHALL be registered as a Fastify plugin in `packages/backend/src/routes/auth.ts`.

#### Scenario: Auth routes registered
- **WHEN** the Fastify application starts
- **THEN** the routes `/auth/login`, `/auth/callback`, `/auth/logout`, and `/auth/session` are registered and accessible

### Requirement: Shared auth-related types
The `@dipstick/shared` package SHALL export types related to authentication: `AuthSession` (user identity in session context), `JoinLink` (join link metadata), and `AuthError` (structured error response for authentication failures).

#### Scenario: Backend imports auth types from shared
- **WHEN** the backend TypeScript code imports `AuthSession` from `@dipstick/shared`
- **THEN** the TypeScript compiler resolves the import without errors

#### Scenario: Frontend imports auth types from shared
- **WHEN** the frontend TypeScript code imports `AuthError` from `@dipstick/shared`
- **THEN** the TypeScript compiler resolves the import without errors

### Requirement: Frontend auth context provider
The frontend SHALL include an auth context provider that wraps the application, tracks the current authentication state, and redirects unauthenticated users to the login endpoint. The provider SHALL expose the current user's identity to child components.

#### Scenario: Unauthenticated user redirected
- **WHEN** the frontend auth context detects no valid session (401 from `/auth/session`)
- **THEN** the user is redirected to `/auth/login`

#### Scenario: Authenticated user identity available
- **WHEN** a user is authenticated and the auth context is loaded
- **THEN** child components can access the user's display name, email, and team memberships via the auth context

### Requirement: Database migration for join_links table
A new database migration SHALL create the `join_links` table with columns: `id` (UUID primary key), `team_id` (FK to teams), `token` (unique, indexed), `created_by` (FK to users), `created_at`, `expires_at`, and `revoked_at` (nullable).

#### Scenario: Migration applies cleanly
- **WHEN** `npm run db:migrate` is run
- **THEN** the `join_links` table is created with all specified columns, constraints, and indexes
