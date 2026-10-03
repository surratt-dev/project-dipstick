## ADDED Requirements

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

## MODIFIED Requirements

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
