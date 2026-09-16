## Why

The Engineering Health Check application has complete, reviewed requirements (BRD, architecture, database schema, REST API contract) but no source code exists yet. The project needs a runnable foundation — a monorepo with the agreed-upon tech stack, local development environment, and database migrations — before any feature development can begin.

## What Changes

- Create a TypeScript monorepo with three packages: `shared` (domain types), `backend` (Fastify application), and `frontend` (React application)
- Add `docker-compose.yml` for local development services: PostgreSQL, Redis, and a simulated OIDC provider
- Apply the designed PostgreSQL schema via a versioned migration system
- Establish the build pipeline: TypeScript compilation, linting, and test runner configured across all packages
- Wire shared TypeScript types between backend and frontend so API contract mismatches are compile-time errors
- Remove stale Spring Boot artifact (`HELP.md`)

## Capabilities

### New Capabilities

- `project-structure`: Monorepo layout, package configuration, TypeScript setup, and shared tooling (lint, test, build scripts) across all three packages
- `local-dev-environment`: Docker Compose service definitions for PostgreSQL, Redis, and simulated OIDC provider; environment variable configuration; local setup documentation
- `database-migrations`: Migration tooling wired to the designed PostgreSQL schema; seed data for default topics and application settings; migration runbook

### Modified Capabilities

<!-- None — this is a greenfield scaffold with no existing capabilities to modify -->

## Impact

- Creates `/packages/shared`, `/packages/backend`, `/packages/frontend` directory structure at project root
- Adds `package.json` (root workspace), `tsconfig.json` files, Docker Compose configuration
- Introduces runtime dependencies: Fastify, React, `node-pg-migrate` (or equivalent), `pg`, `ioredis`
- Introduces dev dependencies: TypeScript, ESLint, Vitest (or Jest), `node-oidc-provider` (simulated OIDC)
- Removes `HELP.md` (stale Spring Boot artifact)
- No production deployment changes — this is local dev and CI scaffold only
