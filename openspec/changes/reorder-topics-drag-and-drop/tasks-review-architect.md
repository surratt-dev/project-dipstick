# Tasks review: Solution Architect (Ingrid Sollenberger)

Scope: dependency order and task boundaries in `tasks.md` against `design.md` and `proposal.md`. I did not review domain, UX or the spec text. I read `moveTopic` at `TopicManagementPage.tsx:955` to check one claim.

## Verdict

Not ready as written. Sections 1 and 2 are sound. Sections 3 to 6 have four ordering defects and four interface gaps that would stop an implementer partway through. All are fixable by editing tasks, with no design change. The hook's public interface is the biggest hole, because three later tasks assume capabilities that 2.2 never gives it.

## Blocking findings (reorder or split before implementation)

### B1. `applyNewOrder(next, topicId)` cannot reproduce the button path's focus
Task 1.2 puts `queueFocus` inside `applyNewOrder` with only `next` and `topicId`. The existing `moveTopic` (line 979) derives its focus list from the clicked `action`: `FOCUS_FALLBACKS[action]`. With no `action`, `applyNewOrder` cannot return the button path's focus behavior. The design dropped the `announcement` parameter to prevent divergence, but the same reasoning needs a replacement here.
- Fix 1.2: state the signature as `applyNewOrder(next, topicId, focusIds: string[])`, or `focusAction: MoveAction`. `moveTopic` passes `FOCUS_FALLBACKS[action]`. The drop handler passes `FOCUS_FALLBACKS.up`.
- Fix 1.2 acceptance: the unchanged button tests must also cover focus.
- Proposal.md still says `applyNewOrder(next, topicId, announcement)`. It conflicts with design.md and tasks and should be corrected.

### B2. The gate extraction (3.2) is a no-behavior-change refactor and a precondition for 3.1, 3.3 and the hook's `enabled` input
Task 3.2 comes after 3.1, but 3.1 needs the gate ("render none when locked or under two", plus the dimmed/inert state). The `computeReorderGate` extraction moves hook-ordering-sensitive code above the early returns. It is the same kind of change as 1.2 and carries the same risk.
- Move 3.2's extraction and unit tests into section 1 as a new 1.3. Run the existing page tests unchanged, as 1.2 does.
- Leave only "render dimmed handle when `movesDisabled`" in the wiring section, folded into the handle task.

### B3. The `useTopicDrag` interface is not defined, and 3.x assumes it provides things 2.2 does not
2.2 lists behaviors but not the contract. Later tasks need all of the following:
1. **An `enabled` parameter.** 3.2 says the gate feeds "the hook's `enabled`". 2.2 never defines it, and 2.3 does not test it.
2. **An imperative `cancel()`, or a documented rule that `enabled` going false cancels internally.** 3.3 cancels on gate change and on `savedOrder` identity change. Nothing in 2.2 gives the page a way to do either. 2.3's cancel list omits both.
3. **Exposed state for rendering:** `draggedTopicId`, `dropSlot` and an `isDragging` flag. 3.5 renders the dimmed row and the drop line, and the container needs `user-select: none`. 2.2 mentions only `dropSlot`.
4. **A container ref and a row-registration mechanism.** The hook needs the list container for outside-release hit-testing, and row elements for measurement. 3.1 needs per-handle pointerdown props from the hook. None of this is specified.
5. **`onCancel(topicId)`.** 3.4's cancel-focus path needs the dragged id. 2.2 says `onCancel` with no argument.
6. **Measured row count in the drop payload.** 3.4 validates "the measured row count equals N", but only the hook measures rows, and `onDrop(topicId, slot)` does not carry the count. Either extend it to `onDrop(topicId, slot, rowCount)`, or move the check into the hook and have 3.4 drop it from the page. The design describes the check as a drop-handler step, so extending the signature is the smaller change.
7. **Whether a programmatic cancel (gate or refetch) calls `onCancel`.** This decides whether the cancel-focus logic lives in `onCancel` or in the effect. It must be stated, because 3.3 and 3.4 both claim focus handling.

Fix: add a short "hook interface" bullet list at the top of 2.2 (or a new 2.2a, "define and type the interface"), and add a test for each cancel path to 2.3.

### B4. 3.3 depends on the cancel-focus machinery that 3.4 builds
3.3 says "focus left to the dialog, else a move control of the dragged row". The cancel-focus rule (`FOCUS_FALLBACKS.up`, then `activeRowHeadingId`) is defined and built in 3.4. Reorder to: drop and cancel handlers (current 3.4), then cancel-on-transition (current 3.3). The alternative is to merge them into one task, "outcomes of a drag: commit, cancel, forced cancel".

### B5. 3.5 (drop line, dimmed row) comes after the drop handler, but it is what makes 3.1 to 3.4 observable
The visual state is a pure consumer of hook state (B3 item 3). Put it with the handle task (3.1) so each intermediate commit is manually checkable. As written, a developer completes the drop handler with nothing visible to drive it by hand.

### B6. 3.1 as written ships a live, inert handle
A rendered handle with no hook attached is a visible, broken affordance. If any commit boundary falls between 3.1 and 3.4, it lands that way. Fix with an ordering note: attach the hook's pointerdown in 3.1, or state that 3.1 to 3.4 must land as one change. Also tighten 6.4 so the requirements are never amended ahead of a merge that includes all of them.

## Significant findings (reorder or relocate)

### S1. Tests are deferred to a block at the end (section 4)
Every R-code test sits after the wiring. That makes the build test-after for the riskiest behavior. Spread section 4's contents across the section it verifies:
- R-BTN, R-HANDLE-COUNT, R-LOCK, R-MIN, R-ARCHIVED, R-BLOCKED go with the handle and gate task.
- R-COMMIT, R-NOOP, R-ENDS, R-FOCUS, R-LIVE and the drop-handler validation go with the drop handler.
- R-CANCEL, R-REFETCH, R-DISABLE-MID, R-UNMOUNT go with the cancel-on-transition task.
- Keep section 4 only as a "coverage reconciliation against the spec's R-code list".

### S2. 4.3 (equivalence test) is the main guard on the shared path and comes too late
It needs only `moveToIndex`, `applyNewOrder` and the drop handler. Run it immediately after the drop handler (current 3.4), so any divergence in announcement, dirty state or PUT body surfaces before more is built on it. Also add focus targets to its comparison (see B1).

### S3. 2.1 mixes a recorded decision, a process rule and an end-of-work measurement
- The decision is already in design.md; this task does nothing.
- The overrun rule is a checkpoint with a date, not an implementation step. Make it an explicit checkpoint, for example "end of day 2: if the hook is not passing 2.3, apply the rule".
- The gzip measurement belongs in section 6 (it needs the finished build), with the design.md update next to it.

### S4. The laptop check (6.1) must precede the final test freeze
6.1 may "confirm or change" `DRAG_THRESHOLD_PX`, `DRAG_HANDLE_MIN_PX` and `DRAG_DIM_OPACITY`, which are asserted by R-CONST in 4.2 and implemented in 2.2. If constants change after tests are final, tests and spec must be touched again. Order: feature complete, then 6.1 laptop check, then constant adjustment, then run the R-CONST and R-LAPTOP-CHECK reconciliation. Fold the dev-stack part of 5.3(c) (audit count by SQL) into the same session, since both need a running stack.

### S5. 5.1 (re-run cited backend tests) is a precondition, not a closing check
If a cited test is missing or failing, the design's Decision 9 evidence is wrong, and the plan should find that out first, because it is cheap and independent. Move 5.1 to a new 0.x, ahead of section 1, with the "open an issue, do not fix here" rule. Run it again at the end for the PR note. Same for 5.5, which has no dependency on the code (record the gaps on #181 on day one).

### S6. 2.0 (test infrastructure) needs a regression gate and placement
The `PointerEvent` polyfill and pointer-capture stubs change the global vitest setup and could alter existing tests. Add "run the full frontend suite unchanged after 2.0" as its exit condition, and place it just before 2.3 (2.2 needs no jsdom support to be written, only to be tested). It is fine where it is, but the exit condition is missing.

### S7. 3.4 has too many unrelated concerns for one task
It combines drop validation (4 checks), index conversion, `applyNewOrder`, announcement, commit focus, cancel focus, and non-list-target cancels. Split into 3.4a (commit path: validate, convert, apply) and 3.4b (cancel path and focus). That also resolves B4 cleanly.

### S8. 4.7 states a test-strategy rule that should govern when tests are written
"Draft semantics are driven through the drop handler; at least one test drives the real hook end to end." That is the test plan for the whole wiring, so it belongs before the wiring tasks, not after them. Hoist it to a header note in section 3 so the tests in 3.x are written the right way the first time.

## Minor

- 3.6 ("do not touch the four move buttons or the aria-live region") is a constraint, not a task. Convert it into a verification line: the diff of the move-button JSX is empty and R-BTN is green. As an unchecked task it can never be honestly ticked.
- 1.1 and the design disagree on module split. Design Decision 1 effort text mentions "a small pure hit-test module", while the "Module split" paragraph and task 1.1 put the pure functions in `topicOrder.ts`. Pick one.
- 5.3(a) (exactly one PUT, zero after cancel/no-op/Discard) is a frontend test and should sit with 4.5 (R-SAVE).
- 6.2 and 6.4 are correctly at merge. Add that 6.4 must not be committed until the full drag feature has merged to the branch being released.
- Proposal.md still says "about 150 lines". The design withdrew that figure. Update or strike it, to avoid it being read as the overrun anchor.

## Proposed order (summary)

0. Preconditions: 5.1 (re-run backend tests), 5.5 (record gaps on #181).
1. No-behavior-change refactors, each ending with the existing page tests green:
   - 1.1 pure functions and tests.
   - 1.2 `applyNewOrder`, with the focus parameter (B1).
   - 1.3 `computeReorderGate` and its unit tests (from 3.2).
2. Hook:
   - 2.0 test infrastructure, exit gate: full suite green.
   - 2.2 hook with its written interface (B3).
   - 2.3 hook state-machine tests, including `enabled` false, imperative cancel and row-count reporting.
   - Overrun checkpoint (from 2.1).
3. Wiring (tests beside each step):
   - 3.1 handle, gate states and hook attach, with the drop line and dimmed row (B5, B6).
   - 3.4a commit path, then the 4.3 equivalence test.
   - 3.4b cancel path and focus.
   - 3.3 cancel on transitions (gate, refetch).
4. Remaining spec R-codes not covered above, including the 4.7 end-to-end hook test.
5. Laptop check, with the dev-stack audit SQL check (S4), then constants confirmed, then R-CONST.
6. Remaining constraint checks (5.2, 5.4), gzip measurement and design.md update, PR notes.
7. At merge: 6.2, 6.4.

## What is already right

- Section 1 is correctly first and safe to land alone, which supports the design's overrun fallback.
- The pure functions precede the hook and wiring, so the slot/final-index confusion (Eng M2) is closed before anything consumes it.
- Moving the gate above the early returns is placed as a refactor rather than hidden in wiring. It only needs to move earlier (B2).
- Server-side enforcement, with no backend change, is handled as evidence plus re-run, not new code. That fits my requirement that authorization be enforced server-side and not leak into the UI.
- Unresolved items (no staleness token; unaudited denials) are recorded for the security owner, not silently inherited.
