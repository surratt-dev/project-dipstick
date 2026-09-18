# Tasks Review — Business Analyst (Marcus Delgado)

## Scope of this review

Checked tasks.md against proposal.md and design.md for: (1) full coverage of the proposal's capabilities, (2) whether the facilitator-grid scope expansion is concretely built out rather than mentioned in passing, and (3) whether task 1.1 (build-enforced automation) and task 1.3 (forward-pointing manual recheck) still cohere now that 1.1 has moved off manual grep. I read the actual source (`ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx`, `FacilitatorReadinessGrid.test.tsx`, `voteDraft.ts`, `vote-compose-recovery/spec.md`) rather than trusting the design doc's characterization of them.

## Overall coverage: good

Every proposal bullet has a task-group home: CTA (Group 2), ARIA/visual register (Group 4 + Group 6 gate), copy checklist (Group 3), vote-loss gate (Group 1), reveal-window non-special-casing (Group 5), role-uniform treatment (2.5/4.7/4.8), structural bounds — `connectionHealth.ts` and `unknown-reconnecting` untouched (Group 7). Nothing in the proposal is unaddressed.

## Facilitator-grid scope expansion: concretely covered, verified against real code

I confirmed directly in source that `FacilitatorReadinessGrid.tsx:62,77-78` and `ConnectionStatusBanner.tsx:25,39-40` currently declare **independent** `REAUTH_REQUIRED_TEXT` constants and separate `<div role="status">` markup — the duplication proposal.md and design.md D9 describe is real, not asserted.

- **Task 2.5** (extraction) is concrete: names the new subcomponent, names the deletion of the facilitator's own constant/markup (not "leave it alongside"), and constrains the subcomponent to take no cause/role/session-moment props — closing off the exact re-divergence path D9's rationale warns about.
- **Task 4.8** (strengthened facilitator test) is not just plausible, it's necessary: I read `FacilitatorReadinessGrid.test.tsx`'s existing "reauth-required exclusion" test (line 235-236, matches task.md's "~line 236" citation exactly) and confirmed it only asserts `getByRole("status")` with the placeholder text — it asserts nothing about a button or `role="alert"`. This test would stay green today even with the facilitator gap fully unfixed. Task 4.8 correctly targets the actual hole.
- **Task 7.4** (byte-identity regression) is the right closing check and is stated as testing both files "now consuming the D9 shared subcomponent" — correctly tied to the mechanism, not just the outcome.
- **Task 4.7** independently reinforces this by requiring the uniformity test to mount the real `SessionConnectionHost.tsx`/`FacilitatorConnectionHost.tsx` hosts rather than two `ConnectionStatusBanner` instances — correctly targets the file where the divergence actually lived.

This group is fully and concretely covered, not passing-mention coverage.

## Task 1.1 / 1.3 coherence: mostly sound, one real gap

1.1 and 1.3 make sense together as designed — 1.1 gives CI a tripwire (fails the moment a future vote-compose UI imports `voteDraft.ts`'s hooks without the copy having been updated), and 1.2 says what to do when it fires. That's a genuine improvement over a recorded human grep.

One thing worth tightening: 1.3's framing that this recheck "cannot be automated" slightly overstates the gap — 1.1 *does* automate detecting that the fact changed (the build goes red). What's actually manual is writing the new copy and updating the test's baseline, which is inherent to any copy change and doesn't need hedging language implying nothing is automated.

**The concrete gap:** task 1.3 states this recheck "rides along with" `vote-compose-recovery/spec.md`'s existing follow-up hook (its tasks.md task 8.3), "rather than inventing a new one, so the recheck doesn't depend on someone remembering this document exists." I read task 8.3 directly (`openspec/changes/archive/2026-09-11-vote-compose-recovery/tasks.md:56-59`) and `spec.md`'s own references to it. Task 8.3's checklist is entirely about `vote-compose-recovery`'s *own* requirements (no-flash restore, discard-indistinguishable-from-empty, silent-under-real-wiring) — it contains no mention of this change, this banner, or a copy recheck. Nothing in this tasks.md adds a pointer *from* 8.3 (or from `vote-compose-recovery/spec.md`) *back to* this change's task 1.3.

So the claim that "the recheck doesn't depend on someone remembering this document exists" isn't yet true — it currently depends on exactly that. The one-directional citation (this document → task 8.3) doesn't give a future implementer working purely from `vote-compose-recovery`'s own task list any way to discover task 1.3's requirement. This is the same failure mode design.md's own Risks section names as something it doesn't want left to institutional memory — but the task that would actually close the loop (editing `vote-compose-recovery/spec.md` or its follow-up checklist to reference this change's task 1.3) doesn't exist in tasks.md.

**Recommendation:** add a task instructing that `vote-compose-recovery/spec.md`'s follow-up note (or task 8.3 itself) be updated to explicitly reference this change's task 1.3/1.1 recheck when this change ships — a small addition, but it's the difference between an asserted forward-link and a real one.

## Minor note

Task 3.2's instruction to also fix the header comment's stale "both strings below are placeholders" framing is a good catch of exactly the kind of drift Marcus cares about (traceability of what's actually still open vs. resolved) — no issue there, just flagging it as correctly scoped.
