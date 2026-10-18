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
     "UPDATE users SET global_role = 'engineer', roles = '{engineer}' WHERE id = '<id from step 1>';"
   ```

   Set both `global_role` and `roles` (#245): `roles` holds the user's full role set and must stay consistent with `global_role`. At the user's next sign-in the role is re-resolved from the IdP, which by then no longer carries the group. **This manual update writes no `audit_log` row**, so record it in your change log.

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
- [ ] **No manager is in the facilitator group**, including skip-level managers and directors who are not in the manager group. A facilitator must not be in the reporting chain of the team they facilitate. The application only refuses a facilitator who is a member of the team; it does not know reporting lines yet (#247), so this rule is yours to keep. See `requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`.
- [ ] **People in the manager group are not also in the admin group.** They resolve to `application_admin`, so they cannot be associated with teams as managers or use the manager views, and, like every admin, cannot take part in sessions.
- [ ] The admin group holds only people who administer Dipstick. **Application admins cannot join, vote in or receive live events of any session**, even in teams they belong to.
- [ ] **Keep Application Administrator team memberships rare** (guidance, not a control; #208). An administrator who is a team's engineering manager can read that team's definitions and change its agenda (archive, restore, reorder, add). Review `team_memberships` rows held by `application_admin` users at each access review; each should have a stated reason. The same applies to IdP group overlap: an administrator who is also in the manager or facilitator IdP group bypasses those groups' restrictions on topic configuration (role precedence resolves them to `application_admin`); the access row's `actor_roles` / `actor_idp_roles_include_em` show the manager case.
- [ ] Find conflicts. For sign-ins after migration 21 (#245), run the "conflict query" below, which lists sign-ins whose IdP claim mapped to both the manager and the facilitator role. It covers only sign-ins after migration 21 was applied: earlier audit rows carry no `roles` field. For earlier sign-ins, search sign-in logs for `discardedRoles` and join to the sign-in by `correlationId`.
- [ ] After a map or group change, affected users must sign in again (or wait out the ~90-minute bound above).
- [ ] Do not change the map while sessions are live. A facilitator demoted mid-session is not removed from the session they are running (follow-up 1).

Conflict query (asserted by `sign-in-audit-role-set-integration.test.ts`):

```sql
SELECT timestamp, actor_user_id, operation, metadata->'roles' AS roles
FROM audit_log
WHERE operation IN ('auth.first_access_created', 'auth.role_claim_mapped')
  AND metadata->'roles' @> '["engineering_manager", "facilitator"]'::jsonb
ORDER BY timestamp DESC;
```

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

**Storing the IdP role set (#245): migrations 21 and 22.** This release adds `users.roles` (the full set of roles the IdP claim maps to) and `audit_log.actor_roles`. It changes nothing users see or can do: every check still reads `global_role`, and facilitators refused today are still refused. No configuration change is needed.

1. **The normal procedure is unchanged.** Apply the migrations as usual (see "Database migrations" below, with `--no-single-transaction`), before or during the rollout. The previous build keeps working against the migrated schema: migration 21 adds a transitional trigger (`users_roles_fill_legacy`) that fills `roles` for a build that writes only `global_role`. It is the first trigger on `users` and stays until follow-up F1 removes it.
2. **Locking.** Migration 21 holds a lock on `users` for at most 1 s (measured: under 0.1 s on 10,000 users) and waits at most 5 s to get it, so a sign-in during the migration can wait up to about 6 s, once; live votes and open rooms are unaffected. Migration 22 waits at most 200 ms for `audit_log`, below the audit write timeouts, so no request fails because of it. If either migration fails on a lock timeout, the command exits non-zero and rolls that migration back; re-run it (already-applied migrations are skipped). Running outside session hours is recommended, not required.
3. **Rollback order is mandatory.** First redeploy the previous build and confirm no instance of this build is still serving. Then, optionally, run the down migrations, 22 first, then 21. Never the reverse: running 21's down while this build serves breaks sign-in, and 22's down breaks its sign-in audit write. The previous build runs correctly on the migrated schema, so the down migrations are not required. They drop only the new columns, the constraint, the trigger and its functions; `global_role` is untouched.
4. **For auditors.** Existing users are backfilled to `roles = {global_role}`, which can under-record their real set. Each user's first `auth.role_claim_mapped` row after migration 21 therefore shows the backfilled set as `previousRoles`: that difference reflects the backfill, not an IdP change. The next sign-in records the full set.

### Database migrations

Migrations must be run before starting the application after an upgrade. From a machine with access to the database:

```bash
DATABASE_URL=postgresql://user:pass@db-host:5432/dipstick \
  npx node-pg-migrate -m migrations up --no-single-transaction
```

Keep `--no-single-transaction` (as `npm run db:migrate` does): without it every pending migration runs in one transaction, so migrations 21 and 22 share one lock window and an audit write can queue behind the `users` lock.

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

Many audit events also write an `audit_log` database row in the same transaction as the state change — that row is the authoritative audit record and is unaffected by log transport configuration (role changes, rate-limit breaches, action-item status changes, EM data-access reads, and most session/WebSocket-lifecycle events all fall in this category). Admin reads (`admin.membership_list_accessed`, `admin.team_detail_accessed`, and TOPIC-002's `admin.topic_config_accessed`, #232, #208) also write a durable row, but not in a transaction: the row is written after the data is read and before the response is sent, and if the write fails the request fails closed (`500`, none of the data returned). If the data was served, the record exists; a row can exist for a response that never reached the client (over-record, never under-record). Most of the `auth.*`/`join.*` trail now also falls in this category (`auth-events-audit-log-coverage`): `auth.success`, `auth.session_created`, `auth.first_access_created`, `auth.role_claim_mapped`, `auth.idp_logout_failed`, `join.link_created`, and `join.link_redeemed` each write a durable `audit_log` row — the fail-open group (`auth.success`, `auth.session_created`, `auth.idp_logout_failed`) via a bounded-timeout write that never blocks the triggering response, the transactional group (`auth.first_access_created`, `auth.role_claim_mapped`, `join.link_created`, `join.link_redeemed`) in the same transaction as the domain write it accompanies. See `openspec/specs/auth-error-handling/spec.md` and `openspec/specs/join-link/spec.md` for the exact mechanism and field shapes. Since migration 22 (#245), `audit_log.actor_roles` holds the actor's full role set on `auth.first_access_created` and `auth.role_claim_mapped` rows, and (from #232) on `admin.topic_config_accessed` rows; no other operation writes it. (The retired `admin.topic_config_denied` operation, #232, also wrote it; #208 removed that operation, and its historical rows are left as they are.) **NULL in `actor_roles` means the actor's role set was not captured for that operation, not that the actor had no roles.**

**What remains log-only, with no database backing anywhere in this codebase:** `auth.session_invalidated` remains a partial exception as before (marked below); four events remain deferred pending a volume/latency determination that no queryable data source exists to answer today (tracked as GitHub issue #156, filed during `auth-events-audit-log-coverage`'s proposal stage) — `auth.authorization_initiated`, `auth.callback_received`, `auth.failure` (all three call sites), and `join.link_rejected` (all five call sites). `auth.audit_write_failed` is deliberately never DB-backed (see the footnote below). Ten further events are also log-only: the two `auth.token_refresh_*` events and eight unrelated to the auth/join trail. In total, 16 events remain at risk if a filtering transport is introduced:

- `auth.*`: `auth.authorization_initiated`, `auth.callback_received`, `auth.failure`, `auth.session_invalidated`\*, `auth.token_refresh_success`, `auth.token_refresh_failure`, `auth.audit_write_failed`
- `join.*`: `join.link_rejected`
- `team.access_grant_mismatch`
- `team.manager_association_rate_approaching`
- `team.manager_association_rate_limit_check_failed`
- `session.reveal_latency_observed`
- `topic.config_read_denied_role`
- `topic.config_read_unknown_team` (#265): log-only probing signal, no `audit_log` row by decision (2026-10-12). Fired by TOPIC-002 when a standing facilitator or an application admin requests a well-formed team id that names no team, just before the `404`; carries `{ userId, teamId, globalRole }` and no topic data. Never fired for a caller who fails authorization. A burst from one `userId` is the signal
- `topic.audit_write_failed` (#264): log-only, no consumer, tracked by #131; grep for it. It fires at error level when TOPIC-002's non-admin denial row (`topic.config_list_denied`) cannot be written (insert error or the 500 ms timeout). The 403 the caller sees is unchanged; the event carries who, which team and which denial reason, with the SQLSTATE only. A sustained burst means the `audit_log` table is unavailable, and the administrator arm of the same endpoint (which fails closed with 500) will show it too
- `admin.*`: `admin.audit_write_failed` (#232, design D5b) — deliberately never DB-backed: it fires when TOPIC-002's administrator-arm role-set read or `admin.topic_config_accessed` insert fails (the access-row path is the only one since #208), and a database row about the database failing to take a row is not a fallback

**TOPIC-002 non-admin denials (`topic.config_list_denied`, #264).** Every denied `GET /api/v1/teams/:teamId/topics/all` (a caller who is not a facilitator or an application admin, or a facilitator who is a member of the team) writes one durable `audit_log` row and emits a matching event of the same name. Unlike the administrator arm, this write is fail-open: a failed or timed-out insert never changes the 403 (the audited event is a refusal, not a disclosure); it emits the log-only `topic.audit_write_failed` instead (listed above; nothing alerts on it, #131). `audit_log.actor_roles` is also populated on these rows (NULL when the caller has no `users` row). `team_id` is the requested id, not a verified team. No application endpoint or screen reads these rows: access is database and log-sink operators only. **`FACILITATOR_IS_TEAM_MEMBER` rows are informational:** a member facilitator opening their own team's Topic Management produces one on every page load, so their volume is not a signal and no one should alert on it; `NOT_A_FACILITATOR` is the probing signal. Rows are never deduplicated and follow the existing `audit_log` retention policy (there is no table-specific purge today), so `audit_log` growth now includes one row per denied request on this route.

This means a filtering transport still puts a meaningful slice of the authentication trail at risk — pre-authentication events, all failure classifications, and rejected join attempts have no database fallback — even though the "who logged in, when, created their account, had their role mapped, or joined a team" record now does.

\* `auth.session_invalidated` is a partial exception (`http-auth-audit-log-coverage`): at all four of its HTTP-side call sites (`middleware.ts`'s absolute-timeout, revoked-token, and exhausted-retry branches; `auth.ts`'s `/auth/logout` handler) it also writes a real `audit_log` row, bounded by a single 500ms timeout covering both DB round trips and fail-open on either an explicit error or that timeout — a DB outage never blocks the triggering 401/logout response. When that write fails, this event's occurrence falls back to log-only for that one occurrence (today's pre-change baseline, not zero evidence), and a sustained failure of the write path emits `auth.audit_write_failed` as a paired, purely log-only detectability signal — writing a DB row about the DB being unreachable isn't a real fallback, so that event never gets one. `auth-events-audit-log-coverage` extends this same `auth.audit_write_failed` signal to the fail-open group's three events (`auth.success`, `auth.session_created`, `auth.idp_logout_failed`), and adds an accurate `errorClass: "AuditWriteError"` to the existing `auth.callback_error` log line for the transactional group's own failure mode (see design.md Decision D3/D7) — both named as candidate inputs for GitHub issue #131 ("No monitoring consumer exists for any `AuditEventName` signal"), which remains open: neither `auth.audit_write_failed` nor any other `AuditEventName` in this codebase is consumed by an alert rule, anomaly-detection job, or dashboard today.

**Administrator topic-configuration rows: on-demand lookup (forensic, not monitored).** Since #208, every Application Administrator is admitted to a team's topic configuration whatever their membership on it (decision record: `requirements/use cases/08b - Member Admin Topic Writes - Decision.md`). The administrator audit rows are **forensic**: they are read after an incident or on request. Nobody monitors them, and there is no review cadence or owner. Rows that carry the topic configuration audit:

- `admin.topic_config_accessed` (every administrator read of TOPIC-002) carries no topic names, ids or definition text. It records the reader's live membership role on the team (`metadata.membership_role`, raw), `actor_roles` and `actor_idp_roles_include_em`.
- The `topic.*` write rows carry topic ids but no topic names or definition text: `topic.custom_added` and `topic.restored` carry `{ topic_id }`, `topic.archived` carries `{ topic_id, openActionItemCount }`, and `topic.reordered` carries `{ previous_order, new_order }` (arrays of topic ids). They carry no membership field. The actor's membership role at the time of a write is reconstructed from `team.role_changed` / manager-association audit history up to the write's timestamp, not from the current `team_memberships` row. This holds only for membership changes made through the application.

On request, administrator reads of topic configuration by a reader who manages the team, or whose stored role set includes engineering manager:

```sql
SELECT * FROM audit_log
 WHERE operation = 'admin.topic_config_accessed'
   AND (metadata->>'membership_role' = 'engineering_manager'
        OR 'engineering_manager' = ANY(actor_roles));
```

Note that `actor_roles` reflects `users.roles` at request time; a user who has not signed in since #245 still has the backfilled `{application_admin}`. Historical `admin.topic_config_denied` rows (#232, retired by #208) are left as they are.

**Default topic template anomalies (`template_anomaly`, `template_anomaly_check_failed`, #215).** After every successful `POST /api/v1/teams`, the application inspects the template team's topic rows (the `__default_topics__` team, id `00000000-0000-0000-0000-000000000001`). If the template is damaged, creation still succeeds (the copy takes only active defaults and renumbers positions 1..n; an archived default is valid state since #216, is never copied, and raises no anomaly, so `non_active_default` no longer exists) and exactly one `warn` log entry `template_anomaly` is written for that request, carrying `templateTeamId`, `anomalies` (`duplicate_active_order`, `non_contiguous_order`, `non_default_row`), `topicIds` (row ids only, at most 50) and `correlationId` (equal to the `reqId` on the request's other log lines). A persistent fault logs on every creation by design; nothing alerts on it yet (log-only, grep for it). `template_anomaly_check_failed` (warn) means the check itself could not run; creation was unaffected. A template with no active defaults is different: creation fails with a 500 and an error-level `default topic template is empty` entry. To inspect, read-only: `SELECT id, is_default, status, display_order FROM topics WHERE team_id = '00000000-0000-0000-0000-000000000001' ORDER BY display_order, id;` (add `name` only if you need it, the log never carries it). The Engineering Manager owns triage; repair is a data fix made by a database operator and is not part of the application.

**Before adopting any pino transport with a level filter:** revisit `emitAuditEvent` in `audit-logger.ts` — the child-logger level override protects against the application log level only, and the transport will need its own accommodation (e.g. a level floor on the transport config, or routing audit events to an unfiltered destination) to keep the events above from going dark.

**Future consideration (deferred, GitHub issue #3):** a startup check that verifies audit events actually reach their configured sink was requested in issue #3 but is not built in this change, because no transport is configured anywhere in this codebase today — building a reachability check against a failure mode that doesn't yet exist would be premature engineering. This is not a nice-to-have to revisit "if" the `emitAuditEvent` rework above happens to get to it: given the events above, a filtering transport shipped without this check risks silently losing the authentication and session-lifecycle audit trail with zero indication anything was lost. Build this check alongside the `emitAuditEvent` rework, before that transport goes to production.

## Zero-topic teams

*(`zero-topic-team-recovery`, #200.)* A team with no ACTIVE topic cannot open a room: room open answers `409 NO_ACTIVE_TOPICS`, and while the team is locked (no completed session) nobody can add or restore a topic either. New teams cannot end up this way (team creation rolls back on an empty template), so this is legacy data or a data fault, and the expected count is 0.

**Preferred first step when restorable archived defaults exist (#218):** "Restore default topics" on the team's Topic Management screen (`POST /api/v1/teams/:teamId/topics/restore-defaults`; a facilitator who is not a member of the team, or an administrator). It reactivates the original archived default rows with their history. Use assign-defaults below when nothing is restorable.

**Recovery is in-app, by an application administrator**, on the team's Topic Management screen ("Assign default topics"; endpoint `POST /api/v1/teams/:teamId/topics/assign-defaults`). It copies the template's current active topics onto the team and changes nothing else. It is not a hand-run database fix; the manual path below is a last resort.

**Find zero-topic teams** (run it read-only; a result other than 0 rows needs a product owner decision about a one-off repair):

```sql
SELECT t.id FROM teams t
WHERE t.id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM topics WHERE team_id = t.id AND status = 'active');
```

Also check for legacy lobby sessions that would pass room open with no snapshot (`/start` has no guard): `SELECT s.id FROM sessions s WHERE s.status = 'lobby' AND NOT EXISTS (SELECT 1 FROM session_topics st WHERE st.session_id = s.id);` should return 0 rows.

**Who may read `audit_log` from the application (#271):** the structural test `packages/backend/src/routes/__tests__/audit-log-reader-structural.test.ts` lists every application query that reads `audit_log` and checks that each one serving a non-admin caller filters `operation` by equality on one non-admin operation; add a reader through its inventory, not around it. Database and log-sink operators are outside its scope.

**Audit lookups** (`audit_log.operation`, with the acting user in `actor_user_id` and the team in `team_id`; retention is the existing `audit_log` policy, there is no table-specific purge):

```sql
SELECT "timestamp", operation, actor_user_id, actor_global_role, team_id, metadata
FROM audit_log
WHERE operation IN ('topic.defaults_assigned', 'topic.defaults_assign_denied', 'topic.defaults_assign_failed', 'topic.defaults_restored', 'topic.restored')
ORDER BY "timestamp" DESC LIMIT 50;
```

- `topic.defaults_assigned`: a successful recovery; `metadata = { topic_count, correlation_id }`. Durable, written in the same transaction as the topics.
- `topic.defaults_assign_denied`: a non-admin was refused (`403 NOT_AN_ADMIN`); `team_id` is whatever the caller supplied (it may name no team). Fail-open, and bounded to **10 rows per actor per minute**: beyond that the caller still gets the 403 but no row is written and a log-only `topic.denial_audit_suppressed` event is emitted (once per window).
- `topic.defaults_restored` (#218): a bulk restore of archived defaults; one row per non-empty request, written in the same transaction as the status change; `metadata = { restored: [{topic_id, display_order}], skipped: [{topic_id, reason}] (capped at 100), restored_count, skipped_count }`, ids and positions only, never topic names. **Provenance queries must union `topic.restored` (single restore, one row per topic) and `topic.defaults_restored` (bulk, one row per request)**; `topics.restored_by` and `restored_at` are authoritative per topic in both paths but are overwritten by each later restore, so the audit log is the only history of earlier restores. Retention is the existing `audit_log` policy.
- `topic.defaults_assign_failed`: the template was empty (below). Join to the error log line by `metadata.correlation_id` = the log entry's `correlationId`.

**When the template is empty.** The administrator sees "The default topic template is empty or unavailable, so nothing was assigned..." (`500 DEFAULT_TOPICS_UNAVAILABLE`), nothing is written, and an error-level log line names the template team id and the correlation id (search the logs for `assign-defaults: the default topic template has no active topics`). The in-app button cannot help: restore the template's active default topics (the `__default_topics__` team's rows with `is_default = true`, `status = 'active'`) in the database, then have the administrator try again.

**Manual database path (last resort).** Any bulk repair script must apply the same precondition (zero ACTIVE topics, re-checked under the team's topic advisory lock `pg_advisory_xact_lock(hashtext(<team id>::text))`), copy the same canonical set, and write one `audit_log` row per team under the operation name `topic.defaults_assigned` with an actor value that identifies the operator.

**Redis outage.** Assignment goes through the topic-write rate limiter, which fails closed: while Redis is down an administrator gets `503 TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE` and recovery is unavailable until it returns. The denial-audit bound is a separate Redis limiter that fails to "write no row", so **a non-admin's refused attempt during a Redis outage leaves no `topic.defaults_assign_denied` row** (a log-only `topic.denial_audit_suppressed` event with `reason: "limiter_error"` is emitted instead); the response is still 403.

**Pre-production checklist for this endpoint (security).**
- `trustProxy` is configured for the real proxy topology (it is `1` in `app.ts`): `audit_log.actor_ip` on these rows, which attribute a lock bypass, is only as trustworthy as `request.ip`.
- Topic text is escaped at render in every consumer. Template content now reaches teams that did not review it; today only Topic Management renders topic text (React escaping, pinned by a render test). Re-check each new consumer, including the session snapshot view when it is built.
- The session cookie is `sameSite: strict` and CORS is a single-origin allowlist (`APP_ORIGIN`, which must not be a wildcard); this POST has no body and relies on both, like every other cookie-authenticated write.

**Deploy order and rollback.** Deploy the backend (and shared types) before the frontend: the screen reads `canAssignDefaults === true`, so a frontend that is ahead of its backend shows the ask-an-administrator copy with no button. Rollback removes the route and the `canAssignDefaults` flag; nothing is persisted that needs reverting except audit rows, which are history. No schema change is involved.

**Diagnostic counts to record.** Run the two queries above against each environment before release and after, and record the counts in `openspec/changes/zero-topic-team-recovery/tasks.md` (1.3, 1.4, 8.1). The counts recorded so far are from a local development database only.

## Default topic maintenance

*(`admin-default-topic-maintenance`, #216.)* The default topic set that new teams are created with (the template: the `__default_topics__` team's rows, `team_id = 00000000-0000-0000-0000-000000000001`) is maintained by an application administrator through seven API routes under `/api/v1/admin/default-topics`, with no migration. **There is no screen yet (FR-8.1 is "partially met, API only"; the Topic Management template screen is follow-up issues #308 (read-only view and history) and #309 (editing)), so the first users read this section, not a UI.** Every change applies to **teams created from now on**; existing teams keep their current topics. Recovering a zero-topic team (above) hands out the template **as of the moment of recovery**.

**Routes** (all `application_admin` only, role read live from `users.global_role`; membership is irrelevant; anyone else gets `403 DEFAULT_MAINTENANCE_ADMIN_ONLY`): `GET /api/v1/admin/default-topics` (the list, archived ones included, with `lastChangedAt` and `lastChangedBy`), `GET .../history?limit=` (newest-first audit rows with `before` and `after`; `limit` defaults to 50 and is capped at 200), `POST .../` (add), `PATCH .../:topicId` (edit name, prompt, first-session description; the vote type is fixed at creation), `POST .../:topicId/archive`, `POST .../:topicId/restore`, `PUT .../order` (`{ "order": [ids] }`, the whole active list). Archive, never delete: a retired default stays in the table with its history. Limits: 1 to 15 active defaults; name up to 60, prompt up to 400, first-session description up to 800 characters (code points); plain text only (no HTML, entities, links or invisible/control characters); an active default's name must be unique ignoring case and surrounding spaces. Writes share the per-actor topic-write rate limit (one budget, 120 per 10 minutes and 400 per day) with the Topic Management writes, so an administrator who is also a facilitator draws on one budget for both; the two GET routes are not rate limited. A write answers `503 DEFAULT_MAINTENANCE_BUSY` (with `Retry-After: 3`) and changes nothing if another maintenance change holds the template lock for more than 3 seconds, or its own statements run past 10 seconds; the GET routes take no lock.

**Writing a good prompt.** Prompts address the team and the work, never individuals, and the first topics of a session set its tone. Good: "How easy is it to reason about production code?"; "How confident are we that the test suite catches regressions?". Bad: "Is Priya's code too clever?"; "Who keeps breaking the build?"; "Why does the platform team ignore us?". A semantic filter was deliberately not built; the guards are the length limits, the plain-text check, the audit trail and review.

**Finding maintenance audit rows.** Each effective write commits exactly one `audit_log` row in the same transaction as the change (a no-op writes none). Select them with the explicit list of the five operation names and the template team id, **never with `LIKE 'topic.default_%'`** (`_` is a wildcard and would also match `topic.defaults_assigned`, `topic.defaults_assign_denied` and `topic.defaults_assign_failed`, which can carry the template's team id):

```sql
SELECT "timestamp", operation, actor_user_id, actor_global_role, host(actor_ip) AS actor_ip, metadata
FROM audit_log
WHERE team_id = '00000000-0000-0000-0000-000000000001'
  AND operation = ANY (ARRAY['topic.default_added','topic.default_edited','topic.default_archived','topic.default_restored','topic.default_reordered'])
ORDER BY "timestamp" DESC, id DESC LIMIT 50;
```

`metadata` is `{ topicId, operation, changedFields, before, after }` (a reorder has no `topicId` and its `before`/`after` are the full id lists). **These five operations are a scoped exception to the "no topic text in audit rows" convention**: they hold the full before and after name, prompt and description, because template text is global and there is no version table. Refusals are `topic.default_maintenance_denied` rows (`team_id` NULL; `metadata` is `endpoint` (the method plus the route template, never the raw URL), `http_status`, `reason` and `correlation_id`), bounded to 10 per actor per minute; beyond that only a log-only `topic.denial_audit_suppressed` event with `family: "/api/v1/admin/default-topics"` is emitted (its `suppressedCount` is sampled at 1, 2, 4, 8, ..., so it is not an exact count). During a Redis outage a refused attempt leaves no row (one log event per actor per minute says so).

**Undo means editing the value back.** There is no undo or revert operation. Read the history, take the row's `before` value, and `PATCH` it back (this writes a new audit row). A rename is not propagated: existing teams' topics are not renamed, and name-based matching for existing teams (single restore, bulk restore, the `defaultTopicsNotActive` list) stops pairing them with the renamed default. Restoring a default returns the team's own superseded wording, and teams created at different times can have different wording. These are accepted consequences, tracked in the follow-up issues (#307, #308, #309, #310, #311).

**Audit retention.** The five maintenance operations on the template are **exempt from routine `audit_log` retention** (they are few and small): any retention job must exclude rows with `team_id = '00000000-0000-0000-0000-000000000001'` and those five names. The list's per-row `lastChangedAt` and `lastChangedBy` are derived from these rows and silently become null if they are purged. They are not "never deletable": see the redaction procedure.

**Break-glass redaction (the only sanctioned mutation of `audit_log`).** An administrator can paste something that must not persist (a person's name, an internal hostname, a credential). A named database operator: (1) if the live template row still holds the text, first corrects it through the normal `PATCH` (which writes a new row holding the corrected text, never the bad one); (2) replaces the text fields of the affected audit row's `metadata.before` and `metadata.after` (and the same text in any later row that copied it) with a tombstone string, adds a `redacted: { "by": ..., "at": ..., "reason": ... }` marker to `metadata`, and leaves `timestamp`, `operation`, the `actor_*` columns and `metadata.topicId` untouched (so `lastChangedAt` is unaffected); (3) records the action in the incident log. No other edit of `audit_log` is sanctioned.

**Alert suggestion.** Every effective write emits one structured `info` log event named for its operation (`topic.default_added`, `topic.default_edited`, `topic.default_archived`, `topic.default_restored`, `topic.default_reordered`) after the change commits, carrying identifiers and `changedFields` only (never `before`, `after` or any text): `operation`, `topicId` (none for a reorder), `actorUserId`, `actorGlobalRole`, `actorIp`, `correlationId`. This is the detective control for a compromised administrator session, so alert on any `topic.default_*` event outside business hours or from an IP not seen before for that actor. A single administrator can rewrite every prompt every future team sees, with no second approver: reopen the single-admin decision if the number of administrators grows beyond a handful or after any incident.

**How `application_admin` is granted.** `users.global_role` is mapped from the IdP role claim at every sign-in (`OIDC_ROLE_CLAIM` / `OIDC_ROLE_MAP`, see "OIDC role map"). There is no in-app grant, so **the IdP group-assignment process is now part of this control**: whoever can put a user in the group mapped to `application_admin` can rewrite the default topics.

**What this audit trail relies on.** Audit integrity relies on database access control: the application's database role is not known to be denied `UPDATE` or `DELETE` on `audit_log`, so the table is not tamper-evident against someone with that role. `audit_log.actor_ip` is `request.ip` under `trustProxy: 1` and is only correct when exactly one trusted proxy fronts the app. CSRF defence has three parts: the `SameSite=Strict` session cookie, the single-origin CORS allow-list with `application/json`-only bodies (a `text/plain` or form body is refused with `415`), and, because archive and restore carry no body, a required custom header `X-Requested-With: dipstick` on every mutating route (`403 MUTATION_CONTROL_HEADER_REQUIRED` otherwise; checked after the role check). The server does not check `Origin` and there is no CSRF token. The header is allowed through CORS in `app.ts`; scripts and the future screen must send it.

**Limits of the denial audit (detective control).** Per actor, the first 10 refused attempts per minute write `topic.default_maintenance_denied` rows; later ones in the same window write nothing and are only logged as `topic.denial_audit_suppressed` at suppressed counts 1, 2, 4, 8, ..., so the exact number of refused attempts is not recoverable, only its order of magnitude. If the limiter store (Redis) errors, **no row and no per-denial event is written**; one `reason: "limiter_error"` event per actor per minute is the only trace, so treat that event as "denials unobserved" in alerting. The 403 path itself is not request-rate limited: each refused request costs one `users` query, one Redis call and the timing-floor wait, for any authenticated user (the same as `assign-defaults`; accepted). Holding the sentinel template lock can only delay other maintenance writes (`503 DEFAULT_MAINTENANCE_BUSY`); it cannot delay team creation, room open or a live session.

**Client and code rules.** A write that committed but whose refreshed list could not be read returns `200`/`201` with `listUnavailable: true` and no `defaults`: a client (the future screen) must treat a missing `defaults` as "reload the list", not as an empty template, or an administrator may re-add topics. In the backend, `request.body` must never be spread or merged in this route family (handlers pick `name`, `prompt`, `firstSessionDescription`, `voteType` by name): its JSON parser is hand-rolled and its `__proto__` guard is a literal substring check, so spreading the body would turn it into a prototype-pollution sink.

**Rendering contract.** Template text (name, prompt, description, and its audit and history copies) is inert data: every consumer must render it as text, with no raw-HTML sink, Markdown renderer or auto-linker. This, not the plain-text check, is the control against stored XSS. The follow-up screen carries the same requirement.

**Rollback.** No migration. Reverting the release removes the routes. Template rows written through them stay valid under the old code, except that an archived default makes the old `non_active_default` detector log a `template_anomaly` warning on each team creation (log noise only; creation is unaffected), and the old template-invariants test would fail in CI against a database that holds maintenance rows (CI databases are not production).

**Before the first production edit** (operational checklist, not a merge gate): one dry run on a non-production database with a facilitator: add, rename, archive, restore, reorder, read the history, edit a value back, creating a team after each step to confirm what it receives; record the outcome. After the first real edit, check one production audit row and one newly created team against the edit.

## Kubernetes

The README lists Kubernetes as the production deployment target. The image tags above work directly in Kubernetes manifests or Helm values. Key considerations:

- Use the semver tag (e.g., `1.0.0`) in production manifests, not `main` or `latest`.
- Store secrets (`SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `DATABASE_URL`) in Kubernetes Secrets, not ConfigMaps.
- Configure a liveness/readiness probe against `/health/ready`.
- Run database migrations as an init container or a pre-upgrade Job, not as part of the application startup.
