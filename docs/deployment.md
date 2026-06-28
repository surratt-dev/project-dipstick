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

## Kubernetes

The README lists Kubernetes as the production deployment target. The image tags above work directly in Kubernetes manifests or Helm values. Key considerations:

- Use the semver tag (e.g., `1.0.0`) in production manifests, not `main` or `latest`.
- Store secrets (`SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `DATABASE_URL`) in Kubernetes Secrets, not ConfigMaps.
- Configure a liveness/readiness probe against `/health/ready`.
- Run database migrations as an init container or a pre-upgrade Job, not as part of the application startup.
