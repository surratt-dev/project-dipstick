## MODIFIED Requirements

### Requirement: The screen does not read `defaultTopicsNotActive`

The Topic Management screen SHALL NOT read or render `defaultTopicsNotActive` from the TOPIC-002 response, including in the empty state. Its `topicId` can refer to the template team for a default the team has no linked row for. (Since #311 the field is matched by the `template_topic_id` link rather than by name, so a same-name custom topic no longer produces wrong rows; the screen still has no need for it.) Re-adding is offered only through the team's own archived topics.

#### Scenario: A team whose default topics are missing offers only its own archive
- **WHEN** an unlocked team has no active topics, two archived topics, and a TOPIC-002 response whose `defaultTopicsNotActive` lists twelve entries
- **THEN** the screen offers "Show archived topics (2)"
- **AND** no entry from `defaultTopicsNotActive` is displayed
