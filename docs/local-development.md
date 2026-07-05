# Local Development Guide

## Prerequisites

- Node.js 22+
- Docker and Docker Compose
- npm 10+

## First-time setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create your environment file**

   ```bash
   cp .env.example .env
   ```

   The defaults in `.env.example` are pre-configured for the Docker Compose services below — no changes needed for local development.

3. **Build shared types** (required before starting the backend)

   ```bash
   npm run build --workspace=packages/shared
   ```

## Starting the stack

Local development requires three things running simultaneously.

### 1. Infrastructure (Docker Compose)

Starts PostgreSQL, Redis, and the local OIDC provider:

```bash
docker compose up
```

Wait for all three services to report healthy before starting the backend. Ports used:

| Service    | Container port | Host port |
|------------|----------------|-----------|
| PostgreSQL  | 5432           | **5433**  |
| Redis       | 6379           | **6380**  |
| OIDC stub   | 4011           | **4011**  |

Ports are offset from their defaults to avoid conflicts with locally-installed services.

### 2. Backend

```bash
npm run dev --workspace=packages/backend
```

Runs on **http://localhost:3000** with `tsx watch` for hot reload.

### 3. Frontend

```bash
npm run dev --workspace=packages/frontend
```

Runs on **http://localhost:5173**. Vite proxies `/api` and `/auth` requests to the backend at `localhost:3000`, so the frontend never makes cross-origin requests during development.

### Shortcut: run backend and frontend together

```bash
npm run dev
```

This starts both backend and frontend concurrently (Docker Compose must still be running separately).

---

## Database migrations

Migrations run automatically when the backend starts in development mode. To run them manually:

```bash
npm run db:migrate --workspace=packages/backend
```

To roll back one step:

```bash
npm run db:migrate:down --workspace=packages/backend
```

---

## Local OIDC provider

The Docker Compose stack includes a stubbed OIDC identity provider built with [`oidc-provider`](https://github.com/panva/node-oidc-provider). It implements a full OIDC Authorization Code flow with PKCE and refresh tokens — the backend cannot tell it apart from a real IdP.

**Discovery endpoint:** http://localhost:4011/.well-known/openid-configuration

### Signing in

When you click "Sign in", the backend redirects you to the stub IdP's login UI (served at `localhost:4011`). You will see a plain login form — enter the **account ID** as the login and `password` as the password.

### Test accounts

| Login (account ID) | Password | Name | Email | Intended role |
|---|---|---|---|---|
| `participant-001` | `password` | Alex Participant | participant@example.com | Participant |
| `facilitator-001` | `password` | Sam Facilitator | facilitator@example.com | Facilitator |
| `manager-001` | `password` | Morgan Manager | manager@example.com | Engineering Manager |
| `admin-001` | `password` | Riley Admin | admin@example.com | Admin |

> **Note:** Accounts are seeded into the stub IdP's in-memory store at startup. The *application-level* role (stored in the database) is assigned separately and may differ from the account's implied role above until seed data is applied.

### How the stub IdP works

- **Protocol:** OIDC Authorization Code + PKCE with `offline_access` scope for refresh tokens
- **Token lifetimes:** access token 1 hour, refresh token 8 hours, session 8 hours
- **Claims returned:** `sub`, `name`, `email`
- **Refresh tokens:** issued when `offline_access` scope is requested (which the backend always requests)
- **Logout:** supports RP-initiated logout; the backend will redirect to the IdP's `end_session_endpoint` on logout
- **State:** entirely in-memory — restarting the `oidc` container clears all sessions, which will invalidate any active browser sessions

### Scopes and claims

The backend requests `openid profile email offline_access`. The stub IdP returns:

- `sub` — unique identifier for the account (used as `oidc_subject` in the database)
- `name` — display name
- `email` — email address

The `iss` (issuer) claim is `http://localhost:4011`.

### RSA signing key

The stub IdP uses a hardcoded RSA key pair to sign tokens. This key is checked into the repository and is **only used for local development** — it must never be used in any deployed environment.

---

## Health checks

Once all services are running, verify the backend is healthy:

```bash
curl http://localhost:3000/health/ready
```

A healthy response looks like:

```json
{"postgres":"ok","redis":"ok"}
```

A `503` response means one or both backing services are not reachable.

---

## Project structure

```
packages/
  shared/     # Domain types shared between backend and frontend
  backend/    # Fastify API server (port 3000)
  frontend/   # React + Vite app (port 5173)
docker/
  oidc/       # Local OIDC stub provider (port 4011)
```

The frontend resolves `@dipstick/shared` directly to the TypeScript source during development (via a Vite alias), so changes to shared types are reflected immediately without a rebuild step.
