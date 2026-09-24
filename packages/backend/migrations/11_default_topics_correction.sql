-- Migration 11: Correct the default topic seed to the twelve topics required
-- by the Topic Management use case's Acceptance Criteria (requirements/use
-- cases/08 - Topic Management - Use Cases.md, line 39).
--
-- Migration 4 seeded six default topics for the sentinel `__default_topics__`
-- team, collapsing "Production Code" and "Test Suite" to a single row each
-- where the AC requires four facets apiece. This migration deletes those six
-- rows and re-inserts the correct twelve, in the same shape as migration 4.
--
-- Item 12's `prompt` is resolved per assess-review.md (Marcus Delgado, BA):
-- the AC's "Project Trend" bullet is the topic label, not literal on-screen
-- prompt text. `name = 'Project Trend'` carries the label; `prompt` keeps the
-- existing seed's full question, "Overall, is this project trending up,
-- steady, or down?", verified character-for-character against migration 4.

-- Up Migration

DELETE FROM topics WHERE team_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, first_session_description) VALUES
(
    '00000000-0000-0000-0000-000000000001',
    'Production Code — Adding Features',
    'How easy is it to add features to production code?',
    'finger',
    1,
    true,
    'Rate how straightforward it is to introduce new functionality. A 1 means adding features is painful — the code fights you. A 4 means it is clean and welcoming. Think about the last time you shipped something new.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Production Code — Reasoning',
    'How easy is it to reason about production code?',
    'finger',
    2,
    true,
    'A 1 means understanding what a piece of code does, and why, takes real excavation — tribal knowledge, guesswork, or archaeology through git blame. A 4 means the code explains itself and a newcomer could trace the logic unaided.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Production Code — Active Development',
    'How would you rate the code under active development?',
    'finger',
    3,
    true,
    'Rate the code you and the team are actively working in right now — this sprint, this quarter. A 1 means the code you touch day to day is a struggle. A 4 means it''s a pleasure to work in.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Production Code — Entire Project',
    'How would you rate the code for the entirety of the project?',
    'finger',
    4,
    true,
    'Rate the codebase as a whole, including the parts nobody has touched in a year. A 1 means there are corners of this project nobody wants to open. A 4 means the whole thing, not just the parts you''re in this week, holds up.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Test Suite — Effectiveness',
    'Is the test suite effective?',
    'finger',
    5,
    true,
    'A 1 means the tests pass but bugs still reach production regularly, or the suite is so slow and flaky it is not trusted. A 4 means the team genuinely relies on the suite and it catches issues before they ship.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Test Suite — Consistency',
    'Is the test suite consistent?',
    'roman',
    6,
    true,
    'Vote up if the suite behaves the same way every run — same input, same result, no flake. Vote down if tests pass or fail unpredictably and the team has learned to re-run before trusting a red build.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Test Suite — Active Development',
    'How would you rate the tests under active development?',
    'finger',
    7,
    true,
    'Rate the tests covering the code you''re actively working in. A 1 means you''re shipping into areas with thin or absent coverage. A 4 means the code you touch day to day is well protected.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Test Suite — Entire Project',
    'How would you rate the tests for the entirety of the project?',
    'finger',
    8,
    true,
    'Rate test coverage across the whole codebase, not just the parts in active development. A 1 means large areas are effectively untested. A 4 means the whole project has a safety net, not just the parts getting attention lately.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Pipeline',
    'Confidence in the pipeline',
    'finger',
    9,
    true,
    'A 1 means deployments are stressful, manual, or unpredictable. A 4 means you can ship at any time with full confidence that the pipeline will catch problems and roll back if needed.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Technology Stack',
    'Are you comfortable with the technology stack?',
    'roman',
    10,
    true,
    'Vote up if the team is fluent with the languages, libraries, frameworks, and infrastructure in use and they are well-suited to the problem. Vote down if the stack is unfamiliar, poorly suited, or actively getting in the way.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Pairing',
    'How effective is pairing?',
    'finger',
    11,
    true,
    'A 1 means pairing rarely happens, is unbalanced, or leaves people feeling isolated. A 4 means the team pairs regularly, collaboration is balanced, and pair composition rotates well.'
),
(
    '00000000-0000-0000-0000-000000000001',
    'Project Trend',
    'Overall, is this project trending up, steady, or down?',
    'modified_roman',
    12,
    true,
    'Vote up if things are genuinely improving — the code is getting cleaner, the team is more capable, delivery is becoming easier. Vote steady if things are holding. Vote down if the trajectory is negative. This is the single most important question in the session.'
);

-- Down Migration
--
-- The up migration deletes migration 4's original six rows before inserting
-- the twelve corrected ones, so reverting to migration 4's state requires
-- re-inserting those six rows verbatim (not just deleting this migration's
-- twelve) — otherwise the sentinel team would be left with zero default
-- topics rather than the prior six-row state.

DELETE FROM topics WHERE team_id = '00000000-0000-0000-0000-000000000001';

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
