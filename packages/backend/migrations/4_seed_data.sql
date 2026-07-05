-- Migration 4: Seed application settings and default topic definitions
-- Default topics use a sentinel system team (UUID ending in ...0001).
-- Application code copies them (with actual team_id) when creating a team's first session.

-- Up Migration

-- Application settings
INSERT INTO application_settings (key, value, description) VALUES
    ('outlier_threshold_individual', '1.5',
     'Individual vote outlier threshold: a vote deviating from the session average by more than this value is flagged. Applies to finger vote topics only. Default: 1.5.'),
    ('staleness_threshold_sessions', '2',
     'Number of completed sessions without a status change before an action item is flagged stale. Default: 2.'),
    ('trend_chart_minimum_sessions', '3',
     'Minimum number of completed sessions required before a trend chart is rendered. Below this threshold, the chart displays the insufficient data empty state. Default: 3.');

-- System user and team used as owner/container for default topic templates
INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'system',
    'system',
    'System',
    'system@dipstick.internal',
    'application_admin'
);

INSERT INTO teams (id, name, created_by_user_id)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '__default_topics__',
    '00000000-0000-0000-0000-000000000001'
);

-- Default topic templates (is_default = true)
INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, first_session_description) VALUES
(
    '00000000-0000-0000-0000-000000000001',
    'Production Code',
    'How easy is it to add new features to the production code?',
    'finger',
    1,
    true,
    'Rate how straightforward it is to introduce new functionality. A 1 means adding features is painful — the code fights you. A 4 means it is clean and welcoming. Think about the last time you shipped something new.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Test Suite',
    'How effective is the test suite at catching real bugs?',
    'finger',
    2,
    true,
    'A 1 means the tests pass but bugs still reach production regularly, or the suite is so slow and flaky it is not trusted. A 4 means the team genuinely relies on the suite and it catches issues before they ship.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Pipeline',
    'How confident are you in the deployment pipeline?',
    'finger',
    3,
    true,
    'A 1 means deployments are stressful, manual, or unpredictable. A 4 means you can ship at any time with full confidence that the pipeline will catch problems and roll back if needed.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Technology Stack',
    'Are you comfortable with the current technology stack?',
    'roman',
    4,
    true,
    'Vote up if the team is fluent with the languages, libraries, frameworks, and infrastructure in use and they are well-suited to the problem. Vote down if the stack is unfamiliar, poorly suited, or actively getting in the way.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Pairing',
    'How effective is pairing on this team?',
    'finger',
    5,
    true,
    'A 1 means pairing rarely happens, is unbalanced, or leaves people feeling isolated. A 4 means the team pairs regularly, collaboration is balanced, and pair composition rotates well.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Project Trend',
    'Overall, is this project trending up, steady, or down?',
    'modified_roman',
    6,
    true,
    'Vote up if things are genuinely improving — the code is getting cleaner, the team is more capable, delivery is becoming easier. Vote steady if things are holding. Vote down if the trajectory is negative. This is the single most important question in the session.'
);

-- Down Migration

DELETE FROM topics WHERE team_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM teams WHERE id = '00000000-0000-0000-0000-000000000001';
DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000001';
DELETE FROM application_settings WHERE key IN (
    'outlier_threshold_individual',
    'staleness_threshold_sessions',
    'trend_chart_minimum_sessions'
);
