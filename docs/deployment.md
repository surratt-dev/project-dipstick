# Deployment Guide

## Pulling Images from GitHub Packages

The Docker workflow publishes container images to GitHub Container Registry (GHCR) on every push to `main` and on version tags.

### Available image tags

| Tag | Example | When updated |
|---|---|---|
| Branch name | `ghcr.io/<owner>/project-dipstick:main` | Every push to `main` |
| Semver | `ghcr.io/<owner>/project-dipstick:1.0.0` | On `v1.0.0` tag |
| Semver minor | `ghcr.io/<owner>/project-dipstick:1.0` | On any `v1.0.x` tag |
| Commit SHA | `ghcr.io/<owner>/project-dipstick:sha-a1b2c3d` | Every push |

Replace `<owner>` with the GitHub organization or username that owns the repository.

### Authentication

GHCR requires authentication to pull images, even from public repositories in some configurations.

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <github-username> --password-stdin
```

Use a personal access token (classic) with `read:packages` scope, or a fine-grained token with Packages read permission.

### Pulling an image

```bash
# Latest from main
docker pull ghcr.io/<owner>/project-dipstick:main

# Specific release
docker pull ghcr.io/<owner>/project-dipstick:1.0.0
```

## Running the Application

### Required environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `SESSION_SECRET` | Cookie signing key (min 32 characters in production) |
| `OIDC_ISSUER` | OpenID Connect provider issuer URL |
| `OIDC_CLIENT_ID` | OIDC client ID |
| `OIDC_CLIENT_SECRET` | OIDC client secret |
| `OIDC_REDIRECT_URI` | OAuth callback URL (e.g., `https://dipstick.example.com/auth/callback`) |
| `NODE_ENV` | Must be `production` for deployed environments |
| `APP_ORIGIN` | Application URL for CORS (required when `NODE_ENV=production`) |

Optional:

| Variable | Description |
|---|---|
| `TOKEN_ENCRYPTION_KEY` | Encryption key for refresh tokens in Redis (falls back to `SESSION_SECRET`) |
| `PORT` | HTTP listen port (default: `3000`) |

### Docker run

```bash
docker run -d \
  --name dipstick \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@db-host:5432/dipstick \
  -e REDIS_URL=redis://redis-host:6379 \
  -e SESSION_SECRET=your-production-secret-at-least-32-chars \
  -e OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0 \
  -e OIDC_CLIENT_ID=your-client-id \
  -e OIDC_CLIENT_SECRET=your-client-secret \
  -e OIDC_REDIRECT_URI=https://dipstick.example.com/auth/callback \
  -e NODE_ENV=production \
  -e APP_ORIGIN=https://dipstick.example.com \
  ghcr.io/<owner>/project-dipstick:1.0.0
```

### Docker Compose (production example)

```yaml
services:
  app:
    image: ghcr.io/<owner>/project-dipstick:1.0.0
    ports:
      - "3000:3000"
    env_file: .env.production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: dipstick
      POSTGRES_USER: dipstick
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dipstick -d dipstick"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
  redisdata:
```

### Database migrations

Migrations must be run before starting the application after an upgrade. From a machine with access to the database:

```bash
DATABASE_URL=postgresql://user:pass@db-host:5432/dipstick \
  npx node-pg-migrate -m migrations up
```

Or exec into the running container if it includes the migration files:

```bash
docker exec dipstick npm run db:migrate --workspace=packages/backend
```

### Health check

Once running, verify the application and its dependencies are healthy:

```bash
curl http://localhost:3000/health/ready
```

A `200` response means PostgreSQL and Redis are both reachable.

### Logging

Audit events are emitted via `emitAuditEvent` (`packages/backend/src/auth/audit-logger.ts`) at the `info` level, with the child logger's level explicitly overridden so application-wide log-level changes (e.g. raising Fastify's logger to `warn`) cannot suppress them. **This override does not protect against transport-level filtering.** If you configure a pino transport (a log shipper, a `pino-*` destination, anything set via `transport` in Fastify's `logger` option) that applies its own level filter below `info`, audit events will be silently dropped downstream of this logger, with no indication in the application that anything was lost.

Many audit events also write an `audit_log` database row in the same transaction as the state change — that row is the authoritative audit record and is unaffected by log transport configuration (role changes, rate-limit breaches, action-item status changes, EM data-access reads, admin reads, and most session/WebSocket-lifecycle events all fall in this category). Most of the `auth.*`/`join.*` trail now also falls in this category (`auth-events-audit-log-coverage`): `auth.success`, `auth.session_created`, `auth.first_access_created`, `auth.role_claim_mapped`, `auth.idp_logout_failed`, `join.link_created`, and `join.link_redeemed` each write a durable `audit_log` row — the fail-open group (`auth.success`, `auth.session_created`, `auth.idp_logout_failed`) via a bounded-timeout write that never blocks the triggering response, the transactional group (`auth.first_access_created`, `auth.role_claim_mapped`, `join.link_created`, `join.link_redeemed`) in the same transaction as the domain write it accompanies. See `openspec/specs/auth-error-handling/spec.md` and `openspec/specs/join-link/spec.md` for the exact mechanism and field shapes.

**What remains log-only, with no database backing anywhere in this codebase:** `auth.session_invalidated` remains a partial exception as before (marked below); four events remain deferred pending a volume/latency determination that no queryable data source exists to answer today (tracked as GitHub issue #156, filed during `auth-events-audit-log-coverage`'s proposal stage) — `auth.authorization_initiated`, `auth.callback_received`, `auth.failure` (all three call sites), and `join.link_rejected` (all five call sites). `auth.audit_write_failed` is deliberately never DB-backed (see the footnote below). Five further events unrelated to the auth/join trail are also log-only. In total, 12 events remain at risk if a filtering transport is introduced:

- `auth.*`: `auth.authorization_initiated`, `auth.callback_received`, `auth.failure`, `auth.session_invalidated`\*, `auth.token_refresh_success`, `auth.token_refresh_failure`, `auth.audit_write_failed`
- `join.*`: `join.link_rejected`
- `team.access_grant_mismatch`
- `team.manager_association_rate_approaching`
- `team.manager_association_rate_limit_check_failed`
- `session.reveal_latency_observed`

This means a filtering transport still puts a meaningful slice of the authentication trail at risk — pre-authentication events, all failure classifications, and rejected join attempts have no database fallback — even though the "who logged in, when, created their account, had their role mapped, or joined a team" record now does.

\* `auth.session_invalidated` is a partial exception (`http-auth-audit-log-coverage`): at all four of its HTTP-side call sites (`middleware.ts`'s absolute-timeout, revoked-token, and exhausted-retry branches; `auth.ts`'s `/auth/logout` handler) it also writes a real `audit_log` row, bounded by a single 500ms timeout covering both DB round trips and fail-open on either an explicit error or that timeout — a DB outage never blocks the triggering 401/logout response. When that write fails, this event's occurrence falls back to log-only for that one occurrence (today's pre-change baseline, not zero evidence), and a sustained failure of the write path emits `auth.audit_write_failed` as a paired, purely log-only detectability signal — writing a DB row about the DB being unreachable isn't a real fallback, so that event never gets one. `auth-events-audit-log-coverage` extends this same `auth.audit_write_failed` signal to the fail-open group's three events (`auth.success`, `auth.session_created`, `auth.idp_logout_failed`), and adds an accurate `errorClass: "AuditWriteError"` to the existing `auth.callback_error` log line for the transactional group's own failure mode (see design.md Decision D3/D7) — both named as candidate inputs for GitHub issue #131 ("No monitoring consumer exists for any `AuditEventName` signal"), which remains open: neither `auth.audit_write_failed` nor any other `AuditEventName` in this codebase is consumed by an alert rule, anomaly-detection job, or dashboard today.

**Before adopting any pino transport with a level filter:** revisit `emitAuditEvent` in `audit-logger.ts` — the child-logger level override protects against the application log level only, and the transport will need its own accommodation (e.g. a level floor on the transport config, or routing audit events to an unfiltered destination) to keep the events above from going dark.

**Future consideration (deferred, GitHub issue #3):** a startup check that verifies audit events actually reach their configured sink was requested in issue #3 but is not built in this change, because no transport is configured anywhere in this codebase today — building a reachability check against a failure mode that doesn't yet exist would be premature engineering. This is not a nice-to-have to revisit "if" the `emitAuditEvent` rework above happens to get to it: given the events above, a filtering transport shipped without this check risks silently losing the authentication and session-lifecycle audit trail with zero indication anything was lost. Build this check alongside the `emitAuditEvent` rework, before that transport goes to production.

## Kubernetes

The README lists Kubernetes as the production deployment target. The image tags above work directly in Kubernetes manifests or Helm values. Key considerations:

- Use the semver tag (e.g., `1.0.0`) in production manifests, not `main` or `latest`.
- Store secrets (`SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `DATABASE_URL`) in Kubernetes Secrets, not ConfigMaps.
- Configure a liveness/readiness probe against `/health/ready`.
- Run database migrations as an init container or a pre-upgrade Job, not as part of the application startup.
