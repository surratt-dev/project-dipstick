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
