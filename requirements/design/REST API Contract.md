---

# Engineering Health Check — REST API Contract

**Prepared by:** Marcus Oyelaran, Senior Full Stack Engineer
**Date:** 2026-03-08
**Input document:** Engineering Health Check — HTTP REST API Endpoint Catalog (Ingrid Sollenberger, 2026-03-08)
**Status:** Working Draft

---

## Preface and Conventions

### Authentication

All protected routes validate a server-side session via an HttpOnly, Secure, SameSite=Strict cookie named `ehc_session`. The cookie value is an opaque session token; the server resolves it to a `users` row via the session store. Requests to protected routes without a valid cookie receive `401 Unauthorized`. Requests with a valid cookie but insufficient permissions receive `403 Forbidden`.

### Authorization Vocabulary

| Term | Meaning |
|---|---|
| `engineer` | A user whose `global_role` is `engineer` or `senior_engineer` and who is an active `participant` member of the relevant team |
| `facilitator` | A user whose `global_role` is `facilitator` and who is **not** an active member of the target team |
| `engineering_manager` | A user with an active `engineering_manager` team membership for the relevant team |
| `application_admin` | A user whose `global_role` is `application_admin` |
| `session facilitator` | The specific user recorded in `sessions.facilitator_id` for the session in question |

### Error Response Envelope

All error responses use this envelope:

```typescript
interface ErrorResponse {
  error: string;           // Machine-readable code, e.g. "SESSION_NOT_FOUND"
  message: string;         // Human-readable explanation
  requestId?: string;      // Trace ID for log correlation
}
```

### Response Conventions

- All timestamps are ISO 8601 strings in UTC (`2026-03-08T14:23:11.000Z`).
- All IDs are UUID v4 strings.
- `204 No Content` responses have no body.
- Pagination uses `limit` (default 50, max 200) and `offset` (default 0) query parameters unless stated otherwise.
- The `Content-Type` for all JSON responses is `application/json`.

---

## Group 1: Authentication and Identity

---

### AUTH-001 — Initiate OIDC Login

**Method and URL**
```
GET /auth/login
```

**Description**
Redirects the browser to the OIDC identity provider's authorization endpoint, beginning the authorization code flow.

**Auth:** Public (unauthenticated access required by design).

**Authorization:** None.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Query | `returnTo` | `string` | No | URL-encoded path to redirect to after successful login. Validated against an allowlist of same-origin paths. |

**Response**

`302 Found` — Redirects to the identity provider's authorization URL. No body.

The `Location` header is the identity provider's authorization URL with these parameters appended:
- `client_id`: the registered OIDC client ID
- `redirect_uri`: the registered callback URI (exact match required, no wildcards)
- `scope`: `openid profile email offline_access`
- `response_type`: `code`
- `state`: a cryptographically random, per-request value stored in a short-lived server-side cookie
- `nonce`: a cryptographically random, per-request value stored in a short-lived server-side cookie

**Error Responses**

| Status | When |
|---|---|
| `400 Bad Request` | `returnTo` parameter fails allowlist validation |

**Notes**
- The `state` and `nonce` values are generated per-request, stored server-side (or in an intermediate short-lived HttpOnly cookie), and validated in AUTH-002. They must not be reusable.
- The `redirect_uri` registered with the provider must be an exact match; no wildcards are permitted (SEC-6).
- Unauthenticated requests to any protected route should redirect here rather than returning `401` directly to browser-originated requests.

---

### AUTH-002 — OIDC Callback / Session Creation

**Method and URL**
```
GET /auth/callback
```

**Description**
Receives the authorization code from the identity provider, exchanges it for tokens, validates all claims, resolves or creates the user record, and issues an application session cookie.

**Auth:** Public (this is the authentication endpoint).

**Authorization:** None — this endpoint establishes identity.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Query | `code` | `string` | Yes | Authorization code from the identity provider |
| Query | `state` | `string` | Yes | Must match the value issued in AUTH-001 |
| Query | `error` | `string` | No | Provider-returned error code (e.g., `access_denied`) |
| Query | `error_description` | `string` | No | Provider-returned human-readable error |

**Response**

`302 Found` — Redirects to the application's post-login landing page (or the `returnTo` path from AUTH-001 if valid).

Sets the `ehc_session` cookie:
- `HttpOnly: true`
- `Secure: true`
- `SameSite: Strict`
- `Path: /`
- Expiry: server-configured session duration

**Error Responses**

| Status | When |
|---|---|
| `400 Bad Request` | `state` does not match; `error` parameter is present from provider; code exchange fails |
| `302 → /auth/error` | Token validation fails (signature, `exp`, `aud`, `iss`, or nonce mismatch); redirects to an error page with a non-sensitive message |

**Notes**
- All four token validations are mandatory (SEC-1): JWKS signature, `exp`, `aud`, `iss`. The `nonce` claim must also be validated against the value issued in AUTH-001.
- The refresh token (obtained via `offline_access` scope) is stored server-side only — it is never sent to the browser (SEC-5).
- If no `users` row matches `(oidc_subject, oidc_issuer)`, one is created using `display_name` and `email` from the ID token claims, with `global_role = 'engineer'` and no team memberships.
- User creation and session issuance are atomic: if user creation fails, no cookie is issued.
- The audit log must record the sign-in event (SEC-13).

---

### AUTH-003 — Sign Out

**Method and URL**
```
POST /auth/logout
```

**Description**
Invalidates the server-side session, clears the session cookie, and redirects to the sign-in page.

**Auth:** Protected (valid session cookie required).

**Authorization:** Any authenticated user.

**Request**

No body. Session is identified via the `ehc_session` cookie.

**Response**

`302 Found` — Redirects to `/auth/login`.

Clears the `ehc_session` cookie via `Set-Cookie: ehc_session=; Max-Age=0; HttpOnly; Secure; SameSite=Strict`.

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie present |

**Notes**
- Cookie deletion alone is insufficient. The server-side session record must be invalidated so that a captured cookie cannot be replayed (SEC-5).
- A facilitator signing out mid-session does not close the session. The session remains in its current state; the WebSocket layer handles the facilitator's disconnection. This endpoint has no session lifecycle side effects.
- The audit log must record the sign-out event (SEC-13).
- Use `POST` (not `GET`) to prevent logout via prefetched URLs or `<img>` tags.

---

### AUTH-004 — Get Current User Profile

**Method and URL**
```
GET /api/v1/users/me
```

**Description**
Returns the authenticated user's identity, global role, and active team memberships.

**Auth:** Protected.

**Authorization:** Any authenticated user — self only. No cross-user profile access exists.

**Request**

No parameters.

**Response**

`200 OK`

```typescript
interface GetCurrentUserResponse {
  id: string;
  displayName: string;
  email: string;
  globalRole: 'engineer' | 'senior_engineer' | 'facilitator' | 'engineering_manager' | 'application_admin';
  teamMemberships: Array<{
    teamId: string;
    teamName: string;
    membershipRole: 'participant' | 'engineering_manager';
    joinedAt: string;
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |

**Notes**
- Only active memberships (`removed_at IS NULL`) are returned in `teamMemberships`.
- The frontend uses this response to initialize role-based rendering, but all authorization is independently re-enforced server-side on every subsequent request (NFR-AUTH-003).
- This endpoint must be callable immediately after the AUTH-002 redirect so the frontend can initialize.
- A deactivated user (`deactivated_at IS NOT NULL`) must have their session invalidated; this endpoint returns `401` for deactivated accounts.

---

## Group 2: Team Management

---

### TEAM-001 — Create Team

**Method and URL**
```
POST /api/v1/teams
```

**Description**
Creates a new team and seeds it with the default topic set. Team creation is independent of session creation; the team will be available for any facilitator to select when initiating a session.

**Auth:** Protected.

**Authorization:** Any authenticated user with `global_role = 'facilitator'` or `global_role = 'engineering_manager'`.

**Request Body**

```typescript
interface CreateTeamRequest {
  name: string;              // Required. Must be unique across all teams. Max 100 characters.
}
```

**Response**

`201 Created`

```typescript
interface CreateTeamResponse {
  teamId: string;
  name: string;
  createdAt: string;
  defaultTopicsSeeded: number;   // Count of default topics added to the team
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user does not have `facilitator` or `engineering_manager` global role |
| `409 Conflict` | A team with the given `name` already exists |
| `422 Unprocessable Entity` | `name` is empty, whitespace-only, or exceeds 100 characters |

**Notes**
- **BRD authority:** FR-1.7. Standalone team creation (without a concurrent session) is a first-class supported path, not a workaround. A team with no sessions is a valid system state.
- Team creation and default topic seeding are performed in a single PostgreSQL transaction. If topic seeding fails, the team is not created.
- The creator is NOT added as a member of the new team. Facilitators are external to the teams they facilitate (FR-2.2); EMs who create a team are associated with it through the separate TEAM-006 (EM/team relationship) flow.
- The default topic set is seeded from `topics` where `is_default = true`.
- **Topic customization lock (FR-8.2):** Topics for a newly created team cannot be customized until after the team's first session is completed. TOPIC-003, TOPIC-004, and TOPIC-006 must enforce this. A team created standalone is subject to the same lock as a team created during session initiation.
- A newly created team with no sessions will appear in TEAM-002 (facilitator team list) and TREND-005 (briefing view) with zero-session indicators. See TREND-005 for the zero-session response shape.

---

### TEAM-002 — List Teams Available to Facilitate

**Method and URL**
```
GET /api/v1/teams/facilitatable
```

**Description**
Returns the list of teams the authenticated facilitator is eligible to facilitate — i.e., teams where the authenticated user has no active membership.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` required.

**Request**

No parameters.

**Response**

`200 OK`

```typescript
interface ListFacilitatableTeamsResponse {
  teams: Array<{
    teamId: string;
    name: string;
    memberCount: number;          // Count of active participant members
    lastSessionDate: string | null;  // ISO 8601, or null if no completed sessions
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user does not have `facilitator` global role |

**Notes**
- The exclusion of teams where the facilitator is a member is a ritual integrity requirement (FR-2.2), not a UI preference. It is enforced server-side by filtering on `team_memberships` for `user_id = authenticated_user_id AND removed_at IS NULL`.
- Deactivated teams (`teams.deactivated_at IS NOT NULL`) are excluded.
- The facilitator cross-team constraint must also be re-validated at `SESSION-001` creation time, because team membership may change between when this list is fetched and when the session is submitted (race condition protection).

---

### TEAM-003 — Get Team Detail

**Method and URL**
```
GET /api/v1/teams/:teamId
```

**Description**
Returns a team's name, active member list with roles, Engineering Manager association, and topic customization lock status.

**Auth:** Protected.

**Authorization:** One of the following must be true (all checked server-side):
- The authenticated user is an active `participant` or `engineering_manager` member of this team, OR
- The authenticated user is a `facilitator` with an active session (`status IN ('lobby', 'pre_session', 'active', 'wrap_up')`) for this team, OR
- The authenticated user has `global_role = 'application_admin'`

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |

**Response**

`200 OK`

```typescript
interface GetTeamDetailResponse {
  teamId: string;
  name: string;
  createdAt: string;
  members: Array<{
    userId: string;
    displayName: string;
    email: string;
    membershipRole: 'participant' | 'engineering_manager';
    joinedAt: string;
  }>;
  engineeringManagers: Array<{
    userId: string;
    displayName: string;
  }>;
  topicCustomizationLocked: boolean;  // true if zero completed sessions for this team
  activeSessionId: string | null;     // ID of any currently active session, or null
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user has no authorized relationship with this team (team exists but is inaccessible) |
| `404 Not Found` | Team does not exist or is deactivated |

**Notes**
- Only active members (`removed_at IS NULL`) appear in `members`. Former members are excluded.
- `topicCustomizationLocked` is `true` when `COUNT(*) FROM sessions WHERE team_id = :teamId AND status = 'complete'` returns 0.
- This response is used to populate the action item owner selector during wrap-up; the `members` array must therefore contain only active engineers of the target team, not the facilitator's own team members.
- Return `403` (not `404`) when the team exists but the requester has no relationship to it, to avoid leaking team IDs.

---

### TEAM-005 — Update Team Member Role

**Method and URL**
```
PATCH /api/v1/teams/:teamId/members/:userId/role
```

**Description**
Updates the team-scoped membership role for an existing team member.

**Auth:** Protected.

**Authorization:** `global_role = 'application_admin'` (any team) OR `global_role = 'engineering_manager'` with an active membership for team `:teamId` (own team only).

**EM role assignment constraint:** An Engineering Manager may only assign the `participant` role via this endpoint. Assigning the `engineering_manager` role requires `application_admin` and is performed via TEAM-006, not this endpoint. A request from an EM to set `role = 'engineering_manager'` must be rejected with `403 Forbidden`.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Path | `userId` | `uuid` | Yes | User whose role is being changed |

**Request Body**

```typescript
interface UpdateMemberRoleRequest {
  role: 'participant' | 'engineering_manager';
}
```

**Response**

`200 OK`

```typescript
interface UpdateMemberRoleResponse {
  userId: string;
  teamId: string;
  displayName: string;
  membershipRole: 'participant' | 'engineering_manager';
  updatedAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not an `application_admin` or `engineering_manager` for this team; or EM attempting to assign `engineering_manager` role |
| `404 Not Found` | Team or user does not exist; user is not an active member of this team |
| `422 Unprocessable Entity` | `role` value is invalid |

**Notes**
- **BRD authority:** FR-1.6 (admin manages membership) extended by decision 2026-03-15: EMs may also manage roles for their own team.
- Role changes take effect immediately on the next authenticated request from the affected user (SEC-11).
- The audit log must record the change: who changed it, what it changed from, what it changed to, and the role of the actor (SEC-13).

---

### TEAM-006 — Establish Engineering Manager / Team Relationship

**Method and URL**
```
POST /api/v1/teams/:teamId/managers
```

**Description**
Associates an Engineering Manager with a team, granting them read-only access to the team's session history, trends, and action items.

**Auth:** Protected.

**Authorization:** `global_role = 'application_admin'` only. The EM being associated must have an existing application account. Assigning the `engineering_manager` role to a team member is a privileged administrative action; it cannot be performed by an EM (to prevent privilege escalation) or a facilitator.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |

**Request Body**

```typescript
interface EstablishManagerRequest {
  engineeringManagerUserId: string;  // Must be a user with global_role = 'engineering_manager'
}
```

**Response**

`200 OK` (idempotent — if the relationship already exists, returns success)

```typescript
interface EstablishManagerResponse {
  teamId: string;
  engineeringManagerUserId: string;
  engineeringManagerDisplayName: string;
  membershipRole: 'engineering_manager';
  establishedAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user is not an `application_admin` |
| `404 Not Found` | Team or target user does not exist |
| `409 Conflict` | Target user does not have `global_role = 'engineering_manager'` |
| `422 Unprocessable Entity` | `engineeringManagerUserId` is malformed |

**Notes**
- This is implemented by inserting or updating a `team_memberships` row with `role = 'engineering_manager'` for the target user on the target team.
- The EM gains read-only access. They cannot vote, create action items, or modify session data.
- One EM may manage multiple teams; one team may have multiple EMs.

---

## Group 3: Topic Management

---

### TOPIC-001 — Get Active Topics for Team

**Method and URL**
```
GET /api/v1/teams/:teamId/topics
```

**Description**
Returns the ordered list of active topics for a team, including prompt, vote type, and customization lock status.

**Auth:** Protected.

**Authorization:** One of:
- Active `participant` member of the team, OR
- `facilitator` with an active session for the team

`engineering_manager` role does not grant access to the topic configuration.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |

**Response**

`200 OK`

```typescript
interface GetActiveTopicsResponse {
  teamId: string;
  isCustomizationLocked: boolean;  // true if the team has zero completed sessions
  topics: Array<{
    topicId: string;
    name: string;
    prompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    displayOrder: number;
    isDefault: boolean;
    firstSessionDescription: string | null;  // Extended description for first-session mode
    teamAnnotation: string | null;           // Team-specific annotation
    createdAt: string;
    updatedAt: string;
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user has no authorized relationship with this team |
| `404 Not Found` | Team does not exist |

**Notes**
- Only topics with `status = 'active'` are returned. Archived topics are served by `TOPIC-002`.
- Topics are ordered by `display_order` ascending.
- `isCustomizationLocked` is computed as `COUNT(*) = 0` from completed sessions for this team.

---

### TOPIC-002 — Get All Topics (Including Archived)

**Method and URL**
```
GET /api/v1/teams/:teamId/topics/all
```

**Description**
Returns both active and archived topics for a team, including configuration details (prompt, vote type, annotation, display order). Used exclusively by the topic management/configuration screen. Trend dashboard consumers must use TREND-001 for archived topic history — this endpoint is not the source of truth for the trend dashboard's archived-topic toggle.

**Auth:** Protected.

**Authorization:** `facilitator` with an active session for the team, OR `application_admin`. (Participants and EMs access archived topic data via TREND-001, not this endpoint.)

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Query | `status` | `'active' \| 'archived' \| 'all'` | No | Filter by topic status. Default: `'all'` |

**Response**

`200 OK`

```typescript
interface GetAllTopicsResponse {
  teamId: string;
  isCustomizationLocked: boolean;
  active: Array<{
    topicId: string;
    name: string;
    prompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    displayOrder: number;
    isDefault: boolean;
    teamAnnotation: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  archived: Array<{
    topicId: string;
    name: string;
    prompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    isDefault: boolean;
    archivedAt: string;
  }>;
  defaultTopicsNotActive: Array<{  // Canonical default topics currently absent from the active list
    topicId: string;
    name: string;
    isArchived: boolean;           // true = was archived; false = was never added to this team
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user is not a facilitator with an active session for this team, and is not an `application_admin` |
| `404 Not Found` | Team does not exist |

**Notes**
- `defaultTopicsNotActive` enables the "restore defaults" UI path (FR-8.6). It enumerates canonical default topics (`is_default = true`) that are currently absent from the team's active topic list — whether because they were archived or were never seeded.
- **Scope boundary:** This endpoint serves topic *configuration* only. Trend dashboard consumers (participants, EMs, facilitators viewing history) must use TREND-001, which includes archived topics in its `topics` array via `topicStatus: 'archived'`. Do not call TOPIC-002 from trend dashboard UI flows.

---

### TOPIC-003 — Add Custom Topic

**Method and URL**
```
POST /api/v1/teams/:teamId/topics
```

**Description**
Creates a new custom topic for the team and appends it to the end of the display order.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` AND the facilitator must not be a member of this team AND `isCustomizationLocked` must be `false` (i.e., the team has at least one completed session).

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |

**Request Body**

```typescript
interface AddCustomTopicRequest {
  name: string;                                          // Required. Max 100 characters.
  prompt: string;                                        // Required. Max 500 characters.
  voteType: 'finger' | 'roman' | 'modified_roman';       // Required.
  firstSessionDescription?: string;                     // Optional. Max 500 characters.
}
```

**Response**

`201 Created`

```typescript
interface AddCustomTopicResponse {
  topicId: string;
  name: string;
  prompt: string;
  voteType: 'finger' | 'roman' | 'modified_roman';
  displayOrder: number;    // Assigned as max(current_display_order) + 1
  isDefault: false;
  createdAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not a facilitator; facilitator is a team member; customization lock is active |
| `404 Not Found` | Team does not exist |
| `422 Unprocessable Entity` | Required fields missing, empty, or exceed length limits |

**Notes**
- The customization lock check (`isCustomizationLocked`) is enforced server-side. The lock applies when the team has zero completed sessions (FR-8.2).
- Prompt uniqueness is not enforced — duplicate prompts are allowed.
- `isDefault` is always `false` for custom topics.

---

### TOPIC-004 — Archive Topic

**Method and URL**
```
DELETE /api/v1/teams/:teamId/topics/:topicId
```

**Description**
Transitions a topic from `active` to `archived` status, removing it from future sessions while preserving historical vote data.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` AND not a member of this team AND `isCustomizationLocked = false`.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Path | `topicId` | `uuid` | Yes | Topic to archive |
| Query | `confirm` | `boolean` | No | Required as `true` if the topic has open action items (see Notes) |

**Response**

`200 OK`

```typescript
interface ArchiveTopicResponse {
  topicId: string;
  status: 'archived';
  archivedAt: string;
}
```

Or, when the topic has open action items and `confirm` is not `true`:

`200 OK` with `requiresConfirmation`:

```typescript
interface ArchiveTopicConfirmationRequired {
  requiresConfirmation: true;
  reason: 'openActionItems';
  openActionItemCount: number;
  message: string;   // Human-readable warning
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not a facilitator, is a team member, customization lock active |
| `404 Not Found` | Team or topic does not exist; topic is not active for this team |
| `422 Unprocessable Entity` | Topic is already archived |

**Notes**
- This is a soft-delete: `topics.status` transitions to `'archived'`; no row is deleted. Historical `votes` and `session_topics` records are unaffected (FR-8.3).
- When the topic has open action items, the first request without `confirm=true` returns the confirmation response (HTTP `200`, not `409`). A subsequent request with `confirm=true` proceeds with the archive.
- After archiving, the topic no longer appears in future session snapshots.

---

### TOPIC-005 — Restore Archived Topic

**Method and URL**
```
POST /api/v1/teams/:teamId/topics/:topicId/restore
```

**Description**
Transitions an archived topic back to active status, appending it at the end of the current display order.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` AND not a member of this team AND `isCustomizationLocked = false`.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Path | `topicId` | `uuid` | Yes | Archived topic to restore |

**Response**

`200 OK`

```typescript
interface RestoreTopicResponse {
  topicId: string;
  name: string;
  status: 'active';
  displayOrder: number;    // New position: max(current) + 1
  restoredAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not a facilitator, is a team member, customization lock active |
| `404 Not Found` | Team or topic does not exist; topic does not belong to this team |
| `422 Unprocessable Entity` | Topic is already active |

**Notes**
- The prior `displayOrder` position is not restored; the topic is appended (FR-8.6, UC: Re-Add a Previously Removed Topic).
- Sessions where the topic was absent while archived appear as gaps in trend charts. The API returns data that makes gaps visible — session records where the topic was absent are identifiable by the absence of a `session_topics` row for that `topic_id`.

---

### TOPIC-006 — Reorder Topics

**Method and URL**
```
PUT /api/v1/teams/:teamId/topics/order
```

**Description**
Replaces the display order for all active topics in a team with a new ordering.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` AND not a member of this team AND `isCustomizationLocked = false`.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |

**Request Body**

```typescript
interface ReorderTopicsRequest {
  orderedTopicIds: string[];   // Complete ordered list of ALL active topic IDs for this team.
                               // Partial lists are rejected.
}
```

**Response**

`200 OK`

```typescript
interface ReorderTopicsResponse {
  topics: Array<{
    topicId: string;
    name: string;
    displayOrder: number;   // New assigned display order (0-indexed or 1-indexed, consistent)
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not a facilitator, is a team member, customization lock active |
| `404 Not Found` | Team does not exist; any provided `topicId` does not exist for this team |
| `422 Unprocessable Entity` | `orderedTopicIds` does not match the complete set of active topics for the team (missing or extra IDs); empty array |

**Notes**
- The request must include all active topic IDs. A partial list is rejected with `422`. This avoids ambiguity about topics not mentioned in the list.
- All `display_order` values are updated in a single PostgreSQL transaction.

---

### TOPIC-007 — Update Topic Annotation

**Method and URL**
```
PUT /api/v1/teams/:teamId/topics/:topicId/annotation
```

**Description**
Sets or clears the team-specific annotation on a topic.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` AND not a member of this team AND `isCustomizationLocked = false`.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Path | `topicId` | `uuid` | Yes | Topic to annotate |

**Request Body**

```typescript
interface UpdateTopicAnnotationRequest {
  annotation: string;   // Empty string clears the annotation. Max 500 characters.
}
```

**Response**

`200 OK`

```typescript
interface UpdateTopicAnnotationResponse {
  topicId: string;
  annotation: string | null;   // null if annotation was cleared
  updatedAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not a facilitator, is a team member, customization lock active |
| `404 Not Found` | Team or topic does not exist; topic is not active for this team |
| `422 Unprocessable Entity` | `annotation` exceeds 500 characters |

**Notes**
- An empty string is treated as a clear operation (sets the field to `NULL`), not a no-op.
- The annotation is included in session topic snapshots (visible to participants during sessions). Changes apply to future sessions only; historical sessions retain the annotation as it was at session creation time.

> **Open question:** The character limit for annotations is not specified in the use case. This contract specifies 500 characters for consistency with resolution notes. Confirm with BA.

---

## Group 4: Session Lifecycle

---

### SESSION-001 — Create Session

**Method and URL**
```
POST /api/v1/sessions
```

**Description**
Creates a new session for a team, generating a join token, snapshotting the team's active topics, and initializing Redis session state.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` AND the authenticated user must NOT be an active member of the target team (FR-2.2). Both conditions are enforced server-side regardless of what `TEAM-002` returned at list time.

**Request Body**

```typescript
interface CreateSessionRequest {
  teamId: string;   // Must be an active team; facilitator must not be a member
}
```

**Response**

`201 Created`

```typescript
interface CreateSessionResponse {
  sessionId: string;
  teamId: string;
  teamName: string;
  status: 'lobby';
  joinLink: string;          // Full URL: {baseUrl}/join/{joinToken}
  joinToken: string;         // The raw token, for display or copy purposes
  isFirstSession: boolean;   // true if this team has no prior completed sessions
  sessionNumber: number;     // Ordinal within the team's session history
  topics: Array<{
    sessionTopicId: string;
    topicId: string;
    topicName: string;
    topicPrompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    displayOrder: number;
    teamAnnotation: string | null;
    firstSessionDescription: string | null;  // Only meaningful when isFirstSession = true
  }>;
  createdAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not a facilitator; facilitator is a member of the target team |
| `404 Not Found` | `teamId` does not reference an existing active team |
| `409 Conflict` | An active session (`status IN ('lobby', 'pre_session', 'active', 'wrap_up')`) already exists for this team |

**Notes**
- This operation must be atomic in PostgreSQL (single transaction): INSERT `sessions`, bulk INSERT `session_topics` (one per active team topic, snapshotting `topic_name`, `topic_prompt`, `vote_type` at this moment in time), compute `is_first_session` and `session_number` within the same transaction.
- PostgreSQL writes happen before Redis initialization, per the persistence layer mapping (Section 1, "Session Created"). If Redis initialization fails after PostgreSQL commits, the session is still valid; Redis state is re-initialized on the facilitator's first WebSocket connection.
- `join_token` is a cryptographically secure, URL-safe random string with at least 128 bits of entropy.
- `session_number` is computed as `COUNT(*) + 1` from `sessions WHERE team_id = :teamId AND status = 'complete'`.
- `is_first_session` is `true` if `session_number = 1`.

---

### SESSION-002 — Get Session State (HTTP Snapshot)

**Method and URL**
```
GET /api/v1/sessions/:sessionId
```

**Description**
Returns the current authoritative state of a session. Serves reconnection recovery and initial page load. Combines Redis (ephemeral state) and PostgreSQL (completed topic results).

**Auth:** Protected.

**Authorization:** One of:
- Authenticated user is the session's facilitator (`sessions.facilitator_id`), OR
- Authenticated user has an active `participant` row in `session_participants` for this session

Engineering Managers do not have access to live session state.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |

**Response**

`200 OK`

```typescript
interface GetSessionStateResponse {
  sessionId: string;
  teamId: string;
  teamName: string;
  status: SessionStatus;
  isFirstSession: boolean;
  sessionNumber: number;
  facilitatorId: string;
  isFacilitator: boolean;   // true if the authenticated user is the facilitator
  currentTopic: {
    sessionTopicId: string;
    topicName: string;
    topicPrompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    phase: 'waiting' | 'voting' | 'revealed' | 'complete';
    // Only present when isFacilitator = true AND phase = 'voting':
    readinessGrid?: Array<{
      userId: string;
      displayName: string;
      readiness: 'not_ready' | 'ready' | 'disconnected';
    }>;
    // Only present when phase = 'revealed' or 'complete':
    revealedVotes?: RevealedVoteEntry[];
    aggregate?: number;
    outlierThreshold?: number;
    flaggedForDiscussion?: boolean;
    discussionNote?: string | null;
  } | null;
  completedTopics: Array<{
    sessionTopicId: string;
    topicName: string;
    phase: 'complete';
    revealedVotes: RevealedVoteEntry[];
    aggregate: number;
    flaggedForDiscussion: boolean;
    discussionNote: string | null;
  }>;
  participants: Array<{
    userId: string;
    displayName: string;
    connectionStatus: 'connected' | 'disconnected_voted' | 'disconnected_no_vote';
    // connectionStatus is omitted for non-facilitator requesters
  }>;
  snapshotSource: 'redis' | 'postgres';  // Indicates whether Redis was available
}

// EM-safe: voterDisplayName is included for engineers/facilitators, omitted for EMs
interface RevealedVoteEntry {
  voterId: string;
  voterDisplayName: string;    // Omitted when requester is an EM
  voteValue: -1 | 0 | 1 | 2 | 3 | 4;
  voteType: 'finger' | 'roman' | 'modified_roman';
  isOutlier: boolean;
}

type SessionStatus = 'lobby' | 'pre_session' | 'active' | 'wrap_up' | 'complete' | 'abandoned';
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user has no relationship to this session |
| `404 Not Found` | Session does not exist |

**Notes**
- Pre-reveal vote values are NEVER returned, regardless of caller role or session state. Pre-reveal votes exist only in Redis vote hashes and are not exposed via any REST endpoint.
- Per the persistence layer mapping (Section 4, "Reconnection loading state"), this endpoint follows a two-phase strategy: Redis snapshot is returned immediately (low-latency); historical completed-topic vote detail is fetched from PostgreSQL. If Redis is unavailable, `snapshotSource` is `'postgres'` and the response is assembled from PostgreSQL state alone.
- The `readinessGrid` field is only populated for the facilitator and only during the `voting` phase. Participant clients never receive readiness state for other participants.
- `connectionStatus` in the participants array is sourced from Redis and is only included in responses to the facilitator.

---

### SESSION-003 — Join Session via Token

**Method and URL**
```
POST /api/v1/sessions/join
```

**Description**
Validates a session join token, confirms the user is an eligible team member, records participation, and returns initial session state.

**Auth:** Protected.

**Authorization:** The authenticated user must be an active `participant` member of the session's team (`team_memberships.role = 'participant' AND removed_at IS NULL`). Engineering Managers who are team members cannot join as participants (FR-1.4).

**Request Body**

```typescript
interface JoinSessionRequest {
  joinToken: string;   // The token from the join link URL
}
```

**Response**

`200 OK` (idempotent — re-joining an active session returns the same response)

```typescript
interface JoinSessionResponse {
  sessionId: string;
  teamId: string;
  teamName: string;
  status: SessionStatus;
  isFirstSession: boolean;
  currentTopic: {
    sessionTopicId: string;
    topicName: string;
    topicPrompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    phase: 'waiting' | 'voting' | 'revealed' | 'complete';
    // Only present when phase = 'revealed' or 'complete':
    revealedVotes?: RevealedVoteEntry[];
    aggregate?: number;
  } | null;
  joined: true;
  joinedAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user is an active team member with `engineering_manager` role; or user is not a member of the team at all |
| `404 Not Found` | Token does not match any session |
| `409 Conflict` | Session exists but is not in a joinable state (`status = 'complete'` or `'abandoned'`) — use `410` for completed/ended sessions |
| `410 Gone` | Session has ended (`status = 'complete'` or `'abandoned'`) |

**Notes**
- The `session_participants` INSERT uses `ON CONFLICT (session_id, user_id) DO NOTHING` to handle reconnections idempotently. The permanent participation record (`joined_at`) is the timestamp of first join.
- An Engineering Manager following the join link receives `403` with a message explaining why they cannot participate. They should be directed to the read-only history view.
- After a successful join, the client should open a WebSocket connection to receive real-time updates. This HTTP endpoint is the gate; the WebSocket is the live channel.
- Redis `session_participants` hash and `joined_users` set are updated after the PostgreSQL INSERT succeeds.

---

### SESSION-004 — Start Session (Lobby → Pre-Session)

**Method and URL**
```
POST /api/v1/sessions/:sessionId/start
```

**Description**
Transitions the session from `lobby` to `pre_session`, beginning the action item review phase. Returns open action items for the team.

**Auth:** Protected.

**Authorization:** Only the session's facilitator (`sessions.facilitator_id = authenticated_user_id`).

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |

No request body.

**Response**

`200 OK`

```typescript
interface StartSessionResponse {
  sessionId: string;
  status: 'pre_session';
  startedAt: string;
  actionItems: Array<{
    actionItemId: string;
    description: string;
    ownerUserId: string;
    ownerDisplayName: string;
    status: 'open' | 'in_progress';
    originatingSessionId: string;
    originatingSessionNumber: number;
    stalenessLevel: 'none' | 'yellow' | 'orange' | 'red';
    createdAt: string;
    updatedAt: string;
  }>;
  hasOpenItems: boolean;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user is not the session's facilitator |
| `404 Not Found` | Session does not exist |
| `409 Conflict` | Session is not in `lobby` status |

**Notes**
- Sets `sessions.started_at = now()` and `sessions.status = 'pre_session'` in PostgreSQL, then updates Redis state hash.
- Action items returned are those with `status IN ('open', 'in_progress')` for the team, from sessions with `status = 'complete'` only (draft items from `wrap_up` sessions are excluded), ordered by `created_at` ascending (oldest first).
- Staleness is computed at query time as the count of completed sessions since each item's `updated_at`. Staleness thresholds use the value from `application_settings.staleness_threshold_sessions`.
- If `actionItems` is empty, the facilitator can advance immediately (UC: Skip Review When No Open Action Items).

---

### SESSION-005 — Advance Past Pre-Session Review

**Method and URL**
```
POST /api/v1/sessions/:sessionId/begin-voting
```

**Description**
Transitions the session from `pre_session` to `active`, sets the first topic to `voting` phase, and triggers the WebSocket `topic.advanced` broadcast.

**Auth:** Protected.

**Authorization:** Only the session's facilitator.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |

No request body.

**Response**

`200 OK`

```typescript
interface BeginVotingResponse {
  sessionId: string;
  status: 'active';
  votingStartedAt: string;
  currentTopic: {
    sessionTopicId: string;
    topicName: string;
    topicPrompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    phase: 'voting';
    firstSessionDescription: string | null;  // Non-null when isFirstSession = true
  };
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user is not the session's facilitator |
| `404 Not Found` | Session does not exist |
| `409 Conflict` | Session is not in `pre_session` status |

**Notes**
- This endpoint performs the following writes in order (per persistence layer mapping, "Facilitator Advances to Topic"):
  1. `sessions.status = 'active'`, `sessions.voting_started_at = now()`, `sessions.current_topic_id = first_topic_id` (PostgreSQL transaction)
  2. First `session_topics.status = 'voting'` (same transaction)
  3. Redis state hash updated
  4. WebSocket `topic.advanced` broadcast sent to all connected clients
- The WebSocket broadcast happens after the HTTP response is returned. The response confirms the state transition; participants see the new topic via WebSocket.
- Participants cannot trigger this transition (FR-3.4).

---

### SESSION-006 — Close Session (Wrap-Up → Complete)

**Method and URL**
```
POST /api/v1/sessions/:sessionId/complete
```

**Description**
Finalizes the session, transitions it to `complete` status, clears Redis state, and triggers the session-complete WebSocket broadcast. This operation is atomic.

**Auth:** Protected.

**Authorization:** Only the session's facilitator.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |

No request body.

**Response**

`200 OK`

```typescript
interface CompleteSessionResponse {
  sessionId: string;
  status: 'complete';
  completedAt: string;
  sessionNumber: number;
  actionItemsFinalized: number;   // Count of action items from this session
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user is not the session's facilitator |
| `404 Not Found` | Session does not exist |
| `409 Conflict` | Session is not in `wrap_up` status |
| `500 Internal Server Error` | PostgreSQL transaction failed — the session remains in `wrap_up` status and the operation is retryable |

**Notes**
- Writes in order (per persistence layer mapping, "Session Wrapped Up / Completed"):
  1. `sessions.status = 'complete'`, `sessions.completed_at = now()` — PostgreSQL transaction must commit before any other step
  2. Redis keys deleted (session state, participants, snapshot, topic states, joined users, vote hashes)
  3. WebSocket session-complete broadcast sent
- If the PostgreSQL commit fails, no Redis changes are made. The session remains in `wrap_up` and can be retried.
- Redis key deletion is eventually consistent: if the server crashes between the commit and the deletion, orphaned Redis keys expire via their 8-hour TTL and are caught by the background cleanup job.
- After this endpoint returns `200`, the session enters a read-only historical state (FR-6.6).
- If `is_first_session = true`, the team's `topicCustomizationLocked` becomes `false` after this completes (since the team now has one completed session).

---

### SESSION-007 — Get Session History for Team

**Method and URL**
```
GET /api/v1/teams/:teamId/sessions
```

**Description**
Returns a paginated list of completed sessions for a team, ordered most-recent-first.

**Auth:** Protected.

**Authorization:** One of:
- Active team member (`participant` or `engineering_manager`), OR
- `facilitator` with an active session for the team (per ADR-007: facilitator history access is session-scoped)

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Query | `limit` | `integer` | No | Max results to return. Default 20, max 100. |
| Query | `offset` | `integer` | No | Offset for pagination. Default 0. |

**Response**

`200 OK`

```typescript
interface GetSessionHistoryResponse {
  teamId: string;
  total: number;
  limit: number;
  offset: number;
  sessions: Array<{
    sessionId: string;
    sessionNumber: number;
    completedAt: string;
    facilitatorDisplayName: string;
    annotation: string | null;
    topicCount: number;
    participantCount: number;
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user has no authorized relationship with this team |
| `404 Not Found` | Team does not exist |

**Notes**
- Only sessions with `status = 'complete'` are returned. In-progress or abandoned sessions are excluded.
- Full session detail (individual votes) is served by `SESSION-008`.
- The EM view returns the same list-level response; the restriction to aggregates-only applies to `SESSION-008`.
- Per ADR-007, a facilitator's access to historical data requires an active session for the team. A facilitator without an active session for this team receives `403`.

---

### SESSION-008 — Get Session Detail

**Method and URL**
```
GET /api/v1/sessions/:sessionId
```

**Description**
Returns full detail for a completed session: participants, per-topic vote results, discussion notes, outlier flags, and associated action items. Vote result shape differs by role: Engineers and Facilitators receive full per-voter attribution; Engineering Managers receive an anonymous vote distribution (counts per value) with no per-voter rows.

**Auth:** Protected.

**Authorization:** Same as `SESSION-007`. EM vote anonymization is enforced at the serialization layer, server-side (SEC-7, FR-9.5).

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |

**Response**

`200 OK`

```typescript
interface GetSessionDetailResponse {
  sessionId: string;
  teamId: string;
  teamName: string;
  sessionNumber: number;
  completedAt: string;
  facilitatorDisplayName: string;
  annotation: string | null;
  isFirstSession: boolean;
  participants: Array<{
    userId: string;
    displayName: string;
    joinedAt: string;
  }>;
  // For Engineers and Facilitators: topics contains 'votes' (full attribution, no 'voteDistribution')
  // For Engineering Managers: topics contains 'voteDistribution' (anonymous histogram, no 'votes')
  topics: Array<EngineerSessionTopic | EngManagerSessionTopic>;
  actionItems: Array<{
    actionItemId: string;
    description: string;
    ownerDisplayName: string;
    status: 'open' | 'in_progress' | 'resolved';
    sessionTopicId: string | null;
    createdAt: string;
  }>;
}

// Shared topic fields (present in both Engineer and EM variants)
interface SessionTopicBase {
  sessionTopicId: string;
  topicId: string;
  topicName: string;
  topicPrompt: string;
  voteType: 'finger' | 'roman' | 'modified_roman';
  displayOrder: number;
  revealedAt: string;
  flaggedForDiscussion: boolean;
  discussionNote: string | null;
  aggregate: number;         // Mean for finger; net-up tally for roman/modified_roman
  outlierThreshold: number;
}

// For Engineers and Facilitators — full per-voter attribution:
interface EngineerSessionTopic extends SessionTopicBase {
  votes: Array<{
    voterId: string;
    voterDisplayName: string;
    voteValue: -1 | 0 | 1 | 2 | 3 | 4;
    isOutlier: boolean;
  }>;
}

// For Engineering Managers — anonymous distribution only (FR-9.5):
// Each entry is a unique vote value and the number of participants who cast that value.
// No per-voter rows, no ordering, no identity linkage.
interface EngManagerSessionTopic extends SessionTopicBase {
  voteDistribution: Array<{
    voteValue: -1 | 0 | 1 | 2 | 3 | 4;
    count: number;
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user has no authorized relationship with this team/session |
| `404 Not Found` | Session does not exist or is not `status = 'complete'` |

**Notes**
- **Security-critical (FR-9.5):** For EM callers, the serializer must produce `voteDistribution` (a histogram of `{ voteValue, count }` entries) and must omit the `votes` field entirely. This must be enforced at the API layer, not the frontend (SEC-7). The endpoint must be tested directly with EM credentials to confirm no per-voter rows are returned in any form.
- `voteDistribution` entries are sorted by `voteValue` ascending. Only values that received at least one vote are included — zero-count entries are omitted.
- `isOutlier` is a per-voter attribute and is not present in the EM response. The topic-level `flaggedForDiscussion` field serves as the EM-visible outlier signal.
- In-progress sessions are not accessible via this endpoint — it returns `404` for sessions in any non-`complete` status.
- OR-6.3 governs facilitator access; pre-session briefing access is permitted without an active session (ADR-007 does not apply here).

---

### SESSION-009 — Add Discussion Note to Topic

**Method and URL**
```
PUT /api/v1/sessions/:sessionId/topics/:sessionTopicId/discussion-note
```

**Description**
Sets or overwrites the discussion note for a specific topic within a session. Writable from the moment a topic is revealed through the end of wrap-up; becomes read-only when the session is closed.

**Auth:** Protected.

**Authorization:** Only the session's facilitator.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |
| Path | `sessionTopicId` | `uuid` | Yes | Session-topic identifier |

**Request Body**

```typescript
interface SetDiscussionNoteRequest {
  note: string;   // Required. Empty string clears the note. Max 2000 characters.
}
```

**Response**

`200 OK`

```typescript
interface SetDiscussionNoteResponse {
  sessionTopicId: string;
  note: string | null;   // null if cleared
  updatedAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user is not the session's facilitator |
| `404 Not Found` | Session or session-topic does not exist; session-topic does not belong to this session |
| `409 Conflict` | Topic phase is `voting` or `waiting` (reveal has not occurred yet); OR session status is `complete` or `abandoned` |
| `422 Unprocessable Entity` | Note exceeds 2000 characters |

**Notes**
- **Phase guard (FR-4.9):** The implementation must check `session_topics.phase` before writing. Permitted phases: `revealed`, `complete`. Rejected phases: `voting`, `waiting`. A `409 Conflict` is returned for rejected phases — this is a state-machine violation, not an authorization failure.
- **Session-close lock (FR-6.6):** Once `sessions.status = 'complete'`, notes are read-only. The `409` check for session status must run before the phase check.
- During `wrap_up`, all topics are in `complete` phase — notes remain writable for the duration of wrap-up, allowing the facilitator to capture details of any final conversation before closing the session.
- Discussion notes are written directly to `session_topics.discussion_note` in PostgreSQL, not buffered in Redis. This ensures note durability across facilitator reconnection.
- Each topic has at most one discussion note. Overwriting is permitted; the most recent value is retained.

---

### SESSION-010 — Mark Topic for Discussion

**Method and URL**
```
PUT /api/v1/sessions/:sessionId/topics/:sessionTopicId/flagged
```

**Description**
Sets or clears the `flagged_for_discussion` boolean on a session topic.

**Auth:** Protected.

**Authorization:** Only the session's facilitator.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |
| Path | `sessionTopicId` | `uuid` | Yes | Session-topic identifier |

**Request Body**

```typescript
interface FlagTopicForDiscussionRequest {
  flagged: boolean;
}
```

**Response**

`200 OK`

```typescript
interface FlagTopicForDiscussionResponse {
  sessionTopicId: string;
  flaggedForDiscussion: boolean;
  updatedAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user is not the session's facilitator |
| `404 Not Found` | Session or session-topic does not exist |
| `409 Conflict` | Session topic is not in `revealed` or `complete` status (cannot flag unrevealed topics) |

**Notes**
- This flag persists on the session record and is visible in session history (FR-5.6).
- The WebSocket event that delivers the discussion prompt to flagged participants is a separate concern from this REST write. After the HTTP write, the WebSocket layer broadcasts the state change to connected clients.

> **Open question (from SA catalog):** Whether the discussion prompt delivery to outlier participants requires a new WebSocket event (`participant.prompted`) or is encoded in a modified existing event has not been decided. This REST endpoint covers the persistent write only. The WebSocket behavior must be defined separately before the discussion flow is fully implementable.

---

### SESSION-011 — Annotate Completed Session

**Method and URL**
```
PUT /api/v1/sessions/:sessionId/annotation
```

**Description**
Adds or replaces a short annotation on a completed session. The annotation is displayed in the trend dashboard's session history list.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'`. Any facilitator with access to the team may annotate (not restricted to the facilitator who ran the session).

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |

**Request Body**

```typescript
interface AnnotateSessionRequest {
  annotation: string;   // Required. Non-empty. Max 60 characters.
}
```

**Response**

`200 OK`

```typescript
interface AnnotateSessionResponse {
  sessionId: string;
  annotation: string;
  updatedAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user is not a facilitator |
| `404 Not Found` | Session does not exist or is not `status = 'complete'` |
| `422 Unprocessable Entity` | `annotation` is empty, whitespace-only, or exceeds 60 characters |

**Notes**
- Annotations apply to completed sessions only. In-progress sessions cannot be annotated.
- Submitting an empty string is rejected (UC: Annotate a Session, alternate flow) — empty strings do not clear an existing annotation.

> **Open question (from SA catalog):** The `sessions` table as designed in `database-schema.md` does not include an `annotation` column. A migration to add `sessions.annotation TEXT NULL` is required before this endpoint can be implemented. This migration must be reviewed by the SA and BA.

> **Open question:** The 60-character limit is taken from the use case's legibility guidance. Confirm with BA.

---

## Group 5: Voting and Results

---

### VOTE-001 — Get Action Items for Pre-Session Review

**Method and URL**
```
GET /api/v1/sessions/:sessionId/pre-session-items
```

**Description**
Returns open and in-progress action items for the team with staleness indicators. Used by reconnecting participants who need the current pre-session review state without going through the session start flow.

**Auth:** Protected.

**Authorization:** Session facilitator OR active `participant` member of the session's team who has a `session_participants` row for this session.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |

**Response**

`200 OK`

```typescript
interface GetPreSessionItemsResponse {
  sessionId: string;
  actionItems: Array<{
    actionItemId: string;
    description: string;
    ownerUserId: string;
    ownerDisplayName: string;
    status: 'open' | 'in_progress';
    originatingSessionId: string;
    originatingSessionNumber: number;
    stalenessLevel: 'none' | 'yellow' | 'orange' | 'red';
    createdAt: string;
    updatedAt: string;
  }>;
  hasItems: boolean;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | User is not a participant or facilitator in this session |
| `404 Not Found` | Session does not exist |
| `409 Conflict` | Session is not in `pre_session` status |

**Notes**
- Staleness is computed at query time from the count of completed sessions since each item's `updated_at`.
- Only items from sessions with `status = 'complete'` are included — draft action items from active `wrap_up` sessions are excluded.
- This endpoint may be partially redundant with `SESSION-004` (which returns the same items as part of the start response). It exists as a separate endpoint for reconnecting participants.

---

### VOTE-002 — Update Action Item Status

**Method and URL**
```
PATCH /api/v1/action-items/:actionItemId/status
```

**Description**
Updates the status of an action item following directed transitions only. Permitted: `open` → `in_progress`, `open` → `resolved`, `in_progress` → `resolved`. Backward transitions and changes from `resolved` are rejected. If transitioning to `resolved`, an optional resolution note may be included. A history record is written on every status change.

**Auth:** Protected.

**Authorization:**
- `engineer`: may only update action items they own (`action_items.owner_id = authenticated_user_id`) and that belong to a team they are a member of.
- `facilitator`: may update any action item belonging to a team they are actively facilitating (active session exists), including items owned by others.
- `engineering_manager`: no write access.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `actionItemId` | `uuid` | Yes | Action item identifier |

**Request Body**

```typescript
interface UpdateActionItemStatusRequest {
  status: 'open' | 'in_progress' | 'resolved';  // Must be a valid forward transition from current status
  resolutionNote?: string;   // Optional when status = 'resolved'. Max 500 characters.
  sessionId?: string;        // Optional. The current session context, for history attribution.
                             // Required when the update occurs within a session (sets resolved_in_session_id).
}
```

**Response**

`200 OK`

```typescript
interface UpdateActionItemStatusResponse {
  actionItemId: string;
  status: 'open' | 'in_progress' | 'resolved';
  resolutionNote: string | null;
  resolvedInSessionId: string | null;
  updatedAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Engineer attempting to update an item they do not own; EM attempting any update; facilitator attempting to update outside an active session context |
| `404 Not Found` | Action item does not exist |
| `409 Conflict` | Requested transition is not permitted: backward transitions (`in_progress` → `open`) and any transition from `resolved` are rejected (FR-7.3) |
| `422 Unprocessable Entity` | `resolutionNote` exceeds 500 characters; `sessionId` references a session not in an active state |

**Notes**
- **Directed state machine (FR-7.3):** Permitted transitions: `open` → `in_progress`, `open` → `resolved`, `in_progress` → `resolved`. All other transitions return `409 Conflict`. The application must read the current status before writing and reject invalid transitions. A same-status write (no-op) resets the staleness clock and is permitted for `open` and `in_progress`; a no-op write on `resolved` is also rejected since `resolved` is terminal.
- A database CHECK constraint should enforce the transition rule at the persistence layer as a secondary guard: `(old_status, new_status) IN (('open','in_progress'), ('open','resolved'), ('in_progress','resolved'))`.
- An `action_item_history` row is written for every accepted status change.
- `resolved_in_session_id` on `action_items` is set to `sessionId` when `status = 'resolved'` and a `sessionId` is provided.
- After this REST write, the WebSocket layer broadcasts `actionitem.updated` to all session participants if `sessionId` is provided and active.
- The database CHECK constraint `action_items_resolved_has_session` requires `resolved_in_session_id IS NOT NULL` when `status = 'resolved'`. The application enforces this before writing.

---

### VOTE-003 — Get Votes for Revealed Topic

**Method and URL**
```
GET /api/v1/sessions/:sessionId/topics/:sessionTopicId/votes
```

**Description**
Returns vote results for a topic that has been revealed. Returns `403` if the topic has not yet been revealed. Serves reconnection recovery and session history.

**Auth:** Protected.

**Authorization:** Session facilitator OR active `participant` in the session OR authorized team member viewing session history. Engineering Managers receive an anonymous vote distribution (counts per value), consistent with `SESSION-008` (FR-9.5).

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |
| Path | `sessionTopicId` | `uuid` | Yes | Session-topic identifier |

**Response**

`200 OK` — shape differs by caller role:

```typescript
// For Engineers and Facilitators:
interface GetRevealedVotesResponseForEngineer {
  sessionTopicId: string;
  topicName: string;
  voteType: 'finger' | 'roman' | 'modified_roman';
  phase: 'revealed' | 'complete';
  revealedAt: string;
  aggregate: number;
  outlierThreshold: number;
  votes: Array<{
    voterId: string;
    voterDisplayName: string;
    voteValue: -1 | 0 | 1 | 2 | 3 | 4;
    isOutlier: boolean;
  }>;
}

// For Engineering Managers (FR-9.5 — anonymous distribution, no per-voter rows):
interface GetRevealedVotesResponseForEM {
  sessionTopicId: string;
  topicName: string;
  voteType: 'finger' | 'roman' | 'modified_roman';
  phase: 'revealed' | 'complete';
  revealedAt: string;
  aggregate: number;
  outlierThreshold: number;
  voteDistribution: Array<{
    voteValue: -1 | 0 | 1 | 2 | 3 | 4;
    count: number;
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | User has no relationship to this session; OR topic has not yet been revealed (`phase = 'voting'` or `'waiting'`) |
| `404 Not Found` | Session or session-topic does not exist |

**Notes**
- The `403` for unrevealed topics is a hard correctness requirement (BRD Section 6.1). It must not be possible to retrieve pre-reveal vote values via this endpoint, regardless of role.
- The reveal itself is triggered via WebSocket (`reveal.trigger`), not this endpoint. This REST endpoint serves clients who missed the `session.revealed` WebSocket event.
- Votes are read from PostgreSQL (not Redis). Pre-reveal votes in Redis are never accessible via HTTP.

---

### VOTE-004 — Reassign Action Item Owner

**Method and URL**
```
PATCH /api/v1/action-items/:actionItemId/owner
```

**Description**
Reassigns an action item to a new active team member. Typically used when the current owner has left the team.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` only. The facilitator must have an active session for the team this action item belongs to.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `actionItemId` | `uuid` | Yes | Action item identifier |

**Request Body**

```typescript
interface ReassignActionItemRequest {
  newOwnerUserId: string;    // Must be an active participant member of the action item's team
  sessionId?: string;        // Current session context, for history attribution
}
```

**Response**

`200 OK`

```typescript
interface ReassignActionItemResponse {
  actionItemId: string;
  ownerUserId: string;
  ownerDisplayName: string;
  updatedAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not a facilitator; resolved action items cannot be reassigned |
| `404 Not Found` | Action item, new owner user, or new owner's team membership does not exist |
| `422 Unprocessable Entity` | New owner is not an active `participant` member of the action item's team; new owner is the facilitator themselves |

**Notes**
- The reassignment event is recorded in `action_item_history` with the prior `owner_id` and the facilitator as `changed_by_user_id`.
- The new owner must be an active `participant` member of the team — not the facilitator themselves, and not an EM.
- Resolved action items cannot be reassigned.

---

## Group 6: Action Items

---

### ACTION-001 — Create Action Item

**Method and URL**
```
POST /api/v1/sessions/:sessionId/action-items
```

**Description**
Creates an action item during the session wrap-up phase. The item is immediately persisted to PostgreSQL and broadcast to all session participants via WebSocket.

**Auth:** Protected.

**Authorization:** Only the session's facilitator. Session must be in `wrap_up` status.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier (must be in `wrap_up` status) |

**Request Body**

```typescript
interface CreateActionItemRequest {
  description: string;           // Required. Non-empty. Max 1000 characters.
  ownerUserId: string;           // Required. Must be an active participant member of the team.
  sessionTopicId?: string;       // Optional. Links item to a specific topic. Must belong to this session.
}
```

**Response**

`201 Created`

```typescript
interface CreateActionItemResponse {
  actionItemId: string;
  description: string;
  ownerUserId: string;
  ownerDisplayName: string;
  status: 'open';
  sessionId: string;
  sessionTopicId: string | null;
  teamId: string;
  createdAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not the session's facilitator; session not in `wrap_up` status |
| `404 Not Found` | Session or `ownerUserId` does not exist; `sessionTopicId` does not belong to this session |
| `422 Unprocessable Entity` | Description is empty or exceeds 1000 characters; `ownerUserId` is not an active participant of the team |

**Notes**
- Action items are written to PostgreSQL immediately at creation — not buffered until session close. This is what enables wrap-up recovery (persistence layer mapping, Section 1, "Action Item Created").
- Action items always start with `status = 'open'`. No other initial status is permitted.
- A WebSocket broadcast (`actionitem.created`) follows this HTTP write. The REST write completes first; the broadcast is sent after.
- The owner must be an active `participant` team member — not the facilitator or an EM.

---

### ACTION-002 — Update Action Item (During Wrap-Up)

**Method and URL**
```
PATCH /api/v1/sessions/:sessionId/action-items/:actionItemId
```

**Description**
Updates the description or owner of an action item during the current session's wrap-up phase. Once the session is closed, this path returns `403`.

**Auth:** Protected.

**Authorization:** Only the session's facilitator. Session must be in `wrap_up` status. The action item must belong to this session.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |
| Path | `actionItemId` | `uuid` | Yes | Action item identifier |

**Request Body**

```typescript
interface UpdateActionItemDraftRequest {
  description?: string;      // Optional. Non-empty if provided. Max 1000 characters.
  ownerUserId?: string;      // Optional. Must be an active participant of the team if provided.
}
```

**Response**

`200 OK`

```typescript
interface UpdateActionItemDraftResponse {
  actionItemId: string;
  description: string;
  ownerUserId: string;
  ownerDisplayName: string;
  updatedAt: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not the session's facilitator; session is not in `wrap_up` status; action item does not belong to this session |
| `404 Not Found` | Session, action item, or `ownerUserId` does not exist |
| `422 Unprocessable Entity` | Description is empty or exceeds character limit; new owner is not an active participant of the team |

**Notes**
- This endpoint covers description and owner changes only. Status changes go through `VOTE-002`.
- The "draft" concept is enforced by session lifecycle: items are mutable via this endpoint while the session is in `wrap_up`; after `complete`, they are immutable.
- No `action_item_history` entry is written for description/owner changes during wrap-up (the item has not yet been finalized). Confirm with BA whether history should also record these edits.

---

### ACTION-003 — Delete Action Item (Wrap-Up Only)

**Method and URL**
```
DELETE /api/v1/sessions/:sessionId/action-items/:actionItemId
```

**Description**
Permanently deletes an action item created in the current wrap-up phase before the session is closed. This is the only delete path — action items cannot be deleted after session close.

**Auth:** Protected.

**Authorization:** Only the session's facilitator. Session must be in `wrap_up` status. Action item must belong to this session.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `sessionId` | `uuid` | Yes | Session identifier |
| Path | `actionItemId` | `uuid` | Yes | Action item to delete |

**Response**

`204 No Content`

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not the session's facilitator; action item does not belong to this session |
| `404 Not Found` | Session or action item does not exist |
| `409 Conflict` | Session is not in `wrap_up` status (session is `active`, `complete`, or `abandoned`) |

**Notes**
- **BRD authority:** FR-7.1a (added 2026-03-15). This endpoint implements the narrow exception to FR-7.1 permitting pre-close deletion of action items created during the current wrap-up, to allow correction of data-entry errors before items enter the permanent record.
- The `403 Forbidden` check for `wrap_up` status is replaced by `409 Conflict` to distinguish a state-machine violation from an authorization failure. A facilitator who is authorized but calls this at the wrong session state receives a `409`, not a `403`.
- This is a hard delete from the `action_items` table. Any `action_item_history` rows cascade-delete. No history entry is written for a pre-close deletion.
- After session `complete`, action items are governed by FR-7.1 in full and may not be deleted. The only permitted terminal state is `resolved`.
- The implementation must verify `action_items.session_id = :sessionId` before deleting, to prevent cross-session deletes.

---

### ACTION-004 — Get Action Item Backlog for Team

**Method and URL**
```
GET /api/v1/teams/:teamId/action-items
```

**Description**
Returns all finalized action items for a team across all completed sessions, with staleness indicators. Supports filtering by status and owner.

**Auth:** Protected.

**Authorization:**
- `engineer` / `participant`: active team member — sees their own team's backlog only
- `engineering_manager`: active team manager — sees the managed team's backlog (read-only)
- `facilitator`: only during an active session for the team (per ADR-007)

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Query | `status` | `'open' \| 'in_progress' \| 'resolved' \| 'open,in_progress'` | No | Filter by status. Default: `'open,in_progress'` |
| Query | `ownerId` | `uuid` | No | Filter by owner user ID |
| Query | `limit` | `integer` | No | Default 50, max 200 |
| Query | `offset` | `integer` | No | Default 0 |

**Response**

`200 OK`

```typescript
interface GetActionItemBacklogResponse {
  teamId: string;
  total: number;
  limit: number;
  offset: number;
  actionItems: Array<{
    actionItemId: string;
    description: string;
    ownerUserId: string;
    ownerDisplayName: string;
    status: 'open' | 'in_progress' | 'resolved';
    originatingSessionId: string;
    originatingSessionNumber: number;
    stalenessLevel: 'none' | 'yellow' | 'orange' | 'red';
    resolutionNote: string | null;
    resolvedInSessionId: string | null;
    resolvedInSessionNumber: number | null;
    createdAt: string;
    updatedAt: string;
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user has no authorized relationship with this team |
| `404 Not Found` | Team does not exist |

**Notes**
- Only items from sessions with `status = 'complete'` are included. Action items from sessions in `wrap_up` status are excluded — this is the mechanism that prevents draft items from appearing in the public backlog before session close.
- Staleness is computed at query time. The staleness algorithm counts completed sessions since each item's `updated_at` and maps to levels using the `application_settings.staleness_threshold_sessions` value.
- `resolvedInSessionNumber` requires a join to `sessions` to get the `session_number` for `resolved_in_session_id`.

---

### ACTION-005 — Get Action Item Detail with History

**Method and URL**
```
GET /api/v1/action-items/:actionItemId
```

**Description**
Returns the full record and chronological status-change history for a single action item, with actor attribution.

**Auth:** Protected.

**Authorization:** Same as `ACTION-004`: active team member, team EM, or facilitator with active session for the team. Access validated via `action_items.team_id`.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `actionItemId` | `uuid` | Yes | Action item identifier |

**Response**

`200 OK`

```typescript
interface GetActionItemDetailResponse {
  actionItemId: string;
  description: string;
  ownerUserId: string;
  ownerDisplayName: string;
  status: 'open' | 'in_progress' | 'resolved';
  teamId: string;
  originatingSessionId: string;
  originatingSessionNumber: number;
  sessionTopicId: string | null;
  sessionTopicName: string | null;
  resolutionNote: string | null;
  resolvedInSessionId: string | null;
  resolvedInSessionNumber: number | null;
  createdAt: string;
  updatedAt: string;
  history: Array<{
    historyId: string;
    changedByUserId: string;
    changedByDisplayName: string;
    previousStatus: 'open' | 'in_progress' | 'resolved';
    newStatus: 'open' | 'in_progress' | 'resolved';
    resolutionNote: string | null;   // Present if change was to 'resolved'
    sessionId: string | null;
    sessionNumber: number | null;
    changedAt: string;
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user has no authorized relationship with the action item's team |
| `404 Not Found` | Action item does not exist |

**Notes**
- `history` is sourced from `action_item_history`, ordered by `changed_at` ascending.
- `changedByDisplayName` requires a join to `users` via `changed_by_user_id`.
- Whether every status update (including no-ops) is recorded in history is a BA decision. This contract assumes all calls to `VOTE-002` write a history row, since no-op updates reset the staleness clock.

---

## Group 7: Trend and Reporting

---

### TREND-001 — Get Trend Dashboard Data

**Method and URL**
```
GET /api/v1/teams/:teamId/trends
```

**Description**
Returns aggregated trend data for all team topics across recent sessions, including per-topic score series, gap indicators, and the Project Trend directional indicator.

**Auth:** Protected.

**Authorization:**
- Active `participant` team member
- `engineering_manager` for this team (aggregate data only — no individual vote attribution)
- `facilitator` with an active session for this team (per ADR-007)

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Query | `sessionLimit` | `integer \| 'all'` | No | Number of most-recent sessions to include. Default: `6`. Use `'all'` for full history. Max: `100` when numeric. |

**Response**

`200 OK`

```typescript
interface GetTrendDashboardResponse {
  teamId: string;
  sessionCount: number;         // Total completed sessions for this team
  minimumSessionsRequired: number;  // From application_settings.trend_chart_minimum_sessions
  topics: Array<{
    topicId: string;
    topicName: string;
    topicStatus: 'active' | 'archived';
    insufficientData: boolean;   // true if fewer than minimumSessionsRequired data points exist
    sessions: Array<{
      sessionId: string;
      sessionNumber: number;
      completedAt: string;
      score: number | null;      // null indicates a gap (topic was absent from this session)
      hadGap: boolean;           // true if topic was absent (not in session_topics for this session)
      annotation: string | null;
    }>;
  }>;
  projectTrend: {
    value: 'up' | 'steady' | 'down' | null;   // null if algorithm produces no result
    insufficientData: boolean;
  };
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user has no authorized relationship with this team |
| `404 Not Found` | Team does not exist |
| `422 Unprocessable Entity` | `sessionLimit` is not a positive integer or `'all'` |

**Notes**
- **Archived topics (FR-9.3):** The `topics` array includes both active and archived topics. `topicStatus: 'archived'` identifies removed topics. The dashboard's archived-topic toggle is implemented as client-side filtering on this response — no separate call to TOPIC-002 is needed or appropriate. Participants and EMs access archived topic history exclusively through this endpoint.
- `hadGap = true` for a session-topic data point indicates the topic was not present in that session's `session_topics`. This enables the frontend to render a broken trend line rather than interpolating across the gap (UC: View Trend Chart with Topic Gap).
- `insufficientData = true` means the topic has fewer than `minimumSessionsRequired` (default 3, from `application_settings`) data points. The frontend must render the empty state (FR-9.7).
- EM access: `score` values are aggregates per topic per session. No individual vote attribution is returned.

> **Open question (from SA catalog):** The Project Trend computation algorithm (the formula for computing `projectTrend.value`) is not defined in any reviewed document. This field will return `null` until the algorithm is specified by the BA. **This must be resolved before the trend dashboard is considered complete.**

---

### TREND-002 — Get Full Topic Trend History

**Method and URL**
```
GET /api/v1/teams/:teamId/topics/:topicId/trend
```

**Description**
Returns the complete session history for a single topic across all completed sessions. Used when a user expands a trend chart to see full history beyond the default 6-session window.

**Auth:** Protected.

**Authorization:** Same as `TREND-001`.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Path | `topicId` | `uuid` | Yes | Topic identifier (canonical topic, not session-topic) |

**Response**

`200 OK`

```typescript
interface GetTopicTrendHistoryResponse {
  topicId: string;
  topicName: string;
  topicStatus: 'active' | 'archived';
  totalSessions: number;      // Total sessions where this topic was present
  sessions: Array<{
    sessionId: string;
    sessionNumber: number;
    completedAt: string;
    score: number | null;     // null = gap (topic absent from this session)
    hadGap: boolean;
    annotation: string | null;
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user has no authorized relationship with this team |
| `404 Not Found` | Team or topic does not exist; topic does not belong to this team |

**Notes**
- Returns all historical sessions for the topic, regardless of the `sessionLimit` used in `TREND-001`.
- `hadGap` uses the same logic as `TREND-001`: `true` for sessions where the topic was absent from `session_topics`.
- Multiple gap intervals may appear if the topic was removed and re-added multiple times.
- Archived topics are accessible via this endpoint (required for trend history visibility).

---

### TREND-003 — Get Application Settings

**Method and URL**
```
GET /api/v1/settings
```

**Description**
Returns current application-level configuration values: outlier threshold, staleness threshold, and trend chart minimum sessions.

**Auth:** Protected.

**Authorization:** Any authenticated user (read). Write access (`PUT /api/v1/settings`) is restricted to `application_admin` role.

**Request**

No parameters.

**Response**

`200 OK`

```typescript
interface GetApplicationSettingsResponse {
  settings: {
    outlierThresholdIndividual: number;      // Default: 1.5
    stalenessThresholdSessions: number;      // Default: 2
    trendChartMinimumSessions: number;       // Default: 3
  };
  lastUpdatedAt: string | null;
  lastUpdatedByDisplayName: string | null;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |

**Notes**
- FR-5.2 explicitly requires the outlier threshold to be "visible, auditable, and changeable without a code deployment." This endpoint is the read path.
- Per-team overrides are served by `TREND-004`. The effective threshold for a team is the team override (if one exists) or this application-level value.

---

### TREND-003b — Update Application Settings

**Method and URL**
```
PUT /api/v1/settings
```

**Description**
Updates application-level configuration settings. Restricted to application administrators.

**Auth:** Protected.

**Authorization:** `global_role = 'application_admin'` only.

**Request Body**

```typescript
interface UpdateApplicationSettingsRequest {
  outlierThresholdIndividual?: number;    // Must be > 0
  stalenessThresholdSessions?: number;    // Must be a positive integer
  trendChartMinimumSessions?: number;     // Must be a positive integer ≥ 1
}
```

**Response**

`200 OK` — same shape as `GET /api/v1/settings`.

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not an application admin |
| `422 Unprocessable Entity` | Any value fails validation |

**Notes**
- Updates are applied to `application_settings` table with `updated_at = now()` and `updated_by_user_id` set to the authenticated user's ID.
- Partial updates are permitted — only fields included in the request body are updated.

---

### TREND-004 — Get Effective Outlier Threshold for Team

**Method and URL**
```
GET /api/v1/teams/:teamId/outlier-threshold
```

**Description**
Returns the effective outlier threshold for a team — the team-level override if one exists, or the application-level default.

**Auth:** Protected.

**Authorization:** `facilitator` eligible to facilitate the team (not a member), OR `application_admin`.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |

**Response**

`200 OK`

```typescript
interface GetEffectiveThresholdResponse {
  teamId: string;
  threshold: number;
  isOverride: boolean;   // true if a team-level override is active
  overrideSetAt: string | null;
  overrideSetByDisplayName: string | null;
  applicationDefault: number;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Requester is not an eligible facilitator or admin |
| `404 Not Found` | Team does not exist |

**Notes**
- The server-side reveal handler uses the value from this endpoint (or equivalent internal lookup) when computing outlier flags at reveal time.
- Per FR-5.3, team-level overrides are a `PREF` requirement. This endpoint may be deferred. The application-level threshold from `TREND-003` can be used as the sole threshold initially.

---

### TREND-005 — Get Facilitator Briefing View

**Method and URL**
```
GET /api/v1/teams/:teamId/briefing
```

**Description**
Returns the facilitator briefing data for a team: last session date, open action items, recent trend summary per topic, and topics flagged for follow-up in the prior session. Accessible without starting a session.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` AND facilitator must not be an active member of this team.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Query | `trendSessions` | `integer` | No | Number of recent sessions for trend summary. Default: `3`. Max: `6`. |

**Response**

`200 OK`

```typescript
interface GetFacilitatorBriefingResponse {
  teamId: string;
  teamName: string;
  lastSessionDate: string | null;   // completedAt of most recent completed session
  completedSessionCount: number;
  openActionItems: Array<{
    actionItemId: string;
    description: string;
    ownerDisplayName: string;
    status: 'open' | 'in_progress';
    stalenessLevel: 'none' | 'yellow' | 'orange' | 'red';
    originatingSessionNumber: number;
  }>;
  trendSummary: Array<{
    topicId: string;
    topicName: string;
    recentScores: Array<{
      sessionNumber: number;
      score: number | null;
      hadGap: boolean;
    }>;
  }>;
  topicsFlaggedInPriorSession: Array<{
    sessionTopicId: string;
    topicName: string;
    discussionNote: string | null;
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not a facilitator; or facilitator is an active member of this team |
| `404 Not Found` | Team does not exist |

**Notes**
- **BRD authority:** OR-6.3 (facilitator briefing accessible without starting a session). ADR-007 resolved: OR-6.3 governs; the briefing endpoint does not require an active session.
- `topicsFlaggedInPriorSession` is populated from the most recently completed session's `session_topics` where `flagged_for_discussion = true`.
- `openActionItems` is the same set as `ACTION-004` with default `status=open,in_progress` filter, but summarized.
- **Zero-session teams (FR-1.7):** A team with no completed sessions is a valid state (standalone team creation or team created during session initiation where no session has yet closed). The response shape is the same; fields populate as follows:
  - `lastSessionDate`: `null`
  - `completedSessionCount`: `0`
  - `openActionItems`: `[]` (no sessions means no action items)
  - `trendSummary`: array of the team's seeded topics, each with `recentScores: []`
  - `topicsFlaggedInPriorSession`: `[]`
  - The endpoint returns `200 OK` — it must not return a `404` or error for a zero-session team.

---

## Group 8: Health and Observability

---

### HEALTH-001 — Liveness Check

**Method and URL**
```
GET /health/live
```

**Description**
Returns `200 OK` if the application process is alive and able to respond. No external dependencies are checked.

**Auth:** Public (no cookie required — Kubernetes must probe without credentials).

**Authorization:** None.

**Request**

No parameters.

**Response**

`200 OK`

```typescript
interface LivenessResponse {
  status: 'ok';
  timestamp: string;   // ISO 8601
}
```

**Error Responses**

| Status | When |
|---|---|
| (no 5xx) | If this endpoint returns any error, the process is dead and Kubernetes will restart it |

**Notes**
- No PostgreSQL query, no Redis call. If the process can respond at all, return `200`.
- Must respond within 5 seconds. Any slower response is treated as unhealthy by the liveness probe configuration.
- This route is intentionally outside the `/api/v1/` prefix to avoid authentication middleware.

---

### HEALTH-002 — Readiness Check

**Method and URL**
```
GET /health/ready
```

**Description**
Returns `200 OK` if both PostgreSQL and Redis are reachable and responsive. Returns `503` with dependency status details if either is unavailable.

**Auth:** Public (no cookie required).

**Authorization:** None.

**Request**

No parameters.

**Response**

`200 OK` when ready:

```typescript
interface ReadinessResponseOk {
  status: 'ready';
  postgres: 'ok';
  redis: 'ok';
  timestamp: string;
}
```

`503 Service Unavailable` when not ready:

```typescript
interface ReadinessResponseNotReady {
  status: 'not_ready';
  postgres: 'ok' | 'error';
  redis: 'ok' | 'error';
  timestamp: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `503 Service Unavailable` | PostgreSQL or Redis check fails |

**Notes**
- PostgreSQL check: `SELECT 1` with a 2-second timeout.
- Redis check: `PING` with a 2-second timeout.
- Both dependency statuses are reported discretely — a single combined status is insufficient for operational triage (NFR-OBS-003).
- This route is outside the `/api/v1/` prefix to avoid authentication middleware.
- This endpoint is the mechanism by which degraded or failed infrastructure conditions become detectable before a user submits a support report.

---

## Appendix A: Shared TypeScript Types

The following types are referenced throughout the contract and are defined in `packages/shared/src/types/`.

```typescript
// packages/shared/src/types/domain.ts

export type VoteType = 'finger' | 'roman' | 'modified_roman';

export type SessionStatus =
  | 'lobby'
  | 'pre_session'
  | 'active'
  | 'wrap_up'
  | 'complete'
  | 'abandoned';

export type TopicPhase = 'waiting' | 'voting' | 'revealed' | 'complete';

export type ActionItemStatus = 'open' | 'in_progress' | 'resolved';

export type StalenessLevel = 'none' | 'yellow' | 'orange' | 'red';

export type GlobalRole =
  | 'engineer'
  | 'senior_engineer'
  | 'facilitator'
  | 'engineering_manager'
  | 'application_admin';

export type MembershipRole = 'participant' | 'engineering_manager';

// Vote value encoding:
// finger: 1 | 2 | 3 | 4
// roman: 1 (up/good) | -1 (down/bad)
// modified_roman: 1 (up) | 0 (steady) | -1 (down)
export type VoteValue = -1 | 0 | 1 | 2 | 3 | 4;

export interface RevealedVoteEntry {
  voterId: string;
  voterDisplayName: string;   // Omitted in EM-filtered responses
  voteValue: VoteValue;
  voteType: VoteType;
  isOutlier: boolean;
}

export interface ErrorResponse {
  error: string;
  message: string;
  requestId?: string;
}
```

---

## Appendix B: Authorization Matrix

This table consolidates the server-side authorization rules. All checks are performed independently of the frontend. All rows assume a valid authenticated session is present.

| Endpoint | Engineer (participant) | Facilitator | Engineering Manager | App Admin | Notes |
|---|---|---|---|---|---|
| AUTH-001 to AUTH-003 | All | All | All | All | Universal; no session required |
| AUTH-004 | Self only | Self only | Self only | Self only | |
| TEAM-001 | No | Yes | No | Yes | Facilitator must not be target team member |
| TEAM-002 | No | Yes | No | Yes | |
| TEAM-003 | Own team | Teams with active session | Managed teams | All | 403 on inaccessible teams |
| TEAM-005 | No | Yes (non-member teams) | No | Yes | |
| TEAM-006 | No | Yes | No | Yes | |
| TOPIC-001 | Own team (read) | Teams with active session | No | Yes | |
| TOPIC-002 to TOPIC-007 | No | Yes (non-member teams, post-lock) | No | Yes | Customization lock enforced |
| SESSION-001 | No | Yes (non-member teams) | No | Yes | Cross-team check re-enforced |
| SESSION-002 | If participant | If facilitator | No | Yes | Live sessions only |
| SESSION-003 | Yes (team member, participant role) | No | No | Yes | EM role blocked |
| SESSION-004 to SESSION-006 | No | Session facilitator only | No | Yes | |
| SESSION-007 | Own team | Teams with active session | Managed teams | All | ADR-007 |
| SESSION-008 | Own team (full votes) | Facilitated teams (full votes) | Managed teams (aggregates only) | All | EM filter enforced server-side |
| SESSION-009 to SESSION-011 | No | Session facilitator / any facilitator (011) | No | Yes | |
| VOTE-001 | Session participant | Session facilitator | No | Yes | |
| VOTE-002 | Own items only | Any item (active session) | No | Yes | |
| VOTE-003 | Session participant | Session facilitator | Aggregates only | Yes | Pre-reveal: 403 |
| VOTE-004 | No | Yes (active session) | No | Yes | |
| ACTION-001 to ACTION-003 | No | Session facilitator | No | Yes | Wrap-up only for 001-003 |
| ACTION-004 | Own team | Teams with active session | Managed teams | All | No draft items |
| ACTION-005 | Own team | Teams with active session | Managed teams | All | |
| TREND-001 to TREND-002 | Own team | Teams with active session | Managed teams (aggregates) | All | |
| TREND-003 (GET) | Yes | Yes | Yes | Yes | Read only |
| TREND-003b (PUT) | No | No | No | Yes | Write: admin only |
| TREND-004 | No | Eligible facilitators | No | Yes | |
| TREND-005 | No | Eligible facilitators | No | Yes | See open question |
| HEALTH-001 to HEALTH-002 | Unauthenticated | Unauthenticated | Unauthenticated | Unauthenticated | Infrastructure probes |

---

## Appendix C: Open Questions Summary

The following open questions must be resolved before the affected endpoints can be finalized. Each is also flagged inline in the endpoint definition above.

| ID | Endpoint | Question | Owner |
|---|---|---|---|
| OQ-1 | SESSION-003 | ~~RESOLVED~~ Team join token mechanism removed. SESSION-003 (session join link) is the sole entry mechanism. Non-members are denied with an explanatory message per FR-2.4. Membership is managed by admins and EMs via TEAM-005/TEAM-006. | Closed |
| OQ-2 | SESSION-011 | The `sessions` table has no `annotation` column. A migration is required before this endpoint is implementable. | Marcus O. to add migration; SA to review |
| OQ-3 | SESSION-010 | The WebSocket event for delivering a discussion prompt to flagged participants is not defined. Is a new event (`participant.prompted`) needed, or is this encoded in an existing event? | Architecture / Full Stack to define |
| OQ-4 | TREND-001 | The Project Trend computation algorithm (`projectTrend.value`) is not specified in any reviewed document. Cannot be implemented until the algorithm is defined. | BA to specify |
| OQ-5 | TREND-005 | ADR-007 restricts facilitator history access to during an active session, but OR-6.3 requires the briefing to be accessible pre-session. These are in direct conflict. Current implementation follows OR-6.3. | SA + BA to resolve formally |
| OQ-6 | TEAM-005 | The authorization scope for role management (facilitator-only, non-member requirement) has not been fully validated against the BRD. May need to be opened to any authenticated user. | BA to confirm |
| OQ-7 | TOPIC-007, SESSION-011 | Character limits for topic annotations (500 chars assumed) and session annotations (60 chars from use case guidance) are not formally specified. | BA to confirm |
| OQ-8 | ACTION-002 | Whether description/owner edits during wrap-up are recorded in `action_item_history` is unspecified. Current contract does not write history for pre-finalization edits. | BA to confirm |

---

## Appendix D: Endpoints Explicitly Excluded from HTTP REST

The following behaviors must NOT be implemented as REST endpoints. They are governed by the WebSocket layer. Implementing them as REST would violate the simultaneous reveal integrity requirement (BRD Section 6.1).

| Behavior | WebSocket message | Why not REST |
|---|---|---|
| Submit and lock in a vote | `vote.submit` | HTTP polling would expose vote timing to observers |
| Trigger the vote reveal | `reveal.trigger` | Must be a server-initiated broadcast to all clients simultaneously |
| Advance to next topic | `topic.advance` | Must broadcast to all participants simultaneously |
| Participant join/leave notification | `participant.joined` / `participant.left` | Real-time push required |
| Readiness grid updates | `vote.locked` (to facilitator only) | Polling introduces unacceptable latency |
| Action item status real-time propagation | `actionitem.updated` | Write via REST (`VOTE-002`), notification via WebSocket |

### WebSocket Specification Gap — FR-4.6.1

FR-4.6.1 [HARD] requires that the `reveal.trigger` event payload include a server-generated timestamp, and that clients use this timestamp to calculate and log observed delivery latency against a 15-second SLA window. This requirement is not fully specifiable within this REST API contract document.

**Required output:** A dedicated WebSocket Specification document must be produced before the real-time layer is considered ready for implementation. At minimum, that document must specify:
- The `reveal.trigger` event payload schema, including the required `serverTimestamp` field (ISO 8601, UTC)
- The client-side latency calculation and logging obligation
- The 15-second delivery SLA definition and how violations are surfaced
- Payload schemas for all other WebSocket messages listed in this table

See `todo.md` in the project root.

---

*Document end. Total endpoints defined: 34 (including TREND-003b; TEAM-004 removed 2026-03-15). Open questions: 8 (several resolved — see Appendix C).*