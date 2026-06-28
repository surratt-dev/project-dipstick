-- Migration 5: Create join_links table for team membership enrollment

CREATE TABLE join_links (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID            NOT NULL REFERENCES teams(id),
    token       VARCHAR(64)     NOT NULL UNIQUE,
    created_by  UUID            NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ     NOT NULL,
    revoked_at  TIMESTAMPTZ     NULL
);

CREATE INDEX idx_join_links_token ON join_links(token);
