## Why

I said in the #52 proposal that reorder is flexibility, not a protective constraint, and that still holds. The Topic Management screen already lets a facilitator reorder with Move to top, Move up, Move down and Move to bottom. What is missing is the gesture the Reorder Topics use case names first: *"drags a topic... (or uses an equivalent reorder control)"*. The #52 owner accepted deferring drag only on condition that #181 follows, so this is a commitment, not a nice-to-have.

The motivating case is the long-distance move. A facilitator preparing the next session, usually the day before and at a laptop, wants to pull a heavy topic from position 9 to position 2. With the buttons that is Move to top, then several Move downs, watching where focus went each time. One drag is the right tool for that. Neighbor swaps are fine with buttons; drag earns its place on moves of several positions, and I would rather say so than oversell it.

User story: as a facilitator preparing for the next session, I move the last topic to near the top in one gesture.

This is a commitment kept and a convenience, not an adoption lever. I would not defend it on adoption grounds, and it yields to any work on first-session onboarding, the trend dashboard or action-item closure; it must not displace them.

What I need is a second way to produce the same draft, not a second feature. Testable form: for any sequence of moves, reordering by drag and by buttons yields the same `draftOrder`, the same dirty state, the same cleared confirmation and error, the same announcement text, and the same Save payload.

## What Changes

- **A drag handle on each active topic row** (mouse, trackpad and pen; touch is a follow-up, see disposition), one drop line, drop commits to the existing local draft. Nothing persists until Save order, as today.
- **One shared draft path.** A pure `moveToIndex(items, from, to)` in `topicOrder.ts`, and one `applyNewOrder(next, topicId, focusIds)` in `TopicManagementPage.tsx` (the announcement is computed inside, from `next` and `topicId`) that both `moveTopic` and the drop handler call. This is the only refactor needed.
- **Escape, `pointercancel`, window blur, or a release outside the list cancels.** No auto-scroll. `prefers-reduced-motion` respected.
- **The four move buttons stay, unchanged, and remain the accessible and keyboard path** (WCAG 2.2 criterion 2.5.7 Dragging Movements). The handle is pointer-only: `aria-hidden`, not focusable.
- **No backend, migration, API, or schema change.** The PUT already takes the full ordered ID list.
- **Mechanism decision (design.md Decision 1):** hand-built Pointer Events, no new runtime dependency. Every library candidate failed at least one of the constraints below when measured on 2026-10-17. Estimate two to three engineer-days; overrun rule in design.md Decision 1.

### Constraints that must be preserved

1. **First-session lock.** The handle exists only where reorder is already offered. A locked team, or one with fewer than two active topics (including the zero-topic recovery from #200), gets no handle and no drag listeners. No new lock flag, no new locked-state copy. The server's `409 TOPIC_CUSTOMIZATION_LOCKED` remains the authority; the client gate is presentation.
2. **Order never reaches an existing session.** Drag changes only the client draft. The pinned copy "Order changes apply to sessions opened after you save. Sessions already open keep their order." stays rendered, unchanged, from drag start through drop and after a successful Save.
3. **No automatic ordering.** No snap, suggest, or sort. The result is the dragged topic at the dropped index with all others in prior relative order.
4. **Not a metric tool.** No new data shown or collected. The existing `topic.reordered` audit row is the only trace; a cancelled or no-op drag writes none. I am declining adoption telemetry (for example, share of reorders by drag).
5. **Open source, on-prem deployable.** No new runtime dependency (testable: `package.json` is unchanged). If Decision 1 is ever reopened, a dependency must be OSI-approved permissive, no hosted service, no telemetry, a release in the last 12 months, no open critical advisory.

Guideline, not a gate: the ritual should not feel like software. One handle per row, no toast or count on drop, no animation beyond the drop line.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `topic-management-screen`: modifies the active-row requirement (drag-and-drop is no longer excluded; the buttons are guaranteed to remain) and adds requirements for the drag handle, its availability gate, drop and cancel semantics, focus and announcement on drop, touch and scroll behavior, and archived rows.

## Impact

**Code:**
- `packages/frontend/src/pages/topicOrder.ts`: add `moveToIndex`, `slotToFinalIndex` and `computeDropSlot` (pure, no DOM).
- `packages/frontend/src/pages/TopicManagementPage.tsx`: `applyNewOrder` and `computeReorderGate` extractions, handle and drop line, drag state, cancel-on-transition effect. The page is already 2,100+ lines; the drag mechanics belong in a separate hook file (design.md Decision 1).
- Frontend tests alongside existing page tests.
- No new runtime dependency.

**Not touched:** backend, shared types, migrations, `session_topics`, the live-session surface, the no-manager rule, simultaneous reveal, facilitator-from-another-team.

**Out of scope:** any backend/API change; ordering assists; undo/redo beyond Discard; persisting a draft across navigation or an in-app navigation guard; dragging between lists (Restore owns archived to active); multi-select drag; a compact reorder view; visually de-emphasizing the move buttons; adoption telemetry; the live-session surface; making a stale conflict preserve the draft.

**Numbers:**
- *Threshold, handle size, dim opacity.* Named provisional constants in the spec table, confirmed at the laptop check.
- *Lists up to about 25 active topics.* A design assumption, delegated to the team lead to confirm; above it drag works but is not tuned.
- *20 kB ceiling.* Dropped as a constraint: with no dependency it is moot.

**Open items:** none blocking. Accessibility confirmation is owned by the implementing developer and verified by the PR reviewer (tasks 6.5). The touch follow-up issue is opened at merge (tasks 7.1).

## Proposal review disposition

Reviews: Marcus Delgado (BA) and Rachel Okonkwo (VP Engineering). Dispositions in my voice as the ritual's founding advisor.

**Gate contradiction (BA Must). Accepted, resolved the other way.** The earlier draft made drag narrower than the buttons whenever an editor or add form was open. That is a new rule on a feature whose whole point is to be a second way to produce the same draft. Drag is now available if and only if the buttons are enabled. A clean open editor does not block it; a drop closes it exactly as a button move does today. See spec "Drag is available exactly when the move buttons are enabled", design Decision 4.

**Reason copy and "visible reason" (BA Must, Exec request 6). Resolved by removing the copy.** With gate parity there is no drag-specific blocked state, so no new string to write or review. A blocked handle is dimmed and inert for the same cause that disables the buttons, and each cause already has its own on-screen treatment. This is a conscious loosening of "never a silently inert handle": the handle is no more silent than the buttons beside it, and a second explanatory voice on a transient state would make the screen feel more like software.

**Announcement string (BA). Accepted.** The source string is the existing template `${name} moved to position ${n} of ${N}`; the drop goes through the same function, and the test compares against the button path's output rather than a copy. No announcement at drag start or while dragging (new scenario).

**Touch and tablet scope (Exec request 2). Accepted: laptop-first.** The use case names tablets for the buttons, which already serve tablets fully. Drag is a convenience for the long move, done at a laptop the day before. This release is mouse, trackpad and pen. I am keeping the issue honest: the handle is built on Pointer Events with `touch-action: none` on the handle only, but touch drag is unverified and not claimed. A follow-up issue is opened at merge. This removes the two-device check, the 44 px target requirement, and long-press handling (BA touch items) from this change; the BA's equivalent laptop checklist record is adopted (R-LAPTOP-CHECK). I am not treating this as a weakening of anything load-bearing: no ritual constraint depends on touch.

**Auto-scroll (Exec request 3). Cut.** Gold-plating for an 11-item default and 25-item assumption. R-NOSCROLL records the absence so it is deliberate. The BA's auto-scroll speed and zone questions disappear with it.

**Effort and fallback (Exec requests 1, and concern 1). Accepted.** Two to three engineer-days; the hook is on the order of 200 to 250 lines plus tests (design.md Decision 1; the earlier 150-line figure is withdrawn). If it passes four days, ship only the shared-path refactor and stop; no library adoption without reopening Decision 1. Cutting touch and auto-scroll is what keeps this small.

**Constraint list (Exec concern 4). Partly accepted.** Constraint 5 (feels like software) is now a guideline, and the 20 kB ceiling is gone. Constraints 1 to 4 stay as written, and I am holding them: they protect the lock, the existing-session guarantee, no auto-ordering, and no metric surface. I am also declining the telemetry again.

**Accessibility owner (Exec request 4). Named by role, not person.** The implementing developer records the keyboard-path check in the PR and the PR reviewer verifies (tasks 6.5). I am not naming myself: I am not the help desk. If Rachel wants a named individual, that assignment is hers or the team lead's to make; I cannot assign people.

**Numbers (Exec request 5, BA). Accepted.** Provisional values are named constants in a spec table with a confirm-by step. The 25-topic assumption is delegated to the team lead.

**Duplicate IDs (BA). Fixed.** The handle one stays R-ARCHIVED; the order one is R-ARCHIVED-ORDER.

**R-AUDIT (BA). Reframed** as an unchanged-endpoint check; backend audit confirmed outside the frontend tests.

**Missing scenarios (BA). Added:** admin without membership, member-facilitator access rule, mixed drag and buttons, two drags in a row, Discard, no announcement during drag, other pointers ignored, window blur, lost capture, cancel bounds, adjacent-gap no-ops, drag-at-ends, row-swipe styling, mid-drag Escape with a dialog, client-only draft. Drop-index semantics (midpoint rule, gaps, ends), cancel focus order, "dimmed in place", and reduced-motion set are defined in the spec. Page size: the hook-in-its-own-file rule is in tasks 2.3.

**Declined or deferred:** per-cause "reason" scenarios (replaced by R-BLOCKED); behavior beyond 25 topics (works, not tuned); refetch-under-drag (unspecified beyond not corrupting the draft).

**Requirements amendment (BA Must). Accepted, timed at merge.** Use case 08's Notes line says drag is deferred to #181, and its "visually reflected immediately" acceptance criterion is met at drop, not during the gesture; both are amended at merge (tasks 7.2) so the requirements never describe unshipped behavior. The requirements folder is not edited now.
