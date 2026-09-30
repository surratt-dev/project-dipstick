# Champion Sign-off: reorder-topics (#52)

**Signed off.**

Devon Calloway, Internal Champion, 2026-09-30

## Ritual intent

The intent is preserved. Reorder gives the facilitator control over the order of the conversation, and nothing else. It does not rank, score, or suggest anything, and it never appears on the live-session surface. The ritual still reads as a conversation, not an optimizer.

## Core constraints

These are unaffected. The diff doesn't touch session participation, the reveal path, or facilitator assignment.

- **No-manager rule:** Unaffected. Authorization is the shared standing-facilitator-or-admin check, and a facilitator who is a member of the team is refused (`FACILITATOR_IS_TEAM_MEMBER`). No new route lets a manager into a session.
- **Simultaneous reveal:** Unaffected. The handler writes only `topics` and `audit_log`.
- **Facilitator from another team:** Unaffected, and reinforced for this write. The member-facilitator refusal applies to reorder the same way it applies to add, remove and restore.

## The three things I said must stay exactly as they are

1. **First-session lock covers reorder: held.** The handler reuses `checkCustomizationLockGate` without changes, with `attemptedOperation: "topic.reordered"`. It runs before body validation, so a locked team gets 409 whatever the body says. Denials write the shared `topic.write_denied_locked` audit row. There is no separate path and no bypass. The UI hides the controls when the team is locked.
2. **Order never reaches into an existing session: held.** Both renumber phases touch only `topics` rows (`status = 'active'`, team-scoped). No endpoint takes a per-session order. Integration test 5.9 checks that `session_topics` for an open session and a completed session are byte-identical before and after a reorder. The UI copy says so plainly ("Sessions already created keep their order"), and the confirmation names the date of the existing session. One caveat: #175 still does not populate `session_topics` at creation, so this is proven structurally, not end to end. That was an inherited gap, and it was disclosed as one.
3. **No automatic ordering: held.** The ordering code in the backend, `topicOrder.ts` and the page contains nothing about scores and no sort-by-signal. The order is whatever the facilitator saves, and the Non-Goals section of design.md records this.

## Deferrals I accept

- **Drag-and-drop moved to #181.** The issue owner approved this. Move up/down/top/bottom covers every kind of input, including tablet.
- **Tasks 4.7, 8.7, 9.1 and 9.2 are deferred to human action.** I accept this on one condition: they happen **before merge**, as the archive note says. 4.7 (the #175 comment about snapshotting on lobby entry, renumbered densely) matters most to me, because it is the only thing that keeps guarantee 2 true once #175 lands. The 9.1 tablet session with Priya should also ask whether losing an unsaved draft on in-app navigation felt like losing work.

## Non-blocking notes

The architect's minors m1–m4 (density wording on a no-op, a design note about the sticky bar, the stale message not being announced to screen readers, a lingering save error) are polish. None of them touches intent. I'd like m3 fixed soon, since accessibility is part of "any team can adopt this without me."
