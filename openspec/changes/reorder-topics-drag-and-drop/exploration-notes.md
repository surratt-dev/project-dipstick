# Exploration notes: drag-and-drop for Reorder Topics (#181)

Voice: Devon Calloway, Internal Champion. Sources read: the archived `2026-09-30-reorder-topics` proposal and design (Decisions 8 and 11), the Reorder Topics use case (08), `TopicManagementPage.tsx`, `topicOrder.ts`, and `packages/frontend/package.json`. Revised after the facilitator review (Priya Nair) and the BA review (Marcus Delgado); see "Review disposition" at the end.

Traceability: use case 08 ("drags a topic... (or uses an equivalent reorder control)"); #52 proposal, Decisions 8 and 11; WCAG 2.2 criterion 2.5.7 Dragging Movements.

## 1. What I actually want from this

Reorder is flexibility, not a protective constraint. I said so in the #52 proposal and it still holds. I don't need drag-and-drop hardened. I need it to be a second way to produce the same draft, not a second feature.

Testable form of that: for any sequence of moves, reordering by drag and by buttons SHALL yield the same `draftOrder`, the same dirty state, the same cleared confirmation and error, the same announcement text, and the same Save payload.

Why bother, given buttons already work? Two reasons. The use case says "drags a topic... (or uses an equivalent reorder control)", and the issue owner accepted the deferral only on condition that #181 follows. And the motivating case is the long-distance move: taking the topic at position 9 to position 2 is seven button clicks while watching where focus went. Neighbor swaps are fine with buttons; drag earns its place on moves of several positions.

Who reorders and when: a facilitator preparing for the next session, usually the day before, at a desk, typically to pull a heavy topic away from the end of the hour. Calm, unhurried, laptop first. Reordering happens from team settings only. It never happens inside a live session, and a session already open is never touched. This is a handful of times a year per team. That frequency is why the cost must stay proportionate (section 3), not a reason to drop the feature, since the use case commits to it.

User story: as a facilitator preparing for the next session, I move the last topic to near the top in one gesture.

## 2. Ritual constraints in play

None of the protective ones are touched. I checked each:

- **First-session lock.** Drag SHALL be available if and only if the Move up/down controls are enabled. When the team is customization-locked, or fewer than two active topics exist (this includes the zero-topic recovery path from #200), no handle, drag listener, or drag cursor SHALL be rendered. One shared gate, not a second flag: a second flag is how a lock bypass gets born. The locked page gives no new copy. It shows whatever reason the buttons already show, and the handle is simply absent.
- **Order never reaches an existing session.** Unchanged, because the server writes only `topics`. Drag changes only the client draft. The pinned copy ("Order changes apply to sessions opened after you save...") SHALL remain rendered, unchanged, from drag start through drop, and stay visible after a successful Save. Tests assert the exact string.
- **No automatic ordering.** Drag SHALL NOT snap, auto-reorder, suggest, or sort topics. The resulting order SHALL equal the dragged topic placed at the dropped index with all other topics in their prior relative order.
- **Not a performance or metric tool.** No new data is shown or collected. The audit row `topic.reordered` with `{previous_order, new_order}` is the only trace. A cancelled or no-op drag writes none. No adoption telemetry (for example share of reorders by drag) is added; that would be new data collection and I am declining it.
- **Software that feels like software.** Each active row SHALL show exactly one drag handle. No animation SHALL run during a drag other than the drop indicator, and none at all under `prefers-reduced-motion: reduce`. No toast, count, or celebration on drop.
- **Open source, on-prem deployable.** Dependency constraints are in section 3.
- **History.** Reorder does not touch retained data for removed or archived topics. It writes the ordered ID list only.

## 3. Dependency versus hand-built

The frontend today has four runtime deps: react, react-dom, react-router-dom, and the shared package. No UI library, all styling inline. Every dependency here is a precedent.

The choice between a library (dnd-kit family, hello-pangea/dnd) and hand-built Pointer Events belongs to design.md, made from a spike. I am not choosing in this document. What the proposal fixes are outcomes any mechanism must satisfy, and the dependency constraints:

- Native HTML5 drag-and-drop is not acceptable as the only mechanism (no touch in most mobile browsers, no keyboard story).
- Whatever is used SHALL defer to the page's existing draft, focus-restore, and single live-region rules. A library SHALL NOT add a second live region, take over focus, or introduce a second keyboard model; its keyboard sensor, if any, is off, since the buttons are the keyboard and switch path.
- Any added dependency SHALL be OSI-approved permissive, with no hosted service and no telemetry, a release within the past 12 months, and no open critical security advisory at proposal time.
- Added gzipped JS SHALL be measured and recorded in design.md. Ceiling: 20 kB gzipped; going over needs a recorded justification that I sign off.
- The decision, including the rejected option and why, is recorded as Decision 11 was.

If hand-built, the owned surface is: drag threshold, auto-scroll, hit-testing, `touch-action: none` on the handle, cancel on Escape and `pointercancel`. That is a bigger surface than the page's reorder logic today, which is why the spike matters.

## 4. Accessibility: pointer, touch, keyboard

Principle: **drag is an enhancement; the buttons stay the accessible path.** WCAG 2.5.7 wants a single-pointer alternative to a drag, and we have one.

Decisions:

- **Pointer.** Drag by a handle only, never the whole row. A pointer movement under the drag threshold from pointerdown SHALL NOT start a drag (value T set in design).
- **Handle is `aria-hidden` and not focusable.** Decided. It is pointer-only; the always-visible adjacent buttons are the equivalent. The spec says why. The accessibility confirmation owner is whichever role the agent team names for accessibility review; if none exists, this decision stands on the 2.5.7 reasoning and the gap is noted in the proposal. The handle has a grip icon, a grab cursor, and a hover tooltip "Drag to reorder". No tutorial, no coach marks.
- **Touch.** Immediate drag from the handle. Long press is a fallback only if real-device testing shows accidental drags. Acceptance: scrolling by swiping on a row body SHALL still scroll the page and SHALL never move a topic. Touch stays in v1 because the use case and #52 name the tablet, but laptop is the primary device and tablet secondary.
- **Auto-scroll.** While dragging within N px of the top or bottom viewport edge, the page SHALL scroll continuously until the pointer leaves that zone or the drag ends (N set in design, around 60 px).
- **Drop indicator.** A single drop line between rows, no live preview. The dragged row stays visible (dimmed in place), never vanishing. The line must be unambiguous in any row height.
- **Screen readers** use the buttons. On drop, exactly one live-region message SHALL be emitted, worded as the button path: "{topic} moved to position n of N". None on hover, none on cancel.
- **Cancel.** Escape, `pointercancel`, or release outside the list cancels. "Outside the list" and drops on the archived section or any non-list target mean cancel, never "drop at nearest end". Cancel leaves the draft exactly as before and returns focus to the moved row's Move up control (not `<body>`).

## 5. Interaction with the existing code

Facts from `TopicManagementPage.tsx` and `topicOrder.ts`:

- The draft is `draftOrder: string[] | null` (null means clean). `moveTopic(topicId, action)` applies a pure helper, stores `null` if the result equals the saved order, clears the confirmation and error, sets the announcement and queues focus.
- Helpers in `topicOrder.ts` return the input array itself for a no-op.
- Focus is restored with a queue of element ids and a `useLayoutEffect`, because React's keyed `<li>` moves blur focused elements.
- Moves are disabled while saving, stale, or while a Remove/Restore dialog is open. Remove and Restore are disabled while dirty.
- The `beforeunload` guard arms on `isDirty`.

What drag must do:

1. **One draft, one code path.** Add a pure `moveToIndex(items, from, to)` to `topicOrder.ts` over the existing private `moveTo`. Have `moveTopic` and the drop handler share one `applyNewOrder(next, topicId, announcement)` so clearing confirmation and error, collapsing to `null` when equal, and announcing cannot diverge. This extraction is the one refactor the feature needs.
2. **Same disable rules.** Drag is off whenever the buttons are disabled (saving, stale, dialog open, locked, under two topics).
3. **Open editors and add form (decided).** Drag SHALL be disabled while any definition editor or the add form is open, with the same visible-reason pattern used for Remove. A silently inert handle is not acceptable. This also means rows are never at expanded-editor height during a drag.
4. **Mid-drag transitions (decided).** If the page becomes stale, a save begins, or a Remove/Restore dialog opens during a drag, the drag is cancelled and the draft is unchanged.
5. **Do not mutate the draft during the drag.** `draftOrder` and the displayed position numbers are unchanged until drop; commit once, on drop. A cancelled drag, or a drop on the starting slot, does not dirty the draft, arm `beforeunload`, announce, or write an audit row. Dragging back to the saved order collapses `draftOrder` to null, as buttons do.
6. **Focus after a drop (decided).** `document.activeElement` SHALL be the moved row's Move up control, or Move down if the row is now first. Never `<body>`. Uses the existing focus queue.
7. **One live region.** The existing unconditionally mounted region is reused; the page has exactly one for reorder announcements.
8. **Archived topics.** Only active rows have a handle. Archived topics are not drop targets, and dragging never changes which topics are archived. The drop index is among active rows and SHALL map correctly into the saved full order; if `draftOrder` carries archived IDs, they keep their relative positions. A test with archived topics interleaved is required.
9. **Position numbers** stay `index + 1`.
10. **Stale and concurrent editing.** Server 409 `TOPIC_ORDER_STALE` handling is unchanged and independent of how the draft was made; drag adds no new conflict scenario. Design confirms and the proposal quotes what the facilitator sees and whether the draft is kept; if that behavior is poor today it is a separate issue, not this change.
11. **No backend change.** The PUT takes the full ordered ID list; drag produces the same list. No migration, API, or schema change.
12. **Layout.** The handle sits at the row's leading edge, visually separated from Remove/Archive so a slip cannot land on a destructive control. Spacing checked in the tablet and laptop pass.
13. **Supported size.** Designed for lists up to about 25 active topics (default set is about 11); behavior beyond that is unspecified.

## 6. What could go wrong if the design drifts

Ordered by how much I'd worry:

1. **Drag becomes the primary path and the buttons rot.** Someone "simplifies" the row by removing the four buttons. That breaks tablet, switch and screen-reader users and fails 2.5.7. R-BTN below is a SHALL with a failing test.
2. **Two code paths drift apart.** Prevented by the shared apply function and tests that run the same assertions against both.
3. **Accidental drags change the order unnoticed.** Mitigations: handle only, threshold, Escape, and the Save/Discard bar. Nothing persists until Save.
4. **Unlocked-drag in a locked team.** Test the locked page for zero handles and listeners.
5. **Library takes over focus or live regions.** Excluded by the section 3 outcomes.
6. **Test blind spot.** jsdom has no layout, pointer geometry, or touch. Unit-test pure functions, integration-test draft semantics by firing the drop handler directly, and do a named manual device check. A synthetic event passing is not "tested".
7. **Dependency creep and bundle weight** for a screen used a few times a year per team. Ceiling in section 3.
8. **Drag leaks into the live-session surface.** It must not.
9. **Draft lost on navigation.** Accepted for v1 and unchanged. The `beforeunload` guard SHALL arm on any committed drag, with plain wording, and a test confirms it fires in the normal flow.

## 7. Scope and out-of-scope

In scope: pointer and touch drag via a handle on each active row, single drop line, Escape cancel, auto-scroll, shared draft logic, focus restore and one announcement on drop, disabled whenever buttons are disabled or an editor/add form is open, handle tooltip, reduced-motion respect.

Out of scope, to be said in the proposal: any backend, migration, or API change; any ordering assist; undo/redo beyond Discard; persisting a draft across navigation or an in-app navigation guard; dragging between lists (Restore owns archived to active); multi-select drag; compact or collapsed reorder view; visual de-emphasis of the move buttons; adoption telemetry; the live-session surface.

## 8. Acceptance conditions (to become spec scenarios)

- **R-BTN.** The four move controls SHALL remain rendered and operable on every active row whenever a handle is present. A test fails if any button is absent while a handle is present.
- **R-LOCK.** Locked team: zero handles, no drag listeners.
- **R-MIN.** Fewer than two active topics (including zero): no handle.
- **R-COMMIT.** Clean draft, drop at a different index: `draftOrder` is the new order, Save/Discard appears, `beforeunload` arms, prior confirmation and error cleared, one announcement.
- **R-NOOP.** Drop on the starting slot: `draftOrder` stays null, no bar, no guard, no announcement.
- **R-REVERT.** Drags returning to the saved order collapse `draftOrder` to null.
- **R-CANCEL.** Escape, `pointercancel`, or release outside the list: draft as before, no announcement, focus on a defined row control.
- **R-NOMUT.** `draftOrder` and position numbers unchanged until drop.
- **R-FOCUS.** After a committed drop, focus is the moved row's Move up (Move down if first).
- **R-LIVE.** Exactly one `aria-live` region for reorder announcements, before, during and after a drag.
- **R-DISABLE-MID.** Stale, save start, or dialog open mid-drag cancels the drag, draft unchanged.
- **R-EDITOR.** Open definition editor or add form: handles not interactive, with the same visible reason text used for Remove.
- **R-ARCHIVED.** Archived topics have no handle, are not drop targets, and a drop among interleaved archived topics yields the correct full order.
- **R-SAVE.** Save of a drag-produced draft sends the same full ID list the button path would. A 409 `TOPIC_ORDER_STALE` is handled as today.
- **R-AUDIT.** One `topic.reordered` row per saved drag-produced order; none for cancel or no-op.
- **R-LIVESESSION.** No handle, listener, or reorder text on any live-session view.
- **R-NOBACKEND.** No migration, API, or schema change.
- **R-TOUCH.** On the named devices, dragging from the handle reorders with no page scroll under the finger, and swiping on a row body scrolls and never reorders. Verified manually, result recorded.
- **R-RM.** Under `prefers-reduced-motion: reduce`, no animated settle.

## 9. Resolved decisions and what remains for design

Resolved here: editors and add form disable drag; focus lands on Move up (Move down if first); handle `aria-hidden` and non-focusable; touch is immediate from handle; mid-drag disabling cancels; outside drops cancel; archived rows excluded; single drop line; announce only, no toast; buttons remain as a SHALL.

Real-device check: one iPad on Safari and one Android tablet on Chrome, plus a laptop browser pass, run by the facilitator persona as in #52 (8.1). Laptop first, tablet second.

Left to design: library versus hand-built (section 3 constraints), the values T and N, and the stale-conflict wording check.

## 10. How I'll judge it

This is my judgment as the champion, not an observable metric, and no telemetry will be added to make it one. I'll sign off if: a team with no one to explain it can reorder by drag or by button and get identical results; the locked state shows neither; nothing the ritual protects has moved; the buttons are untouched; a cancelled or no-op drag leaves no trace; and the added dependency, if any, is OSS, within the ceiling, and recorded as a decision.

## Review disposition

**Accepted (facilitator):** state the long-distance move as the motivating case and add the user story; state who reorders and when, settings only, never mid-session; pinned copy visible after Save; archived topics excluded from handles and drop targets; single unambiguous drop line with the dragged row staying visible; handle spacing from destructive buttons; grip icon, tooltip and cursor for discoverability; locked state uses the buttons' existing reason copy; touch-scroll-never-reorders as acceptance; `beforeunload` must fire in the normal flow; one announcement per drop; laptop-first then tablet test order; honest statement that drag's value is long moves.

**Accepted (BA):** all of section 1 as concrete decisions (editors, focus target, handle non-focusable, immediate touch, named devices, mid-drag cancel, outside-drop cancel, archived rows); the rewrites that turn preferences into testable statements; R-BTN through R-RM as acceptance conditions; archived IDs in `draftOrder`, zero-topic state, concurrency, history preservation, list size, and traceability gaps; moving the library choice to design with only dependency constraints (license, 12-month release, advisory, 20 kB ceiling, recorded decision) stated; adding undo/redo and draft persistence to out of scope; being honest that section 10 is judgment, not a measure.

**Rejected or narrowed, with rationale:**
- *Compact or collapsed rows while dragging, and heavy auto-scroll alternatives.* Open editors already disable drag, so rows are not expanded during a drag. A reorder view is a new mode and inflates scope. Auto-scroll stays.
- *Undo of the last move.* Scope inflation. Discard is the recovery and is one click; this adds state to a draft model deliberately kept simple. Listed out of scope.
- *Dropping or reducing touch because the use is desktop-first.* Narrowed only: laptop is primary and tablet secondary, but the use case and #52 name the tablet, and the tool must not stiffen for facilitators on one.
- *Visually receding the four buttons.* It risks the R-BTN guarantee and invites the removal drift I worry about most. The buttons stay unchanged. Chrome concern is addressed by exactly one handle and no extra feedback instead.
- *New locked-state copy for the handle.* Rejected as extra copy; reuse the buttons' reason.
- *Adoption signal such as share of reorders via drag.* Declined; it needs new data collection and conflicts with the no-new-data stance.
- *Making a stale conflict preserve the draft.* Not changed here; handling stays as today, with design confirming and quoting it. Any improvement is a separate issue.
- *A named accessibility reviewer.* I cannot create a role; the decision is made on the 2.5.7 reasoning and the missing owner is flagged for the agent team.
