## MODIFIED Requirements

### Requirement: Application Admin access is limited to administrative data

Application Admins (users with `global_role = 'application_admin'`) SHALL have access to team administrative data endpoints only. They SHALL NOT have access to session content endpoints. This is Option B of the Application Admin access boundary decision (ADR-007 alignment): a blanket admin grant to session content creates an organization-wide surveillance path. Option B prevents this by keeping session content outside the admin's scope unconditionally.

**Administrative data endpoints accessible to Application Admins:**
- Team metadata: `GET /api/v1/teams/:id` (name, creation date, active/archived status)
- Team membership lists: `GET /api/v1/teams/:id/members` (user IDs, display names, assigned roles, join date, active/removed status)
- Role assignments: current `membership_role` for each team member
- Engineering Manager associations: which EM is linked to which team
- Topic configuration metadata: topic names and descriptions, and team-level customizations (not session-scoped). TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`) exposes this data to Application Admins. TOPIC-002 admits every Application Admin whatever their membership on the team, including an admin who is the team's engineering manager (#208, reversing #232), and writes an `admin.topic_config_accessed` row, recording the admin's live membership role, on every admin read it serves (see `topic-customization-lock`, Requirement: The all-topics endpoint uses the standing, org-wide facilitator authorization model, and Requirement: The all-topics endpoint audits every administrator read). Application Admins may also change any team's topic configuration through TOPIC-003..006 whatever their membership, and each such write is audited in the same transaction (BRD FR-8.2). The active-topics endpoint TOPIC-001 (`GET /api/v1/teams/:teamId/topics`) does **not** serve Application Admins. It answers them with `403` and the denied-access audit row described below (see Requirement: The active-topics endpoint admits only non-manager participant members and eligible session facilitators).

**Session content endpoints to which Application Admins are denied:**
- Session history: `GET /api/v1/teams/:id/sessions` and any session-specific sub-resources
- Trend data: `GET /api/v1/teams/:id/trends`
- Action items: `GET /api/v1/teams/:id/action-items`
- Live session state: any endpoint or WebSocket event serving votes, readiness state, or topic-level results
- Discussion notes: any endpoint serving session discussion notes

**Audit logging for Application Admin access:** Every Application Admin read of administrative data SHALL be logged as one row in the `audit_log` table. The row SHALL record `timestamp`, `actor_user_id`, `actor_global_role`, `actor_ip`, `operation` (for example `'admin.membership_list_accessed'`), `team_id`, and an endpoint-specific `metadata` object. Where an operation captures the actor's role set, the row SHALL also record it in `actor_roles`; a NULL `actor_roles` means the role set was not captured for that operation (TOPIC-002's administrator operation captures it; `admin.membership_list_accessed` and `admin.team_detail_accessed` do not). Writes by an Application Admin (membership changes, role assignments, EM associations) are already covered by the manager-team-association spec's audit requirement, and this requirement adds read access logging. For an Application Admin read, the audit row SHALL be written after the data has been read and before the response is sent. If the audit write fails, the request SHALL fail with `500` and the response SHALL contain none of the data read. The guarantee is one-directional: data that was served always has a row, but a row can exist for a response that never reached the client (for example, a client disconnect after the write). Over-recording is the intended direction. (Write-side audit rows keep their own in-transaction rule, which this sentence does not change. This fail-closed rule covers Application Admin reads of administrative data only. It does not set a pattern for facilitator, participant, or live-session paths, where availability during a session takes priority.)

**Audit logging of denied admin access to session content:** Any Application Admin request to a session content endpoint, whatever the response code, MUST be logged in the `audit_log` table with the standard audit fields plus the HTTP status code of the response. The audit entry MUST be written even when the response is 403. The same logging applies to an Application Admin request to TOPIC-001, under the existing operation `admin.session_content_denied` with `metadata.endpoint = "GET /api/v1/teams/:teamId/topics"`. The operation name SHALL NOT be changed, because audit consumers may key on it.

**Audit visibility guard:** `admin.topic_config_accessed` rows, `topic.config_list_denied` rows (and any historical `admin.topic_config_denied` rows) SHALL NOT be exposed through any endpoint or screen available to team members or engineering managers. To make this checkable, no application query that serves a non-administrator caller SHALL select from `audit_log` using a wildcard, prefix, pattern, or `IN` list on `operation` that could match `admin.topic_config_*` or `topic.config_list_denied`. Every such query SHALL filter `operation` by equality on a single named operation.

**Verification of the guard:** The structural test `packages/backend/src/routes/__tests__/audit-log-reader-structural.test.ts` provides mechanical evidence for the filter-shape portion of this obligation: every application touch of `audit_log` other than a column-listed `INSERT` writer is inventoried, and every inventory entry not marked admin-only is a single-table `SELECT` that filters `operation` by equality on one non-protected operation (protected: any `admin.` operation, any `topic.config_` operation) and is scoped by `team_id` or `metadata->>'scopeId'`. The test does not establish that the obligation is met. Which callers a query serves, whether an entry marked admin-only is in fact admin-only, queries the test cannot see (views and functions in migrations, other packages, SQL assembled from fragments), and the correctness of the scope value and the selected columns are verified by review, the Security Analyst role by convention. The repository has no CODEOWNERS file and the spec does not claim an enforced gate. The test header documents the rules and how to extend the inventory.

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

- **WHEN** a user with `global_role = 'application_admin'` and no active membership on the team calls `GET /api/v1/teams/:teamId/topics` (TOPIC-001)
- **THEN** the response is `403` and an `audit_log` row with operation `admin.session_content_denied` and `metadata.endpoint = "GET /api/v1/teams/:teamId/topics"` is written
- **AND** the same user calling `GET /api/v1/teams/:teamId/topics/all` (TOPIC-002) receives the team's topic configuration and exactly one `admin.topic_config_accessed` row is written

#### Scenario: A non-member admin's TOPIC-002 read is audited

- **WHEN** an `application_admin` with no active membership on the team requests TOPIC-002
- **THEN** the response is `200`
- **AND** exactly one `audit_log` row with operation `admin.topic_config_accessed` and `metadata.membership_role = null` is written for the request

#### Scenario: An admin with a participant membership reads TOPIC-002 and is audited

- **WHEN** an `application_admin` with an active `participant` membership on the team requests TOPIC-002
- **THEN** the response is `200`
- **AND** exactly one `admin.topic_config_accessed` row with `metadata.membership_role = "participant"` is written

#### Scenario: An admin who is the team's engineering manager reads TOPIC-002 and is audited

- **WHEN** an `application_admin` with an active `engineering_manager` membership on a team whose topics carry a definition requests TOPIC-002
- **THEN** the response is `200` with the team's topic configuration, including the definitions, and `canEditAnnotations: false`
- **AND** exactly one `audit_log` row with operation `admin.topic_config_accessed` and `metadata.membership_role = "engineering_manager"` is written, containing no definition text
- **AND** no `admin.topic_config_denied` row is written

#### Scenario: A global engineering manager with a participant membership is denied TOPIC-002

- **WHEN** a user with `global_role = 'engineering_manager'` and an active `participant` membership on the team requests TOPIC-002
- **THEN** the response is `403` with the message "Only a facilitator or an application admin can view this team's topic list."
- **AND** `error.category` is "forbidden" and `error.code` is "NOT_A_FACILITATOR"
- **AND** no `admin.*` audit row is written
- **AND** exactly one `audit_log` row with operation `topic.config_list_denied` and `metadata.reason = "NOT_A_FACILITATOR"` is written (see the topic-customization-lock capability)

#### Scenario: A failed admin-read audit write returns no data

- **WHEN** an admitted `application_admin` requests TOPIC-002 and the `admin.topic_config_accessed` insert fails
- **THEN** the response is `500`
- **AND** the response body contains no topic names, topic ids, definitions, or team name

#### Scenario: Application audit-log reads for non-admin callers filter by exact operation

- **WHEN** the backend source is searched for every query that selects from `audit_log` and serves a caller who is not an `application_admin`
- **THEN** each such query filters `operation` by equality on a single named operation
- **AND** none uses a wildcard, prefix, pattern, or `IN` list that could match `admin.topic_config_accessed`, `topic.config_list_denied`, or the retired `admin.topic_config_denied`

#### Scenario: Application audit-log reads are inventoried and non-admin readers filter by exact operation

- **WHEN** the backend production source (`packages/backend/src`) is scanned for every statement that touches `audit_log` other than a column-listed `INSERT INTO audit_log (...)` writer
- **THEN** each touch is listed in the inventory held by the structural test, keyed by file and enclosing function, with a non-blank reason, as `exact-match` or `admin-only`
- **AND** each `exact-match` entry is a single-table `SELECT` that filters `operation` by equality on one string literal that is not a protected operation, with a `team_id` or `metadata->>'scopeId'` conjunct
- **AND** a statement that cannot be classified statically fails the test
- **AND** any other whole-word `audit_log` in production code (a constant, an array of table names, an identifier, error-message prose) fails the test (tripwire) and cannot be inventoried
- **AND** each `admin-only` function is referenced by name (direct, aliased, namespace, string-literal-keyed, or through an exported wrapper in its defining file that the entry lists) from exactly the one file its entry lists as caller, and its statement count matches the entry
- **AND** `admin-only` classification and queries the scanner cannot see (accepted limits) are verified by review, not by the test
