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
| `facilitator in their read window` | A `session facilitator` for one of the team's sessions while that session is inside the [facilitator read window](#facilitator-read-window) (below). Read-only outside the live statuses. |

#### Facilitator read window

Where an endpoint below grants read access to a "`facilitator` in their read window" (formerly worded "`facilitator` with an active session for the team"), the facilitator must be the `session facilitator` of at least one session for that team in one of these states. This is path 3 of `evaluateTeamAccess` (`packages/backend/src/auth/team-content-access-helper.ts`; spec `team-content-access`):

| Session state | Window |
|---|---|
| `lobby`, `pre_session`, `active`, `wrap_up` | The whole time the session is in that status |
| `draft` | Until 24 hours after `sessions.created_at`. Expired lazily at read time; there is no job that changes the status |
| `complete` | Until `sessions.facilitator_access_expires_at`, which SESSION-006 sets to completion time + 30 minutes (the post-session grace window). No client call can change it |

Outside this window the facilitator receives `403`. The `draft` and `complete` windows grant **read** access only. Endpoints that let a facilitator **write** team data use the narrower set of live statuses (`lobby`, `pre_session`, `active`, `wrap_up`); see VOTE-002 (Update Action Item Status, Decision D10). "Active session" used elsewhere in this document, such as SESSION-001's `409 Conflict`, means only those live statuses and is unrelated to this window.

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

**Promotion block (corrected — restrict-team-005-em-promotion, GitHub issue #109, design.md Decision B):** This endpoint SHALL reject any request that would change a member's role from `participant` to `engineering_manager`, unconditionally — for **every** actor, including `application_admin`, with no admin override, feature flag, or configuration exception. Establishing a new Engineering Manager relationship is exclusively TEAM-006's function. This endpoint supports demotion (`engineering_manager` → `participant`) only.
  - This corrects the prior text of this note, which described the constraint as EM-only ("An Engineering Manager may only assign the `participant` role... requires `application_admin`") and, by omission, left admin-initiated promotion via this endpoint looking permitted. The shipped implementation prior to this change did not enforce even the EM-only version of this constraint — `checkAssignRolesAuthorization` never inspected the requested role value at all, for either actor type. This correction is not reversing a considered decision; it is documenting what the code now actually does.
  - A blocked promotion attempt returns `403 Forbidden` with a redirective message identifying TEAM-006 as the correct endpoint (see the Error Responses table below).

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
| `403 Forbidden` | Not an `application_admin` or `engineering_manager` for this team |
| `403 Forbidden` | **(Added — restrict-team-005-em-promotion, issue #109)** Requested transition is `participant` → `engineering_manager`. Fires for every otherwise-authorized actor, including `application_admin`. Redirective message names TEAM-006 as the correct endpoint (Decision D — not punitive; the actor is not accused, only redirected). Distinguished in the audit trail from the row above: this case only fires for actors who already passed the base authorization check, and writes a synchronous `audit_log` row (`operation = 'team.role_change_denied'`) before the response is sent. |
| `404 Not Found` | Team or user does not exist; user is not an active member of this team |
| `422 Unprocessable Entity` | `role` value is invalid |

**Notes**
- **BRD authority:** FR-1.6 (admin manages membership) extended by decision 2026-03-15: EMs may also manage roles for their own team.
- Role changes take effect immediately on the next authenticated request from the affected user (SEC-11).
- The audit log must record the change: who changed it, what it changed from, what it changed to, and the role of the actor (SEC-13).
- **restrict-team-005-em-promotion (issue #109):** see the Promotion block note above the Request section — this endpoint no longer supports promotion for any actor.

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
- `facilitator` in their [facilitator read window](#facilitator-read-window) for the team

`engineering_manager` role does not grant access to the topic configuration.

**Corrected (#187, `topic-001-authz-contract-reconcile`).** As built before #187, this endpoint answered `200` to an engineering manager. It now denies engineering managers unconditionally, with no flag or override: a caller is denied if their active membership role on the team **or** their stored global role is `engineering_manager`, on the member path and the facilitator path alike. Each such denial is a `403` with the standard forbidden body and emits the log-only `topic.config_read_denied_role` event. Application Admins are also denied (`403`), with an `admin.session_content_denied` audit row. Topic configuration is also exposed by TOPIC-002, which audits every administrator read (see TOPIC-002's Authorization and Notes; #232, #208).

**Scope:** EM-facing views use TREND-001 / SESSION-007/008; EM flows do not call TOPIC-001.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |

**Response**

`200 OK`

**As built (#187).** The topic entries are returned today as raw snake_case rows (`id`, `name`, `prompt`, `vote_type`, `display_order`, `status`) next to camelCase `teamId` and `isCustomizationLocked`. The camelCase shape below is the target. TOPIC-001 has no consumer yet; the first change that adds a TOPIC-001 consumer SHALL do the remap.

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
    // teamAnnotation: NOT returned; deferred until a consumer exists (see the TOPIC-001 follow-up).
    // topic-annotation design.md Decision 8: engineering managers are now denied on this endpoint
    // (#187), but the annotation stays unselected until a consumer needs it. In-session display
    // reads SESSION-005/012's currentTopic.topicAnnotation (the snapshot), never this endpoint.
    createdAt: string;
    updatedAt: string;
  }>;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Caller is not an active participant member or an eligible session facilitator for this team; includes the team's engineering managers and Application Admins |
| `404 Not Found` | `teamId` is not a canonical UUID (`TEAM_NOT_FOUND`), returned before any query; a well-formed id for a nonexistent team returns 403 |

**Notes**
- **Team-definition release note (#187, revised by #208).** When team definitions first reach participants (on this endpoint, or, as today, in the session room's per-session topic snapshot, #175), the release notes must carry this owner-approved wording: "Engineering managers cannot read a team's definitions or change its topics. The exception is someone who also holds the Application Administrator role: administrators can read every team's definitions and add, remove or reorder its topics, including on a team they manage. Every administrator read and change is recorded in the audit log, which is reviewed after an incident rather than monitored." This endpoint still denies both engineering managers and Application Administrators (see 403 above). The note covers TOPIC-002, where administrators, including one who manages the team, read definitions and change topics (#208).
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

**Authorization:** `global_role = 'facilitator'` AND not an active member of the team, OR `application_admin` — the same standing, org-wide facilitator model `TOPIC-003` through `TOPIC-006` share (`TOPIC-007` uses the same non-member facilitator rule but excludes `application_admin` from writing; see its entry). **`TOPIC-007` (topic-annotation, BRD FR-8.7) is facilitator-only for writes; administrators read annotations here read-only.** **Corrected (`remove-topic` design.md Decision 9):** this endpoint's original draft required "a facilitator with an active session for the team," a session-scoped model that does not match its five sibling topic-write endpoints and was never independently reviewed as its own line item — a drafting error, not a considered decision this correction reverses. This endpoint does not require that the caller currently hold, or have ever held, an active session for the target team. (Participants and EMs access archived topic data via TREND-001, not this endpoint.)

**Administrators, whatever their membership. Corrected (#208).** An `application_admin` is admitted whatever their membership on the team (#208, reversing #232's no-manager rule): no membership, or any value of `team_memberships.role` (today `participant` or `engineering_manager`). The same holds for `TOPIC-003` through `TOPIC-006`, so this endpoint and `TOPIC-003` agree for every caller. A global `engineering_manager` is rejected with `NOT_A_FACILITATOR` whatever their membership. Decision record: `requirements/use cases/08b - Member Admin Topic Writes - Decision.md`.

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
  teamName: string;  // Added (`remove-topic` design.md, Task 9.2/Decision 10) — the Topic Management screen's remove-confirmation dialog must name both the topic and the team; no other endpoint reachable by a standing, non-member facilitator returns a team's display name.
  isCustomizationLocked: boolean;
  canEditAnnotations: boolean;  // Added (`topic-annotation` design.md Decision 8). true for a standing facilitator, false for an application_admin (TOPIC-007 is facilitator-only, FR-8.7). Presentation only; TOPIC-007 enforces independently.
  canAddTopics: boolean;  // Added (`topic-add-form-and-empty-state` design.md Decision 1). true for every caller TOPIC-002 admits: a standing facilitator or an application_admin (FR-8.2; admin branch added by #176). Not derived from canEditAnnotations, whose admin exclusion (FR-8.7) is permanent. Does not consider isCustomizationLocked. Presentation only; TOPIC-003 enforces authorization and the lock independently.
  canAssignDefaults: boolean;  // Added (`zero-topic-team-recovery` #200, design.md D6). true if and only if the caller is an `application_admin`, the team has zero ACTIVE topics (archived rows do not count) and the team is not the template team; false in every other case. Computed with the same `isApplicationAdmin` predicate TOPIC-008 authorizes with. Does not consider isCustomizationLocked: an unlocked zero-topic team still reports true for an admin, and the screen shows its normal Add control there, not the Assign button. Presentation only; TOPIC-008 enforces its own authorization and precondition, and nothing reads this back from a client. Required in the shared type; the screen treats only `=== true` as true (a missing value renders no button).
  active: Array<{
    topicId: string;
    name: string;
    prompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    displayOrder: number;
    isDefault: boolean;
    firstSessionDescription: string | null;  // Added (`remove-topic` design.md, Task 9.2) — the "View Active Topic Configuration" use case's AC requires prompt, vote type, AND description per row; the original draft omitted this field.
    teamAnnotation: string | null;  // `topic-annotation`: read from topics.team_annotation (previously hard-coded null).
    annotationUpdatedAt: string | null;  // Added (`topic-annotation`). Provenance of the last change, including a clear.
    annotationUpdatedBy: { userId: string; displayName: string } | null;  // Added (`topic-annotation`). Same shape and null rule as archivedBy.
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
    archivedBy: { userId: string; displayName: string } | null;  // Added (`remove-topic` design.md Decision 6). Facilitator-visible provenance — null only for a pre-existing row archived before this column existed; none exist today. Distinct from and in addition to the audit-log record of the same event.
    restoredAt: string | null;  // Added (`re-add-removed-topic` design.md Decision 4). Null for a topic that has never been restored.
    restoredBy: { userId: string; displayName: string } | null;  // Added (`re-add-removed-topic` design.md Decision 4). Facilitator-visible provenance for TOPIC-005's restore — mirrors archivedBy's shape. A topic archived and restored more than once shows only the most recent restore event, the same stated limitation archivedAt/archivedBy already carry for multiple archive events.
    teamAnnotation: string | null;  // Added (`topic-annotation`). Shown read-only so the facilitator sees what returns on restore.
    annotationUpdatedAt: string | null;  // Added (`topic-annotation`).
    annotationUpdatedBy: { userId: string; displayName: string } | null;  // Added (`topic-annotation`).
  }>;
  defaultTopicsNotActive: Array<{  // Canonical default topics currently absent from the active list
    topicId: string;
    name: string;
    isArchived: boolean;           // true = was archived; false = was never added to this team
  }>;
}
```

**Error Responses**

| Status | Code | When |
|---|---|---|
| `401 Unauthorized` | | No valid session cookie |
| `403 Forbidden` | `NOT_A_FACILITATOR` | Trigger: the caller is not a facilitator and not an `application_admin` (including the global `engineering_manager` role, whether or not a team member). Message: "Only a facilitator or an application admin can view this team's topic list." Authenticated user does not satisfy (`global_role = 'facilitator'` AND not an active member of the team) OR `application_admin` — **corrected (`remove-topic` design.md Decision 9)** from "not a facilitator with an active session for this team, and is not an `application_admin`," matching the `Authorization` correction above |
| `403 Forbidden` | `FACILITATOR_IS_TEAM_MEMBER` | Trigger: the caller is a facilitator who is a member of the team. Message: "A facilitator cannot view topic management for a team they are a member of." |
| `404 Not Found` | `TEAM_NOT_FOUND` | Team does not exist (malformed or unknown id). A `teamId` that is not a canonical UUID is `404` before any query for any caller. A well-formed UUID that names no `teams` row is `404` for an authorized caller (standing facilitator or `application_admin`), after the timing floor, with `Cache-Control: no-store`, and writes no `audit_log` row and no `admin.*` event; it emits one log-only `topic.config_read_unknown_team` event (`{ userId, teamId, globalRole }`, no topic data) before the timing floor as a probing signal, never for a caller who fails authorization. A team that exists (deactivated, the template team, or with no topics) is `200`. Check order: `403` -> `404` (non-canonical id first, then authorization, then the team lookup); a caller who fails authorization gets the same `403` for an existing and a non-existent team. |

TOPIC-001 and TOPIC-002 answer an unknown team differently on purpose: TOPIC-001 is session-scoped and decides authorization before any lookup, so an unknown team is `403`; TOPIC-002 is role-scoped and, once the caller's role is authorized, an unknown team is `404`.

Each `403` carries `error.category = "forbidden"` and the reason as `error.code` (`NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`), the same value written to the denial audit row's `metadata.reason`; the two bodies differ in `error.code` and `error.message` (and the random per-response `error.correlationId`). Clients MUST NOT use `error.code` to grant, unlock or hide an access decision; clients MAY use it to choose display text; a client that does not recognise a code falls back to `error.message`; the server is the sole authority on access. No code may distinguish an engineering-manager or application-admin denial without Security review. `error.correlationId` on this `403` is generated per response and is not currently recorded in the audit row or the event, so it is not searchable. Every `403` carries `Cache-Control: no-store` and the timing floor.

**Notes**
- **`defaultTopicsNotActive` has at most one entry per canonical default (`zero-topic-team-recovery` #200, design.md D3a).** Since #311 a team's default is matched to its template default by the internal link `topics.template_topic_id` (set when the default was copied; never returned in any response), not by name. A default for which the team has an ACTIVE linked row is never listed, even if the team also holds an archived linked row; when the team has only archived linked rows the entry carries the team row's `id`, the team row's own `name` and `isArchived: true` (an active linked row wins, then the lowest id). A default with no linked row is listed with the template id and name and `isArchived: false`. An entry is not listed when another ACTIVE team topic (custom, or a default linked to a different template default) has the same name under `trim().toLowerCase()`, because restoring it would be rejected (#299, `409 TOPIC_NAME_ACTIVE`). A custom topic never matches a default. A template rename does not change what a team that holds the default sees. Legacy defaults with no link (copied before migration 24 and matching no template row) are treated as not held; TOPIC-005 called with the template id of such an entry answers the existing team-scoped 404 (#310). The response shape is unchanged.
- **Annotation fields (`topic-annotation`):** `teamAnnotation`, `annotationUpdatedAt`, and `annotationUpdatedBy` are returned on active **and** archived entries, to standing facilitators and to administrators, whatever their membership on the team (#208). Administrators receive them **read-only** (`canEditAnnotations: false`): topic configuration is administrative data they already read, and TOPIC-007's administrator exclusion concerns who authors the team's words, not who may view the configuration.
- `defaultTopicsNotActive` enables the "restore defaults" UI path (FR-8.6). It enumerates canonical default topics (`is_default = true`) that are currently absent from the team's active topic list — whether because they were archived or were never seeded. **Not read by the Topic Management screen** (`topic-add-form-and-empty-state`; `topic-management-screen` requirement "The screen does not read `defaultTopicsNotActive`"): its `topicId` can refer to the template team for a default the team has no linked row for (the link-based match since #311 no longer mis-matches a custom topic that shares a default topic's name). Whether to drop the field is tracked in #197.
- **Scope boundary:** This endpoint serves topic *configuration* only. Trend dashboard consumers (participants, EMs, facilitators viewing history) must use TREND-001, which includes archived topics in its `topics` array via `topicStatus: 'archived'`. Do not call TOPIC-002 from trend dashboard UI flows.
- **Audit (#232, #208):** every `200` to an `application_admin` writes exactly one durable `admin.topic_config_accessed` `audit_log` row (every team, the template team included, annotated or not, whatever the admin's membership; one per request, never deduplicated). A request for a team id that names no team is `404` before this arm runs and writes no row. The row writes `actor_roles` (the caller's `users.roles`) and carries text-free metadata (counts and flags only; never annotation text, topic names or topic ids), including `membership_role`: the caller's live active membership role on the team, recorded raw, `null` or any value of `team_memberships.role` (today `participant` or `engineering_manager`). It is audit data, not an admission input. It emits the matching structured event. The row carries no `team_found` key (removed by #265, change authored 2026-10-11; the cutover is the merge of its PR: the arm only runs for a team that exists, so the key would always be `true`); rows written before that cutover may carry `team_found` with either value, `team_found: false` rows are the only evidence of past ghost-team admin reads and must not be purged by retention as noise, and readers must treat the key as optional. Fail closed: if the membership read, the role-set read or the insert fails, the request is `500` with no data. A failed role-set read or insert also emits the log-only `admin.audit_write_failed` event (SQLSTATE only). Non-admin callers write no `admin.*` row. The `admin.topic_config_denied` operation (#232) is retired by #208; historical rows are left as they are.
- **Denial audit (#264):** every `403` this endpoint returns (a caller who is not a facilitator or an application admin, `NOT_A_FACILITATOR`; or a facilitator who is a member of the team, `FACILITATOR_IS_TEAM_MEMBER`) writes exactly one durable `topic.config_list_denied` `audit_log` row (`actor_user_id`, `actor_global_role`, `actor_ip`, `actor_roles`, `team_id` = the requested id, `metadata` = `{ endpoint, http_status: 403, reason }`; never team names, topic names or ids, or annotation text) and emits a matching event. Unlike the administrator arm, this write is fail-open: if it fails or exceeds 500 ms the `403` is unchanged and a log-only `topic.audit_write_failed` event is emitted. The response and timing floor do not depend on the audit: the `403` is the same whether the write succeeds or fails, and the caller sees no sign of the audit. `FACILITATOR_IS_TEAM_MEMBER` rows are informational.

---

### TOPIC-003 — Add Custom Topic

**Method and URL**
```
POST /api/v1/teams/:teamId/topics
```

**Description**
Creates a new custom topic for the team and appends it to the end of the display order.

**Auth:** Protected.

**Authorization:** (`global_role = 'facilitator'` AND the facilitator must not be a member of this team) OR `global_role = 'application_admin'` (any team, regardless of membership, per BRD FR-8.2; added by `topic-003-admin-authorization`, #176), AND `isCustomizationLocked` must be `false` (i.e., the team has at least one completed session). The lock and the `403` → `404` → `409` → `422` check order apply to administrators exactly as to facilitators. Engineering Managers are excluded: FR-8.2 names only the facilitator and the Application Administrator.

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
  firstSessionDescription?: string | null;              // Optional; omitted or null means no description. Max 500 characters. Not trimmed by the server (the Topic Management screen sends the trimmed text, or null when blank). Shared type: `AddCustomTopicRequest` in `packages/shared/src/types/topic.ts`.
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
| `403 Forbidden` | Not a facilitator and not an `application_admin` (`NOT_A_FACILITATOR`); facilitator is an active team member (`FACILITATOR_IS_TEAM_MEMBER`) |
| `404 Not Found` | Team does not exist |
| `409 Conflict` | Customization lock is active (`TOPIC_CUSTOMIZATION_LOCKED`); the name duplicates an active topic of the team (`TOPIC_NAME_ACTIVE`, #299; see below) |
| `422 Unprocessable Entity` | `VALIDATION_FAILED`, with `field` set to the first failing of `name`, `prompt`, `voteType`, `firstSessionDescription` (checked in that order): required fields missing, empty after trimming, or exceeding length limits. The Topic Management screen maps `field` to its own copy and does not display `message`. |

**Corrected (`topic-customization-lock-and-add-custom-topic` design.md Decision 2):** the customization lock is a state precondition about the team's session history, not an actor-identity/role failure, so it is rejected with `409 Conflict`, not the `403 Forbidden` this table previously listed for all three causes. `403 Forbidden` is reserved for the two actor-identity/role failures above and is evaluated — and returned — before the lock check ever runs (design.md Decision 9's full cascade: `403` → `404` → `409` → `422`).

**Notes**
- The customization lock check (`isCustomizationLocked`) is enforced server-side. The lock applies when the team has zero completed sessions (FR-8.2).
- Every rejection above is carried in this codebase's standard error envelope, `{ error: { category, code, message, correlationId } }` (plus `field` on `VALIDATION_FAILED`) — not a bare top-level `{ code, message }` body.
- Prompt uniqueness is not enforced — duplicate prompts are allowed. Name duplication against an ACTIVE topic is rejected with `409 TOPIC_NAME_ACTIVE` (#299); archived topics and prompts are not considered. This is duplicate prevention, not a uniqueness guarantee: existing duplicates are not affected, and look-alike names (internal whitespace, Unicode normalization form, accents) are not caught.

**`409 TOPIC_NAME_ACTIVE` (#299).** Returned by Add when an active topic of the same team already has this name after `trim()` and `toLowerCase()` (the shared `normalizeTopicNameForMatch`; no locale, no Unicode normalization, internal whitespace compared as typed). Evaluated inside the per-team advisory lock. There is no override: no parameter, header, body field or role (including `application_admin`) changes the outcome. Body, with header `Cache-Control: no-store`:

```json
{ "error": { "category": "precondition_failed", "code": "TOPIC_NAME_ACTIVE", "message": "An active topic with this name already exists.",
             "conflictingTopicId": "<uuid>", "conflictingName": "Safety", "correlationId": "<uuid>" } }
```

`error` has exactly the keys `category`, `code`, `message`, `correlationId`, `conflictingTopicId`, `conflictingName` (no `field`). `conflictingName` is the conflicting active topic's stored name: a string, possibly empty for a legacy blank name, never null. When several active topics match, the lowest `display_order`, then lowest `id`, is named. The submitted name is never echoed. No `audit_log` row is written. The response is identical in shape for every role. Clients branch on `error.code`, never on a bare `409` (`TOPIC_CUSTOMIZATION_LOCKED` shares the status). Precedence: `403` → `404` → `409 TOPIC_CUSTOMIZATION_LOCKED` → `422 VALIDATION_FAILED` (an empty or whitespace-only name never reaches the name check) → `409 TOPIC_NAME_ACTIVE`.
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

**Authorization:** `global_role = 'facilitator'` AND not a member of this team, OR `application_admin`, AND `isCustomizationLocked = false`. **Corrected (`remove-topic` design.md Decision 1):** the original draft omitted an `application_admin` branch, which would have violated FR-8.2 [HARD] — an admin could list a team's topics via `TOPIC-002` and see a "Remove" action render, then receive a confusing `403` on click. `TOPIC-003` (Add Custom Topic) was not affected by this correction at the time; it gained the same `application_admin` branch later, in `topic-003-admin-authorization` (#176).

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
  openActionItems: Array<{ actionItemId: string; description: string }>;  // Added (`remove-topic` design.md Decision 5) — a bare count doesn't let a facilitator judge whether the open items are stale noise or live commitments.
  message: string;   // Human-readable warning
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not a facilitator and not an `application_admin` (`NOT_A_FACILITATOR`); facilitator is an active team member (`FACILITATOR_IS_TEAM_MEMBER`) |
| `404 Not Found` | Team does not exist (`TEAM_NOT_FOUND`); topic does not exist for this team (`TOPIC_NOT_FOUND`) |
| `409 Conflict` | Customization lock is active (`TOPIC_CUSTOMIZATION_LOCKED`); archiving would leave the team with zero active topics (`TOPIC_LAST_ACTIVE`) |
| `422 Unprocessable Entity` | Topic is already archived (`TOPIC_ALREADY_ARCHIVED`) |

**Corrected (`remove-topic` design.md Decision 4):** this table originally listed the customization lock under `403 Forbidden` ("Not a facilitator, is a team member, customization lock active") and a single undifferentiated `404 Not Found` row. As implemented, the lock is a state precondition, not an actor-identity/role failure, so it is `409 Conflict` — the same correction already made for `TOPIC-003` — and the `404` row is split so a caller can distinguish a nonexistent team from a nonexistent topic. `403 Forbidden` is reserved for the two actor-identity/role failures and is evaluated, and returned, before any later check in the cascade (`403` → `404 TEAM_NOT_FOUND` → `409 TOPIC_CUSTOMIZATION_LOCKED` → `404 TOPIC_NOT_FOUND` → `422 TOPIC_ALREADY_ARCHIVED` → `409 TOPIC_LAST_ACTIVE`).

**Notes**
- This is a soft-delete: `topics.status` transitions to `'archived'`; no row is deleted. Historical `votes` and `session_topics` records are unaffected (FR-8.3).
- When the topic has open action items, the first request without `confirm=true` returns the confirmation response (HTTP `200`, not `409`). A subsequent request with `confirm=true` independently re-derives the open-action-item count and list rather than trusting any value shown in the first response, and proceeds with the archive regardless of what it finds.
- After archiving, the topic no longer appears in future session snapshots.
- Archiving a team's last remaining active topic is rejected with `409 TOPIC_LAST_ACTIVE` (`remove-topic` design.md Decision 3) — a hard block, not a soft warning, serialized per team via the same advisory-lock pattern `TOPIC-003`'s `displayOrder` assignment uses.
- A successful archive sets `topics.archived_by` to the acting user's ID in the same transaction as the status transition (`remove-topic` design.md Decision 6) — surfaced back to facilitators via `TOPIC-002`'s `archived[].archivedBy`.

---

### TOPIC-005 — Restore Archived Topic

**Method and URL**
```
POST /api/v1/teams/:teamId/topics/:topicId/restore
```

**Description**
Transitions an archived topic back to active status, appending it at the end of the current display order.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` AND not a member of this team, OR `application_admin`, AND `isCustomizationLocked = false`. **Corrected (`re-add-removed-topic` design.md Decision 1):** the original draft omitted an `application_admin` branch, the same FR-8.2 [HARD] gap `remove-topic` design.md Decision 1 already found and fixed for `TOPIC-004` — `TOPIC-002` already grants `application_admin` access to the read endpoint that lists a team's archived topics and would render a "Restore" affordance for one; an admin who clicked it would get a confusing `403`.

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
| `403 Forbidden` | Not a facilitator and not an `application_admin` (`NOT_A_FACILITATOR`); facilitator is an active team member (`FACILITATOR_IS_TEAM_MEMBER`) |
| `404 Not Found` | Team does not exist (`TEAM_NOT_FOUND`); topic does not exist for this team (`TOPIC_NOT_FOUND`) |
| `409 Conflict` | Customization lock is active (`TOPIC_CUSTOMIZATION_LOCKED`); an active topic of the team has the same name as this topic (`TOPIC_NAME_ACTIVE`, #299; see below) |
| `422 Unprocessable Entity` | Topic is already active (`TOPIC_ALREADY_ACTIVE`) |

**Corrected (`re-add-removed-topic` design.md Decision 2):** this table originally listed the customization lock under `403 Forbidden` and a single undifferentiated `404 Not Found` row — the same drafting shape `remove-topic` design.md Decision 4 already corrected for `TOPIC-004`. As implemented, the lock is a state precondition, not an actor-identity/role failure, so it is `409 Conflict`, and the `404` row is split so a caller can distinguish a nonexistent team from a nonexistent topic. `403 Forbidden` is reserved for the two actor-identity/role failures and is evaluated, and returned, before any later check in the cascade (`403` → `404 TEAM_NOT_FOUND` → `409 TOPIC_CUSTOMIZATION_LOCKED` → `404 TOPIC_NOT_FOUND` → `422 TOPIC_ALREADY_ACTIVE`).

**Notes**
**`409 TOPIC_NAME_ACTIVE` (#299).** Returned by single restore when an active topic of the same team already has this name after `trim()` and `toLowerCase()` (the shared `normalizeTopicNameForMatch`; no locale, no Unicode normalization, internal whitespace compared as typed). Evaluated inside the per-team advisory lock. There is no override: no parameter, header, body field or role (including `application_admin`) changes the outcome. Body, with header `Cache-Control: no-store`:

```json
{ "error": { "category": "precondition_failed", "code": "TOPIC_NAME_ACTIVE", "message": "An active topic with this name already exists.",
             "conflictingTopicId": "<uuid>", "conflictingName": "Safety", "correlationId": "<uuid>" } }
```

`error` has exactly the keys `category`, `code`, `message`, `correlationId`, `conflictingTopicId`, `conflictingName` (no `field`). `conflictingName` is the conflicting active topic's stored name: a string, possibly empty for a legacy blank name, never null. When several active topics match, the lowest `display_order`, then lowest `id`, is named. The submitted name is never echoed. No `audit_log` row is written. The response is identical in shape for every role. Clients branch on `error.code`, never on a bare `409` (`TOPIC_CUSTOMIZATION_LOCKED` shares the status). Precedence: `403` → `404 TEAM_NOT_FOUND` → `409 TOPIC_CUSTOMIZATION_LOCKED` → `404 TOPIC_NOT_FOUND` → `422 TOPIC_ALREADY_ACTIVE` → inside the lock the topic is re-read and, if it is no longer archived, `422 TOPIC_ALREADY_ACTIVE` again (takes precedence over the name rule) → `409 TOPIC_NAME_ACTIVE`. The topic stays archived and unchanged; no `display_order` is consumed. The way past a conflict is to archive the active topic first, then restore. Bulk restore (`restore-defaults`) is unchanged: it answers `200` and reports a collision as skip reason `NAME_ACTIVE`, never `TOPIC_NAME_ACTIVE`.
- The prior `displayOrder` position is not restored; the topic is appended to the end of the active list (`re-add-removed-topic` design.md Decision 3) — archiving a topic never has to renumber the remaining active topics because position is unique only among a team's active rows (partial unique index `topics_team_active_order ON topics (team_id, display_order) WHERE status = 'active'`, migration 18, `reorder-topics` design.md Decision 1); an archived row's `display_order` is not meaningful and not maintained, and restoring to the prior position would require deciding what happens if an active topic has since taken that slot. Not FR-8.6, which is about the canonical default topic set remaining restorable, not about ordering semantics.
- This is the inverse of `TOPIC-004`'s soft-delete: `topics.status` transitions back to `'active'`. Historical `votes` and `session_topics` records tied to this topic are unaffected and unchanged by a restore.
- A successful restore sets `topics.restored_by`/`topics.restored_at` in the same transaction as the status transition, leaving `archived_at`/`archived_by` untouched — preserved, not cleared (`re-add-removed-topic` design.md Decision 4) — surfaced back to facilitators via `TOPIC-002`'s `archived[].restoredBy`/`archived[].restoredAt` for a topic that has since been re-archived.
- A marker surfacing the gap left by a topic's absence while archived in the EM trend view is out of scope for this endpoint and is tracked as a separate, deferred follow-up change (`re-add-removed-topic` proposal.md "Scope Decision").

---

### TOPIC-006 — Reorder Topics

**Method and URL**
```
PUT /api/v1/teams/:teamId/topics/order
```

**Description**
Replaces the display order for all active topics in a team with a new ordering.

**Auth:** Protected.

**Authorization:** `global_role = 'facilitator'` AND not a member of this team, OR `application_admin` (the standing, org-wide facilitator-or-admin model shared with `TOPIC-002`/`TOPIC-004`/`TOPIC-005`; an admin is admitted whatever their membership on the team, #208), AND `isCustomizationLocked = false`.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |

**Request Body**

```typescript
interface ReorderTopicsRequest {
  orderedTopicIds: string[];   // Complete ordered list of ALL active topic IDs for this team.
                               // 1..200 entries (MAX_REORDER_TOPICS), each a UUID, case-insensitive;
                               // entries are lowercased before the duplicate check.
}
```

Unknown top-level body keys are ignored, as in `TOPIC-003`.

**Response**

`200 OK`

```typescript
interface ReorderTopicsResponse {
  topics: Array<{
    topicId: string;        // lowercase
    name: string;
    displayOrder: number;   // 1-based and dense (1..N) after a save that changes the order;
                            // on a no-op, the stored values, which may have gaps
  }>;
  openSessionCreatedAt: string | null;  // Room-open time (sessions.room_opened_at, #175) of the team's
                                        // lobby/pre_session/active/wrap_up session (not draft), falling back
                                        // to created_at for a session opened before migration 20. The name is
                                        // kept for compatibility. Always null for application_admin.
}
```

A save that does not change the order (no-op) returns the same shape, with `topics` in the current order and their stored `displayOrder` values (which may have gaps left by archives; they are not renumbered), and writes nothing.

Every response, success or error, carries `Cache-Control: no-store`.

**Error Responses**

All errors use the standard envelope `{ error: { category, code, message, correlationId } }`. Checks are evaluated in this order, and the first failure is returned: `403` → `404 TEAM_NOT_FOUND` → `409 TOPIC_CUSTOMIZATION_LOCKED` → `422 INVALID_TOPIC_ORDER` → `409 TOPIC_ORDER_STALE`. `applyTimingFloor` is applied on every handled exit, including `200`.

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Not a facilitator and not an `application_admin` (`NOT_A_FACILITATOR`); facilitator is an active team member (`FACILITATOR_IS_TEAM_MEMBER`) |
| `404 Not Found` | Team does not exist (`TEAM_NOT_FOUND`). Never returned for a topic ID. |
| `409 Conflict` | Customization lock is active (`TOPIC_CUSTOMIZATION_LOCKED`), whatever the body |
| `409 Conflict` | The well-formed list does not equal the team's current active set: a missing active ID, or an extra archived, other-team, or unknown ID (`TOPIC_ORDER_STALE`, `category: "precondition_failed"`). The body is identical for every cause and carries no IDs. |
| `422 Unprocessable Entity` | Malformed body (`INVALID_TOPIC_ORDER`, `field: "orderedTopicIds"`): not a JSON object; `orderedTopicIds` missing, not an array, empty, or over 200 entries (checked before any per-entry check); an entry that is not a UUID string; a duplicate after lowercasing. The message never echoes submitted values. |

`INVALID_TOPIC_ORDER` deliberately diverges from `TOPIC-003`'s `VALIDATION_FAILED`: the failure is about the list as a whole. The envelope keeps the same shape by setting `field`.

**Corrected (`reorder-topics` design.md Decisions 2, 4, 7):** the original draft authorized facilitators only (no `application_admin` branch, the FR-8.2 [HARD] gap `TOPIC-004`/`TOPIC-005` already corrected), listed the customization lock under `403`, returned `404` for an unknown topic ID, rejected a partial list with `422`, and left `displayOrder` as "0-indexed or 1-indexed". As implemented: the lock is `409`, `404` is for the team only, any set mismatch is `409 TOPIC_ORDER_STALE`, `422` is for structure only, and `displayOrder` is 1-based and dense after a save that changes the order (a no-op returns the stored values, which may have gaps).

**Notes**
- The request must include all active topic IDs. A partial list is rejected with `409 TOPIC_ORDER_STALE`. This avoids ambiguity about topics not mentioned in the list.
- All `display_order` values are updated in a single PostgreSQL transaction, under the same per-team advisory lock as `TOPIC-003`/`TOPIC-004`/`TOPIC-005`. The write is two-phase (active rows move to negated targets, then flip to `1..N`) so swaps never collide on the active-order unique index.
- Concurrent reorders of the same set are last-writer-wins; no version token.
- A changed order writes an `audit_log` row `topic.reordered` with `metadata: { previous_order: uuid[], new_order: uuid[] }` (IDs only) in the same transaction. A no-op writes nothing.
- Reorder writes only `topics`. It never writes `session_topics`; sessions whose room has already opened keep their order. A session still in `draft` picks up the saved order when its room opens (#175).

---

### TOPIC-007 — Update Topic Annotation

**Method and URL**
```
PUT /api/v1/teams/:teamId/topics/:topicId/annotation
```

**Description**
Sets or clears the team-specific annotation on a topic: the team's definition of what the topic means, shown on screens as "Our team's definition". Rewritten by `topic-annotation` (#53); see `openspec/changes/topic-annotation/design.md` (archived with the change).

**Auth:** Protected. An unauthenticated request is rejected with `401` by the shared authentication layer before the cascade below runs.

**Authorization:** **Facilitator-only.** `global_role = 'facilitator'` AND not an active member of the team. **`application_admin` is rejected with `403 NOT_A_FACILITATOR`** (BRD FR-8.7). This deliberately differs from TOPIC-003/004/005/006, which admit administrators under FR-8.2: the annotation is the team's words, recorded by the facilitator who was in the room, and administrators have no session context. The customization lock is enforced as `409`, not `403` (below).

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Path | `topicId` | `uuid` | Yes | Topic to annotate. A non-UUID value answers `404 TOPIC_NOT_FOUND`. |

**Request Body**

```typescript
interface UpdateTopicAnnotationRequest {
  annotation: string;   // Required string. "" (after normalization) clears. null is rejected, not a clear.
}
```

Body rules, evaluated in this order:
1. The body must be a JSON object whose `annotation` is a string. A non-object body (bare string, array), a missing field, `null`, or a non-string → `422 INVALID_ANNOTATION`, message "annotation must be a string.". Unknown top-level keys are ignored.
2. Normalize: every `\r\n` → `\n`, then trim leading and trailing whitespace. Interior whitespace and line breaks are kept.
3. Reject (never strip) disallowed characters, **checked before length**: U+0000, an unpaired UTF-16 surrogate, any other C0 control except line feed and tab (U+0001–U+0008, U+000B, U+000C, U+000D, U+000E–U+001F; a lone `\r` included), U+007F, and the bidi embedding/override/isolate controls U+202A–U+202E and U+2066–U+2069 → `422 INVALID_ANNOTATION`, message "Team definition contains characters that can't be saved.".
4. Length: at most **500 UTF-16 code units** after normalization (JavaScript `String.length`, the unit a browser `<textarea maxlength>` enforces; an emoji outside the Basic Multilingual Plane counts as 2) → otherwise `422 INVALID_ANNOTATION`, message "Team definition must be 500 characters or fewer.".

All three body failures carry `field: "annotation"`, and no error body echoes the submitted value. An empty normalized value clears the annotation (stored `NULL`).

**Response**

`200 OK`, with `Cache-Control: no-store` on **every** response (set first, so the `403`s and an unhandled `500` carry it too).

```typescript
interface UpdateTopicAnnotationResponse {
  topicId: string;
  teamAnnotation: string | null;        // null after a clear
  annotationUpdatedAt: string | null;
  annotationUpdatedBy: { userId: string; displayName: string } | null;  // non-null only when both are known
}
```

Renamed from the draft's `annotation`/`updatedAt` so the frontend uses one name everywhere (TOPIC-002 uses the same fields).

**Error Responses** (cascade order; the first failure returns)

| Status | Code | When |
|---|---|---|
| `401 Unauthorized` | | No valid session (shared authentication layer) |
| `403 Forbidden` | `NOT_A_FACILITATOR` | Caller's `global_role` is not `facilitator`, **including `application_admin`** |
| `403 Forbidden` | `FACILITATOR_IS_TEAM_MEMBER` | Facilitator is an active member of the team |
| `404 Not Found` | `TEAM_NOT_FOUND` | Team does not exist |
| `409 Conflict` | `TOPIC_CUSTOMIZATION_LOCKED` | Team has no completed session. Writes a `topic.write_denied_locked` audit row with `attempted_operation: "topic.annotation_updated"`. Takes priority over any body error. |
| `422 Unprocessable Entity` | `INVALID_ANNOTATION` | Body rules 1–4 above; `field: "annotation"`. Takes priority over a missing topic. |
| `404 Not Found` | `TOPIC_NOT_FOUND` | Topic does not exist on this team (including another team's topic and a non-UUID `topicId`) |
| `422 Unprocessable Entity` | `TOPIC_ALREADY_ARCHIVED` | Topic is archived (replaces the draft's `404`, matching TOPIC-004) |

Every non-2xx uses the standard envelope `{ error: { category, code, message, correlationId } }` (plus `field` on `INVALID_ANNOTATION`). Malformed JSON and a non-UUID `teamId` behave as on TOPIC-004/005/006. Every handled exit applies the timing floor.

**Notes**
- **No-op:** if the normalized value equals the stored value (an empty value equals `NULL`), the response is `200` with the current state and **existing** provenance. Nothing is written and nothing is audited.
- **Write:** a changed value updates `team_annotation`, `annotation_updated_by` (the caller), and `annotation_updated_at = now()` (a clear records the clearer), in a row-locked transaction scoped by `team_id` and `status = 'active'`. `updated_at` is not touched. Concurrent writes are last-writer-wins, with no precondition token.
- **Audit:** a changed value writes `topic.annotation_updated` with `metadata: { topic_id, action: "set" | "cleared", length }` in the same transaction. **The text is never written to the audit log or the structured application log.**
- **Snapshot:** sessions never read this value live. When `session_topics` rows are written at room open (#175; see SESSION-001a), `session_topics.topic_annotation` is copied from `team_annotation` in the same write as the rest of the row. SESSION-005/012 return `currentTopic.topicAnnotation` from that snapshot, so an edit affects only sessions whose room is opened after it.
- Annotations survive archive and restore. Default and custom topics are both annotatable. New-team seeding never copies an annotation from the template team.
### TOPIC-008 — Assign Default Topics (zero-topic recovery)

*Added by `zero-topic-team-recovery` (#200). Closes BRD FR-8.6 ("restorable for any team at any time") for the zero-ACTIVE-topics state only; partial restore and a "visible" canonical set remain open.*

**Method and URL**
```
POST /api/v1/teams/:teamId/topics/assign-defaults
```

**Description**
Copies the canonical default topic set (the template team's active default topics, as read inside the transaction) onto a team that has **zero active topics**, so its facilitator can open a room and run a first session. It is the **one exception to the customization lock** (TOPIC-003/004/005/006 are unchanged and still lock-gated) and can write only the canonical set, so it is not a customization route. The team is otherwise left exactly as it was: archived rows are untouched, the lock state is unchanged, no notification is sent and there is no undo.

**Auth:** Protected. **Authorization: `application_admin` only**, read live from the `users` row at request time (never from the session or a token claim; a caller with no user row is a non-admin), whatever the caller's membership on the target team (none, or any `team_memberships.role`; FR-8.2, #208). Not `checkStandingFacilitatorOrAdminAuthorization`: a facilitator is never admitted.

**Request**
No body, no query parameter, no header is read. The endpoint never accepts a source team id or template id; the template is always the canonical sentinel. Any body, query or header sent changes nothing.

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` (canonical 8-4-4-4-12) | Yes | The team to give the defaults to |

**Response**

`201 Created`, `Cache-Control: no-store`

```typescript
interface AssignDefaultsResponse {
  topicCount: number;  // the number of topics created (the template's active default count); also the audit topic_count
}
```

The body carries no topic list, no topic text and no team id other than what the caller supplied.

**Check order** (stops at the first failure): non-canonical `teamId` (`404`, then the id is lowercased) -> authorization (`403`) -> the shared topic-write rate limit (`429` / fail-closed `503`, exactly as TOPIC-003..007; no new limit values) -> team existence and the template-team guard (`404`) -> **no customization-lock check** -> in one transaction at READ COMMITTED, under the team's topic advisory lock (the one room open also takes), the zero-active precondition read as a fresh statement after the lock (`409`) -> the copy -> the success audit row -> COMMIT. The timing floor is applied on every return.

**Errors** (standard envelope `{ error: { category, code, message, correlationId } }`)

| Status | `code` | When |
|---|---|---|
| `401 Unauthorized` | | No valid session |
| `403 Forbidden` | `NOT_AN_ADMIN` | Caller is not an `application_admin` (a facilitator, member or not, an engineering manager, an engineer, or a caller with no user row), **whether or not the team exists** (a non-admin gets `403`, never `404`). The `403` reveals nothing about the team's lock state or topic count. Writes one `topic.defaults_assign_denied` audit row (fail-open, bounded to 10 per actor per minute; beyond that the response is the same `403` with no row). |
| `404 Not Found` | `TEAM_NOT_FOUND` | Non-canonical `teamId`; a well-formed id that names no team (admin only; a non-admin has already had `403`); or the **template team**, which gets the identical response plus a `topic.write_denied_template` audit row with `attempted_operation: "topic.defaults_assigned"` |
| `409 Conflict` | `TEAM_HAS_ACTIVE_TOPICS` | The team has one or more active topics (a repeated call, a second administrator, or a stale view). Nothing changes. |
| `429 Too Many Requests` / `503 Service Unavailable` | the TOPIC-003 codes | The shared per-actor topic-write limit, unchanged. A Redis outage gives the fail-closed `503`, so recovery is unavailable until Redis returns. |
| `500 Internal Server Error` | `DEFAULT_TOPICS_UNAVAILABLE` | The template has no active default topics. Rolled back, nothing written. Fixed message naming the "Zero-topic teams" runbook section; no template id in the body. Writes one fail-open `topic.defaults_assign_failed` audit row after the rollback. |
| `500 Internal Server Error` | `ASSIGN_DEFAULTS_FAILED` | Any other failure inside the transaction (constraint drift, connection loss, audit insert failure). Rolled back; fixed generic message; the database error is logged with the `correlationId` and never returned. A client with an unknown 500 `code` shows its generic failure line. |

**Notes**
- **Copy.** Done by the routine team creation uses (`copyCanonicalDefaults`), so a recovered team is identical to a freshly created one: the template's current active topics in template order, numbered 1..n, each with the template's name, prompt, vote type and description, marked default, with no annotation fields. A team recovered later receives the current template, not the template of its creation date.
- **Zero ACTIVE, not zero rows.** A team whose topics are all archived is a zero-topic team; its archived rows are left alone. An active topic with the same text as an archived one is acceptable (see the TOPIC-002 `defaultTopicsNotActive` note).
- **Atomicity.** Two simultaneous calls on a zero-active team produce exactly one `201` and one `409`. A room open (SESSION-001a) queued behind the assignment snapshots the assigned topics.
- **Audit.** `topic.defaults_assigned` is written in the same transaction as the inserts with `metadata: { topic_count, correlation_id }` only (never topic text, topic ids or the template id); the structured event follows COMMIT, and its loss never changes the response.
- **Template team.** Never a target (see the `404` row).

---

### DEFTOPIC-001 to DEFTOPIC-007 — Maintain the Default Topic Set (admin only)

*Added by `admin-default-topic-maintenance` (#216). Traceable to BRD FR-8.1 (**partially met, API only**: there is no administrator screen; the Topic Management template screen is a follow-up, #308 read-only view and history, #309 editing), to FR-8.6 ("canonical" means the default set as currently maintained, decision D5) and to use case 08, "Maintain Default Topic Set". Authoritative behavior: openspec capability `admin-default-topic-maintenance`.*

**Mutation control (CSRF).** Every mutating route (DEFTOPIC-002 to DEFTOPIC-006) must send the request header `X-Requested-With: dipstick`; without it (or with another value) the response is `403 MUTATION_CONTROL_HEADER_REQUIRED` (standard envelope; the received value is never echoed). It is checked after the role check, so a non-administrator still gets `403 DEFAULT_MAINTENANCE_ADMIN_ONLY`, and before the body is parsed. It exists because archive and restore carry no body and `SameSite=Strict` alone is site-scoped, not origin-scoped; the custom header forces a CORS preflight that only the allow-listed origin passes. GET routes need no header. Archive and restore take no body (an empty body with a JSON content type is accepted). If a request is accepted but the refreshed list cannot be read after the commit, the response is still `200`/`201` with `listUnavailable: true` and no `defaults`: a client must treat a missing `defaults` as "reload the list", never as an empty template or a failed write.

**Routes** (exactly seven; none has a `:teamId` and none accepts a team id, the template id or `DELETE`):

| ID | Method and URL | Success |
|---|---|---|
| DEFTOPIC-001 | `GET /api/v1/admin/default-topics` (list, archived included) | `200` |
| DEFTOPIC-002 | `POST /api/v1/admin/default-topics` (add) | `201` |
| DEFTOPIC-003 | `PATCH /api/v1/admin/default-topics/:topicId` (edit) | `200` |
| DEFTOPIC-004 | `POST /api/v1/admin/default-topics/:topicId/archive` | `200` |
| DEFTOPIC-005 | `POST /api/v1/admin/default-topics/:topicId/restore` | `200` |
| DEFTOPIC-006 | `PUT /api/v1/admin/default-topics/order` (reorder, whole list) | `200` |
| DEFTOPIC-007 | `GET /api/v1/admin/default-topics/history?limit=` | `200` |

**Description.** Changes the template that every team created from now on is copied from, and that zero-topic recovery (TOPIC-008) hands out as of the moment of recovery. It never reads or writes an existing team's topics, a session or a session snapshot. No migration is needed. Archive is the only removal: a default is never deleted, and its audit history remains.

**Auth:** Protected. **`application_admin` only**, read live from `users.global_role` on every request; membership on any team is not consulted. Any other caller gets `403 DEFAULT_MAINTENANCE_ADMIN_ONLY` (`category: forbidden`; distinct from `NOT_AN_ADMIN` and `NOT_A_FACILITATOR`), on all seven routes, reads included. The role check runs **before the request body is parsed**, so a non-admin gets this `403`, the timing floor and the denial audit row whatever the body (oversize, malformed, wrong media type). The refusal writes one fail-open `topic.default_maintenance_denied` audit row (`team_id` null; metadata `endpoint` (method plus route template, never the raw URL), `http_status`, `reason`, `correlation_id`), bounded to 10 per actor per 60 seconds; beyond the bound the response is the same `403` and only a log event is emitted (see the sampled count below).

**Request.** `application/json` only on the body-carrying routes (add, edit, reorder); any other media type is `415 UNSUPPORTED_MEDIA_TYPE` and changes nothing. Body limit 16 KiB (`413 BODY_TOO_LARGE`); malformed JSON is `400 INVALID_JSON_BODY`. **Archive and restore take no body**: an empty body (with or without a JSON content type) is accepted and the content of any body sent is ignored (a malformed JSON body with a JSON content type, or one over 16 KiB, is still refused `400` / `413`, and no media-type check applies to these two routes). Only `name`, `prompt`, `firstSessionDescription` and `voteType` are read from a body; every other key (`teamId`, `status`, `isDefault`, `displayOrder`, `id`, ...) is ignored. Topic ids in paths are template row ids only; a non-canonical id or an id that names nothing on the template (including another team's topic) is `404 DEFAULT_TOPIC_NOT_FOUND`.

| Operation | Body |
|---|---|
| Add | `{ name, prompt, voteType: 'finger' \| 'roman' \| 'modified_roman', firstSessionDescription }`, all required |
| Edit | any of `{ name, prompt, firstSessionDescription }`; `voteType` is fixed at creation (a different value is `422 DEFAULT_VOTE_TYPE_IMMUTABLE`, an equal value is ignored); an archived default cannot be edited |
| Reorder | `{ order: [id, ...] }`: exactly the active default ids, 1 to 15 |
| Archive, restore | none |

**Limits** (constants in code, returned as `limits`): 1 to 15 active defaults; `name` 1 to 60, `prompt` 1 to 400, `firstSessionDescription` 1 to 800 Unicode code points after trim. Text is **plain text**: HTML-like tags, HTML entities, URLs, Markdown links, control and invisible characters are refused (`PROMPT_FORMAT_INVALID`); "rate < 5" and "Dev & Ops" are fine. Active names are unique ignoring case and surrounding spaces; no Unicode normalization.

**Response** (list and every write):

```typescript
interface DefaultTopicListResponse {
  defaults: Array<{
    id: string; name: string; prompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    firstSessionDescription: string;
    status: 'active' | 'archived';
    displayOrder: number | null;          // null for archived
    lastChangedAt: string | null;         // latest add/edit/archive/restore audit row; reorders do not count; null if never changed here
    lastChangedBy: { userId: string; displayName: string } | null;
  }>;                                      // active by position, then archived
  limits: { minActive: 1; maxActive: 15; nameMax: 60; promptMax: 400; descriptionMax: 800 };
  orderLastChangedAt: string | null;       // latest reorder
}
interface DefaultTopicWriteResponse extends DefaultTopicListResponse {
  scope: 'Applies to teams created from now on. Existing teams keep their current topics.';
  notice?: string;            // rename only (exact text below)
  changedTopicId?: string;
  unchanged?: true;           // a no-op: nothing changed, no audit row
  listUnavailable?: true;     // the change committed but the refreshed list could not be read; no list fields are present
}
// DEFTOPIC-007
interface DefaultTopicHistoryResponse {
  history: Array<{ id: string; operation: string; at: string;
    actor: { userId: string; displayName: string }; topicId: string | null;
    changedFields: string[]; before: unknown; after: unknown }>;   // newest first, ties by id descending
}
```

Every write response, including a no-op, carries the `scope` text. A rename adds `notice`, exactly: "Renamed. Existing teams keep their own copy of this topic under its current name. The rename does not change any team's topics. Teams that never had this topic will see the new name."

**Check order** (stops at the first failure): session (`401`) -> role (`403`) -> for the body-carrying routes (add, edit, reorder), a non-JSON media type (`415`) -> non-canonical `:topicId` (`404`) -> for the five writes only, the shared topic-write rate limit (`429` / fail-closed `503`, the same budget as TOPIC-003 to TOPIC-008; no new limit values; a refused role spends nothing; the two GETs are not limited) -> body and field validation (`422`, before any database work; a reorder array longer than 15 is rejected first) -> one transaction under the template's topic lock (target lookup `404`, state checks `409` / `422`, write, invariant check, audit row, COMMIT). Validation precedes state checks, so an invalid add at capacity is `422`. The timing floor applies on every return.

**Errors** (standard envelope `{ error: { category, code, message, correlationId } }`; a body never echoes a rejected value):

| Status | `code` | When |
|---|---|---|
| `401` | | No valid session |
| `403` | `DEFAULT_MAINTENANCE_ADMIN_ONLY` | Caller is not an `application_admin` |
| `404` | `DEFAULT_TOPIC_NOT_FOUND` | Non-canonical id, unknown id, or an id that is not a template row |
| `409` | `TEMPLATE_AT_CAPACITY` | Add or restore would exceed 15 active |
| `409` | `LAST_ACTIVE_DEFAULT` | Archive would leave none active |
| `409` | `DEFAULT_NAME_DUPLICATE` | Name equals another active default's (restore also carries `conflictingTopicId`, `conflictingName`) |
| `409` | `DEFAULT_ARCHIVED` | Edit of an archived default (restore it first) |
| `409` | `REORDER_ID_MISMATCH` | The list is not exactly the active ids; the body carries `current` (the active list to reload) |
| `413` / `415` / `400` | `BODY_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` / `INVALID_JSON_BODY` | Administrators only (a non-admin has already had the `403`) |
| `422` | `DEFAULT_FIELD_REQUIRED`, `DEFAULT_FIELD_TOO_LONG` (+ `max`), `PROMPT_FORMAT_INVALID`, `DEFAULT_VOTE_TYPE_INVALID`, `DEFAULT_VOTE_TYPE_IMMUTABLE`, `INVALID_DEFAULT_ORDER`, `INVALID_HISTORY_LIMIT`, `DEFAULT_ALREADY_ARCHIVED`, `DEFAULT_ALREADY_ACTIVE` | Validation and state refusals; field errors carry `field` |
| `429` / `503` | the TOPIC-003 codes | The shared topic-write limit; a Redis outage fails closed |
| `503` | `DEFAULT_MAINTENANCE_BUSY` | Another maintenance change held the template lock past 3 seconds (or a statement past 10 seconds); `Retry-After: 3`; nothing changed |
| `500` | `DEFAULT_MAINTENANCE_FAILED` | Audit write failure, invariant backstop failure, unique violation or any unexpected error; rolled back; no driver text |

**Notes**
- **Semantics.** Add appends after the highest active position; archive and restore renumber or append so active positions stay exactly 1..N (restore returns at the end, never at its old position); a gapped template is repaired by ordinary use. A reorder identical to the stored order on a healthy template, and an edit that changes nothing (including `{}`), are no-ops: `200`, `unchanged: true`, no audit row. A stale reorder with the same ids is accepted (last write wins; the audit row keeps the overwritten order).
- **Audit and history.** Each effective write commits exactly one audit row with the full before and after values of the changed fields (`topic.default_added`, `_edited`, `_archived`, `_restored`, `_reordered`). This is a scoped exception to "no topic text in audit rows", for template text only. There is no undo operation: edit the value back using the before-value from the history. The structured log event for each write carries identifiers and `changedFields` only, never text.
- **Stored text is inert (MUST).** Template text (name, prompt, description, and its audit and history copies) is rendered **as text** by every consumer: no raw-HTML sink, no Markdown renderer, no auto-linker, no un-escaped interpolation in email or export (design E4a). This, not the plain-text guard (a denylist), is the control against stored XSS. The follow-up screen issues (#308, #309) carries the same requirement.
- **Sampled suppression count.** When denial audit rows exceed the bound, the log-only `topic.denial_audit_suppressed` event is emitted at suppressed counts 1, 2, 4, 8, ...; the count it carries is a sampled running count, not an exact per-denial tally.
- **Prompt-writing guidance.** Prompts address the team and the work, never individuals. The first topics set the tone of a session, so write the opening ones with care.
  - Good: "How confident are we that a change can ship on a Friday?"; "How well do our tests tell us when something is broken?"; "How easy is it to get help when we are stuck?"
  - Bad: "Is Sam's code review turnaround a problem?"; "Who on the team blocks releases?"; "Rate the people who cause the most incidents."
- **Accepted consequences.** Restoring a default on an existing team returns that team's own, possibly superseded, wording, not the template's current text (canonical wording on restore, #310). Renaming a default changes nothing for a team that holds it: the team keeps its own copy under its current name, and `defaultTopicsNotActive` matches by the `template_topic_id` link, not by name (#311). Teams created at different times can show different wording for the same topic. A change needs one administrator and no approver; it is detected by the audit trail and the log event, not prevented.
- **Where defaults come from.** The default set is maintained either through these routes or by a migration that edits the seed; it is no longer migration-only. The team-scoped routes (TOPIC-003 to TOPIC-007) still answer `404 TEAM_NOT_FOUND` for the template.

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
- **Corrected by `session-topics-snapshot-at-creation` (#175, 2026-10-01): the topic snapshot is taken at room open, not at session creation.** As implemented, an existing team's session is created in `draft` (`POST /api/v1/teams/:teamId/sessions/draft`) with no `session_topics` rows; the snapshot is written when the room opens (SESSION-001a below), so draft-window topic edits reach the session. A new team's first session (`POST /api/v1/teams`) is created directly in `lobby`, so its creation is its room open and the snapshot is written in that request's transaction. "Room open" is the moment a session's status first becomes `lobby`; `sessions.room_opened_at` records it.
- **Path id shape (#175 implementation review).** `POST /api/v1/teams/:teamId/sessions/draft`, `GET /api/v1/teams/:teamId/topics` (TOPIC-001), `GET /api/v1/teams/:teamId/topics/all`, and the topic write routes (TOPIC-003/004/005/006/007) accept only the canonical 8-4-4-4-12 UUID form of `teamId`. Any other spelling (no hyphens, braces, other groupings), and any malformed value, answers `404` ("Team not found.") before any query, including the authorization query. Postgres would resolve some of those spellings to a real team, so this keeps the authorized id and the queried id the same string.
- PostgreSQL writes happen before Redis initialization, per the persistence layer mapping (Section 1, "Session Created"). If Redis initialization fails after PostgreSQL commits, the session is still valid; Redis state is re-initialized on the facilitator's first WebSocket connection.
- `join_token` is a cryptographically secure, URL-safe random string with at least 128 bits of entropy.
- `session_number` is computed as `COUNT(*) + 1` from `sessions WHERE team_id = :teamId AND status = 'complete'`.
- `is_first_session` is `true` if `session_number = 1`.

---

### SESSION-001a — Open the Room (draft → lobby)

*Added by `session-topics-snapshot-at-creation` (#175, 2026-10-01).*

**Method and URL**
```
POST /api/v1/teams/:teamId/sessions/:sessionId/advance
```

**Description**
Opens the room for a `draft` session: transitions it to `lobby`, sets `room_opened_at`, and snapshots the team's active topics into `session_topics` (renumbered 1..N, with names, prompts, vote types, and annotations), in one transaction under the team's topic advisory lock.

**Authorization:** checked in this order, all before the lock is taken: session exists (`404`); session belongs to `teamId` (`403`); caller is the session's `facilitator_id` (`403`); caller's live `users.global_role` is `facilitator` (`403`, `category: "forbidden"`, audited as `session.advance_denied_role`). Then the status check (`422`).

**Response:** `200 { sessionId, teamId, status: "lobby" }` (unchanged).

| Status | When |
|---|---|
| `403 Forbidden` | Not the session's team; not the session's facilitator; or the caller's live global role is no longer `facilitator` (including no user row). The role denial writes a `session.advance_denied_role` audit row. |
| `404 Not Found` | No such session, including a `sessionId` that is not a canonical (8-4-4-4-12) UUID, which is rejected before any query |
| `409 Conflict` | The team has no active topics when the advance runs (`NO_ACTIVE_TOPICS`, `category: "precondition_failed"`). The message depends on the team's customization-lock state, read after the failed open has been rolled back (advisory; the `409` itself is unaffected): **locked** team: "This team has no active topics, so the room can't open yet. Ask an application administrator to assign the default topics, then try again. Your session is saved."; **unlocked** team: "This team has no active topics. Add or restore a topic on Topic Management before opening the room." There is no caller-role branch (an administrator never reaches `/advance`). After an administrator assigns the defaults (TOPIC-008) the same session id advances. The session stays `draft`; nothing is audited. Evaluated after every authorization check and the status check, so a non-creator gets `403` and a non-draft session gets `422`, never this `409`. |
| `422 Unprocessable Entity` | The session is not in `draft` (`Session cannot be advanced from status '<status>'.`). A concurrent second advance that loses the race gets the same `422`, with the status re-read inside the transaction. |
| `500` | Any other failure inside the room-open transaction (snapshot, lock, conditional update, audit write, commit): `category: "internal_error"` with a fixed message and the `correlationId`; the database error is logged, never returned. The message wording is not part of the contract. |

**Notes**
- The `session.state_changed` audit row for `draft → lobby` carries `topic_count` and `topic_ids` (in snapshot order) and never topic names, prompts, or annotations; the structured audit log event carries `topicCount` only.
- `session_state_change` is published only after commit.

**Draft facilitator state.** `GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state` includes `activeTopicCount: number` (the team's current active topic count, a JSON number) when the session is in `draft`, and omits the field for every other status. Clients must not treat an absent field as `0`. It feeds the "Open the room" confirmation ("… locks in this session's {N} topics …") and the zero-topic disabled state; the `409` above stays authoritative.

**New team (`POST /api/v1/teams`).** The new team's first session is created in `lobby` with `room_opened_at` set, and its snapshot is written in the same transaction, after the default-topic copy. If the default topic template is empty, the whole transaction rolls back and the response is `500` with `category: "internal_error"`, the message "Team creation is unavailable because the default topic set is not configured. Contact an administrator.", and a `correlationId`; the template team id appears only in the error log line. The `team.created_with_session` audit row carries `topic_count` and `topic_ids` under the same content boundary.

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

**Authorization:** The authenticated user must be an active `participant` member of the session's team (`team_memberships.role = 'participant' AND removed_at IS NULL`). Engineering Managers who are team members cannot join as participants (FR-1.4). Application Admins (`users.global_role = 'application_admin'`) cannot join as participants either, even when they are team members (BRD FR-2.4, Constraint 2; added by #243, design D11).

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
| `403 Forbidden` | Authenticated user is an active team member with `engineering_manager` role; or has `global_role = 'engineering_manager'` or `'application_admin'` (#243); or user is not a member of the team at all |
| `404 Not Found` | Token does not match any session |
| `409 Conflict` | Session exists but is not in a joinable state (`status = 'complete'` or `'abandoned'`) — use `410` for completed/ended sessions |
| `410 Gone` | Session has ended (`status = 'complete'` or `'abandoned'`) |

**Notes**
- The `session_participants` INSERT uses `ON CONFLICT (session_id, user_id) DO NOTHING` to handle reconnections idempotently. The permanent participation record (`joined_at`) is the timestamp of first join.
- An Engineering Manager following the join link receives `403` with a message explaining why they cannot participate. They should be directed to the read-only history view.
- After a successful join, the client should open a WebSocket connection to receive real-time updates. This HTTP endpoint is the gate; the WebSocket is the live channel.
- Redis `session_participants` hash and `joined_users` set are updated after the PostgreSQL INSERT succeeds.

**As built: Application Admin exclusion from live sessions (#243, configurable OIDC role map, design D11).** With group-based role mapping, a person in both the manager and admin IdP groups resolves to `application_admin`. Application Admins are therefore excluded from session participation on the same terms as Engineering Managers. Each check reads `users.global_role` live from the database. The error shapes are the ones the manager denial already uses; there are no new error codes.

| Implemented endpoint / channel | Admin outcome |
|---|---|
| `POST /api/v1/sessions/:sessionId/participants` (participant registration) | `403`, category `invalid_request`, message `"You are not eligible to participate as a voter in this session."`. No `session_participants` row. An `audit_log` row and structured event `session.participant_registration_rejected` record `actor_global_role = 'application_admin'`. |
| `POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in` (vote lock-in) | `403`, category `invalid_request`. The message is now `"You are not eligible to lock in votes in this session."` for every rejected caller, replacing the former `"Engineering Managers cannot lock in votes."`. No vote is recorded. Votes locked in before the user became an admin are kept and counted at reveal. |
| `/ws/sessions/:sessionId` (session WebSocket): subscription, per-event delivery, periodic re-authorization | No participant grant. The connection closes with the existing undisclosed close code, and events are not delivered. The session-facilitator grant is unchanged. |
| `GET /api/v1/sessions/:sessionId/action-items-review`, `GET /api/v1/sessions/:sessionId/participants-roster`, `POST /api/v1/sessions/:sessionId/reveal-latency` (reuse the session-subscriber grant) | Denied exactly as for a caller with no grant (`404` / `404` / `403` respectively). |
| Participant roster contents | Application Admins are not listed. |

Team membership and join-link redemption are not affected: an admin may still hold a team membership.

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
Transitions the session from `pre_session` to `active`, sets the first topic to `voting` phase, and publishes a `session_state_change` WebSocket broadcast after the transaction commits.

**Corrected by `session-lifecycle-transitions` (2026-09-08):** this entry previously stated `SESSION-005` "triggers the WebSocket `topic.advanced` broadcast." As implemented, `SESSION-005` calls `publishSessionStateChange` (a `session_state_change` event, not a `topic.advanced`/`topic_history_update` event) — there is no next-topic advance happening here, only the session's first entry into `active`. `topic_history_update` is published only by `SESSION-012`'s topic-to-topic advance and wrap-up-entry branches. See Appendix D's corrected `topic.advance` row.

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
    topicAnnotation: string | null;  // Added (`topic-annotation`). From session_topics.topic_annotation (the snapshot) ONLY, never live topics.team_annotation. The only source for in-session display of the team definition.
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
  3. `session_state_change` WebSocket broadcast published to the session's subscribers, after the transaction above commits
- The WebSocket broadcast happens after the transaction commits, not before the HTTP response is returned or as part of it — the response confirms the state transition; participants see the new topic via the `session_state_change` WebSocket event.
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
- `facilitator` in their [facilitator read window](#facilitator-read-window) for the team (per ADR-007: facilitator history access is session-scoped)

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
- Per ADR-007, a facilitator's access to historical data is session-scoped: it requires the facilitator to be in their [facilitator read window](#facilitator-read-window) for the team. That includes a `draft` session under 24 hours old and the 30-minute post-session grace window. Outside the window the facilitator receives `403`.

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

### SESSION-012 — Advance Topic (Topic-to-Topic, or Enter Wrap-Up)

**Added by `session-lifecycle-transitions` (2026-09-08).** No endpoint ID existed for this transition prior to this change — confirmed by direct review of all previously-documented endpoints. Fully specified here per `session-lifecycle-transitions` design.md Decision D4/D4a.

**Method and URL**
```
POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance
```

**Description**
Transitions the session's current topic from `revealed` to `complete`. If a next topic exists in `display_order`, that topic transitions to `voting` and `sessions.current_topic_id` updates — the session stays `active`. If no next topic exists, the session transitions to `wrap_up`. One endpoint handles both cases; the branch is a server-side decision, not a client choice (design.md Decision D4's rationale — the client cannot reliably know whether the topic it is looking at is the last one).

**Auth:** Protected.

**Authorization:** Both of the following must pass, in order, before the precondition check below runs (design.md Decision D4's "Authorization, named explicitly" note, matching this file's existing `advance`/`complete` handlers for the same two-path-param shape):
1. `sessions.team_id = :teamId` (else `403`, "Session does not belong to this team.")
2. `sessions.facilitator_id = authenticated_user_id` (else `403`, "Only the facilitator can advance the session's topic.")

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `teamId` | `uuid` | Yes | Team identifier |
| Path | `sessionId` | `uuid` | Yes | Session identifier |

No request body.

**Response**

`200 OK`

```typescript
interface TopicAdvanceResponse {
  sessionId: string;
  teamId: string;
  status: 'active' | 'wrap_up';   // sessions.status after this transition — the discriminant
  completedTopic: {
    sessionTopicId: string;
    topicName: string;
    completedAt: string;
  };
  // Present only when status === 'active' (a next topic exists):
  currentTopic?: {
    sessionTopicId: string;
    topicName: string;
    topicPrompt: string;
    voteType: 'finger' | 'roman' | 'modified_roman';
    phase: 'voting';
    topicAnnotation: string | null;  // Added (`topic-annotation`). From the session_topics snapshot only, as on SESSION-005.
  };
  // Present only when status === 'wrap_up' (no next topic remained):
  wrapUpStartedAt?: string;
}
```

**Error Responses**

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Authenticated user is not the session's facilitator, or the session does not belong to `:teamId` |
| `404 Not Found` | Session does not exist |
| `409 Conflict` | The current topic's `session_topics.status` is not `revealed` — returns `TopicAdvanceBlockedResponse` (`errorState: "advance_blocked"`, `requiresReveal: true`), not a bare `409` body |

```typescript
interface TopicAdvanceBlockedResponse {
  errorState: "advance_blocked";
  sessionId: string;
  teamId: string;
  sessionTopicId: string;    // the CURRENT (unrevealed) topic
  requiresReveal: true;      // tells the frontend to offer the reveal action inline
}
```

**Notes**
- Guarded by a hard precondition, enforced via a conditional `UPDATE ... WHERE status = 'revealed'` with a row-count check (the same mechanism `POST .../reveal` uses for its own `voting → revealed` precondition) — not a separate lock statement.
- Writes `audit_log` with `operation = 'session.topic_advanced'` (topic-to-topic branch) or the existing `operation = 'session.state_changed'` (wrap-up-entry branch, since `sessions.status` changes here exactly as it does for every other transition already using that operation).
- Publishes, after the transaction commits: `topic_history_update` (`updateType: "topic_advanced"`) on the topic-to-topic branch; both `session_state_change` and `topic_history_update` on the wrap-up-entry branch (the just-completed last topic's completion is team-content-relevant on its own).
- `topic_history_update` is delivered via the team-scoped WebSocket registry, not the session-scoped one — a client must be subscribed to its team channel (in addition to its session channel) to receive this event during a live session. See Appendix D.
- The `advance_blocked` `409` is a calm, non-error UX state, not a generic failure — see `team-content-access` spec's Error State 1b. The frontend must offer the reveal action directly from this state.

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

Implemented by `actionitem-updated-live-broadcast` (GitHub issues #64 + #65 + #95, combined) — `packages/backend/src/routes/action-items.ts`.

**Auth:** Protected.

**Authorization:**
- `engineer`: may only update action items they own (`action_items.owner_id = authenticated_user_id`) and that belong to a team they are a member of.
- `facilitator`: may update any action item belonging to a team they are **actively facilitating**, defined narrowly (design.md Decision D10) as a session for that team currently in `lobby`, `pre_session`, `active`, or `wrap_up` status — not this application's broader `evaluateTeamAccess` grant, which additionally covers a session's `draft` (24h) and `complete` (`facilitator_access_expires_at`) grace windows. Those grace windows are appropriate for read access to session content but do not extend to this write endpoint.
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

Error ordering (design.md Decision D12): `404` and `403` are **not independent** — they reflect an ordered lookup-then-authorize check, not two flat conditions. A caller with zero relationship to the item's team receives the same `404` as a genuinely nonexistent `actionItemId`, indistinguishable in body/shape; `403` is reserved for a caller who already has *some* relationship to the item's team (a plain member, an Application Admin, or a facilitator whose relationship exists but falls outside the narrowed active-facilitating window above) but is neither the item's owner nor a currently-authorized facilitator. This closes an `actionItemId` enumeration oracle this endpoint's URL — which carries no `teamId` to gate on the way other team-scoped endpoints do — would otherwise reopen.

| Status | When |
|---|---|
| `401 Unauthorized` | No valid session cookie |
| `403 Forbidden` | Caller has *some* relationship to the item's team (member, Application Admin, or a facilitator outside the narrowed active-facilitating window) but is neither the owner nor a currently-authorized facilitator; EM attempting any update |
| `404 Not Found` | Action item does not exist, **or** exists but the caller has zero relationship to its team (not a member, not the owner, not ever a facilitator for that team) — the two cases are indistinguishable in response |
| `409 Conflict` | Requested transition is not permitted: backward transitions (`in_progress` → `open`) and any transition targeting an item whose current status is already `resolved` are rejected (FR-7.3) |
| `422 Unprocessable Entity` | `resolutionNote` exceeds 500 characters; `sessionId` references a session not in an active state (same narrowed status set as the facilitator-authorization window above) |

**Notes**
- **Directed state machine (FR-7.3):** Permitted transitions: `open` → `in_progress`, `open` → `resolved`, `in_progress` → `resolved`. All other transitions return `409 Conflict`. The application must read the current status before writing and reject invalid transitions. A same-status write (no-op) resets the staleness clock and is permitted for `open` and `in_progress`; a no-op write on `resolved` is also rejected since `resolved` is terminal.
- A database CHECK constraint enforcing the transition rule at the persistence layer as a secondary guard (`(old_status, new_status) IN (('open','in_progress'), ('open','resolved'), ('in_progress','resolved'))`) remains a deliberate no-op, not an oversight: enforcement stays application-level, matching this codebase's consistent pattern for transition and ownership checks elsewhere (e.g. the facilitator-authorization and anti-enumeration checks above, both application-level).
- An `action_item_history` row is written for every accepted, non-no-op status change, in the same transaction as the `action_items.status` update and (design.md Decision D13) an `audit_log` row (`operation = 'action_item.status_changed'`) — `action_item_history` is a business record read back by ordinary users; `audit_log` is this codebase's security audit trail, and every other sensitive mutation writes to both.
- `resolved_in_session_id` on `action_items` is set to `sessionId` when `status = 'resolved'` and a `sessionId` is provided.
- After this REST write, the WebSocket layer broadcasts `action_item_status_updated` (the shipped wire name — `actionitem.updated` was this catalog's pre-correction dot-notation name for the same live, pre-finalization mechanism, per `openspec/specs/websocket-specification/spec.md`'s naming-correction convention, not a contradiction of this contract's intent) to every session subscriber holding a valid grant, gated to sessions currently in `pre_session` status — narrower than the `sessionId` request-body validation's active-state set above, since FR-3.3 places this review strictly before the first voting topic is presented.
- The database CHECK constraint `action_items_resolved_has_session` does **not** exist in this codebase (`packages/backend/migrations/2_create_tables.sql`) — a pre-existing inaccuracy in this contract, not introduced by the change that implemented this endpoint. The application enforces this invariant before writing; no migration backfills the constraint.

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
- The reveal itself is triggered via the authenticated REST endpoint `POST /api/v1/teams/:teamId/sessions/:sessionId/reveal`, which performs the `voting → revealed` write and — after that transaction commits — publishes the `vote_revealed` WebSocket broadcast (corrected by `session-lifecycle-transitions`, 2026-09-08; see Appendix D's corrected `reveal.trigger` row). This `VOTE-003` endpoint is a separate, read-only path serving clients who missed that WebSocket event.
- Votes are read from PostgreSQL (not Redis). Pre-reveal votes in Redis are never accessible via HTTP.

---

### VOTE-004 — Reassign Action Item Owner

**Method and URL**
```
PATCH /api/v1/action-items/:actionItemId/owner
```

**Description**
Reassigns an action item to a new active team member. Typically used when the current owner has left the team.

**Corrected by `reassign-action-item-owner` (2026-09-29):** this entry originally stated three things that did not match this endpoint's actual, shipped design (design.md's Migration Plan, this change's implementation):

1. The error table below listed `403` for both "not a facilitator" and "resolved action items cannot be reassigned" — an authorization failure and a state-precondition failure collapsed into one status code. Corrected to `409 Conflict` for the resolved case, matching `VOTE-002`'s own "resolved is terminal, unhedged" precedent (Open Question 3).
2. `sessionId` was documented as optional ("Current session context, for history attribution"). It is REQUIRED for this endpoint: this endpoint's governing use case has no out-of-session path, unlike `VOTE-002`'s own optional `sessionId`, whose optionality is grounded in a use case that explicitly supports an out-of-session status update. Its absence is rejected `422`.
3. **Authorization** below previously read `global_role = 'facilitator'` only — a real, distinct enum value (`user_role`, migration 1) that describes a materially weaker, standing authorization model than what this endpoint actually implements, and the code never checks `users.global_role` at all. Corrected to state the actual session-scoped mechanism, matching `VOTE-002`'s own corrected entry.

**Auth:** Protected.

**Authorization:** A session exists for the action item's team with `facilitator_id` equal to the authenticated caller and `status` in `lobby`, `pre_session`, `active`, or `wrap_up` — the same session-scoped `EXISTS` check `VOTE-002` establishes (that endpoint's Decision D10), reused verbatim rather than re-derived (design.md Decision D1). Unlike `VOTE-002`, there is no owner-authorized path here at all: reassignment is a privileged action, not something the current owner can do to themselves, so authorization is facilitator-or-nothing.

**Request**

| Location | Name | Type | Required | Description |
|---|---|---|---|---|
| Path | `actionItemId` | `uuid` | Yes | Action item identifier |

**Request Body**

```typescript
interface ReassignActionItemRequest {
  newOwnerUserId: string;    // Must be an active participant member of the action item's team
  sessionId: string;         // Required. The current session context, for history attribution.
                             // Missing or invalid values are rejected 422 (design.md Decision D4).
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
| `403 Forbidden` | Caller has some relationship to the item's team (member, or has ever facilitated a session for it) but is not currently an authorized active facilitator |
| `404 Not Found` | Action item does not exist, or exists but the caller has zero relationship to its team (indistinguishable from nonexistence); new owner user does not exist; new owner has no `team_memberships` row at all for this team |
| `409 Conflict` | The action item's current status is `resolved` — resolved is a terminal state and is not a valid target for this endpoint |
| `422 Unprocessable Entity` | `sessionId` is missing, or does not reference an active-state session for this team; new owner is the calling facilitator themselves; new owner's `team_memberships` row for this team is soft-removed or has `role = 'engineering_manager'` |

**Notes**
- The reassignment event is recorded in `action_item_history` with the prior `owner_id` and the facilitator as `changed_by_user_id`.
- The new owner must be an active `participant` member of the team — not the facilitator themselves, and not an EM.
- Resolved action items cannot be reassigned (`409`, not `403` — see the correction note above).
- Reassigning an item to its own current owner is accepted as a `200` no-op: `updated_at` is bumped and an `audit_log` row is written (`metadata.no_op = true`), but no `action_item_history` row is written, since no ownership transition occurred.
- No WebSocket broadcast is published for any reassignment, no-op or real.

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
- `facilitator`: only while in their [facilitator read window](#facilitator-read-window) for the team (per ADR-007)

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

**Authorization:** Same as `ACTION-004`: active team member, team EM, or `facilitator` in their [facilitator read window](#facilitator-read-window) for the team. Access validated via `action_items.team_id`.

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
- `facilitator` in their [facilitator read window](#facilitator-read-window) for this team (per ADR-007)

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
| TOPIC-001 | Own team (read) | Teams in read window ([def](#facilitator-read-window)) | No (403, #187; membership or global role) | No (403 + audit; reads via TOPIC-002) | EM denied unconditionally; no override |
| TOPIC-002 | No | Yes (non-member teams) | No | Yes; every read audited | Read; `canEditAnnotations` false for admins; admin (any team, any membership, per FR-8.2 / #208) |
| TOPIC-003 | No | Yes (non-member teams, post-lock) | No | Yes | Facilitator (non-member) or admin (any team, any membership, per FR-8.2 / #208); code: `checkAddCustomTopicAuthorization`, delegating to `checkStandingFacilitatorOrAdminAuthorization`; customization lock enforced |
| TOPIC-004 to TOPIC-006 | No | Yes (non-member teams, post-lock) | No | Yes | Facilitator (non-member) or admin (any team, any membership, per FR-8.2 / #208); customization lock enforced (FR-8.2) |
| TOPIC-007 | No | Yes (non-member teams, post-lock) | No | **No** (`403 NOT_A_FACILITATOR`) | Facilitator-only (BRD FR-8.7); customization lock enforced (`409`) |
| TOPIC-008 | No | **No** (`403 NOT_AN_ADMIN`) | No | Yes (any team, any membership; role read live from `users`) | Admin-only (#200). The one exception to the customization lock: allowed only when the team has zero active topics, and it can write only the canonical set. Not for the template team. |
| DEFTOPIC-001 to DEFTOPIC-007 | No | **No** (`403 DEFAULT_MAINTENANCE_ADMIN_ONLY`) | No | Yes (membership irrelevant; role read live from `users`) | Admin-only (#216). Maintains the default set for teams created from now on; touches no existing team. Role is checked before the body is parsed. |
| SESSION-001 | No | Yes (non-member teams) | No | Yes | Cross-team check re-enforced |
| SESSION-002 | If participant | If facilitator | No | No (#243 D11) | Live sessions only |
| SESSION-003 | Yes (team member, participant role) | No | No | No (#243 D11) | EM role and App Admin blocked, even as team members |
| SESSION-004 to SESSION-006 | No | Session facilitator only | No | Yes | |
| SESSION-007 | Own team | Teams in read window ([def](#facilitator-read-window)) | Managed teams | All | ADR-007 |
| SESSION-008 | Own team (full votes) | Facilitated teams (full votes) | Managed teams (aggregates only) | All | EM filter enforced server-side |
| SESSION-009 to SESSION-011 | No | Session facilitator / any facilitator (011) | No | Yes | |
| VOTE-001 | Session participant | Session facilitator | No | No (#243 D11) | Reuses the session-subscriber grant |
| VOTE-002 | Own items only | Any item (active session) | No | Yes | |
| VOTE-003 | Session participant | Session facilitator | Aggregates only | Yes | Pre-reveal: 403 |
| VOTE-004 | No | Yes (active session) | No | Yes | |
| ACTION-001 to ACTION-003 | No | Session facilitator | No | Yes | Wrap-up only for 001-003 |
| ACTION-004 | Own team | Teams in read window ([def](#facilitator-read-window)) | Managed teams | All | No draft items |
| ACTION-005 | Own team | Teams in read window ([def](#facilitator-read-window)) | Managed teams | All | |
| TREND-001 to TREND-002 | Own team | Teams in read window ([def](#facilitator-read-window)) | Managed teams (aggregates) | All | |
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
| OQ-7 | TOPIC-007, SESSION-011 | Character limits for topic annotations (500 chars assumed) and session annotations (60 chars from use case guidance) are not formally specified. **Resolved for TOPIC-007 only (`topic-annotation`):** 500 UTF-16 code units after `\r\n` → `\n` normalization and trim (see TOPIC-007). The SESSION-011 part remains open. | BA to confirm (SESSION-011) |
| OQ-8 | ACTION-002 | Whether description/owner edits during wrap-up are recorded in `action_item_history` is unspecified. Current contract does not write history for pre-finalization edits. | BA to confirm |

---

## Appendix D: Endpoints Explicitly Excluded from HTTP REST

**Corrected by `session-lifecycle-transitions` (2026-09-08):** the original framing below — "must NOT be implemented as REST endpoints," citing BRD 6.1 — supports excluding vote *submission* from REST (timing exposure) but does not support excluding the facilitator's own privileged *trigger* actions, and it already contradicted `SESSION-004`/`SESSION-005` being specified as REST endpoints elsewhere in this same document. The actual, implemented architecture for `reveal.trigger` and `topic.advance` is: an authenticated REST endpoint performs the trigger and the state-transition write (`POST .../reveal`, already existing; `SESSION-012`, `POST .../topics/advance`, new), and — only after that write's transaction commits — a single WebSocket broadcast fans the result out to every connected client simultaneously. The REST trigger is not the integrity mechanism; the single post-commit broadcast is. The rows below are corrected to describe this, not to reassert the original "excluded from REST" framing, which no longer holds for these two rows. `vote.submit`'s exclusion is untouched — its rationale (HTTP polling would expose vote timing to observers) does not share this flaw, since submitting a vote is not a privileged trigger action and timing exposure remains a real concern.

| Behavior | Trigger / WebSocket message | Rationale |
|---|---|---|
| Submit and lock in a vote | `vote.submit` (WebSocket only — no REST trigger). *As built:* `POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in`; Engineering Managers and Application Admins receive `403` (see SESSION-003, "Application Admin exclusion") | HTTP polling would expose vote timing to observers |
| Trigger the vote reveal | REST trigger: `POST /api/v1/teams/:teamId/sessions/:sessionId/reveal`. WebSocket broadcast: `vote_revealed`, published to every session subscriber only after the reveal write's transaction commits | Simultaneous delivery is achieved by the single post-commit broadcast, not by the trigger's transport — an authenticated REST action from the facilitator is the correct trigger for this privileged action |
| Advance to next topic | REST trigger: `POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance` (`SESSION-012`). WebSocket broadcast: `topic_history_update`, published to the team's subscribers only after the advance write's transaction commits | Same pattern as the reveal trigger above — an authenticated REST action performs and commits the write; the post-commit broadcast is what achieves simultaneous delivery |
| Participant join/leave notification | `participant.joined` / `participant.left` | Real-time push required |
| Readiness grid updates | `vote.locked` (to facilitator only) | Polling introduces unacceptable latency |
| Action item status real-time propagation | `actionitem.updated` | Write via REST (`VOTE-002`), notification via WebSocket |

**Corrected by `websocket-specification` (2026-09-11):** the dot-notation names used throughout this appendix — `reveal.trigger`, `vote.submit`, `vote.locked`, `session.revealed`, `topic.advance`/`topic.advanced`, `participant.joined`/`participant.left`, and `actionitem.created`/`actionitem.updated` — do not match the events and mechanisms actually implemented in production. The `websocket-specification` capability spec is now the authoritative, corrected event catalog: it states the real, shipped mechanism behind each name above (e.g., `vote.locked` is `vote_readiness_update`, delivered facilitator-only; `session.revealed` is folded into `vote_revealed`; `topic.advance` is `SESSION-012`'s REST trigger and `topic.advanced` is the `topic_history_update` broadcast) and marks `participant.joined`/`participant.left` as NOT IMPLEMENTED, spec-and-defer, tracked in issue #94, and the live-update case of `actionitem.updated` as NOT IMPLEMENTED, spec-and-defer, tracked in issue #95 (implementation unscheduled for both). Any reference to the dot-notation names elsewhere in this document should be read as referring to the corresponding real mechanism that spec now documents, not as a still-current API surface. See `todo.md`'s "WebSocket Specification" entry for the spec's location.

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