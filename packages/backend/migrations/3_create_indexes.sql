-- Migration 3: Create all indexes

-- users
CREATE INDEX idx_users_oidc ON users (oidc_subject, oidc_issuer);
CREATE INDEX idx_users_email ON users (email);

-- teams
CREATE INDEX idx_teams_active ON teams (deactivated_at) WHERE deactivated_at IS NULL;

-- team_memberships
CREATE INDEX idx_team_memberships_team_active
    ON team_memberships (team_id)
    WHERE removed_at IS NULL;
CREATE INDEX idx_team_memberships_user_active
    ON team_memberships (user_id)
    WHERE removed_at IS NULL;

-- topics
CREATE INDEX idx_topics_team_active
    ON topics (team_id, display_order)
    WHERE status = 'active';
CREATE INDEX idx_topics_team_all ON topics (team_id, status);
CREATE INDEX idx_topics_default ON topics (is_default) WHERE is_default = true;

-- sessions
CREATE INDEX idx_sessions_team_status ON sessions (team_id, status);
CREATE INDEX idx_sessions_join_token ON sessions (join_token);
CREATE INDEX idx_sessions_team_completed
    ON sessions (team_id, completed_at DESC)
    WHERE status = 'complete';
CREATE INDEX idx_sessions_facilitator_active
    ON sessions (facilitator_id)
    WHERE status IN ('lobby', 'pre_session', 'active', 'wrap_up');

-- session_topics
CREATE INDEX idx_session_topics_session ON session_topics (session_id, display_order);
CREATE INDEX idx_session_topics_topic ON session_topics (topic_id);

-- session_participants
CREATE INDEX idx_session_participants_session ON session_participants (session_id);
CREATE INDEX idx_session_participants_user ON session_participants (user_id);

-- votes
CREATE INDEX idx_votes_session_topic ON votes (session_topic_id);
CREATE INDEX idx_votes_session ON votes (session_id);
CREATE INDEX idx_votes_voter ON votes (voter_id);
CREATE INDEX idx_votes_outliers ON votes (session_topic_id, is_outlier) WHERE is_outlier = true;

-- action_items
CREATE INDEX idx_action_items_team_open
    ON action_items (team_id, created_at)
    WHERE status IN ('open', 'in_progress');
CREATE INDEX idx_action_items_team_all ON action_items (team_id, created_at DESC);
CREATE INDEX idx_action_items_owner ON action_items (owner_id, status);
CREATE INDEX idx_action_items_session ON action_items (session_id);

-- action_item_history
CREATE INDEX idx_action_item_history_item ON action_item_history (action_item_id, changed_at);

-- outlier_threshold_overrides
CREATE UNIQUE INDEX idx_outlier_overrides_team_active
    ON outlier_threshold_overrides (team_id)
    WHERE deactivated_at IS NULL;
