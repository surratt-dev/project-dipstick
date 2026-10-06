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
| `OIDC_ROLE_MAP` | JSON map from IdP claim values to application roles. **Required in production and on every deployment whose `OIDC_ISSUER` is not a local address**, whatever its `NODE_ENV`. See [OIDC role map](#oidc-role-map). |

Optional:

| Variable | Description |
|---|---|
| `TOKEN_ENCRYPTION_KEY` | Encryption key for refresh tokens in Redis (falls back to `SESSION_SECRET`) |
| `OIDC_ROLE_CLAIM` | Name of the ID token claim that carries roles or groups (default: `role`; e.g. `groups` or `roles`) |
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
  -e OIDC_ROLE_CLAIM=groups \
  -e OIDC_ROLE_MAP='{"Eng-Managers":"engineering_manager","Retro-Facilitators":"facilitator","Dipstick-Admins":"application_admin"}' \
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

### OIDC role map

The application has five fixed internal roles: `engineer`, `senior_engineer`, `facilitator`, `engineering_manager` and `application_admin`. Your IdP sends its own group or role names. `OIDC_ROLE_MAP` translates those names into internal roles. It is a JSON object: each key is a value your IdP puts in the `OIDC_ROLE_CLAIM` claim, and each value is the internal role it grants.

```bash
OIDC_ROLE_CLAIM=groups
OIDC_ROLE_MAP='{"Eng-Managers":"engineering_manager","Retro-Facilitators":"facilitator","Dipstick-Admins":"application_admin","Senior-Engineers":"senior_engineer"}'
```

**Permitted targets:** `application_admin`, `engineering_manager`, `facilitator`, `senior_engineer`. `engineer` is not a valid target: it is the fixed default for anyone whose claim maps to nothing, so a group mapped to it could only hide a manager.

**Matching rules**

- **Exact and case-sensitive.** `Eng-Managers` does not match `eng-managers`. If your IdP varies case, list both spellings.
- **Keys must be what the token actually carries.** If your IdP sends group IDs (for example Entra ID object GUIDs) rather than names, the keys must be those IDs.
- **String or array claims both work.** `"groups": ["A", "B"]` is matched value by value. Non-string elements are ignored.
- **Several matches resolve to the highest role**, in the fixed order `application_admin > engineering_manager > facilitator > senior_engineer > engineer`. The order is not configurable.
- Keys must be non-empty, without leading or trailing spaces, without control or zero-width characters (zero-width space, word joiner, BOM; these often arrive by copy-paste from an IdP console and would make the key silently never match), and must not repeat. Boot fails if any rule is broken.
- **An empty value counts as unset.** `OIDC_ROLE_MAP=` (or whitespace only) is the same as not setting it.

**When the map is required (boot fails without it)**

- **Production** (`NODE_ENV=production`): the map must be set, and at least one key must target `engineering_manager`. Without a manager mapping every manager would sign in as an engineer and the no-manager rule would fail open silently. If your organisation genuinely has no managers in the IdP, map a placeholder group that nobody belongs to, for example `{"Dipstick-No-Managers":"engineering_manager"}`, as a documented choice.
- **Any deployment whose `OIDC_ISSUER` is not a local address, whatever its `NODE_ENV`** (staging, UAT, a mislabelled `NODE_ENV=prod`). Boot fails with `OIDC_ROLE_MAP is required when OIDC_ISSUER is not a local address`. An issuer the application cannot classify counts as not local.
- Only local development (non-production `NODE_ENV` **and** a local issuer such as the `http://localhost:4011` stub) may leave the map unset. It then gets a built-in identity map in which each internal role string maps to itself.
- **Any deployment that uses a real IdP must set `OIDC_ROLE_MAP`, even on a private network.** "Local" here includes the private ranges `10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16` (the same check the dev persona login uses), so a real self-hosted IdP at, say, `https://10.1.2.3` would otherwise get the identity default. That default exists only for the bundled stub.

> **The manager guard proves a key exists, not that it matches anyone.** A typo, a case mismatch, a renamed group, an Entra overage or the placeholder workaround all pass it. Do not cite a successful boot as evidence that managers are excluded. Check the counts line below and the sign-in warnings.

**Boot output.** The role map is validated before the server starts. Its lines are plain text (not JSON logs) and all contain the fixed prefix `OIDC_ROLE_MAP`, so grep for it. A successful boot prints any warnings first and the summary line last:

```
OIDC_ROLE_MAP: no IdP value maps to facilitator; no user will be able to run a session
OIDC_ROLE_MAP: source=configured engineering_manager=1 facilitator=0 application_admin=1 senior_engineer=0
```

A failed boot prints a single `FATAL` line, no summary, and exits with code 1:

```
FATAL: OIDC_ROLE_MAP: key "Eng-Managers" targets "engineer", which is not permitted (engineer is the fixed default every unmapped user already receives, so it cannot be mapped)
```

The summary line shows the source (`configured` or `default`) and how many keys map to each role, never the keys themselves. A warning is printed for each of `facilitator`, `application_admin` and (outside production) `engineering_manager` that no key targets. **Group names can appear in deploy logs on a failed boot.** A validation error names the offending key and target, though never the whole map. Claim values from users' tokens are never logged.

**Entra ID group overage.** When a user is in more groups than fit in the token, Entra omits the `groups` claim and sends `_claim_names.groups` instead. That user would silently resolve to `engineer`. The application logs a warning with `reason: "claim_overage"` (claim name only) when this happens. Prefer **Entra app roles** (`OIDC_ROLE_CLAIM=roles`) over groups. They are assigned per application and are not subject to overage.

**Broad groups.** The application cannot see how many people are in a group. Never map a broad group such as `Everyone` or `All-Staff` to an elevated role. An unexpectedly high `application_admin` count in the boot line is a warning sign.

**Sign-in warnings** (JSON logs, each carrying `correlationId` and the claim name, never claim values):

- `claimName` only: the user's claim had values but none matched the map.
- `reason: "claim_overage"`: see above.
- `resolvedRole` + `discardedRoles`: the user matched several roles and lower-precedence `facilitator` or `engineering_manager` roles were discarded. Use this to find group conflicts (see the checklist below).

**When changes take effect (revocation timing).** Roles are re-resolved only at an **interactive sign-in**. Token refresh does not re-resolve them; a unit test (`middleware.test.ts`, "refreshSessionTokens does not re-resolve the role") pins this. A change to the map needs a restart, and a change to the map or to a user's IdP groups reaches that user at their next sign-in. The absolute session lifetime of 90 minutes forces that sign-in, so **an IdP-side demotion, including removal of `application_admin`, can take up to about 90 minutes to apply.** Restarting the backend does not shorten this, because sessions live in Redis. Once `users.global_role` changes, every authorization check that reads it, including WebSocket event delivery and the periodic WebSocket re-authorization sweep, applies the new value on its next evaluation.

**Runbook: urgent revocation.** Change the group in the IdP **and** apply the change in the application now. No per-user session-invalidation tool exists yet (follow-up 7 in `openspec/changes/configurable-oidc-role-map/follow-ups.md`). Until one does:

1. **Find the user by identity key, not email.** Email comes from a claim, is not unique, and can change. Use the user's IdP subject (`sub`) and the issuer, and make sure exactly one row comes back:

   ```bash
   docker exec -i <postgres-container> psql -U dipstick -d dipstick -c \
     "SELECT id, global_role FROM users WHERE oidc_subject = '<sub>' AND oidc_issuer = '<OIDC_ISSUER>';"
   ```

2. **Demote the row.** Every authorization check reads it live, including WebSocket event delivery and the periodic re-authorization sweep:

   ```bash
   docker exec -i <postgres-container> psql -U dipstick -d dipstick -c \
     "UPDATE users SET global_role = 'engineer' WHERE id = '<id from step 1>';"
   ```

   At the user's next sign-in the role is re-resolved from the IdP, which by then no longer carries the group. **This manual update writes no `audit_log` row**, so record it in your change log.

3. **Optionally sign the user out now.** Session keys are named by session id (`dipstick:session:<sessionId>`), not by user, so scan them and delete the ones whose value carries that user's id:

   ```bash
   USER_ID='<id from step 1>'
   redis-cli -u "$REDIS_URL" --scan --pattern 'dipstick:session:*' | while read -r key; do
     redis-cli -u "$REDIS_URL" GET "$key" | grep -q "\"userId\":\"$USER_ID\"" && redis-cli -u "$REDIS_URL" DEL "$key"
   done
   ```

4. **If the user is facilitating a session that is already open**, demoting them does not stop it: a facilitator can keep starting, revealing, advancing and completing a session they already opened (follow-up 1). End that session, or wait for it to complete, as part of the revocation.

#### Group hygiene checklist

- [ ] At least one group maps to `facilitator`. Without one, nobody can run a session.
- [ ] People who facilitate are **not** also in the admin or manager groups. They resolve to the higher role and cannot run a session.
- [ ] **People in the manager group are not also in the admin group.** They resolve to `application_admin`, so they cannot be associated with teams as managers or use the manager views, and, like every admin, cannot take part in sessions.
- [ ] The admin group holds only people who administer Dipstick. **Application admins cannot join, vote in or receive live events of any session**, even in teams they belong to.
- [ ] Find conflicts by searching sign-in logs for `discardedRoles`; join to the sign-in by `correlationId`.
- [ ] After a map or group change, affected users must sign in again (or wait out the ~90-minute bound above).
- [ ] Do not change the map while sessions are live. A facilitator demoted mid-session is not removed from the session they are running (follow-up 1).

#### Upgrading

**Breaking change in the configurable OIDC role map release (#243).** After this release, the backend **fails to boot** in production without `OIDC_ROLE_MAP`, and on **any** deployment whose `OIDC_ISSUER` is not a local address without it, whatever its `NODE_ENV`.

1. **Before upgrading**, set `OIDC_ROLE_MAP` on every deployment whose `OIDC_ISSUER` is not a local address. Production also needs at least one `engineering_manager` key. Normally add `facilitator` and `application_admin` keys too. If your IdP already sends the internal role strings in the role claim, this map keeps today's behaviour:

   ```bash
   OIDC_ROLE_MAP='{"application_admin":"application_admin","engineering_manager":"engineering_manager","facilitator":"facilitator","senior_engineer":"senior_engineer"}'
   ```

   **New grants:** an IdP that already sends `facilitator` or `senior_engineer` on the configured claim will now grant those roles at the users' next sign-in.
2. **Deploy**, then grep the boot output for `OIDC_ROLE_MAP:`. Check `source=configured` and the counts, and read any warnings.
3. **Post-deploy check:** a designated facilitator signs in again and creates a draft session. A successful boot alone does not prove this works.
4. **Behaviour changes for application admins:** admins can no longer register in, vote in or receive live events of sessions, even in teams they belong to. A refused admin sees the generic no-access state. The vote lock-in `403` message is now `"You are not eligible to lock in votes in this session."` for every rejected caller (formerly `"Engineering Managers cannot lock in votes."`).
5. **Rollback: check whether it is safe first.** The previous release ignores `OIDC_ROLE_MAP` and only accepts the internal strings `engineering_manager` and `application_admin` on the role claim. No schema changed.
   - **Identity map** (your IdP already sends the internal role strings): rollback is safe. Users granted `facilitator` or `senior_engineer` by this release drop back to `engineer` at their next sign-in.
   - **Translating map** (keys are your IdP's group or role names, e.g. `OIDC_ROLE_CLAIM=groups`): **rollback demotes every mapped user to `engineer` at their next sign-in, including every manager and every admin.** Managers are then admitted to live sessions as engineers, with no error and no audit signal, which re-opens the no-manager rule. Admins lose admin access. **Do not roll back** such a deployment until the IdP has been switched to send the internal strings (`engineering_manager`, `application_admin`) on the configured claim for the right people. Safe procedure: (1) configure the IdP to emit `engineering_manager` or `application_admin` for the members of the mapped groups as a **single string value** on a claim (the previous release does not understand array claims such as `groups`), and point `OIDC_ROLE_CLAIM` at that claim; (2) verify on the current release, with that claim and an identity map, that managers and admins still resolve correctly (boot line, then a manager signs in and the `auth.role_claim_mapped` audit row shows `engineering_manager`); (3) only then redeploy the previous release. If you must roll back immediately, stop running sessions until managers can be re-verified.

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

**Topic writes fail closed on Redis.** The five Topic Management write endpoints (add, archive, restore, reorder, team definition) answer `503 TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE` when Redis is unreachable or slower than 500 ms, because their per-actor rate limit cannot be checked (`harden-topic-write-endpoints`, #184). Session runtime (room open, start, voting, WebSocket) is unaffected. Limiter keys live under `dipstick:ratelimit:topic-write:` and expire on their own; the `topic.write_rate_limit_check_failed` and `topic.write_rate_limit_exceeded` events are log-only (a breach episode's first 429 also writes a `topic.write_rate_limited` `audit_log` row).

### Logging

Audit events are emitted via `emitAuditEvent` (`packages/backend/src/auth/audit-logger.ts`) at the `info` level, with the child logger's level explicitly overridden so application-wide log-level changes (e.g. raising Fastify's logger to `warn`) cannot suppress them. **This override does not protect against transport-level filtering.** If you configure a pino transport (a log shipper, a `pino-*` destination, anything set via `transport` in Fastify's `logger` option) that applies its own level filter below `info`, audit events will be silently dropped downstream of this logger, with no indication in the application that anything was lost.

Many audit events also write an `audit_log` database row in the same transaction as the state change — that row is the authoritative audit record and is unaffected by log transport configuration (role changes, rate-limit breaches, action-item status changes, EM data-access reads, admin reads, and most session/WebSocket-lifecycle events all fall in this category). Most of the `auth.*`/`join.*` trail now also falls in this category (`auth-events-audit-log-coverage`): `auth.success`, `auth.session_created`, `auth.first_access_created`, `auth.role_claim_mapped`, `auth.idp_logout_failed`, `join.link_created`, and `join.link_redeemed` each write a durable `audit_log` row — the fail-open group (`auth.success`, `auth.session_created`, `auth.idp_logout_failed`) via a bounded-timeout write that never blocks the triggering response, the transactional group (`auth.first_access_created`, `auth.role_claim_mapped`, `join.link_created`, `join.link_redeemed`) in the same transaction as the domain write it accompanies. See `openspec/specs/auth-error-handling/spec.md` and `openspec/specs/join-link/spec.md` for the exact mechanism and field shapes.

**What remains log-only, with no database backing anywhere in this codebase:** `auth.session_invalidated` remains a partial exception as before (marked below); four events remain deferred pending a volume/latency determination that no queryable data source exists to answer today (tracked as GitHub issue #156, filed during `auth-events-audit-log-coverage`'s proposal stage) — `auth.authorization_initiated`, `auth.callback_received`, `auth.failure` (all three call sites), and `join.link_rejected` (all five call sites). `auth.audit_write_failed` is deliberately never DB-backed (see the footnote below). Seven further events are also log-only: the two `auth.token_refresh_*` events and five unrelated to the auth/join trail. In total, 13 events remain at risk if a filtering transport is introduced:

- `auth.*`: `auth.authorization_initiated`, `auth.callback_received`, `auth.failure`, `auth.session_invalidated`\*, `auth.token_refresh_success`, `auth.token_refresh_failure`, `auth.audit_write_failed`
- `join.*`: `join.link_rejected`
- `team.access_grant_mismatch`
- `team.manager_association_rate_approaching`
- `team.manager_association_rate_limit_check_failed`
- `session.reveal_latency_observed`
- `topic.config_read_denied_role`

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
