# Tasks review (Business Analyst, Marcus Delgado): reorder-topics-drag-and-drop

Scope: do tasks.md, taken together, cover every proposal capability and every spec scenario, and is anything lost between requirements and tasks?

## Verdict

Approve with minor changes. There are no Must-level gaps. Every named scenario (R-code) in the spec maps to a task, and every proposal constraint (1 to 5) has an owning task. The items below are small traceability and test-coverage holes, plus two stale or ambiguous statements that could cause a "what did you mean" later.

## Coverage matrix (summary)

| Spec / proposal item | Task(s) | Status |
|---|---|---|
| R-BTN, R-HANDLE-COUNT, R-LOCK, R-MIN, R-ARCHIVED, R-ARCHIVED-ORDER | 3.1, 4.1 | Covered |
| R-UNMOUNT, R-REFETCH, R-GATE-PARITY, R-BLOCKED, R-CLEAN-EDITOR, R-DISABLE-MID | 2.3, 3.2, 3.3, 4.2 | Covered |
| R-THRESHOLD, R-COMMIT, R-NOOP, R-ENDS, R-REVERT, R-NOMUT, R-BUTTON-ONLY, R-CANCEL | 1.1, 2.2, 2.3, 3.4, 4.2 | Covered |
| R-FOCUS, R-LIVE, R-RM, R-ROW-SWIPE, R-NOSCROLL, R-LIVESESSION, R-CONST | 3.4 to 3.6, 4.2 | Covered |
| Drag and buttons equivalent, R-MIXED, R-DISCARD | 4.3 | Covered (every from/to pair in 5 items) |
| R-ACTOR-ADMIN, R-ACTOR-MEMBER | 4.4 | Covered |
| R-SAVE (PUT body, 409 stale) | 4.5 | Covered |
| R-AUDIT | 5.3 | Covered, with the honest split between frontend tests and backend/manual evidence |
| R-NOBACKEND, no telemetry (proposal constraint 4), no dependency (constraint 5) | 5.2 | Covered |
| R-LAPTOP-CHECK, constants written back to the spec table | 6.1 | Covered |
| Pinned copy unchanged (constraint 2) | 3.5, 4.6 | Covered |
| First-session lock and zero-topic recovery (constraint 1) | 3.1, 3.2, 4.1 (R-LOCK, R-MIN) | Covered |
| No automatic ordering (constraint 3) | 1.1, 3.4 | Covered only implicitly (see 5) |
| Requirements amendment, touch follow-up, accessibility owner | 6.2, 6.3, 6.4 | Covered |
| Topic history preservation (archived untouched) | 3.1, 4.1 R-ARCHIVED-ORDER | Covered |

## Findings

### Should fix

1. **Escape routing when a dialog is open has no explicit task.** The spec (R-DISABLE-MID) says "an Escape pressed while a dialog is open reaches the dialog only", and the proposal lists "mid-drag Escape with a dialog" as an added scenario. Task 3.3 cancels the drag when the gate closes, and 4.2 lists R-DISABLE-MID, but nothing says the hook's Escape listener must not swallow or `preventDefault` the key, or that the test asserts the dialog still closes on that same Escape. Add one clause to 2.2 or 3.3 and one assertion in 4.2.

2. **Handle presentation requirements are implemented in 3.1 but never asserted.** The spec requires the leading-edge position, Remove at the trailing edge and not adjacent in DOM order or layout, the grip icon and grab cursor, the "Drag to reorder" tooltip, and the not-focusable "tab order" scenario (an unnamed scenario, so it has no R-code and is easy to drop). R-HANDLE-COUNT as written checks count, `aria-hidden`, tab order and size only. Add to 4.1: tooltip text, leading/trailing placement, and a tab-through test that never lands on the handle.

3. **Cancel-target scenarios are only partly listed.** The spec says release over the archived section, the Save/Discard bar, the page header, or any non-list target cancels and does not drop at the nearest end. Task 3.4 says "archived section, Save bar or any non-list target" but 4.2 R-CANCEL only names the outside-the-list and archived cases in the spec text. Make 4.2 assert a release over the Save/Discard bar and over the header, not just the archived section, and assert it does not snap to the nearest end.

4. **R-ACTOR-MEMBER has a denied-screen branch.** The spec says "or the screen is denied" yields no handle. 4.4 names only member access rule. Add the denied/403 render case to 4.4.

5. **"No automatic ordering" (constraint 3) is not a test.** The result must be "the dragged topic at the dropped index with all others in prior relative order". 4.3's equivalence property against the button path covers this indirectly, and 1.1 has hand-written expectations. I would accept that, but say so in 4.3 so the traceability is visible; otherwise the constraint looks unowned.

### Consider

6. **Text-selection and capture-release requirements have no test.** The spec's cancel requirement says text selection SHALL NOT occur across rows, and pointer capture is released on unmount. 2.2 implements `user-select: none`, 2.3/R-UNMOUNT checks listeners are removed, but neither asserts `user-select` while dragging or `releasePointerCapture` on unmount (the spec says "release pointer capture"). Add both to 2.3.

7. **Lists above about 25 topics.** The spec says drag SHALL still function above 25 with no performance guarantee. No task exercises a list of, say, 30 items. A single smoke case in 2.3 or 4.3 is enough. Separately, the proposal delegates confirming the 25-topic assumption to the team lead, but no task records that confirmation; add a line to 6.1 or the PR checklist so it is not left open.

8. **Stale signature in the proposal.** The proposal says `applyNewOrder(next, topicId, announcement)`; task 1.2 (correctly, for parity) computes the announcement inside from `next` and `topicId`. Update the proposal text, or note the deliberate change in 1.2, so the two documents do not disagree. Also, the proposal lists only `moveToIndex`; tasks add `slotToFinalIndex` and `computeDropSlot`. Harmless, but the proposal's Impact list is now incomplete.

9. **Touch wording tension.** The spec lets a drag start by "a pen or touch contact", yet touch is explicitly unverified and unclaimed, while `touch-action: none` is on the handle. That is consistent only if nobody tests or documents touch. 6.2 already says do not claim touch support; I would add the same sentence to the PR/release-note step so a tablet user who tries it and sees partial behavior is not a surprise. No change to scope needed.

10. **Traceability from implementation tasks to spec.** Sections 2 and 3 do not cite R-codes; only section 4 does, in bulk lists. A reader cannot tell which implementation task satisfies which scenario without cross-reading. Suggest appending the R-codes to each of 3.1 to 3.5 (for example 3.3 names R-DISABLE-MID and R-REFETCH). This is cheap and serves the "first place the team looks is the requirements docs" goal.

11. **Requirements amendment (6.4).** Good that it is timed at merge. Two additions: grep the rest of `requirements/` for other statements that drag is deferred (the use case 08 Notes line is the only one named; the proposal docs or FR list may repeat it), and note the openspec delta spec must be synced to the main `topic-management-screen` spec at archive, since 6.1 writes confirmed constants back to a table in the delta.

### Observations (no action)

- Ordering of work is sound: the shared draft path (section 1) ships as a standalone fallback under the 4-day overrun rule, so the commitment to the #52 owner is not hostage to the hook.
- 4.7 is candid that jsdom cannot prove real geometry or touch, and 6.1 compensates with the manual laptop check. This is the right division; I would not weaken it.
- Persona-critical properties check out: archived topics (history preservation) are explicitly untouched; the live-session surface is untouched (R-LIVESESSION); nothing about reveal or facilitator/participant separation is affected.
- The "zero or one session" empty-state concern is not relevant here; the zero-topic recovery case is covered by R-MIN.

## Summary of requested task edits

- 2.2/3.3 and 4.2: Escape must reach an open dialog; assert it.
- 4.1: assert tooltip, leading/trailing placement, handle not in tab order.
- 4.2: cancel on release over Save/Discard bar and header, no snap to nearest end.
- 4.4: denied screen renders no handle.
- 2.3: assert `user-select: none` during drag and `releasePointerCapture` on unmount; add one 30-item smoke case.
- 6.1: record the team lead's confirmation of the 25-topic assumption.
- 1.2 / proposal: reconcile the `applyNewOrder` signature.
- 6.4: search the rest of `requirements/` for other "drag deferred" statements; sync delta spec at archive.
- 3.1 to 3.5: cite the R-codes each task satisfies.
