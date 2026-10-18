# BA review of exploration notes: drag-and-drop for Reorder Topics (#181)

Reviewer: Marcus Delgado, Business Analyst
Verdict: Strong on constraints and risks. The behavioral intent is mostly buildable already. The weak spots are (a) decisions deferred to "a spike" with no pass/fail thresholds, (b) several statements written as preferences ("quiet", "small", "sensible") that cannot be tested, and (c) edge scenarios the notes name but do not resolve. Items below are ordered by how much they block a proposal.

## 1. Clarifications needed (block the proposal)

1. **Open editors and add form (Q4 / 5.6).** The notes say "decide explicitly" and then recommend disabling. Make it a decision, not a question. Proposed: drag is disabled while any definition editor or the add form is open, with the same visible-reason pattern as Remove. Needs Devon's confirmation, then it becomes a SHALL.
2. **Focus after a pointer drop (Q5 / 5.4).** "Handle or Move up button" is two options. If the handle is non-focusable (Q2), focus cannot land on it, so the only consistent answer is the moved row's Move up button (or Move down if the row is now first). Resolve Q2 and Q5 together and state the target, including the first-row and last-row case.
3. **Handle focusability (Q2).** Section 4 says the handle is `aria-hidden` and not focusable, but also gives the alternative of an accessible name "Drag to reorder: {topic}". Pick one for the proposal baseline. Also confirm the accessibility reviewer exists as a named role; "needs an accessibility opinion" has no owner.
4. **Touch behavior (Q3).** Immediate drag from handle versus long press is left open. Recommend a default (immediate, handle only) and make long press a fallback only if real-device testing shows accidental drags.
5. **Real-device check (Q7).** "Which tablet and browser, and who does it" is unanswered. Name the device class (for example, one iPad Safari and one Android Chrome) and the owner role, or the manual task will not get scheduled.
6. **Stale and in-flight states during a drag.** The notes cover disabled-before-drag. They do not say what happens if the page becomes stale, a save starts, or a dialog opens mid-drag. Define: mid-drag transition to a disabled state cancels the drag and leaves the draft unchanged.
7. **Drop outside the list.** Section 4 says Escape or drop outside cancels. Confirm that "drop outside" means cancel, never "drop at nearest end". Also define behavior for a drop onto the archived section or other non-list targets (cancel).
8. **Which rows are draggable.** "Each active row" is stated in scope, but is the list guaranteed to contain only active topics? State that archived topics have no handle and are not drop targets, and that dragging does not change which topics are archived.
9. **Library versus hand-built is not yet a requirement-level question.** Requirements should state outcomes (what must be true), not the mechanism. Move the choice to design, and keep only the dependency constraints in the proposal (permissive OSS license, no hosted service, no telemetry, recorded decision).

## 2. Vague language and suggested rewrites

| Vague statement | Problem | Suggested rewrite |
|---|---|---|
| "A second way to produce the same draft... facilitator should not be able to tell" (s1) | Not testable as written | "For any sequence of moves, reordering by drag and by buttons SHALL yield the same `draftOrder`, the same dirty state, the same cleared confirmation and error, the same announcement text, and the same Save payload." |
| "Keep it quiet: one small handle per row, no animations that demand attention" (s2) | Subjective | "Each active row SHALL show exactly one drag handle. No animation SHALL run during drag other than the drop indicator; no animation SHALL run when `prefers-reduced-motion: reduce` is set." |
| "Drag must hang off that same flag" / "single derived `reorderInteractive`" | Implementation phrasing | "Drag SHALL be available if and only if the Move up/down controls are enabled. When the team is customization-locked, or fewer than two active topics exist, no handle, drag listener, or drag cursor SHALL be rendered." |
| "The pinned copy must stay visible during drag" | Which copy, where | Quote the exact string and state it SHALL remain rendered, unchanged, from drag start through drop. Add a test assertion on the string. |
| "Drag must not grow smart assists" | Negative, open ended | "Drag SHALL NOT snap, auto-reorder, suggest, or sort topics. The resulting order SHALL equal the dragged topic placed at the dropped index and all other topics in their prior relative order." |
| "Drop indicator or live preview" | Two options | Choose one: a single drop line between rows. A live preview risks mid-drag reflow and is harder to verify. |
| "Auto-scroll is required" | No numbers | "While dragging within N px of the top or bottom viewport edge, the page SHALL scroll continuously until the pointer leaves that zone or the drag ends." Pick N in design (for example 60 px) and say what happens at list ends. |
| "A drag threshold (to separate click from drag)" | No value | "Pointer movement under T px from pointerdown SHALL NOT start a drag." Set T in design. |
| "Announce only" (Q6) | Good intent, no text | "On drop, exactly one live-region message SHALL be emitted, in the same wording as the button path: '{topic} moved to position n of N'. No message SHALL be emitted during hover, and none on cancel." |
| "Bundle size and tree-shaking check" | No pass criterion | State a ceiling (for example, added gzipped JS no more than a stated kB, agreed with Devon) or accept "measured and recorded in design.md" as the criterion. Today it is neither. |
| "Verify license and maintenance status" | No criterion | "Selected library SHALL be OSI-approved permissive, with a release within the past 12 months and no open critical security advisory at proposal time." Adjust the window as the team sees fit. |
| "Buttons are untouched" (s9) | Fine as a judgment, weak as a requirement | See section 3, requirement R-BTN. |

## 3. Suggested acceptance conditions (Given/When/Then)

Each of these is intended to become a spec scenario.

- **R-BTN (buttons remain).** The four move controls SHALL remain rendered and operable on every active row whenever drag is available. Given a team with 3 or more active topics, when the page renders, then each row contains Move up, Move down (and the other two existing controls) and a drag handle. A test SHALL fail if any button is absent while a handle is present.
- **R-LOCK.** Given a customization-locked team, when the page renders, then there are zero drag handles and no drag listeners on any row.
- **R-MIN.** Given exactly one active topic, then no handle is rendered.
- **R-COMMIT.** Given a clean draft, when a topic is dropped at a different index, then `draftOrder` equals the new order, the Save/Discard bar appears, `beforeunload` arms, any prior confirmation or error is cleared, and one announcement fires.
- **R-NOOP.** Given a clean draft, when a topic is dropped on its starting slot, then `draftOrder` remains null, no Save/Discard bar appears, `beforeunload` is not armed, and no announcement fires.
- **R-REVERT.** Given a dirty draft, when drags return the order to the saved order, then `draftOrder` collapses to null (same as the button path).
- **R-CANCEL.** Given a drag in progress, when Escape is pressed, pointercancel fires, or the pointer is released outside the list, then the draft is exactly as before the drag, nothing is announced, and focus returns to the handle's row (a defined target, not body).
- **R-NOMUT.** During a drag, `draftOrder` and the displayed position numbers SHALL be unchanged until drop.
- **R-FOCUS.** After a committed drop, `document.activeElement` SHALL be the moved row's Move up control (or Move down if the row is first), and SHALL NOT be `<body>`.
- **R-LIVE.** The page SHALL contain exactly one `aria-live` region for reorder announcements before, during and after a drag.
- **R-DISABLE-MID.** Given a drag in progress, when the page becomes stale, a save begins, or a Remove/Restore dialog opens, then the drag is cancelled and the draft is unchanged.
- **R-EDITOR.** Given a definition editor or the add form is open, then handles are not interactive and the same disabled reason text used for Remove is shown.
- **R-SAVE.** Given a drag-produced draft, when Save is pressed, then the PUT body is the full ordered ID list, identical to what the button path would send for the same order. A 409 `TOPIC_ORDER_STALE` is handled exactly as today.
- **R-AUDIT.** A Save of a drag-produced order SHALL write one `topic.reordered` row with `previous_order` and `new_order`; a cancelled or no-op drag SHALL write none.
- **R-LIVESESSION.** No drag handle, listener, or reorder text SHALL appear on any live-session view.
- **R-NOBACKEND.** The change SHALL include no migration, no API change, and no schema change.
- **R-TOUCH.** On the named tablet and browser, a drag from the handle SHALL reorder with no page scroll under the finger, and scrolling by swiping on the row body SHALL still scroll the page. Verified manually, result recorded.
- **R-RM.** With `prefers-reduced-motion: reduce`, no animated settle SHALL occur.

## 4. Gaps not addressed in the notes

1. **Zero and one topic states.** Covered for the handle (R-MIN), but the notes never mention the zero-topic recovery path just merged (#200). Confirm drag UI renders nothing there.
2. **Concurrent facilitators.** Two facilitators editing the same team: only the 409 path is mentioned. Confirm drag adds no new conflict scenarios, and say so in the proposal.
3. **Topic history preservation.** Reorder must not affect retained historical data for removed topics. The notes say "no backend change", which implies this, but a one-line statement protects against the edge case I care about.
4. **Archived topics in `draftOrder`.** Does the saved order list include archived IDs? If yes, a drop index among active rows must map correctly into the full list. This is where `moveToIndex(items, from, to)` could go wrong silently. Needs an explicit statement and a test case with archived topics interleaved.
5. **Very long lists.** "~11 topics" is an assumption. State the supported maximum or say behavior is unspecified beyond it.
6. **Success measure.** Section 9 is a sign-off checklist, not a measure. Acceptable for an internal tool, but note it is a judgment by Devon, not an observable outcome. If any adoption signal is wanted (for example, share of reorders via drag), say so now, since that would require new data collection and conflicts with "no new data collected" in s2.
7. **Traceability.** Add references: use case 08 line quoted, #52 Decisions 8 and 11, and the WCAG 2.5.7 criterion, so each SHALL traces to a source.

## 5. Out of scope: confirm

The out-of-scope list is clear. Add two items for completeness: undo/redo beyond Discard, and persisting a draft across navigation (already noted as deferred in s6.9, but not listed in s7).

## 6. Readiness

Ready to carry into a proposal after items 1.1 to 1.8 are resolved by Devon and the section 3 conditions are adopted. The library choice may stay open for design, provided the proposal fixes the outcome requirements above so any mechanism must satisfy the same tests.
