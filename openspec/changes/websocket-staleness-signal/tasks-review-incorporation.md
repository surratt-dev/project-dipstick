# Tasks Review Incorporation — `websocket-staleness-signal`

Author of this changelog: Marcus Oyelaran (Full Stack Engineer). This document records what changed in `tasks.md` (and, for one narrowly-scoped item, `design.md`) in response to `tasks-review-architect.md` (Ingrid Sollenberger) and `tasks-review-ba.md` (Marcus Delgado), and why — following this change's existing practice of naming disagreements and deliberate non-actions rather than silently accepting or rejecting feedback. No line of `tasks-review-architect.md` or `tasks-review-ba.md` was modified, and `proposal.md` and `exploration-notes.md` were left untouched as instructed.

## Architect findings — all five addressed

1. **Finding 2, most actionable (missing implementation task for D1c's sticky-state guards).** Added task 1.10a between 1.10 and 1.11: the entry guard (`state === "reauth-required"` checked first, before any other close/error branching) and the synchronous pending-retry-timer clear on entry, mirroring the 1.1a–1.1d / D1d–D1g pairing pattern the reviewer pointed to. Updated 1.14 and 1.15's descriptions to name themselves explicitly as test tasks for 1.10a's guard and timer-clear respectively, closing the "test task for an unbuilt mechanism" gap.

2. **Finding 3 (Group 2's stated dependency didn't match task 2.1's actual prerequisites).** Took the reviewer's second suggested option: moved former task 2.1 (the cross-surface `useConnectionHealth` import check) into Group 4 as new task 4.12, since it cannot be confirmed until `ConnectionStatusBanner.tsx` (Group 3) and the grid-marker treatment (Group 4) both exist. Group 2's header now says only 2.2 remains there, executable right after Group 1, with a note pointing to where 2.1 went and why. Group 4's header now calls out that 4.12 specifically also depends on Group 3, distinguishing it from the rest of Group 4's Group-1-only dependency.

3. **Finding 4 (apparent circular dependency between Group 4's tests and Group 5's fixture).** Added task 4.0a: a minimal, test-local four-state row fixture, built and owned within Group 4, explicitly independent of task 5.2's host-level stub (which serves the dev-server/E2E path per Decision D9, not unit testing). This mirrors 1.1a's precedent exactly, as the reviewer suggested, and removes Group 4's implicit dependency on Group 5.

4. **Finding 1 (Group 1's dependency blurb undercounted which tasks need Group 0's constants).** Widened the blurb to name tasks 1.4, 1.9, 1.10, 1.11, 1.12, and 1.14, matching the reviewer's exact list. (Did not add 1.10a to this list — it references `state === "reauth-required"` and timer state, not the close-code constants themselves, so it doesn't share the same Group-0 dependency the others do.)

5. **Finding 5 (no task applies 6.2's final visual styling after sign-off).** Added task 6.2a: apply the signed-off visual register immediately upon 6.2's closing, replacing the 4.7 placeholder. Also added 6.2a to task 6.4's pilot-readiness hard gate list — a pilot's first live session should see the actual signed-off styling, not a placeholder left in place because 6.2's sign-off closed without the follow-up landing. This last part (touching 6.4) goes slightly beyond what either reviewer asked for verbatim, but follows directly from the gap the architect identified: a sign-off gate that doesn't require its own output to ship before pilot use isn't much of a gate.

## BA findings

1. **Gap: the facilitator tooltip was never built.** Added task 4.11: attach the hover tooltip to the grid marker, wired to the `"Last known state may not be current."` placeholder, positioned before task 6.1 so 6.1 has an actual element to review rather than reviewing copy in the abstract. Updated 6.1's text to reference 4.11 as the tooltip's origin.

2. **"Four bullets" gate language didn't match this change's three copy strings.** Took the reviewer's option (b): reworded 6.1 to say "all three of these copy strings" and added a parenthetical explaining the four-item language was inherited verbatim from `websocket-delivery-time-authorization`'s differently-structured gate and has been reconciled to this change's actual count, rather than left to be discovered as a missing fourth artifact.

3. **Task 1.11's assertion narrower than the proposal's acceptance condition.** Added "`connect()` is not called again as a result of this transition" to 1.11's assertion list, alongside the existing `computeRetryDelay` zero-calls assertion — covering the clean-entry case the same way 1.15 covers the race case.

4. **D7's TTL/fallback answer wasn't labeled as resolved in design.md's Open Questions section.** This was a design.md-only fix per the instruction scoping it narrowly. Added one bullet to design.md's Open Questions list (alongside the existing D10/D12/D1a-scope bullets), stating that the TTL/fallback question is resolved by Decision D7 and restated there only so a future reader doesn't mistake its absence for an oversight. Did not touch D7's own prose.

## Explicitly not actioned, per instructions

- **BA's note on proposal.md's Impact section describing the pre-relocation constant location.** No proposal.md change made; `design-review-incorporation.md` already covers why proposal.md is left untouched, and the instruction was explicit that this item requires no tasks.md change.
- **BA's agreement/sign-off on task 4.1a's D7 interpretation.** Recorded here only as: no tasks.md change was needed or made — 4.1a already asks for confirmation from both Marcus Delgado and Priya Nair, and Marcus Delgado's sign-off in `tasks-review-ba.md` doesn't change what the task asks for.
- **BA finding 5 (task 4.1a and 5.3 as checkpoints without a defined "what if disagreement" path).** Not in the instruction's list of items to action, so left as-is. Flagging it here rather than silently dropping it: if a future pass wants to tighten 5.3's "confirm with whoever is coordinating issue #19" language, the reviewer's suggested rewrite (name what "sufficient" means, file a new task if the E2E can't exercise both host components unmodified) is a reasonable one to pick up later.
- **Architect's Group 1 observation about task 1.9's grep being vacuously true until 1.10 exists.** The reviewer explicitly said this doesn't need a task change ("intentional... not an ordering mistake"), so no edit was made.

## Numbering convention

Followed the existing precedent set by `design-review-incorporation.md`: new tasks use lettered/decimal insertions (1.10a, 4.0a, 4.11, 4.12, 6.2a) rather than a full renumber, keeping every existing cross-reference elsewhere in `tasks.md` and `design.md` (e.g., "task 1.14," "task 6.2," "Decision D7") valid without a repo-wide renumbering pass.
