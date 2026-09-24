## ADDED Requirements

### Requirement: Join link creation and redemption are durably recorded

Every `join.link_created` emission SHALL also produce an `INSERT INTO audit_log` row, written in the same database transaction as the `INSERT INTO join_links` it accompanies. Every `join.link_redeemed` emission SHALL also produce an `INSERT INTO audit_log` row, written in the same database transaction as the `INSERT INTO team_memberships` it accompanies, at **both** of its call sites: `GET /api/join/:token` (the already-authenticated direct path, in `join-links.ts`) and `executeJoinFlow` (the through-auth path, invoked from `GET /auth/callback` in `auth.ts`). If the audit `INSERT` fails at either call site, it SHALL be rethrown as an `AuditWriteError` (`packages/backend/src/auth/errors.ts`, matching the `auth-error-handling` capability's "OIDC library error sanitization" requirement) before the transaction rolls back, and the accompanying domain write (the join link's creation, or the team membership's creation) SHALL NOT be committed — this coupling is deliberate (see design.md Decision D3), matching the precedent already established for `team.manager_established`. If acquiring the transaction's database connection fails before the transaction begins, it SHALL likewise be rethrown as `AuditWriteError`, with no rollback attempted (none was opened). The audit `INSERT` at every call site in this requirement SHALL run with a shorter statement-level timeout than the fail-open group's write-level timeout, so a hung `INSERT` is cancelled by the database itself rather than left outstanding on the connection the subsequent `ROLLBACK` needs (design.md Decision D3). `join.link_redeemed`'s audit row SHALL be written only when the `INSERT INTO team_memberships ... ON CONFLICT DO NOTHING` actually inserts a new row — an idempotent re-join (an existing member following the link again) produces no audit row, matching the existing structured-log behavior. The existing structured `emitAuditEvent` call for `join.link_created` (and, when a row was inserted, `join.link_redeemed` at both call sites) SHALL fire only after its transaction commits successfully — never before, and never when the transaction rolls back.

**The two `join.link_redeemed` call sites' failure UX is asymmetric, deliberately not equalized:** `executeJoinFlow`'s call site runs inside `GET /auth/callback`'s try block, so its `AuditWriteError` is caught by that handler's existing catch block and classified via `mapAuthError`/`sanitizeOidcError` as `internal_error` with a retryable, non-redacted message (see `auth-error-handling`'s "OIDC library error sanitization" and "Distinct error messages for authentication failure modes" requirements). `join-links.ts`'s `GET /api/join/:token` — and its `POST /api/teams/:teamId/join-links` (`join.link_created`) — have no equivalent catch block; an `AuditWriteError` thrown there is not sanitized or reclassified and surfaces as Fastify's default error response, an ordinary 500. This is a real difference in failure UX between the two `join.link_redeemed` call sites, named here so it isn't read more broadly than it is: "identical treatment" in this requirement means identical audit-write-and-rollback mechanics, not identical error responses.

`team_id` SHALL be populated (not `NULL`) on every row produced by this requirement, from `link.team_id` or the route's own `:teamId` parameter — already unambiguous and in scope at every call site involved, unlike `auth.session_invalidated`'s call sites, none of which had an unambiguous team candidate. `actor_user_id` SHALL be the creating facilitator (`join.link_created`) or the joining user (`join.link_redeemed`). `actor_global_role` SHALL be the actor's `global_role`, resolved differently at each call site since it is not uniformly already in scope:
- At `join.link_created` (`POST /api/teams/:teamId/join-links`), it is already resolved earlier in the same handler via the existing facilitator-permission check — no additional lookup.
- At `executeJoinFlow`'s `join.link_redeemed` call site, it is passed in as a new required parameter (`actorGlobalRole: string`) from the caller's already-resolved value (`user.globalRole` in `GET /auth/callback`, resolved moments earlier in the same handler) — a parameter pass, not a lookup.
- At `join-links.ts`'s `GET /api/join/:token`'s `join.link_redeemed` call site, no such value is in scope anywhere in the handler — it issues a new `SELECT global_role FROM users WHERE id = $1` (using `session.userId`) before writing the audit row.

`actor_ip` SHALL be populated from the live request. `metadata` SHALL include `linkId` on both events, and `expiresAt` on `join.link_created`.

#### Scenario: Join link creation is recorded transactionally
- **WHEN** a facilitator creates a join link via `POST /api/teams/:teamId/join-links` and `join.link_created` is emitted
- **THEN** an `audit_log` row is written with `operation = 'join.link_created'` in the same transaction as the `join_links` INSERT, `team_id` populated from the route's `:teamId`, and `metadata` including `linkId` and `expiresAt`

#### Scenario: Direct-path join redemption is recorded transactionally
- **WHEN** an already-authenticated user redeems a join link via `GET /api/join/:token` and a new `team_memberships` row is inserted
- **THEN** `join.link_redeemed` is emitted and an `audit_log` row is written with `operation = 'join.link_redeemed'` in the same transaction as the `team_memberships` INSERT, with `team_id` populated

#### Scenario: Through-auth join redemption is recorded transactionally
- **WHEN** a user completes the OIDC flow with a pending join token, `executeJoinFlow` inserts a new `team_memberships` row, and `join.link_redeemed` is emitted
- **THEN** an `audit_log` row is written with `operation = 'join.link_redeemed'` in the same transaction as that INSERT, with `team_id` populated — identical audit-write-and-rollback mechanics to the direct path (not identical failure UX on a rollback — see below)

#### Scenario: Idempotent re-join produces no audit row
- **WHEN** a user who is already a member of a team redeems that team's join link again, at either call site, and `ON CONFLICT DO NOTHING` suppresses the insert
- **THEN** no `audit_log` row is written and no `join.link_redeemed` structured log entry is emitted, matching the existing pre-change behavior

#### Scenario: A failed audit write rolls back the join itself
- **WHEN** the `audit_log` INSERT accompanying a `join.link_created` or `join.link_redeemed` write fails inside the shared transaction
- **THEN** the accompanying `join_links` or `team_memberships` INSERT is rolled back
- **AND** the request fails rather than succeeding with a silently missing audit row
- **AND** the error rolled back and rethrown is an `AuditWriteError`, not the raw underlying database error, at every one of this requirement's call sites
- **AND** the structured log entry for that operation (`join.link_created` or `join.link_redeemed`) is never emitted — it fires only after a successful commit, never before and never after a rollback

#### Scenario: A failed connection acquisition fails the request the same way, with nothing to roll back
- **WHEN** the database connection for a `join.link_created` or `join.link_redeemed` transaction cannot be acquired (e.g. the connection pool is exhausted)
- **THEN** no `join_links` or `team_memberships` row is written, no `audit_log` row is written, and no structured log entry is emitted
- **AND** the resulting `AuditWriteError` is rethrown immediately, with no `ROLLBACK` attempted, since no transaction was opened

#### Scenario: The through-auth call site's failure is classified and retryable; the direct-path call sites' are not
- **WHEN** the `AuditWriteError` from `executeJoinFlow`'s `join.link_redeemed` transaction propagates into `GET /auth/callback`'s catch block
- **THEN** it is categorized as `internal_error` and the user is redirected to `/auth/error` with a retryable, non-redacted message
- **WHEN** the equivalent `AuditWriteError` is thrown from `join-links.ts`'s `join.link_created` transaction or the direct-path half of its `join.link_redeemed` transaction
- **THEN** it is not passed through `mapAuthError` or `sanitizeOidcError` — no equivalent catch block exists in that file — and the request fails with Fastify's default error response instead

#### Scenario: actor_global_role resolution differs by call site
- **WHEN** the `join.link_redeemed` audit row is written by `executeJoinFlow`
- **THEN** `actor_global_role` comes from the `actorGlobalRole` parameter, threaded from the caller's already-resolved `user.globalRole` — no database lookup is issued by `executeJoinFlow` for this value
- **WHEN** the `join.link_redeemed` audit row is written by `join-links.ts`'s `GET /api/join/:token`
- **THEN** `actor_global_role` comes from a `SELECT global_role FROM users WHERE id = $1` issued in that handler using `session.userId`, since no such value is available in scope otherwise

### Requirement: Join link rejection remains log-only

`join.link_rejected` SHALL NOT gain an `audit_log` database row as part of this capability, at any of its five call sites (three in `join-links.ts`'s `GET /api/join/:token`, two in `auth.ts`'s `executeJoinFlow`). It SHALL continue to be recorded only via its existing structured `emitAuditEvent` log entry. This deferral is tracked as GitHub issue #156, pending a volume determination (human-scale expired-link traffic vs. scanning-scale token-guessing against `/api/join/:token`) that no queryable data source exists to answer today.

#### Scenario: Rejected join link adds no database write
- **WHEN** a join link is rejected for any reason (not found, revoked, or expired) at either call site
- **THEN** only the existing structured log entry is produced; no `audit_log` INSERT is performed

### Requirement: Through-auth join rejections carry the acting user's id

`executeJoinFlow`'s two `join.link_rejected` structured-log emissions (the `not_found` and `revoked`-or-`expired` branches) SHALL include `userId`. Unlike `join-links.ts`'s `GET /api/join/:token` handler, whose three `link_rejected` branches fire before any session check and structurally have no `userId` available, `executeJoinFlow` runs only after the user is already authenticated and the `userId` parameter is already in scope at both of its rejection branches.

#### Scenario: Through-auth rejection log includes userId
- **WHEN** `executeJoinFlow` rejects a pending join token as not found, revoked, or expired
- **THEN** the resulting `join.link_rejected` structured log entry includes the authenticated user's `userId`, in addition to its existing `sourceIp`, `linkId`, and `reason` fields
