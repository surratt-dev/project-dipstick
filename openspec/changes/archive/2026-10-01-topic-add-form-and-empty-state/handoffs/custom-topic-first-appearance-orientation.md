# Title: Show a topic's orientation text the first time it appears in a session

**Type:** enhancement (proposed fix for "Custom topic descriptions can never reach participants in a session")
**Raised by:** Priya Nair (facilitator review of #55), endorsed by Devon Calloway
**Related:** #175, #55

## Body

A custom topic's first appearance in a session is effectively a first session for that topic: the room has never voted on it, and the scale and intent need explaining. Today orientation text (`first_session_description`) is sent only when the *team's* session is its first (`sessions.is_first_session`), which a custom topic can never be part of.

### Proposal
Key orientation display on **the topic's** first appearance rather than the team's first session: show `first_session_description` to participants when this topic has never appeared in a completed session for this team.

### Things to settle in the change
- How "first appearance" is determined (e.g. no prior `session_topics` row for this topic in a completed session). Depends on #175 populating `session_topics`.
- Whether default topics restored after archiving count as a new first appearance (probably not: they have history).
- Snapshot semantics: whether the description is snapshotted into `session_topics` at session creation, like name/prompt.
- Session view stays quiet: orientation shows once, in the same place default topics show it in session one. No new UI chrome.

### Acceptance
- [ ] A custom topic with a description shows that description to participants the first time it is voted on.
- [ ] It does not show on later appearances.
- [ ] Default topics' first-session behaviour is unchanged.
- [ ] The #55 form copy is updated to say where the description appears.
