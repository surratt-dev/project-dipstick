# Architecture Review — Task Ordering (Ingrid Sollenberger)

Scope: does tasks.md respect the dependency graph implied by design.md's D9 extraction (task 2.5)? No opinion offered on copy content, visual mock, or domain behavior — out of scope for this review.

## Finding 1 (Blocking): Group 1 is sequenced before the artifact it references

Task 1.1(b) requires asserting that "the shared `reauth-required` copy (**in the D9 shared subcomponent from task 2.5**) includes the vote-loss statement." That subcomponent does not exist until Group 2/task 2.5 runs. Group 1's own header claims "**No code dependencies**" — that claim is false for 1.1(b): the test target (the subcomponent file) doesn't exist yet if Group 1 executes first, as its position in the document (Group 1, before Group 2) implies.

This isn't cosmetic — a checklist executed in document order will hit 1.1(b) and have nothing to import.

**Recommendation:** Split 1.1 explicitly. Part (a) — grep-checking whether a vote-compose UI imports `voteDraft.ts` — genuinely has no code dependency and can run first, as written. Part (b) — asserting the shared subcomponent's rendered copy — must be resequenced after task 2.5 (subcomponent exists) and realistically after 3.1/3.2 (actual copy text exists to assert against). Either move 1.1(b) into Group 3 as a follow-on to 3.2, or add an explicit forward-dependency note to Group 1's header instead of "no code dependencies."

## Finding 2 (Blocking): Group 2's internal task order contradicts its own instructions

Tasks 2.1–2.4 (CTA button, first-render presence, navigation test) each say "Implement this in the shared subcomponent created by task 2.5" / operate on that subcomponent — but 2.5 (the extraction) is listed *last* in the group, after the tasks that depend on it. Read literally in numeric order, 2.1 instructs the implementer to place code "in the shared subcomponent created by task 2.5" before task 2.5 has run.

**Recommendation:** Renumber so the extraction comes first: make the D9 extraction task 2.1 (create `ReauthRequiredTreatment.tsx`, wire both `ConnectionStatusBanner.tsx` and `FacilitatorReadinessGrid.tsx` to consume it, delete `FacilitatorReadinessGrid.tsx`'s duplicated constant/markup — i.e., today's 2.5 minus the CTA-specific content, which lands via the renumbered tasks that follow), then renumber the CTA-wiring tasks 2.2–2.5 to build inside the now-existing shared component. This is a pure renumbering fix, not a scope change — every task's content is already correct, only the sequence is inverted.

## Finding 3 (Non-blocking, but worth tightening): Group 3 and Group 4 headers understate their real dependency on task 2.5

- Task 3.2 places the finalized copy "in the shared subcomponent created by task 2.5" — correct at the macro level since Group 3 follows Group 2, but Group 3's header only names Group 1 as a dependency.
- Task 4.1 changes `role="status"` to `role="alert"` "in the shared subcomponent created by task 2.5"; tasks 4.7 and 4.8 both implicitly require the extraction to be complete (4.7 mounts both real host components and expects identical output; 4.8 requires `FacilitatorReadinessGrid.tsx` to actually be rendering the shared component before its assertions about the button/`role="alert"` can pass). Yet Group 4's header states "**Depends on: nothing structurally**" — this is misleading given the group's own task content.

This doesn't break execution order today (Group 2 as a whole precedes Groups 3–4), but it does mean a reader relying on the header summaries alone (the stated purpose of these headers throughout the document) would not learn that 2.5 is a hard prerequisite for 3.2, 4.1, 4.7, and 4.8. Once Finding 2's renumbering lands, update these two headers to name the (renumbered) extraction task explicitly.

## Finding 4: Task 4.8 itself is correctly positioned

Fixing `FacilitatorReadinessGrid.test.tsx`'s under-specified test makes sense *after* both the extraction (2.5) and the `role="alert"` change (4.1) exist, since the strengthened assertions (button present, `role="alert"` present) can only pass once `FacilitatorReadinessGrid.tsx` is actually rendering the shared subcomponent. At the group level (Group 4 after Group 2) this ordering already holds. No split or move needed for 4.8 specifically — it inherits correctness once Findings 1–3 are fixed upstream.

## Summary

The task list gets the *group-level* macro-ordering right (extraction lands in Group 2, before Groups 3/4 that consume it). The problems are two inversions at finer grain: Group 1 references Group 2's output before Group 2 runs (Finding 1, blocking), and within Group 2 itself the CTA tasks are listed ahead of the extraction they depend on (Finding 2, blocking). Both are renumbering/resequencing fixes, not scope or design changes. Finding 3 is a documentation-accuracy cleanup that should ride along with the Finding 2 renumbering.
