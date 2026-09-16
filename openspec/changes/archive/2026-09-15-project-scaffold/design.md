## Context

Project Dipstick has complete, reviewed requirements documentation (BRD, architecture ADRs, database schema, REST API contract) but no source code. The architecture document (ADR-001 through ADR-007) has already resolved the significant decisions: TypeScript full-stack, Fastify backend, React frontend, shared type layer, PostgreSQL for persistence, Redis for ephemeral session state, OIDC authentication with a simulated provider for local dev.

This scaffold creates the runnable foundation. It does not implement any features — it establishes the structure, tooling, and infrastructure that feature development will grow on top of.

## Goals / Non-Goals

**Goals:**
- Create the monorepo package structure with working TypeScript compilation across all three packages
- Stand up local dev services (Postgres + Redis + simulated OIDC) via Docker Compose with a single command
- Apply the designed database schema through a versioned migration system
- Wire shared types between backend and frontend so API contract mismatches are caught at compile time
- Provide a working `npm run dev` that starts the backend and frontend concurrently
- Remove the stale `HELP.md` Spring Boot artifact

**Non-Goals:**
- Implement any application features (auth flow, session management, live voting)
- Configure CI/CD pipeline or Kubernetes manifests (addressed in a later change)
- Connect to a real OIDC identity provider (Microsoft Entra is production-only per NFR-AUTH-002)
- Configure production secrets management

## Decisions

### Monorepo tooling: npm workspaces

**Decision:** Use npm workspaces (native, no additional tooling).

**Rationale:** The project has exactly three packages (shared, backend, frontend) with well-defined boundaries. npm workspaces handles cross-package dependencies and hoisting without the learning curve of Turborepo, Nx, or pnpm. The project doesn't need incremental build caching or complex task orchestration at this scale. Keeping the toolchain minimal reduces maintenance surface.

**Alternatives considered:**
- pnpm workspaces: stricter hoisting behavior is beneficial at scale but unnecessary here
- Turborepo: adds caching and pipeline orchestration — overkill for three packages with simple build dependencies

---

### Migration tool: node-postgres-migrate (`node-pg-migrate`)

**Decision:** Use `node-pg-migrate` for schema migrations.

**Rationale:** Pure Node.js, no separate JVM or binary required. Migrations are JavaScript/TypeScript files, consistent with the rest of the stack. Well-established (widely used in the Node.js + PostgreSQL ecosystem). Supports up/down migrations and timestamped versioning. The architecture document specifies a "versioned migration system" without mandating a specific tool; this satisfies that requirement with minimal friction.

**Alternatives considered:**
- Flyway: requires Java runtime — adds a dependency on a runtime the project has deliberately moved away from
- Prisma Migrate: brings ORM coupling; the project uses raw SQL (the schema is already written in SQL); Prisma's migration model would require re-expressing the schema as a Prisma schema file
- Knex.js migrations: lighter weight but requires Knex as a query builder dependency; the project doesn't need a query builder

---

### Simulated OIDC provider: `node-oidc-provider`

**Decision:** Use `node-oidc-provider` as the local-dev identity provider, run as a separate service in Docker Compose.

**Rationale:** The BRD (NFR-AUTH-002) explicitly requires a simulated OIDC provider for local and developer machine testing. `node-oidc-provider` is a full OIDC server implementation that supports all token flows the application will use (authorization code flow with PKCE, refresh tokens, token introspection). Running it as a Docker Compose service means it's always available alongside Postgres and Redis without any per-developer setup.

**Alternatives considered:**
- Keycloak: full-featured but heavy (JVM, significant memory); overkill for a simulated local provider
- MockServer / WireMock: would require hand-crafting OIDC token responses; doesn't enforce real OIDC protocol behavior, which defeats the validation purpose
- `oidc-provider` npm package embedded in the backend: couples the simulated provider to application code; running it as a separate service keeps the boundary clean

---

### Package structure

```
project-dipstick/
├── packages/
│   ├── shared/          ← Domain types; consumed by backend and frontend
│   │   ├── src/
│   │   │   └── types/   ← User, Team, Session, Vote, ActionItem, Topic
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── backend/         ← Fastify application
│   │   ├── src/
│   │   │   └── index.ts ← App entry point (minimal: server starts, health endpoint)
│   │   ├── migrations/  ← node-pg-migrate migration files
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── frontend/        ← React application (Vite)
│       ├── src/
│       │   └── main.tsx ← App entry point (minimal: renders placeholder)
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
├── docker-compose.yml
├── package.json         ← Workspace root
└── tsconfig.base.json   ← Shared TS compiler options
```

---

### Frontend bundler: Vite

**Decision:** Use Vite for the React frontend.

**Rationale:** Fast dev server with HMR. First-class TypeScript support. Simple configuration. No meaningful trade-off at this stage — this is a greenfield React app with no legacy bundler constraints.

---

### Test runner: Vitest

**Decision:** Use Vitest across backend and frontend.

**Rationale:** Native TypeScript support, no separate ts-jest configuration. Compatible with Vite's module resolution. Same API as Jest, so familiar. Configured once in the workspace root.

## Risks / Trade-offs

**Risk: `node-pg-migrate` migration file format** → The designed schema SQL can be copied directly into migration files, but `node-pg-migrate` wraps SQL in JS/TS modules. Minor formatting work required; not a blocker.

**Risk: Shared types package resolution in Vite** → Vite's module resolution must be configured to resolve `@dipstick/shared` from the local workspace package rather than node_modules. Requires explicit `resolve.alias` in `vite.config.ts`. Known pattern; well-documented.

**Risk: simulated OIDC provider configuration** → `node-oidc-provider` requires explicit configuration of clients, accounts, and scopes. A minimal but complete configuration must be provided for local dev. The configuration file should live in `docker/oidc/` and be documented clearly so developers can add test accounts.

**Risk: Docker Compose port conflicts** → Developers may have local Postgres or Redis instances running on default ports. Docker Compose service ports should be mapped to non-default local ports (e.g., Postgres on 5433, Redis on 6380) to avoid conflicts, with documentation noting this.

## Migration Plan

This is a greenfield scaffold — there is no existing code to migrate. The implementation steps are additive only.

Rollback (if scaffold needs to be unwound): delete the created package directories and Docker Compose file. No data migration is required since there is no production deployment.

## Open Questions

- **Linting configuration:** ESLint with a shared config at the workspace root, or per-package configs? Recommend a single `eslint.config.mjs` at the root with package-level overrides as needed.
- **Test accounts for simulated OIDC:** How many pre-seeded test users are needed for local dev? Recommend at minimum: one `engineer`, one `facilitator`, one `engineering_manager`, one `application_admin`. These should be documented in the local setup guide.
