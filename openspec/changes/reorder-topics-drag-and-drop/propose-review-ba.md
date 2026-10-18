# Proposal Review: reorder-topics-drag-and-drop (Business Analyst)

Reviewer: Marcus Delgado, Senior Business Analyst
Scope read: proposal.md, specs/topic-management-screen/spec.md, and against requirements/ (use cases/08 Topic Management, BRD FR-2.7 and FR-8.2, Feature Sets).
Did not read the other reviewer's file.

## Verdict

Approve with required changes. This is better specified than most proposals. The core behavior (one shared draft path, equivalence with buttons, lock gating, no backend change) is testable and traces cleanly to the Reorder Topics use case and FR-8.2/FR-2.7. The gaps are: (1) several SHALL statements rely on values or wording that live only in design.md or are undefined, (2) a few internal contradictions, (3) the requirements documents still say drag is not provided, and (4) some edge cases are unspecified. None are large. Items marked **[Must]** should be fixed before implementation starts.

## Traceability check against requirements/

- Use case "Reorder Topics" main flow step 3 names drag first ("drags a topic... or uses an equivalent reorder control"). This change closes that. Good.
- **[Must] Use case Notes (08, line 368) states "Drag-and-drop is not provided in v1 (deferred to #181)."** The proposal does not list the use case document as an artifact to update. Add a task to amend the Notes, and decide whether the acceptance criteria get a drag item. Otherwise the requirements contradict the shipped behavior the day this merges.
- **[Must] Use case step 4 / AC 3: "displayed order updates in real time... visually reflected immediately when the Facilitator moves a topic."** The spec deliberately does NOT reorder rows during drag (R-NOMUT; only a drop line shows). Reasonable design, but it is a divergence from the written AC. State explicitly in the proposal that the "immediately" criterion is satisfied at drop, not during the gesture, so nobody later files it as a defect.
- Use case alternate flow "Only one topic exists: controls not shown or disabled" is covered by R-MIN. Good.
- FR-8.2 (facilitator not on the team, or Application Administrator) is the actor rule. Neither the proposal nor spec has a scenario that an Application Administrator with no membership gets the handle, or that a member-facilitator does not (the page access rule is inherited, but the handle gate is specified only by lock and count). Add one scenario: handle presence follows the same access rule as the move buttons.
- Out-of-scope list in the proposal matches the use case Out of Scope (no auto-ordering, no in-session reorder). Consistent.

## Capability-by-capability assessment

### 1. Drag handle (presence, appearance, gate)
Implementable? Mostly.
Vague or missing:
- "visually separated from the Remove control": no measure. Suggest: handle is at the leading edge, Remove is at the trailing edge, and they are not adjacent in DOM order. Or a minimum separation.
- "grip icon, grab cursor": fine, but no minimum touch target. Tablet is the stated use. Suggest: handle hit area at least 44x44 CSS px (consistent with WCAG 2.5.5 target guidance, and 2.5.8's 24 px minimum at the least).
- **[Must] Tooltip "Drag to reorder" on an `aria-hidden`, non-focusable element** is invisible on touch (no hover) and to AT. That is acceptable for the AT case, but on the tablet the tooltip is the only discoverability aid, and it never shows. Say so, or specify a visible label. Also confirm that "no tutorial or coach marks" still lets a tablet user find the handle: the grip icon must carry it.
Concrete conditions:
- Given unlocked, >=2 active topics, no blocker: N active rows render N handles (count equals active row count), 0 on archived rows.
- Handle has `aria-hidden="true"` and `tabindex` absent or -1; tab sequence per row is exactly the four move buttons plus existing controls.
- Handle hit area >= 44x44 px (or state the chosen value).

### 2. Availability gate and blocked state
Implementable? Needs clarification.
- **[Must] Internal contradiction.** Requirement title: "Drag is available only when the move buttons are enabled and no editor or add form is open." Body: "Drag SHALL never be available when the move buttons are disabled for the same cause." Neither says what the buttons do while an editor is open. If buttons stay enabled while an editor is open, the drag gate is strictly narrower than the button gate, which is a new rule for the page and conflicts with the "second way to produce the same draft" framing. State which, with a scenario.
- **[Must] "SHALL carry a visible reason" vs scenario "exposes a reason in its tooltip".** A tooltip is not visible on touch and is not "visible" in the SHALL sense. Pick one. Also the reason copy is explicitly unwritten (proposal open item). Specs should not be approved with a SHALL on copy that does not exist. Draft the string now (for example "Close the open editor to drag"), with one string per cause or a single generic string, and state which.
- The blocked list has redundancy ("no definition editor is dirty or saving" and "no definition editor is open"). Collapse to "no definition editor is open", unless dirty/saving covers a case where the editor is closed. If so, say which.
- Handle that is "non-interactive": is it still rendered, dimmed, with cursor not-allowed? Specify (rendered, `aria-disabled` not needed since aria-hidden, cursor not-allowed, no pointer handlers).
Concrete conditions:
- Each blocker (save in flight, stale, Remove dialog, Restore dialog, editor open, add form open, add request in flight) gets one scenario: handle rendered, pointerdown+move produces no drag, reason is present.

### 3. Drop commit and equivalence with buttons
Strongest part. Testable as a property test (drag sequence vs button sequence, same `draftOrder`, dirty, cleared confirmation/error, announcement, payload).
Gaps:
- **[Must] "Drag threshold" is used in the SHALL but the value is only in design.md (5 px) and the proposal calls it a "starting value for the device check".** A requirement that cannot be tested without reading another document is not explicit. Either put "5 CSS px (provisional, to be confirmed by R-TOUCH)" in the spec or define the acceptance as "a pointer movement under T does not start a drag and a movement of T or more does", with T stated. Same for the auto-scroll zone N (60 px) and scroll speed.
- **Drop-index semantics are undefined.** "Drop line between rows": what determines the line position (pointer above or below row midpoint)? Dropping into the gap directly above or directly below the dragged row are both no-ops (R-NOOP says "starting slot"); say so, since a reviewer could read "starting slot" as only the row itself. Add: dropping in the gap after the last row yields position N; before the first row yields position 1.
- "dimmed in place": no value. Suggest "opacity reduced; row stays at its original position and keeps its position number".
- **Duplicate scenario ID: R-ARCHIVED appears twice** (handle spec and drop spec). Rename one (e.g., R-ARCHIVED-ORDER), since the IDs are being used as test names.
- R-AUDIT ("one `topic.reordered` row per saved drag order") is a backend behavior, not drag behavior; the frontend change cannot cause or test it. Reword as "a Save of a drag-produced draft calls the same endpoint as today; audit behavior is unchanged", or mark it as an end-to-end check.
- The announcement text is "{topic} moved to position n of N". **Verify this matches the existing button announcement verbatim** and quote the source string in the spec or a test; "worded as the button path" is a pointer, not a requirement.
- Right/middle mouse buttons, a second simultaneous touch, text selection, and context menu (long-press) during drag: unspecified. Suggest: only the primary button/first pointer starts a drag; other pointers during a drag are ignored; long-press on touch does not open a context menu or start text selection on the handle.
Concrete conditions:
- Positions 1..N: for every (from,to) pair with from != to in a 5-item list, result equals buttons applied to the same effect (property test).
- from == to, or drop in the adjacent gap on either side: `draftOrder` stays null, no bar, no announcement.
- Drop returning to saved order: `draftOrder` null (R-REVERT, already good).

### 4. Cancel
- "Release outside the list": define the list bounds (the active topics container? including padding and the Save bar?). The archived section is called out, but what about the page header, the Save/Discard bar, or off-window? Suggest: the active-list container's bounding box, evaluated at pointerup, with off-window release also cancelling.
- **Focus on cancel: "Move up control (falling back to the row's other enabled move controls)".** Specify the fallback order. Row 1's Move up is disabled. Use the same order as the drop rule (Move up, then Move down).
- Not specified: window blur, tab visibility change, orientation change/resize, browser Back during a drag, the topic list changing underneath (refetch). The proposal does cover stale/save/dialog (R-DISABLE-MID). Add: window blur and `visibilitychange` cancel, others "unspecified, must not corrupt draft" at minimum. Resolve what happens to focus after R-DISABLE-MID cancel (to the dialog opener or the dialog, not body).
- Escape while a dialog is open: which Escape wins? R-DISABLE-MID cancels on dialog open, so Escape should reach the dialog only. State it.

### 5. Focus and announcement after drop
Explicit and testable. Minor: "Move up, or Move down if the row is now first", but if N>=2 and the row is both first... fine. State: because the list re-renders, the focus target is the same DOM row by topic id, not by index. Test it with focus moved after React reorder.
"Exactly one aria-live region ... before, during, and after": a count assertion is fine. Also state that no announcement fires on drag start or during dragging (screen reader users of pointer devices exist). I'd add a scenario for that.

### 6. Touch, scroll, reduced motion
- **[Must] R-TOUCH is manual and defines no pass/fail record.** "The result is recorded" – where, by whom, in what form? Suggest: a short checklist in tasks.md with device, browser version, date, and pass/fail per item (handle drag works with no page scroll; row swipe scrolls and does not reorder; drop at far end with auto-scroll; Escape/cancel where hardware keyboard is attached). Without that it will be marked done unverified.
- "page SHALL scroll continuously" with no speed. Say: speed scales with proximity, or a fixed px/s. At least say it is bounded.
- Reduced motion: "no animated settle". Define the set: no transition on the dragged row or drop line movement, and auto-scroll uses instant (not smooth) scrolling. The dim and drop line are not animation. Note the proposal says "no animation other than the drop line" while the drop line moving between slots is an animation if transitions are used; say it snaps.
- Handle must suppress native touch panning and gestures (`touch-action: none` on the handle only). Make this an explicit requirement or the row-body-swipe scenario cannot hold.
- Lists up to about 25 topics are the design assumption; beyond that "unspecified". Fine for the proposal, but add a scenario at 25 (with scroll) and say what is expected at, say, 50: still functions, no performance guarantee.

### 7. No backend change / constraints
Good and explicit. "No telemetry" and "no new data" are clear. Constraint 5 ("ritual should not feel like software") is a design intent; the testable parts (one handle per row, no toast) are already covered. Constraint 6 dependency criteria apply only if a library is introduced; since Pointer Events are hand-built, state that the dependency count check is "package.json has no new runtime dependency" so it is testable.

## Vague language list

| Phrase | Where | Fix |
|---|---|---|
| "drag threshold" | drop requirement | state value (5 px provisional) |
| "auto-scroll zone", "continuously" | touch requirement | state N and speed |
| "a visible reason" / "in its tooltip" | gate requirement | choose; write the string |
| "visually separated" | handle requirement | measurable separation |
| "dimmed in place" | drop requirement | opacity value or style token |
| "the list" (release outside) | cancel requirement | define bounds |
| "the starting slot" | R-NOOP | include both adjacent gaps |
| "worded as the button path" | announcement | quote the exact string |
| "the result is recorded" | R-TOUCH | where and in what form |
| "no animated settle" | R-RM | enumerate |
| "equivalent" (state) | proposal Why | already defined by the testable form; keep that form in the spec |
| "about 25 active topics" | proposal | acceptable if spec says behavior at larger sizes is "works, not tuned" |

## Missing edge cases to add as scenarios

1. Application Administrator without membership: handle appears (FR-8.2).
2. Facilitator who is a member of the team: unchanged from current access rule (no handle where buttons are absent).
3. Drag then a 409 `TOPIC_ORDER_STALE` returned by an in-flight save is not possible (save blocks drag), but drag in progress when another tab saves has no effect until Save: state that the draft is client-only and stale is discovered at Save, as today.
4. Drag starts from a draft that already contains button moves (mixed sequence): result equals applying both in order. Covered by the equivalence statement, but add one mixed scenario.
5. Two drags in a row without Save: each updates the same draft; one announcement per drop.
6. Draft dirty, Discard clicked: drag-produced draft discarded identically.
7. Page loses the unlocked state mid-session (first session completing elsewhere is the reverse; lock cannot reappear). Skip.
8. Zero topics (#200 recovery) and one topic: R-MIN covers it.
9. Handle used with a mouse on a desktop with keyboard focus currently on a move button: focus after drop moves to the dropped row's control. Covered by R-FOCUS.
10. Pointer capture lost (element removed during drag): treated as `pointercancel`.

## Concrete acceptance conditions I would like in the spec (consolidated)

- AC-1: With N>=2 active topics, unlocked, no blocker: exactly N handles; each `aria-hidden`, absent from tab order; four move buttons present on each row.
- AC-2: With locked team, N<2, or any listed blocker: no drag can start; for blockers (not lock/count) the handle is rendered with the reason; for lock/count no handle and no listeners.
- AC-3: A pointer movement < 5 px does not start a drag; >= 5 px does (value confirmed by R-TOUCH).
- AC-4: During drag, `draftOrder` and position numbers unchanged; exactly one drop line shown; dragged row remains in place, dimmed.
- AC-5: Drop at index != start: `draftOrder` equals buttons' result; Save/Discard bar appears; unload prompt armed; confirmation and error cleared; one announcement with the exact existing string; focus on Move up (or Move down if first).
- AC-6: Drop at start or adjacent gap: no state change, no announcement.
- AC-7: Escape, `pointercancel`, window blur, release outside active list, release over archived section: draft unchanged, no announcement, focus on a move control of the dragged row (order: Move up, Move down, other enabled).
- AC-8: Mid-drag save start, stale, or dialog open: drag cancels, draft unchanged.
- AC-9: Save of a drag draft: PUT body `{ orderedTopicIds }` with active ids only; handling of 409 as today.
- AC-10: Row-body swipe on touch scrolls and never reorders; handle drag does not scroll the page except via auto-scroll.
- AC-11: Reduced motion: no transition on drop line or rows; auto-scroll instant.
- AC-12: Pinned "Order changes apply..." text is present before, during, after drag and after Save.
- AC-13: No new runtime dependency, no backend/schema/API diff.
- AC-14: R-TOUCH checklist filled in for iPad Safari, Android Chrome, laptop (laptop first) with date and result.

## Other observations

- The Why section is written in first person ("I said in the #52 proposal"). Fine for a proposal, but the spec's numbers marked "mine, not measured" (20 kB ceiling, 25 topics, 5 px, 60 px) should move to a "Provisional values" table in the spec with an owner and a confirm-by step, so none ships as an unexamined magic number. This is the same concern I carry about thresholds in code: make them visible, named constants.
- The accessibility reviewer gap is real. The non-focusable handle rests on 2.5.7, which requires a single-pointer alternative, and the buttons satisfy that. I accept that reasoning, but note that `aria-hidden` on an element that has a pointer handler is a known lint/axe flag; document it as intentional so it is not "fixed" later.
- Page size (2,100+ lines): the requirement to put drag mechanics into a separate hook is stated in the Impact section but not as a SHALL or task AC. Not a requirements matter; keep it in tasks.md.

## Summary of required changes before implementation

1. Amend use case 08 Notes (drag now provided) and explain the "real time" AC at drop.
2. Resolve the gate contradiction (buttons vs editor open) and the "visible reason" vs tooltip inconsistency; write the reason string.
3. Put the threshold, auto-scroll zone/speed, dim style, and hit-target size in the spec as provisional named values.
4. Define drop-index semantics, "outside the list", and cancel focus fallback order.
5. Rename the duplicate R-ARCHIVED scenario; reframe R-AUDIT as an unchanged-endpoint check.
6. Quote the existing announcement string; add the no-announcement-during-drag scenario.
7. Add FR-8.2 actor scenarios (admin without membership; member-facilitator).
8. Define the R-TOUCH record format and location.
