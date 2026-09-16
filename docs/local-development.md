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
| OIDC stub   | 4011           | **4011** (bound to `127.0.0.1` only — see [Local OIDC provider](#local-oidc-provider)) |

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

> **Known issue (pre-existing, not specific to the persona login shortcut):** `GET /auth/callback` in `packages/backend/src/routes/auth.ts` reconstructs the callback URL from `request.hostname`, which Fastify reports without the port. Against this stack's default `http://localhost:3000`, the reconstructed URL loses `:3000`, the `redirect_uri` the token exchange derives from it no longer matches the one used at the authorization step, and the stub IdP rejects the code exchange with `invalid_grant` — this affects every sign-in, persona shortcut or manual password entry alike, and predates this change. Flagged for a follow-up fix; not addressed here because it lives in `auth.ts`'s callback handler, which this change does not modify.

### Signing in

When an unauthenticated request hits any route, the frontend checks whether the persona login shortcut is available (`GET /auth/dev-login-options`, bounded by a 300ms timeout). This check only ever succeeds locally — it is double-gated on `NODE_ENV !== "production"` AND the configured `OIDC_ISSUER` resolving to a private/local address, so it is a hard `404` in any deployed environment, with no added latency there.

When it succeeds, you land on a **"LOCAL DEV ONLY — PERSONA LOGIN"** page instead of the generic IdP form: one button per seeded test account below, labeled with its role and account id. Clicking a button starts a completely normal OIDC Authorization Code + PKCE sign-in — the button only pre-selects which account the stub IdP's interaction screen auto-approves (via the standard `login_hint` parameter); it does not skip or shortcut the exchange itself. The Facilitator button is labeled by account id alone, with an inline note that its role is not seeded (see the Test accounts table below).

If the persona login page isn't shown (a deployed environment, or the check times out), or you click **"Sign in manually"**, you land on the stub IdP's plain login form — enter the **account ID** as the login and `password` as the password (the stub does not actually verify the password).

### Test accounts

| Login (account ID) | Password | Name | Email | `global_role` on sign-in |
|---|---|---|---|---|
| `participant-001` | `password` | Alex Participant | participant@example.com | default (`engineer`) — not seeded |
| `facilitator-001` | `password` | Sam Facilitator | facilitator@example.com | default (`engineer`) — **not seeded**; signs in as a default user, not a Facilitator. `facilitator` is not on the application's role-claim allowlist, so there is currently no way to seed this account with a real Facilitator role. A single identity also can't exercise cross-team facilitation — that needs separate team-scoped fixtures, which don't exist yet. |
| `manager-001` | `password` | Morgan Manager | manager@example.com | **`engineering_manager`** — real, via the OIDC `role` claim |
| `admin-001` | `password` | Riley Admin | admin@example.com | **`application_admin`** — real, via the OIDC `role` claim |

`manager-001` and `admin-001` carry an OIDC `role` claim in the stub's account definitions (`docker/oidc/server.js`), asserted in the ID token on every sign-in. The backend's existing role-claim mapping (`OIDC_ROLE_CLAIM`, `account-resolver.ts`) reads that claim and sets `users.global_role` accordingly — the same mechanism a real IdP's role claim would use, not a separate seeding path. `facilitator-001` and `participant-001` carry no `role` claim and are unaffected.

### Testing multiple personas at once

Each persona button (or a manual sign-in) starts a normal, independent session — there's no new tooling for running several at once. To have, say, a Facilitator and a Participant signed in simultaneously, use **separate browser profiles or incognito/private windows**, one session cookie per window, exactly as you would with any cookie-based app.

### How the stub IdP works

- **Protocol:** OIDC Authorization Code + PKCE with `offline_access` scope for refresh tokens
- **Token lifetimes:** access token 1 hour, refresh token 8 hours, session 8 hours
- **Claims returned:** `sub`, `name`, `email`, and `role` (only for `manager-001`/`admin-001` — see Test accounts above)
- **Refresh tokens:** issued when `offline_access` scope is requested (which the backend always requests)
- **Logout:** supports RP-initiated logout; the backend will redirect to the IdP's `end_session_endpoint` on logout
- **State:** entirely in-memory — restarting the `oidc` container clears all sessions, which will invalidate any active browser sessions
- **Network exposure:** the container's port is bound to `127.0.0.1:4011` only, not all host interfaces. The persona login shortcut turns a single unauthenticated `login_hint=<account-id>` request into a full sign-in with no credential of any kind, so this port must not be reachable beyond the machine running the stack — same reasoning that already applied to the plain login form, just more consequential now that it takes one request instead of a submitted password.

### Scopes and claims

The backend requests `openid profile email offline_access`. The stub IdP returns:

- `sub` — unique identifier for the account (used as `oidc_subject` in the database)
- `name` — display name
- `email` — email address
- `role` — only for `manager-001` and `admin-001` (see Test accounts above); read by the backend's existing `OIDC_ROLE_CLAIM` mapping to set `users.global_role`

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
