# Architecture Review — participant-readiness-view

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Implementation vs. design.md/tasks.md; boundary integrity; pattern consistency with existing `packages/` code.
**Verdict: Approved.** No blocking findings. Two non-blocking observations below (§3, §5) worth a follow-up decision, not a merge gate.

---

## 1. D2 mechanism (registration-gap closure)

The implementation matches the documented decision exactly, and the rejection rationale for auto-upsert-at-WS-connect holds up under my own reading of the boundary it would have crossed.

`websocket-routes.ts` runs `evaluateSessionSubscriberAccess` **before** registering a connection — that ordering is the authorization boundary. Auto-upserting a `session_participants` row at that point would have required moving the write to the *front* of that check, which converts "prove you have standing, then connect" into "connect, and standing is granted on the way in" — a materially larger surface (any authenticated user, any session, no team-membership or join-link gate). Option 2 instead reuses the already-gated REST endpoint and adds a caller. This is the correct call: it keeps the single authorization chokepoint (`evaluateSessionSubscriberAccess`) as the only path that can ever open a WS grant, and treats registration as a write that must independently satisfy the same condition set, not a side effect of connecting.

I verified the "same condition set" claim directly — `sessions.ts:106-151`'s eligibility check (`membership_exists && membership_removed_at === null && global_role !== 'engineering_manager' && membership_role !== 'engineering_manager'`) is a byte-for-byte match of `session-subscriber-access-helper.ts:155-161`'s Path 1 condition. Read side (`participants-roster`'s row filter) and write side (registration) agree, as D5 requires. The `lock-in` handler's identical pre-existing gap was fixed in the same pass, correctly scoped as "already in this exact area," not new work.

Audit logging follows the `join-links.ts` transactional convention precisely: INSERT + audit row inside one `BEGIN`/`COMMIT`, `emitAuditEvent` fired only after commit, both the success and rejection paths covered. No deviation from the established pattern.

**This is sound architecture.** The boundary stays where it was designed to be; the fix widens what the boundary accepts, not where the boundary sits.

## 2. Task 1.3b (retry-on-404, not unconditional mount POST)

Sound, and the stated reasoning is the right reasoning: an unconditional call on every mount would tax the common case (already-registered participants, facilitators — the majority of visits) for a payoff only the first-time-joiner case needs. Retry-on-404 pays the extra round trip exactly once, exactly where it's needed, and a genuinely unauthorized caller still terminates at `no-access` after the retry — the corrected server-side check is what actually enforces the boundary, this is just when the client asks. I don't see a loosening of authorization here; the gate is still the database read in `sessions.ts`, evaluated fresh on both the original and retried request.

## 3. Non-blocking observation: `SessionLobbyPage`'s WS connection during registration

Not in tasks.md and not something I'd hold the merge for, but worth naming since it's the same failure class D1's correction went out of its way to close for `DraftSessionHost`.

`SessionLobbyPage` opens its `useConnectionHealth` socket unconditionally on mount (`SessionLobbyPage.tsx:170-173`), same as it did before this change. For a first-time-joining Engineer, that WS attempt races the REST registration flow (`fetchReview`'s 404 → `POST .../participants` → retry). The socket attempt almost always loses that race — no `session_participants` row exists yet, so `evaluateSessionSubscriberAccess` Path 1 fails, and `websocket-routes.ts` closes with `CLOSE_UNAUTHORIZED`. `connectionHealth.ts` is deliberately disclosure-blind past `REAUTH_GRACE_EXPIRED_CLOSE_CODE` (confirmed at `connectionHealth.ts:213-227`), so this is treated as an ordinary failure and lands in `beginOrContinueUnknownEpisode()`'s backoff-and-retry loop.

This is **not** the same defect D1 fixed. D1's case was permanent: a facilitator sitting on `draft` has *zero* valid grant paths until they act, so the reconnect loop never terminates on its own. Here it's transient and self-healing: registration completes within one REST round trip, and the next scheduled backoff retry (which was already going to happen) finds the row and succeeds. Net effect is a brief, bounded delay before the roster's live layer comes up for a first-time joiner — not a storm, not a stuck state.

Also worth noting: this exact race was **unreachable before this change**, because D7 meant no first-time joiner could ever get a `session_participants` row at all — the WS connection for that caller was permanently broken, full stop. D2 turns a permanent failure into a transient one. That's a net improvement this change delivers as a side effect, not a regression it introduces.

I'd log this as a fast-follow candidate (skip the socket mount until the registration retry resolves, mirroring D1's gate) rather than a blocker — the cost of the current behavior is a few seconds of delayed live updates for the roster's first-time-joiner case, bounded by the existing backoff schedule.

## 4. SessionLobbyPage join-link gap (flagged by the implementer)

This is a real, acknowledged shortfall against the roster spec's literal wording ("join link SHALL remain displayed alongside the empty-state prompt"), and I looked at it specifically because Marcus flagged it rather than papering over it.

**My assessment: acceptable as a follow-up, not a blocker for this change.**

Reasoning:
- The gap is isolated and inert. `ParticipantRosterView`'s `joinUrl` prop is explicitly optional (`ParticipantRosterView.tsx:29-36`) and the component degrades cleanly — the empty-state prompt still renders, just without the join-link line. There's no broken state, no crash, no silent data exposure; a facilitator on `SessionLobbyPage` sees one line less of information than the spec's literal text asks for.
- Building a join-token fetch for `SessionLobbyPage` is genuinely out of this change's scope as scoped in tasks.md Section 5 — that page has no existing mechanism to resolve a session's join token today, and manufacturing one is a different, non-trivial task (a new fetch, a new piece of page state, its own error/loading handling) that tasks.md never asked for and design.md never budgeted for. Scope creep introduced under review pressure, to close a cosmetic gap on a page whose primary flow (start the session) is unaffected, is exactly the kind of thing I'd normally push back on adding *now*.
- It's asymmetric with `DraftSessionHost`, where the join link **does** render correctly in the roster's empty state (`DraftSessionHost.tsx` already computes `joinUrl` and passes it through `LiveReadinessView` → `LobbyParticipantRoster`). So the spec requirement is met on one of the two surfaces this change targets, and cleanly degraded (not violated) on the other.

I'd want this tracked as a named follow-up issue, not silently absorbed as "good enough forever" — the spec line exists for a reason (a facilitator watching an empty room on `SessionLobbyPage` still needs the invite mechanism visible), and Marcus is right to flag rather than close it quietly. But it does not rise to a blocking architectural concern: it's a UI completeness gap on an already-narrow page, not a boundary violation, not a data-exposure risk, and not a correctness bug.

## 5. Pattern consistency / code quality

- **Boundary discipline:** `useParticipantRoster` is genuinely host-agnostic (takes a socket + sessionId, no page-specific knowledge), and `LobbyParticipantRoster` is the single shared mount point both pages use — confirmed by reading both `DraftSessionHost.tsx` and `SessionLobbyPage.tsx`, neither has a second implementation. Task 6.1's self-check holds up under my independent read.
- **`FacilitatorReadinessGrid.tsx` is untouched and structurally distinct** — confirmed by reading it directly. Its state names (`connected-locked-in`, `disconnected-voted`) are voting-phase concepts with no overlap with the roster's pre-session concerns, and it shares no imports or state with the new components. The two won't get conflated by someone picking this up later, which was the explicit concern in tasks.md 6.1.
- **D5's authorization precedent choice is correctly applied and independently verified in tests:** `facilitator-sessions.ts:1058-1102` follows `dispatchParticipantJoined`/`dispatchParticipantLeft`'s caller-level gate (`grant?.path !== "facilitator"` → disclosure-blind 404), not `action-items-review`'s dual-grant-plus-filter pattern. The test suite (`facilitator-sessions.test.ts:1678+`) explicitly separates the caller-level case (a legitimate `participant` grant still gets 404) from the row-level case (an EM row is excluded from an already-authorized facilitator's response) — exactly the split Finding 2 called for, and exactly the kind of "these are different failure modes" distinction that's easy to accidentally collapse into one test.
- **`applyTimingFloor()` + `Cache-Control: no-store`** applied on every response path of the new endpoint, matching `action-items-review`'s convention byte-for-byte, verified in tests.
- **D1's mount/unmount gate is implemented as designed**, not as a status check inside a hook: `LiveReadinessView` is a genuine child component owning its own `useConnectionHealth` call, rendered only once `currentSessionState !== 'draft'`. This is exactly the structural change design.md's correction demanded, not a cosmetic rename.
- **Shared types are minimal and additive** (`ParticipantRosterEntry`, `ParticipantRosterResponse`) — no existing response shape was overloaded, consistent with D5's stated rationale for a new endpoint over extending an old one.
- **Audit event additions** (`session.participant_registered`, `session.participant_registration_rejected`) follow the existing `AuditEventName` union's documentation convention in `audit-logger.ts` — each new entry carries the same style of inline rationale comment the surrounding entries already use.

No forked implementations, no authorization logic pushed to the frontend, no new precedent invented where an existing one already fit. This change adds surface area cleanly along the seams the codebase already has.

## Summary

| Area | Assessment |
|---|---|
| D2 mechanism & rationale | Sound — correctly rejects the larger-surface alternative, keeps the single grant chokepoint intact |
| Task 1.3b (retry-on-404) | Sound — right-sized to the actual cost/benefit, doesn't loosen authorization |
| SessionLobbyPage join-link gap | Acceptable as a tracked follow-up, not a merge blocker |
| WS race during first-time registration (§3, new observation) | Transient, self-healing, net improvement over pre-change behavior — worth a fast-follow, not a blocker |
| Pattern consistency | Strong — reuses existing precedents (caller/row-level split, transactional audit writes, timing-floor convention, mount/unmount discipline) rather than inventing new ones |

I have no objection to this change proceeding to merge, contingent on the two items tasks.md itself already flags as outstanding and not self-certifiable: the dedicated security review of the D2 mechanism (task 1.5) and the independent code-review checkpoint for shared-component verification (task 6.1) — both of which this review's §1 and §5 findings can serve as input to, but do not substitute for, since a solution-architecture review is not the same review those tasks call for.
