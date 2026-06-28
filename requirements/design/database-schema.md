# PostgreSQL Schema Design
## Engineering Health Check — Persistence Layer

|                   |                                                                    |
|-------------------|--------------------------------------------------------------------|
| **Document Date** | 2026-03-08                                                         |
| **Version**       | 0.3 — all flagged gaps resolved                                   |
| **Status**        | Working Draft — Under Review                                       |
| **Primary Author**| Marcus Oyelaran (Full Stack Engineer)                              |
| **Reviewers**     | Ingrid Sollenberger (Solution Architect), Marcus Delgado (Business Analyst) |

---

## Overview

This document defines the complete PostgreSQL schema for the Engineering Health Check application. PostgreSQL is the system of record for all data that must survive a process restart. It owns nothing ephemeral. It does not hold in-flight vote values during a live session, participant connection states, or readiness indicators — those live in Redis and are explicitly documented in the companion Redis session model document.

Every table in this schema has a clear rationale. Every index has a stated purpose. Every design decision that touched a requirement or constraint is annotated.

---

## Enum Types

Enum types are defined first because table definitions reference them. Using PostgreSQL enum types (rather than unconstrained text columns) means the database enforces valid values independently of application code.

```sql
-- User role within the application
CREATE TYPE user_role AS ENUM (
    'engineer',
    'senior_engineer',
    'facilitator',
    'engineering_manager',
    'application_admin'
);

-- A user may have multiple roles if they are both a facilitator and an engineer on their own team.
-- The role column on users captures their primary/global role. Team-specific role overrides
-- (e.g., an engineer who is also assigned as EM for a particular team) are handled through
-- team_memberships.

-- Vote type, configured per topic
CREATE TYPE vote_type AS ENUM (
    'finger',           -- 1–4 integer scale
    'roman',            -- up / down (binary)
    'modified_roman'    -- up / steady / down (trend only)
);

-- Session lifecycle state
CREATE TYPE session_status AS ENUM (
    'lobby',            -- Created; participants joining; voting not yet started
    'pre_session',      -- Pre-session action item review phase
    'active',           -- Live voting in progress
    'wrap_up',          -- All topics complete; facilitator reviewing and creating action items
    'complete',         -- Session finalized; read-only
    'abandoned'         -- Session abandoned (e.g., Redis unavailable for 5+ minutes)
);

-- Action item lifecycle state
CREATE TYPE action_item_status AS ENUM (
    'open',
    'in_progress',
    'resolved'
);

-- Topic lifecycle state (soft-delete approach for history preservation)
CREATE TYPE topic_status AS ENUM (
    'active',
    'archived'
);

-- Session-topic lifecycle state (the state of a single topic within a live session)
CREATE TYPE session_topic_status AS ENUM (
    'waiting',      -- Topic is queued; facilitator has not yet advanced to it
    'voting',       -- Facilitator has advanced to this topic; participants are voting
    'revealed',     -- Facilitator has triggered the reveal; votes are visible
    'complete'      -- Facilitator has advanced past this topic; it is finalized
);

-- Team membership role (a user can be a participant on one team and an EM on another)
CREATE TYPE membership_role AS ENUM (
    'participant',          -- Eligible to vote in this team's sessions
    'engineering_manager'   -- Read-only access to this team's data; cannot vote
);
```

---

## Tables

### `users`

Stores the application-managed identity record for every authenticated user. The application never stores passwords — authentication is fully delegated to the OIDC provider. This table holds the claims resolved from the OIDC token and the application role assigned to the user.

```sql
CREATE TABLE users (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    oidc_subject        text            NOT NULL,
    oidc_issuer         text            NOT NULL,
    display_name        text            NOT NULL,
    email               text            NOT NULL,
    global_role         user_role       NOT NULL DEFAULT 'engineer',
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    deactivated_at      timestamptz     NULL       -- NULL means active; set when user is removed from org

    CONSTRAINT users_oidc_unique UNIQUE (oidc_subject, oidc_issuer)
);

-- Index: identity lookup on every authentication
-- Every request with a valid session cookie resolves the OIDC subject+issuer pair to a user record.
CREATE INDEX idx_users_oidc ON users (oidc_subject, oidc_issuer);

-- Index: email lookup for display and de-duplication
CREATE INDEX idx_users_email ON users (email);
```

**Design rationale:**

The combination of `oidc_subject` + `oidc_issuer` is the unique stable identifier from the identity provider. Using both columns is required for correctness: a `sub` claim is only unique within a given issuer, not globally. If the organization ever migrates OIDC providers, a new issuer means new `sub` values, and users can be reconciled via email rather than silently creating duplicates.

`deactivated_at` enables soft-delete. When a user leaves the organization, their record is deactivated rather than deleted. This preserves referential integrity for historical sessions, votes, and action items that reference the user.

`global_role` captures the user's application-level role. Most authorization decisions also require consulting `team_memberships` for team-specific context.

---

### `teams`

Stores the engineering teams that use the application. Teams are the primary organizational unit around which sessions, topics, and action items are organized.

```sql
CREATE TABLE teams (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text            NOT NULL,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    created_by_user_id  uuid            NOT NULL REFERENCES users(id),
    deactivated_at      timestamptz     NULL   -- NULL means active team

    CONSTRAINT teams_name_unique UNIQUE (name)
);

-- Index: active teams listing (common query for admin and session setup views)
CREATE INDEX idx_teams_active ON teams (deactivated_at) WHERE deactivated_at IS NULL;
```

**Design rationale:**

`created_by_user_id` records who created the team. Per the BRD, any authenticated user can create a team — there is no admin-only constraint on creation, only on session facilitation.

The unique constraint on `name` prevents confusion from duplicate team names but is the most likely constraint to require re-evaluation if team names need to change.

---

### `team_memberships`

The junction table between users and teams. A user can be a member of multiple teams. Their role (participant vs. engineering manager) is team-specific and independent of their global role.

```sql
CREATE TABLE team_memberships (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id             uuid            NOT NULL REFERENCES teams(id),
    user_id             uuid            NOT NULL REFERENCES users(id),
    role                membership_role NOT NULL DEFAULT 'participant',
    joined_at           timestamptz     NOT NULL DEFAULT now(),
    removed_at          timestamptz     NULL,   -- NULL means currently active member
    removed_by_user_id  uuid            NULL REFERENCES users(id)

    CONSTRAINT team_memberships_unique UNIQUE (team_id, user_id)
);

-- Index: find all current members of a team (used for session participant resolution and action item owner selectors)
CREATE INDEX idx_team_memberships_team_active
    ON team_memberships (team_id)
    WHERE removed_at IS NULL;

-- Index: find all teams a user belongs to (used for authorization checks)
CREATE INDEX idx_team_memberships_user_active
    ON team_memberships (user_id)
    WHERE removed_at IS NULL;
```

**Design rationale:**

Soft-delete (via `removed_at`) is essential here. When a user leaves a team, their membership record must not be deleted: historical sessions and action items reference their participation. The `removed_at` field distinguishes former members from current ones in queries.

`removed_by_user_id` provides an audit trail for membership changes, important for the facilitator reassignment use case where historical ownership must be traceable.

The UNIQUE constraint on `(team_id, user_id)` is intentionally on the active membership. If re-adding a previously removed user is required, the application should update the existing row (clear `removed_at`) rather than insert a new one, to preserve history. Alternatively, a partial unique index on active records may be preferable — this is flagged as an open design question.

---

### `application_settings`

A key-value store for global application configuration values that must be auditable and changeable without a code deployment. This includes the outlier detection threshold (explicitly required by FR-5.2 to not be a magic number in code).

```sql
CREATE TABLE application_settings (
    key                 text            PRIMARY KEY,
    value               text            NOT NULL,
    description         text            NOT NULL,
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    updated_by_user_id  uuid            NULL REFERENCES users(id)
);

-- Seed data (initial values; managed by the migration system)
-- INSERT INTO application_settings (key, value, description) VALUES
--     ('outlier_threshold_individual', '1.5',
--      'Individual vote outlier threshold: a vote deviating from the session average by more than
--       this value is flagged. Applies to finger vote topics only. Default: 1.5.'),
--     ('staleness_threshold_sessions', '2',
--      'Number of completed sessions without a status change before an action item is flagged stale.
--       Default: 2.'),
--     ('trend_chart_minimum_sessions', '3',
--      'Minimum number of completed sessions required before a trend chart is rendered.
--       Below this threshold, the chart displays the insufficient data empty state. Default: 3.');
```

**Design rationale:**

FR-5.2 is explicit: the outlier threshold must not be a magic number. It must be visible, auditable, and changeable without a code deployment. A dedicated settings table is the correct solution. The seed values are deployed via the migration system, not hardcoded in application logic.

---

### `topics`

The canonical topic definitions. Each team has a set of topics. The default topic set is seeded for all new teams. When a topic is archived, its historical data is preserved — the `topic_status` column transitions from `active` to `archived` rather than deleting the row.

```sql
CREATE TABLE topics (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id             uuid            NOT NULL REFERENCES teams(id),
    name                text            NOT NULL,
    prompt              text            NOT NULL,
    vote_type           vote_type       NOT NULL,
    display_order       integer         NOT NULL DEFAULT 0,
    status              topic_status    NOT NULL DEFAULT 'active',
    is_default          boolean         NOT NULL DEFAULT false,
    first_session_description text      NULL,  -- Extended description shown only in first-session mode
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    archived_at         timestamptz     NULL   -- Set when status transitions to 'archived'

    CONSTRAINT topics_team_order UNIQUE (team_id, display_order, status)
);

-- Index: active topics for a team (used for session setup and topic management views)
CREATE INDEX idx_topics_team_active
    ON topics (team_id, display_order)
    WHERE status = 'active';

-- Index: all topics for a team (used for trend dashboard, including archived)
CREATE INDEX idx_topics_team_all ON topics (team_id, status);

-- Index: default topics (used to seed new teams)
CREATE INDEX idx_topics_default ON topics (is_default) WHERE is_default = true;
```

**Design rationale:**

Soft-archive (via `status` and `archived_at`) is the explicit requirement from FR-8.3: removing a topic from the active list must not delete its historical data. The trend dashboard shows archived topics via a toggle; both active and archived topics share this table.

`display_order` controls the order in which topics are presented during a session. The UNIQUE constraint on `(team_id, display_order, status)` prevents two active topics from occupying the same position.

`is_default` marks topics that are part of the canonical default set. The default set is seeded by the migration system and can be restored for any team at any time (FR-8.6) by querying `is_default = true` topics and re-adding any that a team has removed.

`first_session_description` holds the expanded description shown only during a team's first session (OR-5.2). It is on the topic record, not a separate table, because it is a property of the topic itself.

---

### `sessions`

Each Engineering Health Check session run for a team. The session record is the primary organizing entity — votes, discussion notes, and action items all reference a session.

```sql
CREATE TABLE sessions (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id             uuid            NOT NULL REFERENCES teams(id),
    facilitator_id      uuid            NOT NULL REFERENCES users(id),
    status              session_status  NOT NULL DEFAULT 'lobby',
    join_token          text            NOT NULL,
    is_first_session    boolean         NOT NULL DEFAULT false,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    started_at          timestamptz     NULL,    -- Set when facilitator transitions from lobby to pre_session
    voting_started_at   timestamptz     NULL,    -- Set when facilitator transitions from pre_session to active
    wrap_up_started_at  timestamptz     NULL,    -- Set when final topic is advanced
    completed_at        timestamptz     NULL,    -- Set when facilitator marks session complete
    abandoned_at        timestamptz     NULL,    -- Set if Redis is unavailable for 5+ minutes
    current_topic_id    uuid            NULL REFERENCES topics(id),  -- Which topic is currently active
    session_number      integer         NOT NULL DEFAULT 1,          -- Ordinal within the team's session history

    CONSTRAINT sessions_join_token_unique UNIQUE (join_token),
    CONSTRAINT sessions_no_concurrent CHECK (
        -- Enforced at application layer, but the constraint makes it explicit:
        -- only application logic can prevent two active sessions for the same team simultaneously.
        -- This CHECK cannot express that constraint; the application layer enforces it.
        status != 'abandoned' OR abandoned_at IS NOT NULL
    )
);

-- Index: find active sessions for a team (used during join and facilitator access)
CREATE INDEX idx_sessions_team_status ON sessions (team_id, status);

-- Index: join token lookup (used on every participant join request)
CREATE INDEX idx_sessions_join_token ON sessions (join_token);

-- Index: session history for a team (Trend Dashboard, session history view)
CREATE INDEX idx_sessions_team_completed
    ON sessions (team_id, completed_at DESC)
    WHERE status = 'complete';

-- Index: facilitator's active sessions (facilitator reconnection)
CREATE INDEX idx_sessions_facilitator_active
    ON sessions (facilitator_id)
    WHERE status IN ('lobby', 'pre_session', 'active', 'wrap_up');
```

**Design rationale:**

`join_token` is the unique, non-guessable string used to construct the join link (FR-2.3). It must be globally unique and generated with sufficient entropy that it cannot be guessed. The application generates this value; the UNIQUE constraint enforces it at the database level.

`is_first_session` enables first-session mode (OR-5.1 through OR-5.5) without requiring a query to count prior sessions on every page load. It is set at session creation time based on whether any prior completed sessions exist for the team.

`current_topic_id` is a convenience pointer to the currently active topic. It is nullable (no topic active in lobby/pre-session/wrap-up/complete states). This column is on the session rather than derived from Redis because it is needed for reconnection recovery and persists across the session lifecycle.

`session_number` is the ordinal count of this session in the team's history (1st, 2nd, 3rd...). Used for display in the trend dashboard and action item backlog ("Created in session 4"). Computed at session creation from the count of prior completed sessions for the team.

Multiple `*_at` timestamp columns reflect the session's stage history. This is preferable to a single `updated_at` because trend analysis queries may need to know how long sessions stayed in each phase (facilitator briefing, operational monitoring).

---

### `session_topics`

A snapshot of the topics included in a session, in the order they were presented. This is a copy of the team's topic configuration at session creation time, not a live reference. If a topic is archived after a session, the session history still accurately reflects what was covered.

```sql
CREATE TABLE session_topics (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid            NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    topic_id            uuid            NOT NULL REFERENCES topics(id),
    display_order       integer         NOT NULL,
    topic_name          text            NOT NULL,   -- Snapshot: name at session time
    topic_prompt        text            NOT NULL,   -- Snapshot: prompt text at session time
    vote_type           vote_type       NOT NULL,   -- Snapshot: vote type at session time
    status              session_topic_status NOT NULL DEFAULT 'waiting',
    revealed_at         timestamptz     NULL,
    completed_at        timestamptz     NULL,
    flagged_for_discussion boolean      NOT NULL DEFAULT false,
    discussion_note     text            NULL,

    CONSTRAINT session_topics_session_order UNIQUE (session_id, display_order),
    CONSTRAINT session_topics_session_topic UNIQUE (session_id, topic_id)
);

-- Index: topics for a session, in order (used throughout live session)
CREATE INDEX idx_session_topics_session ON session_topics (session_id, display_order);

-- Index: find all session appearances of a specific topic (Trend Dashboard)
CREATE INDEX idx_session_topics_topic ON session_topics (topic_id);
```

**Design rationale:**

Snapshotting the topic name and prompt at session time is important for historical accuracy. If the team changes a topic's prompt after a session, the historical session record should reflect what participants actually saw and voted on, not the current prompt text. The `topic_id` foreign key to `topics` is retained for cross-referencing the trend dashboard, but the displayed data comes from the snapshot columns.

`discussion_note` is stored directly on `session_topics` rather than in a separate `discussion_notes` table. The data model in the architecture document includes `DiscussionNote` as an entity, but the use cases make clear that each topic in a session has at most one discussion note (the facilitator's text). A separate table would be appropriate if multiple notes per topic were possible — they are not, per the current requirements.

`flagged_for_discussion` is the boolean the facilitator sets after a reveal to mark a topic for follow-up discussion. It persists on the record and is visible in session history (FR-5.6).

---

### `session_participants`

Records which users participated in each session. This is the authoritative participation record written at session completion time (or progressively as participants join and lock in).

```sql
CREATE TABLE session_participants (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid            NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id             uuid            NOT NULL REFERENCES users(id),
    joined_at           timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT session_participants_unique UNIQUE (session_id, user_id)
);

-- Index: participants in a session (used for results display, action item owner selector)
CREATE INDEX idx_session_participants_session ON session_participants (session_id);

-- Index: sessions a user participated in (used for user-facing session history view)
CREATE INDEX idx_session_participants_user ON session_participants (user_id);
```

**Design rationale:**

`session_participants` is populated when a user joins a session (via the join token). It is the permanent record used by session history views to show "who participated." The ephemeral connection state (connected vs. disconnected vs. reconnected) lives exclusively in Redis during the live session and is not written to PostgreSQL — only the fact of participation is recorded here.

FR-4.10 states that a participant who joins after a topic's reveal has already occurred is not retroactively added as a voter for that topic. The `joined_at` timestamp enables this determination. Votes table records only locked-in votes for topics where the participant was present before the reveal.

---

### `votes`

The permanent vote record. Votes are written to this table when the facilitator triggers the reveal for a topic. Pre-reveal votes exist only in Redis.

This is the most security-sensitive table in the schema. Several constraints and design choices directly enforce the ritual integrity requirements.

```sql
CREATE TABLE votes (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid            NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    session_topic_id    uuid            NOT NULL REFERENCES session_topics(id) ON DELETE CASCADE,
    voter_id            uuid            NOT NULL REFERENCES users(id),
    vote_value          integer         NOT NULL,
    -- For finger vote: 1, 2, 3, 4
    -- For roman vote: 1 (up/good), -1 (down/bad)
    -- For modified roman vote: 1 (up/trending positive), 0 (steady), -1 (down/trending negative)
    vote_type           vote_type       NOT NULL,
    is_outlier          boolean         NOT NULL DEFAULT false,
    outlier_threshold   numeric(5,2)    NULL,  -- The threshold value used when outlier was computed
    revealed_at         timestamptz     NOT NULL,
    created_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT votes_session_topic_voter UNIQUE (session_topic_id, voter_id),
    CONSTRAINT votes_finger_range CHECK (
        vote_type != 'finger' OR vote_value BETWEEN 1 AND 4
    ),
    CONSTRAINT votes_roman_values CHECK (
        vote_type != 'roman' OR vote_value IN (1, -1)
    ),
    CONSTRAINT votes_modified_roman_values CHECK (
        vote_type != 'modified_roman' OR vote_value IN (1, 0, -1)
    )
);

-- Index: all votes for a topic reveal (primary read pattern at reveal time)
CREATE INDEX idx_votes_session_topic ON votes (session_topic_id);

-- Index: all votes in a session (session history detail view)
CREATE INDEX idx_votes_session ON votes (session_id);

-- Index: votes by a user (individual history — used carefully, restricted to authorized contexts)
CREATE INDEX idx_votes_voter ON votes (voter_id);

-- Index: outlier flags (facilitator post-reveal view, session history)
CREATE INDEX idx_votes_outliers ON votes (session_topic_id, is_outlier) WHERE is_outlier = true;
```

**Design rationale:**

`vote_value` uses a single integer column with type-specific CHECK constraints. Alternative approaches (separate columns per vote type, or storing a text label) were considered and rejected:

- Separate columns: introduces nullability complexity and makes aggregate queries messier.
- Text label: loses the ability to compute numeric aggregates (mean for finger votes) directly in SQL.
- Single integer with encoding: consistent, queryable, enforced by constraints. The encoding (1/-1 for roman, 1/0/-1 for modified roman) is documented in the column comment and in the shared TypeScript type layer.

`is_outlier` and `outlier_threshold` are stored on the vote record at the time of the reveal computation (FR-5.6: the outlier flag must persist on the session record and be visible in history). `outlier_threshold` captures the threshold value actually used, providing an audit trail if the threshold is changed over time.

`revealed_at` records when the reveal occurred. This is the timestamp included in the reveal event payload sent to clients (FR-4.6.1). Storing it here means the reveal timing is part of the permanent audit record.

The UNIQUE constraint on `(session_topic_id, voter_id)` enforces that each participant votes at most once per topic. This is a database-level enforcement of a ritual integrity property.

---

### `action_items`

The persistent record of action items created during or after sessions. Action items are never deleted — they are resolved. This is explicitly required by FR-7.1.

```sql
CREATE TABLE action_items (
    id                      uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id                 uuid                NOT NULL REFERENCES teams(id),
    session_id              uuid                NOT NULL REFERENCES sessions(id),
    -- The session in which this action item was created
    session_topic_id        uuid                NULL REFERENCES session_topics(id),
    -- NULL if the action item is not associated with a specific topic (session-level item)
    owner_id                uuid                NOT NULL REFERENCES users(id),
    description             text                NOT NULL,
    status                  action_item_status  NOT NULL DEFAULT 'open',
    resolution_note         text                NULL,
    resolved_in_session_id  uuid                NULL REFERENCES sessions(id),
    created_at              timestamptz         NOT NULL DEFAULT now(),
    updated_at              timestamptz         NOT NULL DEFAULT now(),

    CONSTRAINT action_items_description_nonempty CHECK (length(trim(description)) > 0),
    CONSTRAINT action_items_resolution_note_length CHECK (
        resolution_note IS NULL OR length(resolution_note) <= 500
    ),
    CONSTRAINT action_items_resolved_has_session CHECK (
        status != 'resolved' OR resolved_in_session_id IS NOT NULL
        -- When resolved, the resolving session must be recorded. This is enforced at the
        -- application layer; the constraint serves as a schema-level assertion.
    )
);

-- Index: open/in-progress items for a team (pre-session review, action item backlog)
CREATE INDEX idx_action_items_team_open
    ON action_items (team_id, created_at)
    WHERE status IN ('open', 'in_progress');

-- Index: all items for a team (full backlog view including resolved)
CREATE INDEX idx_action_items_team_all ON action_items (team_id, created_at DESC);

-- Index: items owned by a user (engineer's personal action item view)
CREATE INDEX idx_action_items_owner ON action_items (owner_id, status);

-- Index: items created in a session (session history detail, wrap-up recovery)
CREATE INDEX idx_action_items_session ON action_items (session_id);
```

**Design rationale:**

`session_topic_id` is nullable. The use cases allow action items to be created at the session level during wrap-up, not necessarily tied to a specific topic. When a topic is flagged for discussion and produces an action item, the topic reference is preserved. For items created in the general wrap-up flow, `session_topic_id` is NULL.

`resolved_in_session_id` records which session the item was resolved in. This is required by the use cases (action item history must show the session of resolution) and enables staleness computation (sessions elapsed since resolution).

The CHECK constraint on `action_items_resolved_has_session` is aspirational — PostgreSQL CHECK constraints cannot enforce foreign key integrity at the application level, and the constraint is not fully enforceable in pure SQL without a trigger. It is included as schema documentation of intent; the application layer must enforce it.

Resolution note length is capped at 500 characters, matching the use case guidance ("a brief note").

---

### `action_item_history`

An audit log of status changes on action items. Required by the "View the History of a Specific Action Item" use case, which requires a chronological log of status changes with actor attribution.

```sql
CREATE TABLE action_item_history (
    id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    action_item_id      uuid                NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
    changed_by_user_id  uuid                NOT NULL REFERENCES users(id),
    previous_status     action_item_status  NOT NULL,
    new_status          action_item_status  NOT NULL,
    resolution_note     text                NULL,   -- Captured at this history point if status is 'resolved'
    session_id          uuid                NULL REFERENCES sessions(id),
    -- NULL if the change occurred outside a session context
    changed_at          timestamptz         NOT NULL DEFAULT now()
);

-- Index: history for an action item (action item detail view)
CREATE INDEX idx_action_item_history_item ON action_item_history (action_item_id, changed_at);
```

**Design rationale:**

The use case explicitly requires showing who made each status change and in which session. A separate history table is the correct pattern: it allows the current state to live on `action_items` while preserving a full audit trail. Writing a history record on every status change is the application's responsibility; the schema enforces only that the data is there when written.

---

### `outlier_threshold_overrides`

Per-team outlier threshold overrides. The default threshold lives in `application_settings`. FR-5.3 (preference) allows the threshold to be overridable per team.

```sql
CREATE TABLE outlier_threshold_overrides (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id             uuid            NOT NULL REFERENCES teams(id),
    threshold_value     numeric(5,2)    NOT NULL,
    set_by_user_id      uuid            NOT NULL REFERENCES users(id),
    created_at          timestamptz     NOT NULL DEFAULT now(),
    deactivated_at      timestamptz     NULL,  -- NULL means currently active override

    CONSTRAINT outlier_threshold_overrides_team_active UNIQUE (team_id)
    -- Only one active override per team. The UNIQUE constraint enforces this only
    -- when deactivated_at is NULL; partial index would be cleaner:
);

-- Cleaner enforcement: one active override per team
CREATE UNIQUE INDEX idx_outlier_overrides_team_active
    ON outlier_threshold_overrides (team_id)
    WHERE deactivated_at IS NULL;
```

**Design rationale:**

Keeping overrides in a separate table rather than adding a nullable column to `teams` makes it explicit that this is optional configuration. The active override for a team is determined at query time: if a record exists in this table with `deactivated_at IS NULL`, it takes precedence over the application-level setting.

---

## Data Retention

Per the architecture document, all session data is retained for 15 months from session completion. The retention policy is implemented as a scheduled background task that deletes sessions (and cascades to votes, session_topics, session_participants, action_items) where `completed_at < now() - interval '15 months'`.

The `ON DELETE CASCADE` foreign key constraints on child tables ensure that deleting a session atomically removes all associated records. Action items are explicitly included in the cascade — items open at deletion time are deleted regardless of status (per Section 5.4 of the architecture document).

Cascading delete relationships:
- `sessions` → `session_topics` (ON DELETE CASCADE)
- `sessions` → `session_participants` (ON DELETE CASCADE)
- `sessions` → `votes` (via `session_id`, ON DELETE CASCADE)
- `session_topics` → `votes` (via `session_topic_id`, ON DELETE CASCADE)
- `sessions` → `action_items` (ON DELETE CASCADE)
- `action_items` → `action_item_history` (ON DELETE CASCADE)

---

## Schema Migration Notes

All schema changes are managed through a versioned migration system (e.g., Flyway or node-pg-migrate). Migrations are version-controlled alongside application source code. No schema change is applied by hand.

Initial seed data applied in migrations:
- Default topic set (5 topics: Production Code, Test Suite, Pipeline, Technology Stack, Pairing — with vote types, prompts, and first-session descriptions)
- Application settings (outlier threshold: 1.5, staleness threshold: 2 sessions, trend chart minimum: 3 sessions)

---

## Architectural Validation Notes — Ingrid Sollenberger

**Redis/PostgreSQL boundary compliance:** This schema contains no fields that replicate live-session ephemeral state. There is no `connection_status` column on `session_participants`, no `vote_locked` boolean on `votes`, no `readiness_state` anywhere in PostgreSQL. The ephemeral state boundary is clean. I checked every table for fields that would be written during a live session and found none that belong in Redis.

**Orphaned key risk:** The `sessions` table records `status` and the timestamp columns for each phase transition. A session that is abandoned (Redis unavailable for 5 minutes, per NFR-REL-004) sets `status = 'abandoned'` and `abandoned_at` in PostgreSQL at the time of abandonment. This means abandoned sessions are not orphaned — they have a clean, queryable state in the permanent record.

**No application-specific partitioning:** At the anticipated data volume (multiple teams, bi-weekly sessions, 15-month retention), table sizes do not justify partitioning. The indexes are sufficient. This should be revisited if the application scales to dozens of teams running frequent sessions.

**Backup and point-in-time recovery:** The architecture document (NFR-DATA-006) requires a documented backup and PITR procedure before production use. This schema has no specific impact on that requirement, but the `completed_at` timestamp on sessions is the natural recovery checkpoint: restoring to a point before `completed_at` allows recovery of in-progress sessions if PostgreSQL itself fails during a session completion write.

**Audit log completeness:** The `action_item_history` table covers action item changes. Vote records include `revealed_at`. Session phase transitions have timestamp columns. WebSocket-level audit events (joins, locks, reveals) are logged to the structured log, not to a database table — this is appropriate; the database is not a logging backend.

**Reviewed and confirmed:** The schema as designed is consistent with the documented Redis/PostgreSQL boundary, does not conflate ephemeral and persistent data, and supports the retention policy and recovery requirements.

---

## Domain Validation Notes — Marcus Delgado

**Simultaneous reveal integrity (FR-4.6):** The `votes` table is populated at reveal time, not at lock-in time. Pre-reveal votes exist only in Redis. There is no column in this schema that would allow a client-visible pre-reveal vote value. The schema enforces the boundary correctly.

**Topic history preservation (FR-8.3):** The `topics` table uses soft-archive (`status = 'archived'`), not deletion. The `session_topics` table snapshots topic name and prompt at session time. Both requirements are met: historical sessions show what was voted on, and the topic record remains in the database for trend queries.

**Action item continuity (FR-7.1 through FR-7.6):**
- Action items are never deleted (no hard-delete path exists in the schema; retention cascade after 15 months is the only deletion path).
- `action_item_history` satisfies the history view requirement.
- `owner_id` references `users(id)`, and `team_memberships` provides the mechanism to detect former members (via `removed_at`).
- Staleness is computable from `action_items.updated_at` and the count of completed sessions for the team since that date. This requires a query, not a stored field — consistent with the use case notes recommending against storing staleness as a persistent field.

**Facilitator cross-team constraint (FR-2.2, FR-6.3):** The schema does not enforce the facilitator cross-team constraint at the database level — it is enforced by application logic. The schema does make it queryable: checking whether `sessions.facilitator_id` has an active membership in `sessions.team_id` via `team_memberships` is a straightforward query. A database-level constraint would require a trigger and is unnecessary if the application enforces it at the API layer.

**Engineering manager cannot vote (FR-1.4):** The `membership_role` enum includes `engineering_manager`. The application enforces the no-vote rule at the API layer. The schema supports the check: a user's `team_memberships.role` for the session's team determines eligibility. No vote record can be created for a user with `engineering_manager` membership on the target team — this is enforced by the application before writing to the `votes` table.

**Vote calculation from actual submissions (not total participants):** Aggregates are computed from the `votes` table for a given `session_topic_id`. Participants who did not vote have no row. Counting rows gives the actual voter count. This is the correct computation — not joining against `session_participants` for a total denominator.

**Gaps flagged:**
- ~~`session_topics.status` used `text` rather than an enum type.~~ Resolved: `session_topic_status` enum added (`waiting`, `voting`, `revealed`, `complete`); the column now uses it.
- ~~Action item drafts are indistinguishable from finalized action items in the current schema.~~ Resolved: an `is_draft` column is not warranted. Action items created during wrap-up exist only for the duration of the wrap-up phase — a short, facilitator-controlled window that ends when the session is marked complete. Draft visibility is enforced at the API layer by filtering backlog queries to `sessions.status = 'complete'`. Given the brief lifecycle, schema-level draft tracking would add complexity without meaningful benefit. Decision documented; no schema change required.
- The `session_number` column on `sessions` is computed at creation time from prior session count. If a session is abandoned and a new one is created, the numbering may develop gaps. This is acceptable behavior but should be documented as expected.
