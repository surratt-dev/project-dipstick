# topic-skip-and-creation-time-confirmation

**Status:** Stub — not yet proposed. Filed by `session-lifecycle-transitions` (tasks.md task 7.5).

**Owner:** Marcus Delgado (Business Analyst), per the exploration notes' Section 3 recommendation (same recommendation that names ownership for `team-membership-removal`).

## Why this is deferred, not built here

`session-lifecycle-transitions`'s proposal.md ("Topic-Skip Decision") rules out mid-session topic-skipping for that change:

- Priya Nair's review named a real scenario — a team's context changes between topic-list setup and the session reaching that topic (e.g., an on-call topic for a team that just deprecated on-call).
- That scenario doesn't conflict with `session-lifecycle-transitions`'s hard reveal-before-advance precondition — skipping a topic before any vote exists for it strands nothing.
- But a facilitator-initiated skip path is new authorization surface (who can trigger it, what gets audited, how it interacts with `display_order`) that did not have review bandwidth to design correctly alongside that change's already-committed scope (two session-phase endpoints, one topic-advance endpoint, a reveal write, and a lock-in race fix).

## Second gap this change should also close

`session-lifecycle-transitions`'s "Topic-Skip Decision" caveat names a related, narrower gap worth bundling with the skip design rather than treating as a separate ask: a facilitator who creates a session ahead of the actual meeting (e.g., to distribute the join link early) gets no signal — at creation time or afterward — that the topic list is about to be locked in for that session (`SESSION-001` snapshots the topic list into `session_topics` at creation, not at `SESSION-004`/session start). If they notice a topic is stale after creation but before the session starts, editing the team's topic list silently does nothing for that already-created session, and nothing currently surfaces that failure to them.

Candidate mechanism (not designed here): a creation-time signal — surfacing the about-to-be-snapshotted topic list back to the facilitator for a last look before `SESSION-001` confirms — would close this gap without reopening the authorization-surface problem a real mid-session skip path creates.

Both gaps stem from the same underlying tension: topic-list edits and session timing don't currently give facilitators a clean signal of when "too late" actually is. Track both under this one follow-on rather than as two unrelated asks.

## Scope to design when this change is picked up

- Facilitator-initiated topic-skip: authorization (who can trigger it), audit trail, and interaction with `display_order` and the existing reveal-before-advance precondition.
- A creation-time topic-list confirmation signal, closing the gap named above.
- Confirm demand for the skip path is real beyond the single scenario named in `session-lifecycle-transitions`'s review before committing full design effort to it.
