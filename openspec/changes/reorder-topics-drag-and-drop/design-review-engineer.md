# Design review (engineering): reorder-topics-drag-and-drop

Reviewer: Marcus Oyelaran, Full Stack Engineer
Inputs: design.md, proposal.md, and the current `TopicManagementPage.tsx` / `topicOrder.ts`.

## Verdict

Implementable, and the boundaries are mostly clean. The shared draft path (`moveToIndex` + `applyNewOrder`) is the right seam, and the hand-built-hook decision is defensible at this scope. The claims about existing code check out: `savedOrder` comes from `data.active` only, `movesDisabled` matches the quoted expression, the announcement template matches, and the focus queue works as described. There is one structural blocker (hook placement, Must 1) and several gaps that should be fixed in the design before tasks are cut.

## Verified against the code

- `savedOrder = data.active.map(topicId)` (line 665), so archived IDs never enter `draftOrder`. Decision 3 holds.
- `moveTo` returns the input array on a no-op, so `moveToIndex` can reuse it and callers can detect a no-op by identity.
- `moveTopic` (955-981) does exactly the sequence Decision 2 lists. One detail Decision 2 does list but is easy to miss: `setAnnotationSavedTopicId((saved) => saved === topicId ? null : saved)`. It is in the design's "clear saved-definition marker" item, so keep it in `applyNewOrder`.
- `FOCUS_FALLBACKS.up` is `["up","top","down","bottom"]`, and the layout effect skips disabled elements. A drop at position 1 lands on Move down. Decision 6 is correct. A drop at the last position lands on Move up. Fine.
- Frontend uses vitest + jsdom 29 + user-event 14. No existing Pointer Events usage anywhere in `packages/frontend/src`.

## Must fix

### M1. Hook placement vs. early returns (hidden coupling, the real cost of "just wiring")

`TopicManagementPage` returns early at lines 1253 (`loading`), 1255 (`error`) and 1266 (`!data`). Everything that defines the gate, `reorderEnabled` (1283) and `movesDisabled` (1299), is computed after those returns, from a non-null `data`. `useTopicDrag` and the "cancel when the gate goes false" effect (Decision 5) are hooks, so they must be called above line 1253, where `data` is nullable and `movesDisabled`'s inputs (`dialogState`, `restoreDialogState`, `isSaving`, `isStale`, `annotationBusy`, `addSubmitting`) are only partly in scope.

The design says "the page only gains wiring". It does not say how the gate gets above the early returns. Options:
1. Hoist the gate into a `useMemo`/plain boolean computed from nullable `data` above the early returns (`dragAllowed = !!data && !data.isCustomizationLocked && data.active.length >= 2 && !(…movesDisabled inputs…)`), and have the later `reorderEnabled`/`movesDisabled` consts reuse the same pieces. This also removes the risk of two copies of the gate drifting, and the design should require a single definition.
2. Move the drag-bearing list into a child component that mounts only when `data` exists. Cleaner, but a bigger diff on a 2,100-line file.

The design must pick one. I recommend option 1, with `dragAllowed` as the single source for both the handle's inert styling and the hook's `enabled` parameter. Add a test that the handle is inert for each `movesDisabled` cause, so a future edit to `movesDisabled` that is not reflected in the hoisted copy fails.

### M2. `onDrop(topicId, toIndex)` index semantics are ambiguous (off-by-one risk)

The hook reports a drop-slot index from hit-testing against row midpoints. The design says the index "maps directly to an index into `displayedOrder`", but there are two different quantities:
- the insertion slot in the list with the dragged row still present (0..N), and
- the final index after removal (0..N-1), which is what `moveTo(items, from, to)` takes.

Dropping the row at slot k > from needs `to = k - 1`. This is the classic bug in this kind of code and the design leaves it to the implementer. The design should state that the hook emits the final index, or the slot, and that `moveToIndex` converts it, and it should require a table-driven test of `moveToIndex` plus the hit-test over (from, slot) pairs including the adjacent-gap no-ops (slot == from and slot == from+1 both yield no change). The proposal's "adjacent-gap no-ops" scenario hints at this but the design does not own it.

### M3. Row geometry assumption is not stated; rows are not uniform

Rows are tall, variable-height cards: definition text, inline `DefinitionEditor`, the Remove confirmation blocks, the open-items escalation, and the last-active-blocked alert all render inside the `<li>`. Midpoint hit-testing handles variable heights, but:
- Rects must be measured at drag start and re-measured if layout changes. An editor or message can change row heights mid-drag via the `screenMessage` region, `annotationSavedTopicId`, and so on. Decision 5 cancels on gate changes, but not on layout changes that leave the gate open (for example a rate-limit message or the "Saved." status appearing). Say whether rects are measured per `pointermove` (cheap for 25 rows, and the simplest correct choice) or once at start. I recommend per-move `getBoundingClientRect()`; it also covers page scroll by wheel during drag.
- On long rows a drag from the leading-edge handle to the other end of a 25-topic list will exceed the viewport, and auto-scroll is cut. The design argues this is acceptable at about 11 topics. With cards this tall (each easily 150-250 px with definitions) 11 rows already exceeds a laptop viewport, so the "barely overflows" claim in Decision 8 is optimistic. The very case the proposal motivates, moving position 9 to 2, may need a scroll mid-drag. Wheel scrolling during a pointer drag does work natively if hit-testing uses live rects (another reason for per-move measurement), so state that explicitly and manually verify it at the laptop check. Otherwise the feature's headline gesture may not work without a workaround.

## Should fix

### S1. Pointer capture and event-listener strategy are under-specified

The design lists cancel causes (pointercancel, lost capture, blur, release outside, Escape) but not the listener model. Specify: `setPointerCapture` on the handle at pointerdown, `pointermove`/`pointerup`/`pointercancel`/`lostpointercapture` on the capturing element (or window), the active `pointerId` stored and other pointers ignored, and the `blur` and `keydown` listeners attached only while dragging (Decision 5 already says this for Escape). Also address:
- Text selection during drag. `touch-action: none` does not prevent it for mouse drags. Needs `user-select: none` on the list while dragging, or `preventDefault` on pointerdown. A drag across rows that selects text on drop is a visible defect.
- "Release outside the list cancels": with capture, `pointerup` fires on the handle regardless of position, so the hook must hit-test the final coordinates against the list rect itself. Say so.
- Unmount mid-drag (route change, `key={teamId}` remount at line 2122, refetch replacing rows): the hook must remove listeners and release capture in cleanup.
- Refetch mid-drag (the declined "refetch-under-drag" item): the proposal defers this as "unspecified beyond not corrupting the draft". It is a real path: an annotation save or add outcome triggers a refetch while `data.active` changes. If the dragged `topicId` is no longer in `displayedOrder` at drop time, `applyNewOrder` would build a bad array. Minimum requirement: the drop handler validates that the dragged ID is still present and the index is in range, and otherwise cancels. Cheap and it closes the path.

### S2. Stale closures in the drop handler

`moveTopic` is a `useCallback` over `draftOrder`/`savedOrder`. The hook will hold `onDrop` across many renders of a pointer gesture. If the hook caches the callback at drag start it will compute `next` from a stale `current`. Require the hook to read `onDrop` through a ref (latest-callback pattern) or to report `(topicId, toIndex)` and have the page compute `next` from the current `draftOrder ?? savedOrder` at drop time. The latter is what the design implies; make it explicit.

### S3. Focus after a pointer drop

Focus moves to a Move button after drop. For a mouse user this is a visible focus ring jumping to a button; for keyboard-adjacent users it is right. Fine, but confirm that `:focus-visible` heuristics will not show a ring after a mouse gesture (programmatic focus after pointer input usually does not), and that scroll-into-view from `element.focus()` can move the viewport after a long drop. Use `focus({ preventScroll: true })` only if you want to change existing behavior; otherwise note that the existing effect already scrolls and decide whether the dropped row should be what ends up in view. Minor, but it is the one UX side effect of reusing the effect unchanged.

### S4. Test strategy is thinner than "unit tests ship with the feature" implies

Risk 1 accepts that jsdom cannot test geometry and says the integration tests invoke the drop handler directly. Concerns:
- jsdom has no `PointerEvent` constructor in older versions and no layout (`getBoundingClientRect` returns zeros). The design says to inject rects, which is right, so require the hit-test to be a pure function `(rects, y, fromIndex) -> slot`, exported and tested on its own. This is where most real bugs will be.
- The hook's state machine (idle -> pending -> dragging -> idle, threshold crossing, ignoring second pointers, each cancel cause) is testable with `fireEvent.pointer*` once `PointerEvent` is polyfilled (vitest setup or a tiny helper). Check whether this repo's vitest setup already polyfills it. I found no existing pointer usage, so the polyfill is new test infrastructure; add it to the tasks, with `setPointerCapture`/`releasePointerCapture` stubs.
- "Invoke the drop handler directly" does not exercise the wiring from the hook to the page. Add at least one page-level test that drives the hook end to end with stubbed rects (mock `getBoundingClientRect` on the `<li>`s) and checks the Save payload.
- The "buttons == drag" equivalence test is good. Make it property-style over several (from, to) pairs, not one example.

### S5. Gate-parity edge: `isTopicDialogOpen` includes the Restore dialog but drag handle placement is in the active list

Not a bug, just confirm: `movesDisabled` includes `restoreDialogState !== null`. The Restore dialog is opened from the archived section, not from a row. A drag in progress when the facilitator cannot reach it is impossible with one mouse, so Decision 5's transition cancel is mostly defensive for dialogs. It is the stale and saving transitions that matter (keyboard shortcut, async completion of a prior request, `beforeunload`). Keep the effect, but do not spend test effort on opening a dialog mid-drag with a mouse; test it by flipping the gate prop.

## Technology choices

- Hand-built Pointer Events: agreed. The numbers in the candidate table are explicitly approximate and I would not rely on them for anything beyond "all libraries are heavier or older than 150 lines of owned code". The decision does not rest on them, and the fallback rule (stop at four days, land the refactor) is sensible.
- One reservation on the estimate: about 150 lines for the hook only holds if M1-M3 and S1 are not hand-waved. With capture, per-move rect measurement, cleanup, self-hit-testing and the validation in S1, I would plan for 200-250 lines plus the pure hit-test module. That is still inside the 2-3 day band given tests, but the "~150 lines" figure should not become an anchor for the overrun rule.
- Split the pure hit-test (`computeDropSlot`) from the hook into `topicOrder.ts` or a sibling pure file. It keeps `topicOrder.ts`'s "pure array helpers" character if it only takes numbers, and gives the tests a clean target.

## Missing error paths (summary)

1. Dragged topic absent at drop (refetch mid-drag): validate and cancel.
2. Component unmount or `key` remount mid-drag: cleanup of listeners and capture.
3. Pointer released outside the list while capture is held: explicit self hit-test.
4. Text selection during mouse drag.
5. Layout change mid-drag that does not close the gate (messages, "Saved." status): per-move measurement.
6. `setPointerCapture` throwing (it throws `InvalidStateError` if the pointer is no longer active, and some environments lack it): wrap in try/catch and cancel on failure. jsdom lacks it entirely.
7. Browser context menu or middle/right button during drag: the design says primary button only at pointerdown; also cancel on `contextmenu` while dragging (a right click mid-drag with capture can leave the drag stuck on some platforms).

## Minor

- Decision 6 says the cancel path uses the focus queue for the dragged row. Specify which id (the row heading `activeRowHeadingId`, which has `tabIndex=-1`, is the sensible target since the handle is not focusable) so the implementer does not invent one.
- The handle is `aria-hidden` and has a tooltip "Drag to reorder". A `title` on an `aria-hidden` element is not exposed to AT, which is intended, but note that mouse users on a laptop with a screen reader will not know the gesture exists. Acceptable given the buttons are the accessible path.
- Naming: `applyNewOrder(next, topicId, announcement)` takes the announcement as a parameter, but the design also says the announcement template must not diverge. Computing the string inside `applyNewOrder` (it already receives `next` and `topicId`) removes the third parameter and makes divergence impossible by construction. Recommend dropping the parameter.
- Since position numbers and `draftOrder` do not change during drag, the drop line is overlay-only state in the hook. Make sure it does not live in the page's state, or every `pointermove` re-renders a 2,100-line component with 25 large rows. Keep `dropSlot` in hook state and only update it when the slot value changes (not on every move).

## Recommendation

Proceed after addressing M1-M3 in the design text and folding S1, S2 and S4 into the tasks. None of these change the architecture; they remove places where an implementer would otherwise make an unrecorded decision.
