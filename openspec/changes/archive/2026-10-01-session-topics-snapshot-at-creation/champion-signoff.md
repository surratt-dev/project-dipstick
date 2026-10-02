# Champion sign-off: session-topics-snapshot-at-creation (#175)

**Reviewer:** Devon Calloway (Internal Champion)
**Date:** 2026-10-01
**Verdict:** CLEAN PASS

## Ritual intent

This change fixes the most damaging gap we had. Every real session stopped at begin-voting, so no team could get past its first attempt. It fixes it in the way the ritual needs. The topic list is fixed at one named moment, room open. Teams can adapt their topics between sessions and never during one. That keeps "topic flexibility within guardrails" honest, and it keeps session N comparable with session N+1, which the trend dashboard depends on. The confirmation tells the facilitator, calmly, that they are locking the list in. That is the right amount of process: one sentence, no warning chrome.

## Core constraints

- **No-manager rule:** not affected. Join, participant and role-gating paths were not changed. The new live-role check on `/advance` (`facilitator` only, `403`, audited) makes it harder for anyone without the facilitator role to open a room.
- **Simultaneous reveal:** not affected. Reveal logic was not changed. The fix to the reconnect snapshot (R5) only resolves the caller's own `hasLockedInVote` against the correct `session_topics` row. It exposes no one else's vote state, and it stops a reconnecting participant from looking unvoted, which protects the lock-in flow.
- **Facilitator from another team:** not weakened, and slightly strengthened. The membership-conflict denial on `POST /draft` still stands. Rejecting non-canonical UUIDs with a `404` before the authorization query closes the hole where a member facilitator could get past the membership check by spelling their own team id differently. A real-DB test covers it.

## Implementation-phase deviations

- **Canonical-UUID 404s:** these support intent. They are fail-closed and come before any query. The rule is defined in one place.
- **Local fixed 500s:** acceptable. They stop SQL and configuration text from leaking, and they don't affect ritual behavior. They are a local patch, so the global handler (follow-up 6) still needs an owner.
- **"Open the room" stays enabled after a failed refetch:** acceptable. The enabled button cannot skip anything. The next click runs the confirmation refetch again, so the facilitator still sees the count and the lock-in sentence or the zero-topic disabled state. The server still refuses a zero-topic open with `409`. Nobody gets stuck, and the constraint holds.
- **New non-normative strings:** they are plain and blame-free, and none of them softens the lock-in message. Priya's walkthrough (10.4) is the right place to settle the wording.

## Non-blocking notes

- Follow-ups 1 (expired draft re-establishes team-content access) and 2 (live facilitator role on start, begin-voting, reveal and complete) both concern who holds facilitator authority during the ritual. Neither was introduced here. Please give them named owners and dates rather than letting them drift.
- The operator backfill gate (10.3a) should be run and recorded before release, so no team is left with a session that cannot start voting.
