# Dipstick — Engineering Health Check

A web application that facilitates recurring Engineering Health Check sessions for engineering teams. Teams vote simultaneously on topics related to their development experience and codebase health; a facilitator from a different team guides the session and the application tracks results over time to surface trends.

The ritual replaces a fragile spreadsheet-based process. The application enforces the mechanics that make it work — simultaneous vote reveal, no engineering manager participation as voters, cross-team facilitator requirement — as structural constraints, not configurable options.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript (Vite) |
| Backend | Node.js + Fastify + TypeScript |
| Real-time | WebSockets |
| Database | PostgreSQL |
| Ephemeral state | Redis |
| Authentication | OIDC (Microsoft Entra in production; simulated provider for local dev) |
| Deployment | Kubernetes |

Shared TypeScript types are defined once in `packages/shared` and consumed by both backend and frontend, so API contract mismatches are caught at compile time.

## Requirements

The `requirements/` directory contains the full product specification:

- **BRD** (`BRD.md`) — Business requirements document covering functional requirements, ritual integrity constraints, security requirements, non-functional requirements, and organizational constraints. The authoritative reference for what the system must do and why.
- **Architecture** (`High-Level Architecture.md`) — Component design, data architecture, real-time architecture, authentication model, deployment architecture, and a full Architectural Decisions Record (ADR-001 through ADR-007).
- **Use cases** (`use cases/`) — Feature-level use cases organized by functional area: identity and access, session setup, live voting, outlier detection, session wrap-up, action item management, topic management, and trend reporting.
- **Database schema** (`design/database-schema.md`) — Complete PostgreSQL schema with rationale for every table and index, reviewed by the solution architect and business analyst.
- **REST API contract** (`design/REST API Contract.md`) — Full API surface with a companion validation report.

## Operating the Project

### Prerequisites

- Node.js 22+
- Docker (for local services)

### Local development

**1. Start backing services**

```bash
docker compose up -d
```

Starts PostgreSQL on `localhost:5433`, Redis on `localhost:6380`, and a simulated OIDC provider on `localhost:4011`.

**2. Configure environment**

```bash
cp .env.example .env
```

The example file is pre-configured for the Docker Compose services and requires no edits for local development.

**3. Apply database migrations**

```bash
npm run db:migrate --workspace=packages/backend
```

**4. Start the application**

```bash
npm install
npm run dev
```

Starts the Fastify backend on `http://localhost:3000` and the Vite frontend dev server on `http://localhost:5173` (with API requests proxied to the backend).

### Common commands

| Command | Description |
|---|---|
| `npm run build` | Compile all packages (shared → backend → frontend) |
| `npm run test` | Run Vitest across backend and frontend |
| `npm run lint` | ESLint across all packages |
| `npm run db:migrate --workspace=packages/backend` | Apply pending migrations |
| `npm run db:migrate:down --workspace=packages/backend` | Roll back the most recent migration |
| `docker compose up -d` | Start local services |
| `docker compose down` | Stop local services |

### Health check

Once running, `GET http://localhost:3000/health/ready` returns the status of PostgreSQL and Redis dependencies. A `200` response means both are reachable.

### Project structure

```
packages/
  shared/    — Domain TypeScript types (consumed by backend and frontend)
  backend/   — Fastify application; migrations in packages/backend/migrations/
  frontend/  — React application
docker/
  oidc/      — Simulated OIDC provider for local development
requirements/ — Full product specification (see Requirements above)
```
