## ADDED Requirements

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
