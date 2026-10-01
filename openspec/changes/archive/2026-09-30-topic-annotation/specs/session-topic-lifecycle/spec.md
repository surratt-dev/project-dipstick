## ADDED Requirements

### Requirement: Session topic payloads carry the team annotation from the session snapshot only

The begin-voting response (`SESSION-005`, `currentTopic`) and the topic-advance response (`SESSION-012`, `currentTopic` when `status = 'active'`) SHALL include `topicAnnotation: string | null`, read only from `session_topics.topic_annotation` for that session topic. Neither response SHALL read the annotation from `topics.team_annotation`, so an annotation edited after a session's topics were snapshotted SHALL NOT change what that session shows. Any in-session display of the annotation SHALL use these payloads, not TOPIC-001 or TOPIC-002.

#### Scenario: Begin-voting returns the snapshotted annotation
- **WHEN** a session's first `session_topics` row has `topic_annotation = 'X'` and the facilitator calls `SESSION-005`
- **THEN** the response's `currentTopic.topicAnnotation` is `"X"`

#### Scenario: Advance returns the snapshotted annotation
- **WHEN** the next `session_topics` row has `topic_annotation = 'X'` and the facilitator calls `SESSION-012` after reveal
- **THEN** the response's `currentTopic.topicAnnotation` is `"X"`

#### Scenario: A null snapshot returns null
- **WHEN** the relevant `session_topics` row has `topic_annotation` NULL
- **THEN** `currentTopic.topicAnnotation` is `null` in both responses

#### Scenario: Editing the live topic does not change session output
- **WHEN** a `session_topics` row has `topic_annotation = 'X'`, and its source `topics.team_annotation` is subsequently set to `'Y'`
- **THEN** both `SESSION-005` and `SESSION-012` still return `topicAnnotation: "X"` for that session topic

### Requirement: A session topic snapshot copies the topic's annotation in the same write as the rest of the row

**Status: pending — no production code writes `session_topics` today (#175). This requirement constrains #175's implementation; it is pinned here so the snapshot model chosen by `topic-annotation` cannot be lost.** WHEN `session_topics` rows are written for a session, each row's `topic_annotation` SHALL equal its source topic's `team_annotation` at that instant, in the same write as the `topic_name`, `topic_prompt`, `vote_type`, and `display_order` snapshot. The annotation SHALL NOT be snapshotted at a different moment from the rest of the row, and the write SHALL complete before the session's first `SESSION-005` (begin-voting) call can succeed, which is the first point at which a topic is presented to participants. Whether that write happens at session creation or when a session leaves `draft` is decided once, for the whole row, by #175.

#### Scenario: The snapshot captures the annotation alongside the prompt
- **WHEN** `session_topics` rows are written for a session while topic T has `team_annotation = 'X'` and `prompt = 'P'`
- **THEN** T's `session_topics` row has `topic_annotation = 'X'` and `topic_prompt = 'P'`, both written by the same statement or transaction

#### Scenario: A later edit does not reach an existing snapshot
- **WHEN** a session's `session_topics` rows have been written and the team's annotation for topic T is then changed
- **THEN** T's `session_topics.topic_annotation` for that session is unchanged
