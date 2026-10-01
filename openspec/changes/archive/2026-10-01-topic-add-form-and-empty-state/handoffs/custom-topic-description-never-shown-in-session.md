# Title: Custom topic descriptions can never reach participants in a session

**Type:** defect (against use case "View Topics During a Live Session", step 5)
**Found in:** exploration for #55 (`openspec/changes/topic-add-form-and-empty-state/exploration-notes.md`, 2.1)
**Related:** #175, #55, follow-up "Show orientation text on a topic's first appearance"

## Body

The "description" field on a topic is stored as `topics.first_session_description`. In a live session, `packages/backend/src/routes/facilitator-sessions.ts` (~L1274) sends it to participants only when the session is a team's first session:

```
firstSessionDescription: sessionRow.is_first_session ? firstTopicRow.first_session_description : null
```

Custom topics can only be added after the first session (TOPIC-003 is blocked by the first-session lock). As a result, **a custom topic's description can never reach a participant.** It only renders on the Topic Management screen.

Use case "View Topics During a Live Session", step 5, says that if a topic has a description it is displayed to give context. That holds for default topics in session one only, and never for custom topics. The topics that most need orientation, the unfamiliar team-invented ones, are the only ones that can't get it.

Team definitions (TOPIC-007) don't fill the gap today either: they reach the room only through the `session_topics.topic_annotation` snapshot, which is pending #175.

### Interim mitigation (shipping in #55)
The add form labels the field "Description (optional, shown on this screen only)" and its helper text says engineers won't see it during sessions. No copy promises in-session display.

### Acceptance
- [ ] Decide the intended behaviour (see the first-appearance follow-up for the proposed fix), or amend use case step 5 to match current behaviour.
- [ ] Once fixed, update the #55 form label and helper text to match.
