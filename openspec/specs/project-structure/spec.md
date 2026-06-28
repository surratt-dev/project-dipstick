# project-structure

## Purpose

Defines requirements for the monorepo workspace layout, shared TypeScript types, backend and frontend application shells, TypeScript configuration, and linting setup.

## Requirements

### Requirement: Monorepo workspace layout
The project SHALL be organized as an npm workspace monorepo with three packages under `packages/`: `shared`, `backend`, and `frontend`. The root `package.json` SHALL declare the workspace and provide scripts to build, test, and start all packages from the project root.

#### Scenario: Workspace packages are recognized
- **WHEN** `npm install` is run at the project root
- **THEN** all three package directories are linked as workspace packages and their cross-package dependencies are resolved without manual symlinking

#### Scenario: Root build script compiles all packages
- **WHEN** `npm run build` is executed at the project root
- **THEN** TypeScript is compiled for `shared`, then `backend`, then `frontend`, in dependency order, and all compiled outputs are produced without errors

#### Scenario: Root test script runs all test suites
- **WHEN** `npm run test` is executed at the project root
- **THEN** Vitest runs all test files across `backend` and `frontend` packages and reports results

---

### Requirement: Shared TypeScript domain types package
The `packages/shared` package SHALL define the canonical TypeScript types for all domain entities: `User`, `Team`, `TeamMembership`, `Session`, `SessionTopic`, `SessionParticipant`, `Vote`, `ActionItem`, `Topic`, and `ApplicationSettings`. These types SHALL be the single source of truth consumed by both `backend` and `frontend`.

#### Scenario: Backend imports shared types
- **WHEN** the backend TypeScript code imports a type from `@dipstick/shared`
- **THEN** the TypeScript compiler resolves the import from the local workspace package without errors

#### Scenario: Frontend imports shared types
- **WHEN** the frontend TypeScript code imports a type from `@dipstick/shared`
- **THEN** Vite resolves the import from the local workspace package and the type is available at compile time

#### Scenario: API contract mismatch is a compile error
- **WHEN** the backend returns a response shape that does not match the shared type definition
- **THEN** TypeScript compilation fails with a type error before the code can run

---

### Requirement: Backend package (Fastify application shell)
The `packages/backend` package SHALL contain a minimal Fastify application that starts successfully, registers a health endpoint, and connects to PostgreSQL and Redis using environment variables. No feature routes are required at this stage.

#### Scenario: Application starts
- **WHEN** `npm run dev` is run in `packages/backend` with valid environment variables
- **THEN** the Fastify server starts and logs a startup message including the port it is listening on

#### Scenario: Health endpoint responds
- **WHEN** `GET /health/ready` is called on the running backend
- **THEN** the response is `200 OK` with a JSON body indicating PostgreSQL and Redis status, and `503 Service Unavailable` if either dependency is unreachable

#### Scenario: Missing environment variable fails fast
- **WHEN** `DATABASE_URL` or `REDIS_URL` is absent at startup
- **THEN** the application exits with a descriptive error message identifying the missing variable

---

### Requirement: Frontend package (React application shell)
The `packages/frontend` package SHALL contain a minimal React application built with Vite that renders a placeholder page and compiles without errors. No UI features are required at this stage.

#### Scenario: Frontend dev server starts
- **WHEN** `npm run dev` is run in `packages/frontend`
- **THEN** the Vite dev server starts and the application is accessible in a browser

#### Scenario: Frontend build produces distributable output
- **WHEN** `npm run build` is run in `packages/frontend`
- **THEN** Vite produces a `dist/` directory with minified HTML, JS, and CSS assets

---

### Requirement: TypeScript configuration
A base `tsconfig.base.json` SHALL exist at the project root with shared compiler options. Each package SHALL extend this base and add package-specific overrides. Compiler options SHALL enforce: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.

#### Scenario: Strict mode catches implicit any
- **WHEN** a TypeScript file uses an implicit `any` type without explicit annotation
- **THEN** TypeScript compilation fails with an error

#### Scenario: Package configs extend the base
- **WHEN** the TypeScript compiler processes any package
- **THEN** it resolves the base `tsconfig.base.json` from the project root and applies its settings

---

### Requirement: Linting configuration
ESLint SHALL be configured at the project root with a shared configuration covering all TypeScript files across all packages. The linter SHALL enforce consistent code style and catch common TypeScript errors. `npm run lint` at the project root SHALL lint all packages.

#### Scenario: Lint passes on clean scaffold
- **WHEN** `npm run lint` is run on the freshly created scaffold
- **THEN** ESLint reports no errors or warnings

#### Scenario: Unused imports are flagged
- **WHEN** a TypeScript file contains an unused import
- **THEN** ESLint reports an error for that file

---

### Requirement: Backend authentication middleware
The backend SHALL include authentication middleware (`packages/backend/src/auth/middleware.ts`) that validates the session cookie on every protected request. Requests without a valid session SHALL receive a 401 response with a structured `AuthError` body. The middleware SHALL be registered globally with explicit exclusions for public routes: `/health`, `/auth/login`, `/auth/callback`, `/auth/logout`, and `/api/join/`.

#### Scenario: Protected route without session
- **WHEN** a request without a valid session cookie is sent to a protected API route
- **THEN** the application responds with 401 and `{ error: { category: "session_expired", message: "Please sign in to continue.", correlationId: "<uuid>" } }`

#### Scenario: Health endpoint remains public
- **WHEN** a request without a session cookie is sent to `GET /health/live` or `GET /health/ready`
- **THEN** the application responds normally without requiring authentication

#### Scenario: Auth and join routes remain public
- **WHEN** a request is sent to `/auth/login`, `/auth/callback`, `/auth/logout`, or `/api/join/:token`
- **THEN** the middleware does not enforce session validation

---

### Requirement: Backend authentication route module
The backend SHALL include route handlers for `GET /auth/login` (initiates OIDC redirect), `GET /auth/callback` (handles IdP response), `POST /auth/logout` (sign-out with optional confirmation), and `GET /auth/session` (returns current session info). These routes SHALL be registered as a Fastify plugin in `packages/backend/src/routes/auth.ts` with prefix `/auth`.

#### Scenario: Auth routes registered
- **WHEN** the Fastify application starts
- **THEN** the routes `/auth/login`, `/auth/callback`, `/auth/logout`, and `/auth/session` are registered and accessible

---

### Requirement: Backend join link route module
The backend SHALL include route handlers for `POST /api/teams/:teamId/join-links` (creates a join link) and `GET /api/join/:token` (redeems or initiates join flow). These routes SHALL be registered as a Fastify plugin in `packages/backend/src/routes/join-links.ts`.

#### Scenario: Join link routes registered
- **WHEN** the Fastify application starts
- **THEN** the routes `/api/teams/:teamId/join-links` and `/api/join/:token` are registered and accessible

---

### Requirement: Shared auth-related types
The `@dipstick/shared` package SHALL export types related to authentication from `packages/shared/src/types/auth.ts`: `AuthSession` (user identity, team memberships, session metadata), `JoinLink` (join link metadata), `AuthErrorCategory` (union of error categories), and `AuthError` (structured error response for authentication failures).

#### Scenario: Backend imports auth types from shared
- **WHEN** the backend TypeScript code imports `AuthSession` or `AuthErrorCategory` from `@dipstick/shared`
- **THEN** the TypeScript compiler resolves the import without errors

#### Scenario: Frontend imports auth types from shared
- **WHEN** the frontend TypeScript code imports `AuthError` or `JoinLink` from `@dipstick/shared`
- **THEN** the TypeScript compiler resolves the import without errors

---

### Requirement: Frontend auth context provider
The frontend SHALL include an auth context provider that wraps the application, tracks the current authentication state via the `/auth/session` endpoint, and redirects unauthenticated users to `/auth/login`. The provider SHALL expose the current user's identity and team memberships to child components.

#### Scenario: Unauthenticated user redirected
- **WHEN** the frontend auth context detects no valid session (401 from `/auth/session`)
- **THEN** the user is redirected to `/auth/login`

#### Scenario: Authenticated user identity available
- **WHEN** a user is authenticated and the auth context is loaded
- **THEN** child components can access the user's display name, email, and team memberships via the auth context

---

### Requirement: Backend auth module structure
The backend authentication logic SHALL be organized under `packages/backend/src/auth/` with the following modules: `oidc-client.ts` (OIDC discovery, authorization URL, token exchange, refresh, end-session), `session-store.ts` (Redis store creation, session data building, token encryption/decryption), `account-resolver.ts` (upsert-based account resolution from ID token claims), `middleware.ts` (request-level session validation, absolute lifetime, token refresh), `error-handler.ts` (error categorization and message mapping), `audit-logger.ts` (structured audit event emission), and `token-encryption.ts` (AES-256-GCM encryption/decryption).
