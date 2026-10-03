# team-content-access

## Purpose

Defines the server-side authorization layer for all team-scoped content HTTP endpoints. This spec establishes the shared authorization helper, the content type access matrix with role-specific response shapes, Application Admin access boundaries (Option B: administrative data only), consistent 403/404 denial behavior, and the no-caching constraint. Every endpoint that serves team content MUST use this authorization layer.

This spec covers: the three authorization paths (team member, associated EM, active facilitator), the content type access matrix, Application Admin Option B, consistent 403/404 behavior, cache prohibition, and live-session facilitator error states.

This spec does NOT cover: WebSocket delivery-time authorization (see websocket-session-authorization spec), session join authorization (see session-participation spec), or session creation authorization (facilitator-from-another-team constraint, also in session-participation spec).

**Implementation note — `sessions.status` enum value:** The codebase uses `'complete'` (not `'completed'`) for the completed session status throughout. This is the normative spelling for all SQL and application code in this spec.

**Implementation note — Error States 1a/1b (`session-lifecycle-transitions`):** The backend contract for both states — the `already_revealed` and `advance_blocked` `errorState`-keyed response shapes, returned by the `session-topic-lifecycle` capability's reveal and topic-advance endpoints — is implemented and covered by backend tests, including the ordering rule that authorization always runs before either precondition check. The frontend rendering behavior each state's "Required display" describes below is not yet implemented; it is named here as a required acceptance condition for this capability, tracked as open follow-up work, not assumed satisfied by the correct HTTP status/body alone.

---

## Requirements

### Requirement: Authorization helper evaluates three access paths and returns a role-qualified grant

The application SHALL provide a reusable server-side authorization helper that evaluates whether an authenticated user is authorized to access a specific team's content. The helper MUST return a typed role-qualified access grant or deny access. It MUST NOT return a single boolean. It MUST execute a live database read on every call; the result MUST NOT be cached at any layer (see Requirement: Authorization results are not cached).

The helper MUST evaluate the following three paths in order:

**Path 1 — Team member:** The user has an active `team_memberships` row (`removed_at IS NULL`) for the requested team. Sub-case:
- `membership_role = 'participant'`: grant type `{ path: 'member', role: 'participant', teamId }`

A `team_memberships` row with `role = 'engineering_manager'` does NOT, by itself, grant `role: 'engineering_manager'` access through Path 1. `membership_role = 'engineering_manager'` alone is insufficient — this exact sub-case (granting EM access from `membership_role` alone, without confirming `global_role`) was the read-side half of the TEAM-005 EM-promotion gap (issue #109) and MUST NOT be reintroduced. A user whose `team_memberships.role = 'engineering_manager'` but whose `users.global_role != 'engineering_manager'` is evaluated under the mismatched-state handling defined below, not granted access via Path 1.

**Path 2 — Engineering Manager by explicit association:** The user has `users.global_role = 'engineering_manager'` AND an active `team_memberships` row with `role = 'engineering_manager'` for the requested team. Grant type: `{ path: 'member', role: 'engineering_manager', teamId }`. This is the TEAM-006 path; the dual-check on both `users.global_role` and `team_memberships.role` MUST be performed, and — as of this change — is the ONLY path by which the helper may return a grant with `role: 'engineering_manager'`. Both fields MUST be read live from the database on every call, from the same query used to evaluate Path 1; the helper MUST NOT perform two separate database reads for what is structurally one authorization question.

**Path 3 — Active session facilitator:** The user has an active session row for the requested team:
```sql
sessions.facilitator_id = $current_user
AND sessions.team_id = $requested_team
AND (
  sessions.status IN ('draft', 'lobby', 'pre_session', 'active', 'wrap_up')
  OR (
    sessions.status = 'complete'
    AND sessions.facilitator_access_expires_at > NOW()
  )
)
```
Grant type: `{ path: 'facilitator', sessionId, teamId, sessionStatus }`.

**Application Admin path:** A user with `users.global_role = 'application_admin'` who has no `team_memberships` row for the requested team MUST NOT be granted access to session content endpoints. They SHALL be granted access only to administrative data endpoints (see Requirement: Application Admin access is limited to administrative data).

**Mismatched-state handling:** A user with `team_memberships.role = 'engineering_manager'` for the requested team but `users.global_role != 'engineering_manager'` matches neither Path 1's participant sub-case nor Path 2's dual-check. This state is expected to be unreachable through normal operation once TEAM-005 no longer originates `participant → engineering_manager` transitions (see the role-assignment capability) and TEAM-006 continues to enforce its `global_role` precondition — but the helper MUST NOT assume it cannot occur, since a future write path could reintroduce it. Per design.md Decision E of the restrict-team-005-em-promotion change, the helper MUST degrade gracefully: it returns a grant of `role: 'participant'` (not `null`, not a 403, and never a bare grant of `role: 'engineering_manager'`), and MUST emit a structured, log-only `team.access_grant_mismatch` event carrying `userId`, `teamId`, the mismatched `global_role`, and `membership_role`. This event MUST NOT be written as a synchronous `audit_log` row, since this helper executes on essentially every content request.

If none of the three paths matches, the helper denies access. A user in the mismatched state above is not denied outright — see the graceful-degrade resolution above.

#### Scenario: Team member with participant role is granted access

- **WHEN** the authorization helper is called for a user with an active `team_memberships` row with `role = 'participant'` for the requested team
- **THEN** the helper returns a grant with `path = 'member'` and `role = 'participant'`

#### Scenario: EM with team_memberships.role = engineering_manager AND matching global_role is granted access via Path 2

- **WHEN** the authorization helper is called for a user with `users.global_role = 'engineering_manager'` AND an active `team_memberships` row with `role = 'engineering_manager'` for the requested team
- **THEN** the helper returns a grant with `path = 'member'` and `role = 'engineering_manager'`
- **AND** the helper has checked both `users.global_role` and `team_memberships.role` from the database in the same query

#### Scenario: team_memberships.role = engineering_manager alone, without a matching global_role, does not grant EM access

- **WHEN** the authorization helper is called for a user with an active `team_memberships` row with `role = 'engineering_manager'` for the requested team
- **AND** that user's `users.global_role != 'engineering_manager'`
- **THEN** the helper does NOT return a grant with `role: 'engineering_manager'`
- **AND** this holds regardless of how the mismatched `team_memberships` row came to exist

#### Scenario: Active session facilitator is granted scoped access

- **WHEN** the authorization helper is called for a user with a `sessions` row where `facilitator_id = $user`, `team_id = $team`, and `status IN ('lobby', 'pre_session', 'active', 'wrap_up')`
- **THEN** the helper returns a grant with `path = 'facilitator'` and the active session's `sessionId` and `sessionStatus`

#### Scenario: Facilitator with only a completed session row is denied access after grace window expiry

- **WHEN** the authorization helper is called for a facilitator whose only session row for the requested team has `status = 'complete'` and `facilitator_access_expires_at < NOW()`
- **THEN** the helper denies access
- **AND** access is not granted on the basis of `global_role = 'facilitator'` alone

#### Scenario: Facilitator with completed session within grace window is granted access

- **WHEN** the authorization helper is called for a facilitator whose session for the requested team has `status = 'complete'` and `facilitator_access_expires_at > NOW()`
- **THEN** the helper returns a grant with `path = 'facilitator'` and `sessionStatus = 'complete'`
- **AND** the grant is marked read-only (no write operations are permitted during the grace window)

#### Scenario: User with no team relationship is denied

- **WHEN** the authorization helper is called for an authenticated user who has no `team_memberships` row for the requested team and no active session as facilitator
- **THEN** the helper denies access
- **AND** no grant object is returned

#### Scenario: Application Admin with no team membership is denied session content

- **WHEN** the authorization helper is called for a user with `global_role = 'application_admin'` and no `team_memberships` row for the requested team
- **AND** the requested resource is a session content endpoint (session history, trend data, votes, action items)
- **THEN** the helper denies access

---

### Requirement: Content serializer enforces role-specific response shapes

The application SHALL enforce the content type access matrix at the serializer layer, independently of the authorization check. Each content endpoint MUST produce a different response shape based on the role in the access grant. The authorization check and the serializer MUST NOT be collapsed into a single code path that obscures role-specific filtering.

**Defined terms:**

**"Aggregate vote distributions"** means: the count of votes cast at each score value for a given topic and session, presented as a count-per-bucket without any mapping of vote value to individual engineer identity. This includes summary statistics (team average, score range, outlier count if applicable) derived from the distribution. It explicitly excludes: the identity of which engineer cast which vote; ranked orderings that would allow inference of individual votes by process of elimination; any data that would allow an EM to reconstruct individual attribution indirectly.

**"Participant view of historical session data"** means: for a completed session, the requesting engineer sees: (a) the aggregate vote distribution for each topic (count-per-bucket, team average, outlier count), (b) the engineer's own individual vote for each topic they participated in, and (c) trend data (how this topic's score compares to prior sessions). The participant view does NOT include the individual votes of other engineers.

**Content type access matrix:**

| Content Type | Engineer (team member) | Facilitator (active session) | EM (associated) | Application Admin |
|---|---|---|---|---|
| Live session: pre-reveal (readiness grid) | Own readiness status only | Readiness grid (who locked in) — vote values excluded | None | None |
| Live session: post-reveal votes | Aggregate distribution + own vote | Full revealed distribution with individual attribution | None | None |
| Session history (aggregate vote distributions) | Yes | Yes (during active session + grace window only) | Yes | No |
| Session history (own individual vote) | Yes | Yes (during active session + grace window only) | No | No |
| Session history (other engineers' individual vote attribution) | No | Yes (during active session + grace window only, for revealed topics only) | No | No |
| Trend data | Yes | Yes (during active session + grace window only) | Yes | No |
| Action items | Yes | Yes | Yes (read-only) | No |
| Topic configuration | Read-only | Read/Write during session setup | None | Read-only (metadata, no session data) |
| Team membership list | Read-only | Read-only | None | Yes (full) |
| Role assignments | Read-only (own role only) | Read-only | None | Yes (full) |
| EM associations | None | None | Read-only (own association) | Yes (full) |
| Team metadata (name, status, creation date) | Read-only | Read-only | Read-only | Yes (full) |

**Facilitator pre-reveal constraint:** A facilitator's access grant during a live session does NOT include vote values for any topic that has not yet been revealed. During the pre-reveal phase, the facilitator sees the readiness grid only. This constraint is enforced at the serializer layer by checking the topic's reveal status before including vote values in the response. It is not sufficient to rely on the authorization check alone.

**Three serializer boundaries:** The application implements three distinct serializer/query pairs: `serializeForMemberParticipant` (accepts `ParticipantQueryResult`, includes `voter_id` for own-vote identification), `serializeForMemberEM` (accepts `EMQueryResult`, must never include `voter_id`; attribution boundary enforced at the query layer), and `serializeForFacilitator` (accepts `FacilitatorQueryResult`, includes individual attribution for revealed topics only). These types are nominally distinct; cross-path use MUST produce a compile error.

#### Scenario: EM receives aggregate vote distributions, not individual attribution

- **WHEN** an EM calls the session history endpoint for a team they manage
- **THEN** the response includes aggregate vote distributions (count-per-bucket, team average) for each topic in each completed session
- **AND** the response does NOT include any mapping of vote value to individual engineer identity

#### Scenario: Engineer sees own vote but not other engineers' votes in session history

- **WHEN** an Engineer calls the session history endpoint for their team
- **THEN** the response includes the aggregate vote distribution for each topic
- **AND** the response includes the engineer's own individual vote for each topic they participated in
- **AND** the response does NOT include the individual vote of any other engineer

#### Scenario: Facilitator pre-reveal — vote values are excluded even though facilitator is authorized

- **WHEN** a facilitator accesses live session data for a topic that has not yet been revealed
- **THEN** the response includes the readiness grid (who has locked in) but not vote values
- **AND** this restriction applies regardless of the facilitator's elevated access grant
- **AND** the restriction is enforced at the serializer, not only at the authorization check

#### Scenario: Facilitator post-reveal — individual attribution is included for revealed topics

- **WHEN** a facilitator accesses live session data for a topic that has been revealed
- **THEN** the response includes the full vote distribution with individual attribution for the revealed topic

#### Scenario: Application Admin receives 403 on session content endpoint

- **WHEN** a user with `global_role = 'application_admin'` and no `team_memberships` row for Team A calls `GET /api/v1/teams/:id/sessions`
- **THEN** the endpoint returns `403 Forbidden`
- **AND** the response body confirms access is denied but does not indicate whether Team A exists or has session records

---

### Requirement: Application Admin access is limited to administrative data

Application Admins (users with `global_role = 'application_admin'`) SHALL have access to team administrative data endpoints only. They SHALL NOT have access to session content endpoints. This is Option B of the Application Admin access boundary decision (ADR-007 alignment): a blanket admin grant to session content creates an organization-wide surveillance path. Option B prevents this by keeping session content outside the admin's scope unconditionally.

**Administrative data endpoints accessible to Application Admins:**
- Team metadata: `GET /api/v1/teams/:id` (name, creation date, active/archived status)
- Team membership lists: `GET /api/v1/teams/:id/members` (user IDs, display names, assigned roles, join date, active/removed status)
- Role assignments: current `membership_role` for each team member
- Engineering Manager associations: which EM is linked to which team
- Topic configuration metadata: topic names and descriptions, team-level customizations (not session-scoped). This data is exposed to Application Admins by TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`). TOPIC-002 does not yet write the admin read-audit row this requirement calls for; that gap, and whether TOPIC-002 should deny an admin who holds an engineering-manager membership on the team, are tracked separately (proposal Follow-ups of change `topic-001-authz-contract-reconcile`, item 7) and are not changed by this requirement. The active-topics endpoint TOPIC-001 (`GET /api/v1/teams/:teamId/topics`) does **not** serve Application Admins. It answers them with `403` and the denied-access audit row described below (see Requirement: The active-topics endpoint admits only non-manager participant members and eligible session facilitators).

**Session content endpoints to which Application Admins are denied:**
- Session history: `GET /api/v1/teams/:id/sessions` and any session-specific sub-resources
- Trend data: `GET /api/v1/teams/:id/trends`
- Action items: `GET /api/v1/teams/:id/action-items`
- Live session state: any endpoint or WebSocket event serving votes, readiness state, or topic-level results
- Discussion notes: any endpoint serving session discussion notes

**Audit logging for Application Admin access:** Every Application Admin read of administrative data SHALL be logged in the `audit_log` table with fields: `timestamp`, `actor_user_id`, `actor_global_role`, `actor_ip`, `action` (e.g., `'team.members.read'`), `resource_type`, `resource_id`. Every write (membership changes, role assignments, EM associations) by an Application Admin is already covered by the manager-team-association spec's audit requirement; this requirement adds read access logging. The audit write MUST execute in the same database transaction as the data access operation.

**Audit logging of denied admin access to session content:** Any Application Admin request to a session content endpoint — regardless of response code — MUST be logged in the `audit_log` table with the standard audit fields plus the HTTP status code of the response. The audit entry MUST be written even when the response is 403. The same logging applies to an Application Admin request to TOPIC-001, under the existing operation `admin.session_content_denied` with `metadata.endpoint = "GET /api/v1/teams/:teamId/topics"`. The operation name SHALL NOT be changed, because audit consumers may key on it.

#### Scenario: Application Admin can access team membership list

- **WHEN** a user with `global_role = 'application_admin'` calls `GET /api/v1/teams/:id/members`
- **THEN** the endpoint returns the full membership list with roles and statuses
- **AND** an audit log entry is created recording the read access

#### Scenario: Application Admin is denied trend data

- **WHEN** a user with `global_role = 'application_admin'` and no `team_memberships` row for Team A calls `GET /api/v1/teams/team-a-id/trends`
- **THEN** the endpoint returns `403 Forbidden`
- **AND** the response body does not confirm whether Team A has trend data

#### Scenario: Application Admin who adds themselves to a team is detectable from audit log

- **WHEN** a user with `global_role = 'application_admin'` creates a `team_memberships` row for themselves via `POST /api/v1/teams/:id/members`
- **THEN** an audit log entry is created recording the membership change with `actor_user_id` equal to the admin's own user ID
- **AND** the audit log entry appears before any subsequent session content access by that user

#### Scenario: Application Admin reads topic configuration through TOPIC-002, not TOPIC-001

- **WHEN** a user with `global_role = 'application_admin'` calls `GET /api/v1/teams/:teamId/topics` (TOPIC-001)
- **THEN** the response is `403` and an `audit_log` row with operation `admin.session_content_denied` and `metadata.endpoint = "GET /api/v1/teams/:teamId/topics"` is written
- **AND** the same user calling `GET /api/v1/teams/:teamId/topics/all` (TOPIC-002) receives the team's topic configuration

---

### Requirement: The active-topics endpoint admits only non-manager participant members and eligible session facilitators

`GET /api/v1/teams/:teamId/topics` (TOPIC-001) SHALL return `200` only when both of these hold:

1. The access grant from `evaluateTeamAccess` is either (a) `path: "member"` for an active `participant` membership on the team, or (b) `path: "facilitator"`, an eligible session facilitator as this spec defines (active session statuses, a draft session under 24 hours old, or the post-session grace window).
2. The actor is not an engineering manager for this team, as defined below.

Every other caller SHALL receive `403`. That includes every `path: "member", role: "engineering_manager"` grant, every `path: "admin"` grant, a `null` grant, and any grant variant added to `TeamAccessGrant` after this change. The rule is an allow-list. An implementation that denies only a named set of grants (a deny-list) does not satisfy this requirement.

**Engineering manager, for this rule.** A caller is an engineering manager for the team when **either** of these is true, each read from the database on the request:
- their active `team_memberships.role` for the team is `engineering_manager` (this signal is live: it reflects the current membership row), or
- their stored `users.global_role` is `engineering_manager` (this signal reflects the user's last sign-in, because the IdP role claim is re-mapped only at sign-in).

This OR definition applies on every grant path, the facilitator path included, and it judges the actor, not the path the grant came through. It therefore denies:
- a caller whose membership role and global role are both `engineering_manager`;
- a caller whose membership role is `engineering_manager` but whose global role is not. The helper's Decision E degrades this caller to a `participant` grant, and that grant SHALL NOT let them through on TOPIC-001;
- a caller whose global role is `engineering_manager` but whose membership role is `participant`, for example an EM demoted through TEAM-005 or one who joined by invite link;
- a facilitator grant whose live `actorGlobalRole` is `engineering_manager`.

A facilitator grant (`path: "facilitator"`) whose live `actorGlobalRole` is `facilitator` SHALL NOT be denied by this rule. Team membership never disqualifies a facilitator **grant**, because the helper issues one only when the caller has no active membership on the team. A caller with an active membership is judged on the member path, whatever their global role. A user whose `users.global_role` is `facilitator` and who holds an active `engineering_manager` membership on the team receives a member grant and SHALL be denied by the membership signal. An implementation SHALL NOT admit a caller on their global role being `facilitator` before checking the membership signal.

This divergence from Decision E (degrade-to-participant) applies to TOPIC-001 only. It does not change how any other endpoint treats a mismatched grant.

**Unconditional.** The rule SHALL apply unconditionally, for every actor, with no feature flag, configuration setting, or administrative override. The admission decision SHALL take as input only the access grant from `evaluateTeamAccess` and the caller's active membership role on the team (the global role is carried on the grant). A member SHALL be admitted only when that membership role is exactly `participant`; a missing, unrecognised, or `engineering_manager` membership role SHALL deny. The admission decision SHALL NOT read any environment variable, configuration object, feature-flag service, or database setting.

**Denial response.** An engineering-manager denial SHALL:
- return exactly the standard `403` envelope `{ error: { category: "forbidden", message: "You do not have access to this team's content.", correlationId } }` with a freshly generated `correlationId`, and never the cross-team facilitator message;
- carry `Cache-Control: no-store`;
- apply `applyTimingFloor(startTime)` once before the response is sent, so the denial is not observably faster than a `null`-grant `403`;
- send before the `topics` query or the customization-lock check runs, so no topic row, topic name, annotation text, or `isCustomizationLocked` value reaches the caller;
- emit exactly one structured log event `topic.config_read_denied_role` before the response, carrying `userId`, `teamId`, `grantPath`, `globalRole`, `membershipRole` (or `null`), and `reason` (`membership_em`, `global_em`, or `not_admitted`). The event SHALL NOT carry topic names, topic ids, annotation text, or the lock flag. It is log-only; no `audit_log` row is written for it.

If reading the caller's membership role fails, the request SHALL fail with a server error and SHALL NOT be admitted.

The `team.access_grant_mismatch` log event that the helper emits for a mismatched EM membership SHALL still fire. It is how an administrator finds a mis-tagged engineer.

**Application Admins.** An `application_admin` caller SHALL receive `403` with exactly one `audit_log` row. This is the existing `denyAdminContentAccess` behaviour, operation `admin.session_content_denied`, with `metadata.endpoint = "GET /api/v1/teams/:teamId/topics"`. Topic configuration is also served by TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`), which this requirement does not change.

**Unchanged.** The non-canonical `teamId` check (`404 TEAM_NOT_FOUND` before any query) SHALL still run first. The template team's rows SHALL still be served to callers this rule admits (FR-8.6).

#### Scenario: Engineering manager by membership and global role is denied
- **WHEN** a user with `global_role = 'engineering_manager'` and an active `team_memberships` row with `role = 'engineering_manager'` on Team A calls `GET /api/v1/teams/:teamA/topics`
- **THEN** the response is `403` with the standard forbidden envelope and `Cache-Control: no-store`
- **AND** neither the `topics` query nor the customization-lock check is executed

#### Scenario: Engineering manager membership with a non-EM global role is denied
- **WHEN** a user with `global_role = 'engineer'` and an active `team_memberships` row with `role = 'engineering_manager'` on Team A calls TOPIC-001 for Team A
- **THEN** the response is `403` with the standard forbidden envelope
- **AND** a `team.access_grant_mismatch` log event is emitted for the request
- **AND** a `topic.config_read_denied_role` log event is emitted with `reason = 'membership_em'`
- **AND** no topic data or `isCustomizationLocked` is present in the response body

#### Scenario: Global engineering manager with a participant membership is denied
- **WHEN** a user with `global_role = 'engineering_manager'` and an active `team_memberships` row with `role = 'participant'` on Team A calls TOPIC-001 for Team A
- **THEN** the response is `403` with the standard forbidden envelope
- **AND** a `topic.config_read_denied_role` log event is emitted with `reason = 'global_em'`

#### Scenario: Global facilitator with an engineering manager membership is denied
- **WHEN** a user with `global_role = 'facilitator'` and an active `team_memberships` row with `role = 'engineering_manager'` on Team A calls TOPIC-001 for Team A
- **THEN** the response is `403` with the standard forbidden envelope
- **AND** a `team.access_grant_mismatch` log event is emitted for the request

#### Scenario: Global facilitator with a participant membership keeps access
- **WHEN** a user with `global_role = 'facilitator'` and an active `team_memberships` row with `role = 'participant'` on Team A calls TOPIC-001 for Team A
- **THEN** the response is `200` with `teamId`, the team's active topics, and `isCustomizationLocked`

#### Scenario: Facilitator whose global role has drifted to engineering manager is denied
- **WHEN** a caller holds an eligible facilitator grant for Team A and their live `users.global_role` is `engineering_manager`
- **AND** they call TOPIC-001 for Team A
- **THEN** the response is `403` with the standard forbidden envelope

#### Scenario: Participant member keeps access
- **WHEN** a user with `global_role = 'engineer'` or `global_role = 'senior_engineer'` and an active `participant` membership on Team A calls TOPIC-001 for Team A
- **THEN** the response is `200` with `teamId`, the team's active topics, and `isCustomizationLocked`
- **AND** no `topic.config_read_denied_role` event is emitted

#### Scenario: Eligible facilitator keeps access
- **WHEN** a user with `global_role = 'facilitator'`, no membership on Team A, and an eligible session for Team A calls TOPIC-001 for Team A
- **THEN** the response is `200` with `teamId`, the team's active topics, and `isCustomizationLocked`

#### Scenario: Application Admin is denied with one audit row
- **WHEN** a user with `global_role = 'application_admin'` calls TOPIC-001 for any team
- **THEN** the response is `403`
- **AND** exactly one `audit_log` row is written with operation `admin.session_content_denied` and `metadata.endpoint = "GET /api/v1/teams/:teamId/topics"`

#### Scenario: Application Admin with an engineering manager membership takes the admin path
- **WHEN** a user with `global_role = 'application_admin'` and an active `team_memberships` row with `role = 'engineering_manager'` on Team A calls TOPIC-001 for Team A
- **THEN** the response is `403`
- **AND** exactly one `audit_log` row is written with operation `admin.session_content_denied` and `metadata.endpoint = "GET /api/v1/teams/:teamId/topics"`

#### Scenario: Non-canonical teamId is rejected before the admission gate
- **WHEN** an engineering manager calls TOPIC-001 with a `teamId` that is not a canonical UUID
- **THEN** the response is `404` with `TEAM_NOT_FOUND`, not `403`
- **AND** `evaluateTeamAccess` is not called

#### Scenario: Engineering-manager denial is indistinguishable from a no-relationship denial
- **WHEN** an engineering manager of Team A and a caller with no relationship to Team A each call TOPIC-001 for Team A
- **THEN** the timing floor is applied exactly once, with the handler's start time, before each response is sent
- **AND** the two responses have the same status, headers, and body apart from `correlationId`

#### Scenario: A failed membership read does not admit the caller
- **WHEN** a caller with a member grant calls TOPIC-001 and reading their active membership role fails
- **THEN** the response is a server error, not `200`
- **AND** neither the `topics` query nor the customization-lock check is executed

#### Scenario: No annotation text reaches a denied engineering manager
- **WHEN** Team A has an active topic whose team annotation is `"X"` and an engineering manager of Team A calls TOPIC-001 for Team A
- **THEN** the response is `403`
- **AND** the response body does not contain `"X"`, any topic name, or `isCustomizationLocked`

#### Scenario: Engineering manager of the template team is denied
- **WHEN** a caller who is an engineering manager (by membership or global role) with a membership on the template team (`DEFAULT_TOPICS_TEAM_ID`) calls TOPIC-001 for the template team
- **THEN** the response is `403`
- **AND** a `participant` member of the template team calling the same endpoint still receives `200` with the template's rows

#### Scenario: No configuration value can admit engineering managers
- **WHEN** the admission decision for TOPIC-001 is evaluated
- **THEN** its only inputs are the access grant (which carries the global role) and the caller's active membership role, and no configuration value, environment variable, feature flag, or database setting is read
- **AND** an engineering manager calling TOPIC-001 receives `403` both with `NODE_ENV = 'development'` and with `NODE_ENV = 'test'`

---

### Requirement: Authorization is enforced server-side on every content endpoint

Every API endpoint that returns team-scoped content SHALL enforce authorization independently using the authorization helper defined in this spec. Authorization MUST be enforced at the route level, not only in the frontend. A request to a content endpoint that bypasses the frontend MUST receive the same authorization enforcement as a request that originates from the application UI.

**Route-level enforcement is not sufficient on its own.** A route guard that redirects unauthorized users away from a dashboard page does not prevent a direct API call to the underlying endpoint. Every API route must independently invoke the authorization helper before serving any data.

**Authorization MUST be checked at the query level.** The team boundary MUST be enforced in the database query, not by retrieving a broad result set and filtering in application code. A query that fetches all sessions across all teams and then filters to those the user is authorized to see is not acceptable.

**Known deviation — em-views.ts routes:** As of this change, the EM-specific routes under `/api/v1/teams/:teamId/em/` use a local `checkEmAuthorization` function rather than the shared `evaluateTeamAccess` helper. This creates two parallel authorization code paths. The migration of em-views.ts routes to use `evaluateTeamAccess` is a named follow-on item; until it is completed, these routes operate outside the shared authorization contract. This deviation does not represent a privilege escalation risk (the local function is narrower than the shared helper) but creates a maintenance liability.

#### Scenario: Direct API call to content endpoint is authorized independently

- **WHEN** a client calls `GET /api/v1/teams/:id/sessions` directly (without using the application UI)
- **THEN** the backend invokes the authorization helper before returning any data
- **AND** an unauthorized caller receives `403 Forbidden` regardless of how the request was formed

#### Scenario: Authorization check is at the query level

- **WHEN** the session history endpoint receives an authorized request
- **THEN** the database query includes the team membership or facilitator session condition as a predicate, not as a post-query filter
- **AND** the query does not return rows for other teams that are then filtered out in application code

---

### Requirement: Authorization results are not cached

The application SHALL NOT cache authorization results at any of the following layers:

1. **HTTP response cache:** Content endpoints MUST NOT set `Cache-Control` headers that would allow a proxy or browser to serve a cached response to a different user or after a role change. Responses from content endpoints that include team data MUST set `Cache-Control: no-store` or equivalent.

2. **ORM/query cache:** The authorization helper's database queries (team membership check, session status check) MUST NOT be served from any ORM-level query cache. Each call to the helper executes a live read.

3. **Application-session cache:** The authorization check MUST NOT be resolved from the role and membership information stored in the application session cookie. If a user's `team_memberships.role` or `users.global_role` changes after the session cookie is issued, the change MUST take effect on the next content request, not on the next login or session refresh.

A role change that takes effect immediately means: a user whose `team_memberships.role` was changed from `participant` to `engineering_manager` by an Application Admin MUST receive an EM-scoped response on their next content request, even if their session cookie still reflects `participant`.

**Known deviation — em-views.ts routes:** As of this change, the EM-specific routes in `em-views.ts` do not set `Cache-Control: no-store`. This is a pre-production blocking finding. These routes MUST be updated before any EM content endpoint is deployed to production.

#### Scenario: Role change takes effect on next request without re-authentication

- **WHEN** a user's `team_memberships.role` is changed from `participant` to `engineering_manager` while the user has an active application session
- **AND** the user makes a subsequent request to the session history endpoint
- **THEN** the response reflects the new `engineering_manager` role (aggregate distributions only)
- **AND** re-authentication is not required for the role change to take effect

#### Scenario: Content endpoint response is not cacheable

- **WHEN** the session history endpoint serves a successful response to an authorized caller
- **THEN** the response includes `Cache-Control: no-store` (or equivalent)
- **AND** the response is not served from any HTTP cache layer on a subsequent request by a different user

---

### Requirement: Unauthorized access returns consistent 403/404 regardless of resource existence

All team content endpoints SHALL return the same response code and body to an unauthorized caller regardless of whether the requested resource exists. This prevents callers from inferring team or session existence from the response.

**Implementation:** The authorization check MUST execute before the resource lookup. If the caller is not authorized for the requested team, the endpoint returns `403 Forbidden` without querying whether the resource exists. The response body for unauthorized requests MUST NOT include the team ID, session ID, or any identifier that would confirm the resource exists.

**This rule extends Decision 4 of the manager-team-association change (the 404 information exposure constraint) to all team content endpoints as a system-wide rule.** It is not applied per-endpoint; it is the default behavior for all content routes that include a team ID in the URL.

**Exception:** Application Admins calling administrative data endpoints (which they are authorized to access) receive normal 404 responses when a resource does not exist.

**Known issue — single-session endpoint:** The `GET /api/v1/teams/:teamId/sessions/:sessionId` handler queries sessions by ID without filtering by `team_id`. An authorized Team A member who holds a session UUID from Team B receives 403 (not 404), confirming that the UUID exists somewhere in the system. The correct query is `WHERE id = $1 AND team_id = $2`. This must be fixed before the endpoint ships.

#### Scenario: Unauthorized caller gets 403 for an existing team

- **WHEN** a user with no team relationship calls `GET /api/v1/teams/:id/sessions` where the team exists
- **THEN** the endpoint returns `403 Forbidden`
- **AND** the response body does not indicate that the team exists or has sessions

#### Scenario: Unauthorized caller gets 403 for a nonexistent team

- **WHEN** a user with no team relationship calls `GET /api/v1/teams/:id/sessions` where the team does not exist
- **THEN** the endpoint returns `403 Forbidden` (not `404`)
- **AND** the response is identical in status code and body structure to the case where the team exists

#### Scenario: Authorized caller gets 404 for a nonexistent resource

- **WHEN** an authorized user calls `GET /api/v1/teams/:id/sessions/:sessionId` where they are a team member but the session does not exist
- **THEN** the endpoint returns `404 Not Found`

---

### Requirement: Facilitator pre-session preparation access via draft session status

The application SHALL support a `draft` session status that grants a facilitator read-only historical access to a team's data before a session is formally opened.

A `draft` session is created when a facilitator initiates preparation for a specific team before they are ready to open the session to participants. The `draft` session is associated with a specific team. The facilitator MUST be eligible to facilitate that team (i.e., not a team member of that team per the facilitator-from-another-team constraint).

**Behavior of draft sessions:**
- A `draft` session grants the facilitator read-only access to the team's historical session data, trend data, and action items.
- A `draft` session does not open the session to participants; no join link is distributed while status is `draft`.
- A `draft` session becomes inaccessible after 24 hours via lazy expiry: the authorization SQL includes `status = 'draft' AND created_at + INTERVAL '24 hours' > NOW()`. No background deletion process is required. Orphaned `draft` rows may be cleaned up by a periodic maintenance query as an operational concern; the security property (access ends at 24 hours) is enforced by the SQL check alone.
- The facilitator's access grant under a `draft` session expires when the 24-hour window closes.

**Authorization SQL for draft sessions:** The `draft` branch is included in the facilitator access check as a separate OR clause:
```sql
OR (
  sessions.status = 'draft'
  AND sessions.created_at + INTERVAL '24 hours' > NOW()
)
```

#### Scenario: Facilitator accesses team history via draft session before opening the room

- **WHEN** a facilitator creates a `draft` session associated with Team A
- **THEN** the facilitator can call `GET /api/v1/teams/team-a-id/sessions` and receive the team's historical data
- **AND** no join link is distributed and no participants can join

#### Scenario: Draft session auto-expires after 24 hours

- **WHEN** a facilitator creates a `draft` session and does not advance it to `lobby` within 24 hours
- **THEN** the authorization check evaluates `created_at + INTERVAL '24 hours' > NOW()` as false and returns null
- **AND** the facilitator's historical access for that team ends
- **AND** a subsequent call to the session history endpoint returns `403`

#### Scenario: Facilitator cannot create a draft session for a team they are a member of

- **WHEN** a facilitator who has an active `team_memberships` row for Team A attempts to create a `draft` session for Team A
- **THEN** the request is rejected (consistent with the facilitator-from-another-team constraint)
- **AND** no `draft` session record is created

---

### Requirement: Post-session access grace window is bounded and read-only

When a session transitions to `complete`, the application SHALL set `sessions.facilitator_access_expires_at = NOW() + INTERVAL '30 minutes'` in the same UPDATE statement that sets `status = 'complete'`. During this window, the facilitator retains read-only access to the team's historical session data, trend data, and action items. After the window expires, the facilitator's Path 3 check fails and access ends.

The expiry check is evaluated in-database: `s.status = 'complete' AND s.facilitator_access_expires_at > NOW()`. No application-level datetime comparison is used; this avoids a TOCTOU gap.

**Grace window constraints:**
- The grace window is read-only. No write operations (adding action items, updating topic configuration, modifying session data) are permitted during the grace window.
- `facilitator_access_expires_at` is set server-side at session completion. It MUST NOT be updatable by the facilitator or any client call. No endpoint accepts `facilitator_access_expires_at` as a request parameter.
- The grace window applies to the most recently completed session row. It does not accumulate across sessions.
- A facilitator whose grace window has expired has no access to the team's data through the facilitator path until a new session is created.

#### Scenario: Facilitator retains read access in the 30 minutes after session close

- **WHEN** a session for Team A transitions to `complete` at time T
- **AND** a facilitator calls `GET /api/v1/teams/team-a-id/sessions` at time T + 15 minutes
- **THEN** the endpoint returns the team's historical data (read-only)

#### Scenario: Facilitator loses access 30 minutes after session close

- **WHEN** a session for Team A transitions to `complete` at time T
- **AND** a facilitator calls `GET /api/v1/teams/team-a-id/sessions` at time T + 31 minutes
- **THEN** the endpoint returns `403 Forbidden`

#### Scenario: Grace window is not extended by the facilitator

- **WHEN** a facilitator's `facilitator_access_expires_at` is set at session completion
- **AND** the facilitator or any client attempts to modify `facilitator_access_expires_at` directly
- **THEN** the request is rejected
- **AND** the expiry time is unchanged

#### Scenario: Grace window is read-only — write attempt during grace window is rejected

- **WHEN** a facilitator within the grace window attempts to add an action item to Team A's session
- **THEN** the endpoint returns `403 Forbidden` for the write operation
- **AND** the facilitator's read access is unaffected

---

### Requirement: Live session error states for facilitators are distinct from general 403/404 responses

The application SHALL provide distinct, named error states for facilitators encountering access control failures during a live session. These error states MUST NOT inherit the general 403/404 error presentation. An authorization failure during a live session is a UX emergency: the facilitator is in a room with participants and cannot navigate away to investigate.

**Implementation note — full-stack E2E coverage (`facilitator-error-states-e2e`):** Error States 1 (both the recoverable and non-recoverable paths), 1a, 1b (backend contract only), 2, 3 (real-trigger case), and 4 have real full-stack test coverage — real Postgres, real Redis, no mocked `db.query` anywhere in the covering tests — run via the existing `integration` CI workflow with no new CI wiring required. Error State 3's coverage is asserted against its real production trigger: a real committed session-state transition (via the topic-advance wrap-up-entry branch or session completion) that publishes `session_state_change` and delivers it to a real subscriber over the actual Redis pub/sub channel, not a directly-invoked function call or a manually-published stand-in event. Error State 3's "system timeout" trigger variant is explicitly not covered by this test suite: no timeout-driven auto-transition mechanism exists anywhere in this codebase, so there is nothing to trigger. The frontend "Required display" behavior each state below describes remains open follow-up work, tracked under GitHub issue #38 — this coverage proves the backend/WebSocket contract these displays will consume, not the UI itself.

**Named error states:**

**Error State 1 — Authorization failure during vote reveal:**
- Trigger: The facilitator triggers the reveal and the backend authorization check fails (unexpected session status transition, server-side error, facilitator's session row not found).
- Required display: An inline error that distinguishes between:
  - *Recoverable:* "The reveal could not be completed. Your session is still active. Try again." — The panel remains visible; the facilitator can retry.
  - *Non-recoverable:* "This session is no longer in an active state. Please review the session status." — The facilitator knows to check session state before retrying.
- MUST NOT display: A generic error modal, a blank results panel, or technical details.

**Error State 1a — Reveal attempted on an already-revealed topic:**
- Trigger: The facilitator triggers reveal for a topic whose `session_topics.status` is already `revealed` (a duplicate click, a stale tab, a race with another reveal request for the same topic).
- Required display: The facilitator's screen renders **indistinguishably from a successful reveal** — the topic's revealed state is shown, using the `revealedAt` timestamp returned with the response. No error modal, toast, or banner implying something went wrong. The facilitator did nothing incorrect; the topic is, and remains, revealed.
- MUST NOT display: Any error chrome, or a message suggesting the reveal failed or must be retried.

**Error State 1b — Topic advance attempted before the current topic is revealed:**
- Trigger: The facilitator attempts to advance to the next topic (or into wrap-up) while the current topic's `session_topics.status` is still `voting`.
- Required display: A blocked-advance state that offers the reveal action directly, rather than requiring the facilitator to back out and locate the reveal control themselves. The response's `requiresReveal: true` field signals this to the client.
- MUST NOT display: A generic error modal, or a dead-end state with no actionable next step.

**Error State 2 — Historical data unavailable during active session:**
- Trigger: The facilitator is viewing historical trend data during the session and an authorization check fails or the data endpoint returns an error.
- Required display: An empty state labeled "Historical data is temporarily unavailable. Your session is still active." — This communicates a transient data issue, not an access denial.
- MUST NOT display: "You do not have access to this data." (This phrasing suggests a session problem and may cause the facilitator to end the session unnecessarily.)

**Error State 3 — Session status transition during live facilitation:**
- Trigger: The session status changes while the facilitator is mid-flow (system timeout, accidental state advance, WebSocket connection drop).
- Required display: A persistent non-blocking banner (not a modal) showing current session state and a clear action: "Session state has changed. [Current state]. Resume or review." The facilitator MUST be able to see the participant grid and topic state while the banner is displayed.
- MUST NOT display: A modal that blocks the screen or hides the session view.

**Error State 4 — Cross-team access denial during active session:**
- Trigger: A facilitator operating across multiple teams attempts to access Team A's history while in a session for Team B.
- Required display: "This data is not available in your current session." — The phrasing communicates a contextual constraint (current session scope) without revealing Team A's existence.
- MUST NOT display: "You do not have access to Team A's session history." (This reveals Team A's existence and that it has session data.)

#### Scenario: Facilitator sees recoverable error when reveal fails transiently

- **WHEN** the facilitator triggers the reveal
- **AND** the backend authorization check fails transiently
- **THEN** the facilitator view shows the recoverable error message
- **AND** the session panel remains visible and the session is still in an active state

#### Scenario: Facilitator sees the revealed state, not an error, on a duplicate reveal

- **WHEN** the facilitator triggers reveal for a topic that is already `revealed`
- **THEN** the facilitator view shows the topic's revealed state, using the `revealedAt` timestamp from the response
- **AND** no error modal, toast, or banner is displayed

#### Scenario: Facilitator can reveal directly from a blocked-advance state

- **WHEN** the facilitator attempts to advance past a topic that has not yet been revealed
- **THEN** the response is rejected with the `advance_blocked` error state and `requiresReveal: true`
- **AND** the facilitator view offers the reveal action directly from the blocked state, without requiring navigation to find it

#### Scenario: Facilitator sees non-blocking banner on unexpected session status change

- **WHEN** the session status changes unexpectedly while the facilitator is mid-flow
- **THEN** a persistent non-blocking banner appears above the session view
- **AND** the facilitator can still see the participant grid and topic state
- **AND** no modal blocks the screen

#### Scenario: Cross-team denial does not reveal other team's existence

- **WHEN** a facilitator in a session for Team B requests historical data for Team A
- **THEN** the response message does not mention Team A by name or confirm Team A has data
- **AND** the facilitator's Team B session is unaffected by the denial

---

### Requirement: Timing oracle — constant minimum response time floor

All content endpoint responses — both authorized and denied — SHALL apply a constant minimum response time floor. The floor MUST be set at no less than the p95 or p99 of authorized-request latency under realistic database load. This eliminates timing side-channels that would allow statistical inference of resource existence from response time distributions.

**Deployment gate:** The floor constant MUST be measured (not estimated) under realistic database load before any content endpoint is deployed to production. The measurement must be performed against the highest-latency content endpoint. Results must be documented in the operations runbook with the measurement date, measured distribution, and selected floor value.

**Known deviation — em-views.ts routes:** As of this change, the EM-specific routes in `em-views.ts` do not apply the timing oracle. This is a pre-production blocking finding. These routes MUST apply the timing floor before any EM content endpoint is deployed to production.

#### Scenario: Denied request is not detectably faster than an authorized request

- **WHEN** a content endpoint receives an unauthorized request
- **THEN** the response time is padded to at least the measured floor value
- **AND** the response time is not statistically distinguishable from an authorized request at the floor percentile
