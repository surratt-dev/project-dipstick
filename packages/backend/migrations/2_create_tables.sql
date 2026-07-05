-- Migration 2: Create all application tables in dependency order

CREATE TABLE users (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    oidc_subject        text            NOT NULL,
    oidc_issuer         text            NOT NULL,
    display_name        text            NOT NULL,
    email               text            NOT NULL,
    global_role         user_role       NOT NULL DEFAULT 'engineer',
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    deactivated_at      timestamptz     NULL,
    CONSTRAINT users_oidc_unique UNIQUE (oidc_subject, oidc_issuer)
);

CREATE TABLE teams (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text            NOT NULL,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    created_by_user_id  uuid            NOT NULL REFERENCES users(id),
    deactivated_at      timestamptz     NULL,
    CONSTRAINT teams_name_unique UNIQUE (name)
);

CREATE TABLE team_memberships (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id             uuid            NOT NULL REFERENCES teams(id),
    user_id             uuid            NOT NULL REFERENCES users(id),
    role                membership_role NOT NULL DEFAULT 'participant',
    joined_at           timestamptz     NOT NULL DEFAULT now(),
    removed_at          timestamptz     NULL,
    removed_by_user_id  uuid            NULL REFERENCES users(id),
    CONSTRAINT team_memberships_unique UNIQUE (team_id, user_id)
);

CREATE TABLE application_settings (
    key                 text            PRIMARY KEY,
    value               text            NOT NULL,
    description         text            NOT NULL,
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    updated_by_user_id  uuid            NULL REFERENCES users(id)
);

CREATE TABLE topics (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id                 uuid            NOT NULL REFERENCES teams(id),
    name                    text            NOT NULL,
    prompt                  text            NOT NULL,
    vote_type               vote_type       NOT NULL,
    display_order           integer         NOT NULL DEFAULT 0,
    status                  topic_status    NOT NULL DEFAULT 'active',
    is_default              boolean         NOT NULL DEFAULT false,
    first_session_description text          NULL,
    created_at              timestamptz     NOT NULL DEFAULT now(),
    updated_at              timestamptz     NOT NULL DEFAULT now(),
    archived_at             timestamptz     NULL,
    CONSTRAINT topics_team_order UNIQUE (team_id, display_order, status)
);

CREATE TABLE sessions (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id             uuid            NOT NULL REFERENCES teams(id),
    facilitator_id      uuid            NOT NULL REFERENCES users(id),
    status              session_status  NOT NULL DEFAULT 'lobby',
    join_token          text            NOT NULL,
    is_first_session    boolean         NOT NULL DEFAULT false,
    session_number      integer         NOT NULL DEFAULT 1,
    current_topic_id    uuid            NULL,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    started_at          timestamptz     NULL,
    voting_started_at   timestamptz     NULL,
    wrap_up_started_at  timestamptz     NULL,
    completed_at        timestamptz     NULL,
    abandoned_at        timestamptz     NULL,
    CONSTRAINT sessions_join_token_unique UNIQUE (join_token),
    CONSTRAINT sessions_abandoned_has_timestamp CHECK (
        status != 'abandoned' OR abandoned_at IS NOT NULL
    )
);

-- Add FK for current_topic_id now that sessions table exists
ALTER TABLE sessions ADD CONSTRAINT sessions_current_topic_fk
    FOREIGN KEY (current_topic_id) REFERENCES topics(id);

CREATE TABLE session_topics (
    id                      uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id              uuid                    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    topic_id                uuid                    NOT NULL REFERENCES topics(id),
    display_order           integer                 NOT NULL,
    topic_name              text                    NOT NULL,
    topic_prompt            text                    NOT NULL,
    vote_type               vote_type               NOT NULL,
    status                  session_topic_status    NOT NULL DEFAULT 'waiting',
    revealed_at             timestamptz             NULL,
    completed_at            timestamptz             NULL,
    flagged_for_discussion  boolean                 NOT NULL DEFAULT false,
    discussion_note         text                    NULL,
    CONSTRAINT session_topics_session_order UNIQUE (session_id, display_order),
    CONSTRAINT session_topics_session_topic UNIQUE (session_id, topic_id)
);

CREATE TABLE session_participants (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id     uuid        NOT NULL REFERENCES users(id),
    joined_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT session_participants_unique UNIQUE (session_id, user_id)
);

CREATE TABLE votes (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    session_topic_id    uuid        NOT NULL REFERENCES session_topics(id) ON DELETE CASCADE,
    voter_id            uuid        NOT NULL REFERENCES users(id),
    vote_value          integer     NOT NULL,
    vote_type           vote_type   NOT NULL,
    is_outlier          boolean     NOT NULL DEFAULT false,
    outlier_threshold   numeric(5,2) NULL,
    revealed_at         timestamptz NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
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

CREATE TABLE action_items (
    id                      uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id                 uuid                NOT NULL REFERENCES teams(id),
    session_id              uuid                NOT NULL REFERENCES sessions(id),
    session_topic_id        uuid                NULL REFERENCES session_topics(id),
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
    )
);

CREATE TABLE action_item_history (
    id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    action_item_id      uuid                NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
    changed_by_user_id  uuid                NOT NULL REFERENCES users(id),
    previous_status     action_item_status  NOT NULL,
    new_status          action_item_status  NOT NULL,
    resolution_note     text                NULL,
    session_id          uuid                NULL REFERENCES sessions(id),
    changed_at          timestamptz         NOT NULL DEFAULT now()
);

CREATE TABLE outlier_threshold_overrides (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id             uuid            NOT NULL REFERENCES teams(id),
    threshold_value     numeric(5,2)    NOT NULL,
    set_by_user_id      uuid            NOT NULL REFERENCES users(id),
    created_at          timestamptz     NOT NULL DEFAULT now(),
    deactivated_at      timestamptz     NULL
);
