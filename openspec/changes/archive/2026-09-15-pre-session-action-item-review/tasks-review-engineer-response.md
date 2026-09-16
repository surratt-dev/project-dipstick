# Engineer Response — tasks-stage review incorporation

**Author:** Marcus Oyelaran, Full Stack Engineer
**Responding to:** tasks-review-architect.md (Ingrid Sollenberger, 4 findings), tasks-review-ba.md (Marcus Delgado, 1 fix + 2 minor notes)

All findings incorporated. No pushback — both reviews are correct on the merits, and the fixes are cheap. Details below.

## Architect findings (Ingrid)

**1. Task 1.2's blocking reference pointed at section 4 instead of 5.x.** Fixed. Task 1.2 now reads "before task 5.2 below is implemented," with a note explaining the correction. Confirmed by re-reading section 4 — it's WebSocket subscription, fetch/branch logic, and the Start Session control; none of it touches item ordering. 5.2 is the only real consumer.

**2. Section 2's header pointed at nonexistent tasks 2.4/2.5.** Fixed, and I took Ingrid's (and Marcus Delgado's) shared fallback suggestion over their more specific alternatives: rather than repointing at 3.4/3.5 or 3.1, I dropped the task-number pointer entirely — "blocking — complete before any task in Section 3." 3.1 already says the fix is a "separate, already-completed prerequisite" for the export step, which implies section-wide precedence; a specific pointer would just be one more number to keep in sync the next time tasks.md gets renumbered.

**3. Task 4.2's forward reference to 6.1, and 6.1/6.2/6.4's back-references to 4.2/4.3.** Took Ingrid's preferred option (b): folded section 6 into the sections that actually consume it. Original 6.1 (GET-failure error state) and 6.2 (Begin First Topic disable gate + begin-voting fallback) are now 4.3/4.4, immediately following the fetch logic in 4.2 they extend. Original 6.4 (Start Session retry) is now 4.6, immediately following the Start Session control in 4.5. Original 6.3 (per-item staleness failure) is now 5.3, immediately following the item-rendering task in 5.2 it extends. Section 6 no longer exists as a standalone bucket; Section 7 (Verification) renumbers to Section 6. I agree with Ingrid's read that section 6 was never really a coherent "error states" section — its four items were satellites of sections 4 and 5, and keeping them there removes the forward-reference problem instead of just documenting around it.

**4. Timing-floor/no-store application deferred to 3.6, four tasks after the response bodies they protect are defined.** Fixed exactly as recommended: `applyTimingFloor()` and `Cache-Control: no-store` are now applied inline in 3.2 (404), 3.3 (409), and 3.4 (200) as each response is constructed. 3.6 is narrowed to the net-new cross-cutting regression tests — the timing-indistinguishability test and the header-presence-across-all-three-codes test — which legitimately need all three response paths to already exist. This matches design.md's own "design requirement, not later hardening" framing for F1/F2, which the original sequencing undercut.

## BA findings (Marcus Delgado)

**Finding 1 (dangling 2.4/2.5 reference).** Same underlying defect as architect finding #2 — resolved by the same edit (see above). I went with the "drop the parenthetical" option both reviewers offered as a fallback, rather than either reviewer's more specific repoint, for the reason given above.

**Finding 2 (UC5's real-time-clearing AC not named alongside the UC1/UC2/UC3 deferral).** Added to proposal.md's "Why" section: the deferral sentence now names UC5's "cleared in real time" acceptance criterion alongside UC1 step 6 and UC2/UC3, with the same one-line rationale (it depends on the same deferred write path). One sentence, no scope change — this is a documentation-traceability fix, not a new decision.

**Finding 3 (no verification task for "no cross-team/cross-owner comparison").** Added as task 6.7 (renumbered to fit the section 6/7 restructuring from architect finding #3 — Marcus Delgado's suggested "7.7" no longer applies since section 7 is now section 6). Cheap, and it converts an implicit non-feature into something explicitly confirmed in the running app, which is the right instinct given how close this sits to Rachel's no-performance-tool constraint.

## Net effect on tasks.md structure

- Section 2's header lost its stale pointer.
- Section 3 (3.2/3.3/3.4) now builds F1/F2 inline; 3.6 is narrower.
- Section 4 gained 4.3/4.4/4.6 (folded in from the old section 6) and is now the section that fully owns SessionLobbyPage's fetch/branch/error/retry behavior, not just the happy path.
- Section 5 gained 5.3 (folded in from the old section 6).
- The old section 6 is gone. The old section 7 (Verification) is now section 6, with 7.0-7.6 renumbered to 6.0-6.6 and a new 6.7 added.
- proposal.md's UC1/UC2/UC3 deferral sentence now also names UC5.

No task content was removed or descoped — every original task's substance survived the renumbering; only the section it lives in and its cross-references changed.
