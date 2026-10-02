## ADDED Requirements

### Requirement: The registration snapshot resolves the current topic in the `topics.id` id-space

`sessions.current_topic_id` SHALL be a `topics.id`. That is how begin-voting (`SESSION-005`) and advance (`SESSION-012`) write it and how reveal reads it. The `session_registration_snapshot` payload SHALL resolve the session's current `session_topics` row by `(session_id, topic_id = sessions.current_topic_id)`. `currentTopic.sessionTopicId` SHALL be that row's `session_topics.id`, the same id the begin-voting and advance payloads return as `sessionTopicId`. `currentTopic.status` SHALL be that row's status, and `hasLockedInVote` SHALL be computed by joining `votes.session_topic_id` to that row's `id` for the connecting participant. No other reader of `current_topic_id` changes.

#### Scenario: A participant who locked in still shows as locked in after reconnecting
- **WHEN** a session is `active`, a participant has locked in a vote for the current topic, and that participant's session-scoped connection reconnects
- **THEN** the `session_registration_snapshot` carries `hasLockedInVote: true`
- **AND** `currentTopic.sessionTopicId` equals the `sessionTopicId` returned by begin-voting or advance for that topic
- **AND** `currentTopic.status` is `voting`

#### Scenario: A participant who has not locked in shows as not locked in
- **WHEN** a session is `active` and a participant who has not voted on the current topic registers
- **THEN** the snapshot carries `hasLockedInVote: false` with the current topic's `sessionTopicId` and status

#### Scenario: No current topic yields null
- **WHEN** a session is in `lobby`, `pre_session`, or `wrap_up` and `current_topic_id` is NULL
- **THEN** the snapshot's `currentTopic` is `null` and `hasLockedInVote` is `false`
