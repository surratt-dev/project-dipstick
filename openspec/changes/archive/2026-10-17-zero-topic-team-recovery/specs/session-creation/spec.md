## MODIFIED Requirements

### Requirement: Opening the room is refused when the team has no active topics

If the team has zero active topics when `/advance` runs (evaluated under the team's advisory lock), the request SHALL be rejected with `409`, `error.category: "precondition_failed"`, and `error.code: "NO_ACTIVE_TOPICS"`. The code is unchanged in every case below; only the message varies, by the team's lock state. There is no caller-role branch: `/advance` admits only a caller whose live `global_role` is `facilitator`, so an application administrator never reaches it. The session SHALL remain in `draft`, and no audit row and no event SHALL be written, so the facilitator can retry without recreating the session. A session with a single active topic SHALL be allowed to open. Authorization comes first: a caller who is not the session's facilitator SHALL receive `403` whatever the team's active topic count, so topic state cannot be probed without authorization. The status check comes next: a session not in `draft` SHALL receive `422` whatever the team's active topic count, and SHALL never receive `409 NO_ACTIVE_TOPICS`.

The message SHALL be exactly one of the following, chosen by the customization lock state, read after the failed open has been rolled back (advisory: the 409 decision itself is unaffected by the read):

| Team state | Message |
|---|---|
| Locked, zero active topics | "This team has no active topics, so the room can't open yet. Ask an application administrator to assign the default topics, then try again. Your session is saved." |
| Unlocked | "This team has no active topics. Add or restore a topic on Topic Management before opening the room." |

The messages carry no team id, template id or other identifier. Naming "an application administrator" here is the sanctioned loosening (pending PO ratification) of the "do not name an application role" copy rule for the zero-topic locked state only (see `topic-management-screen`). Because every successful open snapshots the team's topics at the moment of opening, a draft session created before an administrator assigned the defaults SHALL snapshot the newly assigned topics when the room is opened; it is not bound to an empty set.

#### Scenario: Zero active topics returns NO_ACTIVE_TOPICS
- **WHEN** the facilitator advances a `draft` session for a team with no active topics
- **THEN** the response is `409` with `error.category: "precondition_failed"`, `error.code: "NO_ACTIVE_TOPICS"`, and the message the table above selects
- **AND** the session remains `draft` with no `session_topics` rows, no `session.state_changed` audit row, and no `session_state_change` event

#### Scenario: A locked team's facilitator is told to ask an application administrator
- **WHEN** the facilitator advances a `draft` session for a locked team with zero active topics
- **THEN** the message is "This team has no active topics, so the room can't open yet. Ask an application administrator to assign the default topics, then try again. Your session is saved."

#### Scenario: An unlocked team keeps the original message
- **WHEN** the facilitator advances a `draft` session for an unlocked team with zero active topics
- **THEN** the message is "This team has no active topics. Add or restore a topic on Topic Management before opening the room."

#### Scenario: A failed open leaves the session in draft and retryable
- **WHEN** the advance is refused with `409 NO_ACTIVE_TOPICS`, and an application administrator then assigns the default topics, and the facilitator calls `/advance` again for the same session
- **THEN** the second `/advance` returns 200 and the session is `lobby` without having been recreated: no new session row exists, and the facilitator performed no step other than clicking Open room again
- **AND** its `session_topics` snapshot holds the newly assigned topics

#### Scenario: A draft session is not joinable by participants
- **WHEN** a participant attempts to join a `draft` session whose team has zero active topics
- **THEN** the join is refused exactly as for any `draft` session, and no lobby is shown

#### Scenario: A session not in draft gets 422 even when the team has no active topics
- **WHEN** the facilitator calls `/advance` for a session in `lobby` whose team has zero active topics
- **THEN** the response is `422`, not `409`
- **AND** no row, audit entry, or event is written

#### Scenario: A non-creator gets 403, not 409, on a team with no active topics
- **WHEN** a user who is not the session's facilitator calls `/advance` for a `draft` session whose team has zero active topics
- **THEN** the response is `403`, not `409`
- **AND** no row, audit entry for the open, or event is written

#### Scenario: One active topic is enough
- **WHEN** the facilitator advances a `draft` session for a team with exactly one active topic
- **THEN** the session opens with one `session_topics` row at `display_order = 1`
