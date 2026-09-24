# join-link

## Purpose

Defines requirements for join link generation, validation, expiry, the join-link-through-authentication flow with destination preservation, session-aware landing, and batch arrival handling.

## Requirements

### Requirement: Join link generation
Facilitators (users with `facilitator`, `engineering_manager`, or `application_admin` global role, or `engineering_manager` team membership role) SHALL be able to generate join links for their teams via `POST /api/teams/:teamId/join-links`. Each join link SHALL contain a cryptographically random, URL-safe token (32 bytes, base64url-encoded). Join links SHALL expire after 7 days by default. Facilitators SHALL be able to generate new join links at any time; previously generated links remain valid until their individual expiry.

#### Scenario: Facilitator generates join link
- **WHEN** an authenticated user with appropriate role requests a join link for a team
- **THEN** the application creates a join link with a unique cryptographic token and an expiry 7 days from creation, and returns a `JoinLink` response with `id`, `teamId`, `token`, `createdAt`, and `expiresAt`

#### Scenario: Join link token is cryptographically random
- **WHEN** a join link is generated
- **THEN** the token is 32 bytes of cryptographic randomness, base64url-encoded

#### Scenario: Facilitator generates additional join link
- **WHEN** a facilitator requests a new join link for a team that already has an active link
- **THEN** a new link is created; previously generated links remain valid until their individual expiry

#### Scenario: Non-facilitator cannot generate join link
- **WHEN** a user without facilitator/manager/admin role attempts to create a join link
- **THEN** the application returns a 403 error

---

### Requirement: Join link validation
The application SHALL validate join links by checking that the token exists, has not expired, and has not been revoked. Invalid or expired links SHALL display the message: "This link has expired. Ask your facilitator for a new one." Nonexistent tokens SHALL display: "This link is not valid."

#### Scenario: Valid join link
- **WHEN** an authenticated user follows a join link (`GET /api/join/:token`) with a valid, non-expired token
- **THEN** the user is added to the team with `participant` role

#### Scenario: Expired join link
- **WHEN** a user follows a join link whose expiry has passed
- **THEN** the application redirects to an error page with message "This link has expired. Ask your facilitator for a new one." and does not add the user to any team

#### Scenario: Revoked join link
- **WHEN** a user follows a join link that has been revoked (`revoked_at` is set)
- **THEN** the application redirects to an error page with message "This link has expired. Ask your facilitator for a new one." and does not add the user to any team

#### Scenario: Nonexistent join link token
- **WHEN** a user follows a URL with a token that does not exist in the database
- **THEN** the application redirects to an error page with message "This link is not valid."

---

### Requirement: Join-link-through-authentication flow
An unauthenticated user who follows a join link SHALL be redirected to `/auth/login?joinToken=<token>`, which initiates the OIDC flow with the join token preserved in the OIDC `state` parameter (stored in Redis). After successful authentication (including First Access account creation if needed), the callback handler retrieves the pending join token from state and completes the join flow automatically. No manual steps SHALL occur between authentication and team membership.

**OIDC state retrieval is atomic:** The callback handler uses `redis.getdel` — a single atomic Redis command — to retrieve and delete the OIDC state in one operation. This eliminates the window that would exist between a separate `redis.get` and `redis.del` where a concurrent second callback for the same state key could read the pending join token before the first request deletes it. State keys are single-use by construction.

**Join token log redaction:** The Fastify request serializer SHALL redact join tokens from all request log lines before they are written. Two URL patterns are covered: `/api/join/<token>` (the direct join path) and `/auth/login?joinToken=<token>` (the authentication redirect). The token value is replaced with `[REDACTED]` in both cases. This prevents join tokens from appearing in application logs regardless of which code path the request follows. The redaction is applied at the serializer layer — it covers all request logging unconditionally, not only audit events.

#### Scenario: Unauthenticated user follows join link
- **WHEN** an unauthenticated user visits `GET /api/join/:token`
- **THEN** the application redirects to `/auth/login?joinToken=<token>`, which redirects to the IdP, and after authentication the join flow completes automatically

#### Scenario: First-time user follows join link
- **WHEN** a user with no existing account follows a join link and authenticates
- **THEN** the application creates their account (First Access), adds them to the team with `participant` role, and directs them to the team view or active session — all without manual intervention

#### Scenario: Join destination survives IdP redirect
- **WHEN** a user follows a join link and completes the OIDC redirect chain
- **THEN** the original join link token is retrieved from the `pendingJoinToken` field in the Redis-stored OIDC state and the join flow executes

---

### Requirement: Through-auth join error delivery
When the through-auth join path fails — because the token has expired, been revoked, or does not exist — the callback handler SHALL redirect to `/join-error` with a `?joinError=` query parameter specifying the failure reason. The user SHALL NOT be routed to `/no-team` when a `pendingJoinToken` was present in the OIDC state and failed validation.

**Error parameter values:**
- `?joinError=expired` — token exists but `expires_at` is in the past, or `revoked_at` is set
- `?joinError=invalid` — token does not exist in the database

**Message mapping:**
- `expired` → "This link has expired. Ask your facilitator for a new one."
- `invalid` → "This link is not valid."
- Both states display a secondary line: "If this is your first time using this tool, sign out and ask the person who invited you for a new link."

Both the direct join path (`GET /api/join/:token`) and the through-auth path (`GET /auth/callback`) SHALL redirect to `/join-error?joinError=...`. The `/join-error` route is accessible without authentication.

#### Scenario: Expired pendingJoinToken at callback time
- **WHEN** an authenticated user completes the OIDC flow with a `pendingJoinToken` that has expired (`expires_at` is in the past)
- **THEN** the callback handler redirects to `/join-error?joinError=expired`
- **AND** the page displays: "This link has expired. Ask your facilitator for a new one."
- **AND** the user is not added to any team
- **AND** the user is not routed to `/no-team`

#### Scenario: Revoked pendingJoinToken at callback time
- **WHEN** an authenticated user completes the OIDC flow with a `pendingJoinToken` whose `revoked_at` is set
- **THEN** the callback handler redirects to `/join-error?joinError=expired`
- **AND** the page displays: "This link has expired. Ask your facilitator for a new one."
- **AND** the user is not added to any team
- **AND** the user is not routed to `/no-team`

#### Scenario: Nonexistent pendingJoinToken at callback time
- **WHEN** an authenticated user completes the OIDC flow with a `pendingJoinToken` that does not exist in the database
- **THEN** the callback handler redirects to `/join-error?joinError=invalid`
- **AND** the page displays: "This link is not valid."
- **AND** the user is not added to any team
- **AND** the user is not routed to `/no-team`

#### Scenario: Successful through-auth join for a new member
- **WHEN** an authenticated user completes the OIDC flow with a valid `pendingJoinToken` and is not already a member of the team
- **THEN** the callback handler redirects to `/team/:teamId` (or `/session/:sessionId` if a session is active) with `?newMember=true` appended

---

### Requirement: Already-a-member handling
When an authenticated user follows a join link for a team they are already a member of, the `INSERT ... ON CONFLICT DO NOTHING` ensures no duplicate membership is created. The application redirects to the team view (or active session) with `?alreadyMember=true` query parameter for the frontend to display a transient notification. This behavior SHALL apply to both the direct join path and the through-auth join path.

#### Scenario: Existing member follows join link (direct path)
- **WHEN** a user who is already a member of a team follows that team's join link directly (authenticated)
- **THEN** no duplicate membership is created, and the user is redirected to the team view (or active session) with `?alreadyMember=true`

#### Scenario: Existing member completes through-auth join (through-auth path)
- **WHEN** a user who is already a member of a team completes the OIDC flow with a `pendingJoinToken` for that team
- **THEN** no duplicate membership is created, and the user is redirected to the team view (or active session) with `?alreadyMember=true`

---

### Requirement: New-member confirmation on team page
When a user arrives at the team page via a successful join flow for the first time (new membership created), the team page SHALL display a transient notification banner with the content: "You've joined the team. Your facilitator will share what comes next." This banner is triggered by the `?newMember=true` query parameter appended by the through-auth path's `executeJoinFlow` when `INSERT ... ON CONFLICT DO NOTHING RETURNING id` returns a new row.

**Path asymmetry:** The direct join path (`GET /api/join/:token` for an already-authenticated user) does NOT append `?newMember=true` for new members. On the direct path, the user deliberately clicked a join link and the join outcome is self-evident; a first-time confirmation banner adds no value. `?alreadyMember=true` is appended on both paths — idempotent re-join is less obvious to the user regardless of how they arrived.

The team page SHALL remove `?newMember=true` from the URL via `replace` navigation after rendering the banner, consistent with `?alreadyMember=true` handling. The session page does NOT handle `?newMember=true`: the banner content "Your facilitator will share what comes next" is misleading when a session is already in progress, and mid-session arrival handling is session-participation territory.

#### Scenario: New member arrives at team page after through-auth join
- **WHEN** a user is redirected to `/team/:teamId?newMember=true` after a successful through-auth join
- **THEN** the team page displays a transient notification: "You've joined the team. Your facilitator will share what comes next."
- **AND** the query parameter is removed from the URL without adding a browser history entry

---

### Requirement: Role vocabulary — "Engineer" maps to `participant`
The `team_memberships.membership_role` enum value `participant` corresponds to what the use case calls "Engineer." The global `user_role` enum on the `users` table is a distinct enum; it has its own `engineer` value which does NOT exist in `membership_role`. These MUST NOT be conflated.

All membership insert sites SHALL include an inline comment stating this mapping. Changing the inserted role value from `participant` to `engineer` would cause a database constraint error, as `engineer` is not a valid value in the `membership_role` enum.

**Join link revocation — explicitly deferred:** The `revoked_at` column exists and the validation logic handles it correctly. A write endpoint to set `revoked_at` is NOT part of this change. The 7-day expiry provides time-bounded protection sufficient for initial deployment. Revocation MUST be implemented as part of the link management UI change (the feature that provides facilitators a surface to manage and revoke links).

#### Scenario: Role vocabulary comment present at insert site in join-links.ts
- **WHEN** a developer reads the `INSERT INTO team_memberships` call in `packages/backend/src/routes/join-links.ts`
- **THEN** an inline comment is present explaining that `role: 'participant'` corresponds to the use case's "Engineer" role and that the `membership_role` enum is distinct from the global `user_role` enum

#### Scenario: Role vocabulary comment present at insert site in auth.ts
- **WHEN** a developer reads the membership insertion logic called via `executeJoinFlow` in `packages/backend/src/routes/auth.ts`
- **THEN** an inline comment is present explaining the same vocabulary mapping

#### Scenario: Revocation endpoint is not exposed in this change
- **WHEN** a facilitator wishes to revoke a join link before its 7-day expiry
- **THEN** no revocation endpoint is available; the facilitator must wait for expiry or generate a new link

---

### Requirement: Accurate `sourceIp` in join audit events
The `join.link_redeemed` and `join.link_rejected` audit events SHALL carry the real requester IP from `request.ip` on both the direct join path (`GET /api/join/:token`) and the through-auth path (`GET /auth/callback`). The `executeJoinFlow` function in the auth callback accepts `sourceIp` as a required parameter — callers MUST pass `request.ip` directly. A string placeholder (e.g., the literal `"callback"`) MUST NOT be used. Making `sourceIp` a required (non-optional) parameter ensures that omitting it at any future call site is a TypeScript type error rather than a silent audit-event gap.

#### Scenario: Direct join audit event carries real sourceIp
- **WHEN** a user joins via the direct path and `join.link_redeemed` is emitted
- **THEN** the `sourceIp` field contains the value of `request.ip` from the join-links route handler

#### Scenario: Through-auth join audit event carries real sourceIp
- **WHEN** `executeJoinFlow` is called from the auth callback handler and emits `join.link_rejected` or `join.link_redeemed`
- **THEN** the `sourceIp` field contains the value of `request.ip` from the callback handler, not a placeholder string

---

### Requirement: Join link creation and redemption are durably recorded

Every `join.link_created` emission SHALL also produce an `INSERT INTO audit_log` row, written in the same database transaction as the `INSERT INTO join_links` it accompanies. Every `join.link_redeemed` emission SHALL also produce an `INSERT INTO audit_log` row, written in the same database transaction as the `INSERT INTO team_memberships` it accompanies, at **both** of its call sites: `GET /api/join/:token` (the already-authenticated direct path, in `join-links.ts`) and `executeJoinFlow` (the through-auth path, invoked from `GET /auth/callback` in `auth.ts`). If the audit `INSERT` fails at either call site, it SHALL be rethrown as an `AuditWriteError` (`packages/backend/src/auth/errors.ts`, matching the `auth-error-handling` capability's "OIDC library error sanitization" requirement) before the transaction rolls back, and the accompanying domain write (the join link's creation, or the team membership's creation) SHALL NOT be committed — this coupling is deliberate, matching the precedent already established for `team.manager_established`. If acquiring the transaction's database connection fails before the transaction begins, it SHALL likewise be rethrown as `AuditWriteError`, with no rollback attempted (none was opened). The audit `INSERT` at every call site in this requirement SHALL run with a shorter statement-level timeout than the fail-open group's write-level timeout, so a hung `INSERT` is cancelled by the database itself rather than left outstanding on the connection the subsequent `ROLLBACK` needs. `join.link_redeemed`'s audit row SHALL be written only when the `INSERT INTO team_memberships ... ON CONFLICT DO NOTHING` actually inserts a new row — an idempotent re-join (an existing member following the link again) produces no audit row, matching the existing structured-log behavior. The existing structured `emitAuditEvent` call for `join.link_created` (and, when a row was inserted, `join.link_redeemed` at both call sites) SHALL fire only after its transaction commits successfully — never before, and never when the transaction rolls back.

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

---

### Requirement: Join link rejection remains log-only

`join.link_rejected` SHALL NOT gain an `audit_log` database row as part of this capability, at any of its five call sites (three in `join-links.ts`'s `GET /api/join/:token`, two in `auth.ts`'s `executeJoinFlow`). It SHALL continue to be recorded only via its existing structured `emitAuditEvent` log entry. This deferral is tracked as GitHub issue #156, pending a volume determination (human-scale expired-link traffic vs. scanning-scale token-guessing against `/api/join/:token`) that no queryable data source exists to answer today.

#### Scenario: Rejected join link adds no database write
- **WHEN** a join link is rejected for any reason (not found, revoked, or expired) at either call site
- **THEN** only the existing structured log entry is produced; no `audit_log` INSERT is performed

---

### Requirement: Through-auth join rejections carry the acting user's id

`executeJoinFlow`'s two `join.link_rejected` structured-log emissions (the `not_found` and `revoked`-or-`expired` branches) SHALL include `userId`. Unlike `join-links.ts`'s `GET /api/join/:token` handler, whose three `link_rejected` branches fire before any session check and structurally have no `userId` available, `executeJoinFlow` runs only after the user is already authenticated and the `userId` parameter is already in scope at both of its rejection branches.

#### Scenario: Through-auth rejection log includes userId
- **WHEN** `executeJoinFlow` rejects a pending join token as not found, revoked, or expired
- **THEN** the resulting `join.link_rejected` structured log entry includes the authenticated user's `userId`, in addition to its existing `sourceIp`, `linkId`, and `reason` fields

---

### Requirement: Session-aware join link landing
If an active session exists for the team (status `active`) at the time a join link flow completes, the user SHALL be directed to `/session/:sessionId`. If no active session exists, the user SHALL land on `/team/:teamId`.

#### Scenario: Active session exists at join time
- **WHEN** a user completes the join flow and a session with status `active` exists for the team
- **THEN** the user is redirected to `/session/:sessionId`

#### Scenario: No active session at join time
- **WHEN** a user completes the join flow and no active session exists for the team
- **THEN** the user is redirected to `/team/:teamId`

---

### Requirement: Batch arrival handling
The application SHALL handle concurrent join-link-through-auth flows without serialization that would cause visible delays. The `ON CONFLICT DO NOTHING` upsert pattern ensures concurrent team membership insertions do not conflict.

#### Scenario: Concurrent join link redemptions
- **WHEN** 10 users click the same join link within 30 seconds
- **THEN** all 10 complete the authentication and join flow independently without blocking each other

#### Scenario: Concurrent First Access from same join link
- **WHEN** 10 first-time users follow the same join link simultaneously
- **THEN** all 10 accounts are created and all 10 team memberships are established without serialization
