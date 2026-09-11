# Engineering Review — `actionitem-updated-live-broadcast`

**Reviewer:** Marcus Oyelaran, Full Stack Engineer
**Scope reviewed:** `design.md`, `proposal.md`, `tasks.md`, the two spec deltas (`action-item-status-management`, `websocket-specification`), cross-checked against the shipped implementation in `packages/backend/src/realtime/` and `packages/shared/src/types/realtime.ts`.

## Bottom line

Implementable, and better-grounded than most designs I review at this stage — the D2 delivery pattern is a near-exact copy of `dispatchSessionStateChange`, the payload shape correctly reuses `SessionStateChangePayload`'s convention, and the VOTE-002 reconciliation work (D4, D5, D9) is careful and specific rather than hand-wavy. I found two concrete implementation blockers that tasks.md doesn't currently surface, both at exactly the kind of boundary I care about — the WebSocket dispatcher and the spec/code conformance check — plus one reuse opportunity on Open Question 1 that should make the architect's decision easier, not harder. None of these require redesigning anything; they're gaps in the plumbing detail that would otherwise surface as a confusing CI failure or a runtime type error partway through 4.x.

## Blocker 1 — `dispatchActionItemStatusUpdated` has no source for `sessionStatus` on the participant path

Design D2 and tasks 4.3 both specify: deliver to *any* valid `evaluateSessionSubscriberAccess` grant (participant or facilitator), gated to `sessionStatus === "pre_session"`. I checked this against the actual type:

```ts
// packages/shared/src/types/team-content-access.ts
export type SessionSubscriberGrant =
  | { path: "facilitator"; sessionId: string; teamId: string; sessionStatus: SessionStatus; actorGlobalRole: string }
  | { path: "participant"; sessionId: string; teamId: string; actorGlobalRole: string };  // no sessionStatus
```

`sessionStatus` only exists on the `facilitator` branch. The existing dispatcher that gates on status (`dispatchVoteReadinessUpdate`) only works today because it *also* restricts delivery to `grant?.path === "facilitator"` — the type narrows correctly and there's no participant case to worry about. `dispatchSessionStateChange`, the pattern D2 says to copy, delivers to both paths but doesn't gate on status at all. **There is no existing precedent in this codebase for "deliver to both grant paths AND gate on session status"** — this design introduces that combination for the first time, and the data isn't there to support it as currently scoped. `RegisteredConnection` (`connection-registry.ts`) doesn't carry session status either, so there's no fallback source on the connection side.

This isn't a hard problem, but it needs an explicit answer before 4.x starts, and tasks.md doesn't currently have a task for it. Options, in my order of preference:

1. **Carry `sessionStatus` on the internal Redis envelope, not the grant** — matching the existing precedent in `VoteRevealedTriggerPayload`, which carries `sessionStatus: SessionStatus` precisely so `dispatchVoteRevealed` doesn't need to re-derive it. The mutation handler already has the session's status in hand (it just validated it per Open Question 2's `422`-if-not-active check), so this costs nothing at publish time. The dispatcher gates on `envelope.payload.sessionStatus === "pre_session"` instead of the grant's. This field need not appear on the client-facing `WsClientMessage` payload (task 2.2's `ActionItemStatusUpdatedPayload` can stay exactly as scoped) — same split `VoteRevealedTriggerPayload` vs. `VoteRevealedPayload` already models.
2. Extend `SessionSubscriberGrant`'s `participant` branch to also carry `sessionStatus` — the underlying SQL in `evaluateSessionSubscriberAccess` already selects `s.status` for every row, so this is a one-line addition, but it's a shared, heavily-documented helper other dispatch handlers depend on, and its own doc comments would need updating to stay accurate. Slightly more invasive for no real benefit over option 1.

I'd take option 1. Recommend adding it as an explicit tasks.md item under Group 4, and noting the envelope-vs-client-payload split in D4 alongside the existing `resolutionNote`/`resolvedInSessionId` omission, so a future reader doesn't wonder why the envelope and the wire payload differ.

## Blocker 2 — tasks.md 5.1 as written will fail the conformance test it's supposed to satisfy

I read `packages/shared/src/__tests__/websocket-spec-conformance.test.ts` directly rather than trusting the design's description of it. The relevant detail: it extracts backtick-quoted names from the Event Registry table's first cell and only compares **code-style** names (`/^[a-z]+(_[a-z]+)+$/` — snake_case, no dots) against `WsClientMessage`'s eventType literals. Dot-notation names are explicitly skipped as "documentation labels," per the test's own comment.

The current Registry row is:

```
| `actionitem.updated` (live, pre-finalization case) | NOT IMPLEMENTED — tracked in issue #95 |
```

Task 5.1 says: "flip the Event Registry table row for `actionitem.updated` (live case) from NOT IMPLEMENTED to Implemented." Taken literally — status flipped, name left as `actionitem.updated` — the row's name is still dot-notation, so the test's `isCodeStyleName` filter skips it entirely. Meanwhile `action_item_status_updated` (the real eventType landing in `WsClientMessage` per task 2.3) has **no matching row at all**, and the first conformance test (`has at least one Event Registry row for every eventType WsClientMessage can send`) fails with exactly the missing-row message it's designed to produce.

The fix is one line, but it's not in tasks.md as written, and it's the kind of thing that's obvious once you're staring at a red CI run and non-obvious from reading the task list beforehand. There's also direct precedent in this exact table for the fix: the `participant_joined`/`participant_left` row already uses the real snake_case names, not the old `participant.joined`/`participant.left` dot-notation — this design should do the same. Task 5.1 should read something like: *"flip the row from NOT IMPLEMENTED to Implemented, and rename it from `` `actionitem.updated` (live, pre-finalization case) `` to `` `action_item_status_updated` ``, matching how `participant_joined`/`participant_left` already replaced their dot-notation row name once implemented."*

Task 6.5 ("confirm the conformance test passes once 2.x and 5.1 land together") will catch this at PR time regardless — CI is a backstop here — but it'll catch it as a confusing failure to debug rather than a checklist item, for whoever implements this. Worth the one-line fix to tasks.md now.

## Open Question 1 — a reuse point the architect should have in hand

Not a blocker, but relevant evidence for the architect's ratify-or-override call. I checked `evaluateTeamAccess` (`packages/backend/src/auth/team-content-access-helper.ts`), the existing REST-side authorization helper. Its Path 3 ("Active Session Facilitator") is:

```
sessions.facilitator_id = userId AND sessions.team_id = teamId
AND status IN ('lobby','pre_session','active','wrap_up')
  OR (draft within 24h) OR (complete within grace window)
```

This is, almost verbatim, VOTE-002's documented middle formulation ("any action item belonging to a team they are actively facilitating (active session exists)") — and it's already a shipped, tested helper. `action_items` has `team_id` directly on the row (`2_create_tables.sql:136`), so the facilitator check for task 3.3 could call `evaluateTeamAccess(userId, actionItem.team_id)` and branch on `grant.path === "facilitator"` directly, rather than hand-rolling new SQL. That's less code, less risk, and it's consistent with how every other facilitator-scoped write in this codebase already resolves facilitator standing.

One thing worth flagging to the architect alongside this: `evaluateTeamAccess`'s facilitator path treats `lobby`, `pre_session`, `active`, `wrap_up` (plus draft/complete grace windows) all as "actively facilitating" — a broader definition of "active" than the `pre_session`-only gate the live broadcast itself uses (D2). If Open Question 1 is ratified toward VOTE-002's formulation and implemented via `evaluateTeamAccess` reuse, the PATCH endpoint's *authorization* scope and the WebSocket *broadcast*'s gating scope will legitimately differ in breadth (a facilitator could authorize a status change during `active`, but no broadcast fires because the review isn't in `pre_session`) — which is fine and arguably correct (D7 already says mutation success is never gated on broadcast eligibility), but it's worth the architect stating explicitly in the Open Question 1/2 write-up so it doesn't read as an inconsistency later. This is the same "active" ambiguity Open Question 2 already names for `sessionId` validation — good that the design flagged it, but it applies equally to whichever helper actually implements the authorization check, and that detail isn't visible until you read the helper code.

## D9 (resolutionNote late-inclusion) — implementation risk check

Asked specifically to sanity-check this. I don't see meaningful added implementation risk from folding it back in at this stage:

- Schema, shared `ActionItemStatus`/`ActionItem`/`ActionItemHistory` types, and the read path (`content.ts`, `em-views.ts`) all already exist and already round-trip `resolutionNote`/`resolvedInSessionId` — I confirmed this directly rather than taking D5/D9's word for it (`packages/shared/src/types/action-item.ts:11-12`, `em-views.ts:825,907`). There's no new column, no new read-side serializer, no new shared type to invent — only the write side, which this change was building regardless.
- The `resolution_note` length CHECK constraint (`action_items_resolution_note_length`) already exists at the DB layer as a secondary guard; the design correctly treats `422` as the primary, application-level enforcement.
- Tasks 3.6/6.3 cover the resolutionNote write path and its edge cases (over-length, omitted, dropped-on-non-resolving-transition) directly and don't read as bolted on.
- The one thing I'd double check at implementation time, not a blocker: `ActionItemHistory.resolutionNote` and `ActionItem.resolutionNote` already exist as camelCase fields in the shared type — task 2.2's new `ActionItemStatusUpdatedPayload` should reuse the existing `ActionItemStatus` type (`packages/shared/src/types/action-item.ts:1`) for its `previousStatus`/`newStatus` fields rather than re-declaring the union inline. Tasks.md doesn't say not to, but it also doesn't say to reuse it, and this is exactly the kind of drift-by-omission the shared-types discipline exists to prevent.

D9's actual scope-boundary reasoning (why #65 folds in but #69 doesn't) is sound and matches what I'd conclude independently: #65 was never a separable feature, it was the unbuilt remainder of a contract this change was already implementing end to end.

## Smaller observations (non-blocking)

- **D7 / publish-after-commit**: correctly matches `ws-pubsub.ts`'s documented discipline and the `participant_joined`/`participant_left` carve-out precedent. No notes — this is exactly right, and D7's framing ("never gate the PATCH on the broadcast") is the correct answer regardless of how Open Question 2's stricter facilitator-403 case resolves, since that 403 is an *authorization* rejection before any transaction begins, not a broadcast failure after one commits. Worth the architect stating this distinction explicitly when resolving Open Question 2, since D7's prose and VOTE-002's error table read as being in tension until you notice they're answering different questions (mutation-failure vs. authorization-failure).
- **Exhaustiveness guard (task 4.4)**: the `never`-assignment pattern in the dispatcher's `default` case will do its job correctly here — adding `action_item_status_updated` to `WsEventType` without a matching `case` will fail to compile, not just at runtime. Good; no action needed, just confirming the mechanism holds up under this addition.
- **VOTE-002's separate suggested DB CHECK constraint** for the transition state machine ("`(old_status, new_status) IN (...)`") is a *recommendation* in VOTE-002's Notes, distinct from the `action_items_resolved_has_session` claim the design correctly identifies as stale and corrects. Design.md's Migration Plan doesn't address this second, still-open recommendation — I don't think it needs to (app-level enforcement is this codebase's consistent pattern elsewhere, e.g. transition and ownership checks all live in helpers, not triggers), but it's worth one sentence in the VOTE-002 reconciliation task (5.3) confirming this is a deliberate no-op, not an oversight, the same way the design already does for the `_has_session` constraint.
- **Route file location** (task 3.1, "new or existing backend route file"): no `packages/backend/src/routes/action-items.ts` exists yet — this will be a new file. Fine either way; flagging only because tasks.md leaves it open and someone will need to make that call at implementation time. Given `content.ts`/`em-views.ts` already own action-item *read* paths, I'd lean toward a new `action-items.ts` for the write path rather than growing either of those further, but this is a low-stakes call either implementer can make.

## Verdict

Ready for the architect's sign-off on the three Open Questions as scoped. Before 4.x/5.x implementation begins, I'd want tasks.md updated with: (1) an explicit task for how `sessionStatus` reaches the dispatcher for the participant path (Blocker 1), and (2) task 5.1 corrected to say the Registry row's *name* changes, not only its status (Blocker 2). Both are small, well-understood fixes — neither changes the shape of the change, and neither is a reason to send this back to exploration.
