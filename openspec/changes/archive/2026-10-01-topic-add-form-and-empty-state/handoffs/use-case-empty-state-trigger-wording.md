# Title: Use case wording: the empty active-topics trigger "all have been removed" can't happen through the UI

**Type:** documentation (requirements)
**Raised by:** Marcus Delgado (BA review of #55, traceability check)
**File:** `requirements/use cases/08 - Topic Management - Use Cases.md` ("View Active Topics" empty state)

## Body

The use case describes the empty active-topics state as happening when all topics have been removed. TOPIC-004 has a last-active-topic guard (`409 TOPIC_LAST_ACTIVE`), so the UI can never archive the last topic.

The real ways a team reaches zero active topics are:
1. A concurrent-archive race (#184 item 1). Unlocked, with archived topics.
2. Team creation copying zero default topics (see "No recovery path for a team created with zero topics"). Locked, nothing archived.
3. Manual data fixes.

### Suggested change
Reword the trigger to "the team has no active topics (for example after a data error)", and note that what the empty state offers depends on whether the team is locked and whether archived topics exist, as specced in #55.
