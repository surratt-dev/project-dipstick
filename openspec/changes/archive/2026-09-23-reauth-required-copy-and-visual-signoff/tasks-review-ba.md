# BA Review — Tasks Stage (reauth-required-copy-and-visual-signoff)

**Reviewer:** Marcus Delgado (BA persona), Stage 4 review
**Verified against:** tasks.md, proposal.md, design.md, exploration-notes.md, my own Stage 2 review (propose-review-ba.md).

**Bottom line:** tasks.md covers the proposal's substance and closes the one gap I flagged at Stage 2. One traceability gap is worth a small fix before implementation starts — #137/#138 have no task group of their own and their closure path has to be inferred rather than stated. One documentation-completeness note on proposal.md (not tasks.md) is worth a follow-up but doesn't block. Task 4.0 is now specific enough to execute. No open threads from my Stage 2 review remain unaddressed.

---

## 1. Do tasks.md's groups fully cover #137/#138, #139, #140, #141 as scoped in proposal.md?

**#139, #140, #141 — yes, cleanly, with explicit labels.** Group 1 is labeled `(#139)`, Group 2 `(#140)`, Group 3 `(#141)`, and each proposal.md "What Changes" bullet maps onto a specific task:

- Real register via both hosts → 1.1–1.3
- No regression to the settled mechanism → 1.4
- Mock sign-off per-bound against D1 + host coverage + disclaimer + verdict vocabulary → 2.1–2.6
- Copy-in-layout sign-off with the same shape → 3.1–3.6
- Conditional header-comment cleanup → Group 4
- Spec status sync → Group 5

**#137/#138 — functionally covered, but not labeled or traceable as such.** Neither task group carries a `(#137/#138)` tag the way Groups 1–3 carry `(#139)`/`(#140)`/`(#141)`, and tasks.md's own scope note only claims coverage at the collective "#137–#141" level. Tracing #137/#138 to its actual closure requires reading exploration-notes.md §4 first: per that section, #137/#138 ("copy drafted, wired") is "close to done in substance — mostly a sign-off-and-comment-cleanup exercise once reviewed alongside a real mock." That maps to Group 3 (the copy-in-layout sign-off, which is the "formal sign-off... read in actual layout" exploration §4 line 120 says #137/#138 is waiting on) plus task 4.1 (removing the "COPY IS NOT FINAL" comment, which is the "wired" half). Both tasks exist and do the work — I'm not finding a functional gap — but nothing in tasks.md itself states that closing Group 3 + 4.1 is what closes #137/#138. A reader checking "did we close #137/#138" has to reconstruct that mapping from a different artifact.

This is exactly the kind of thing my persona exists to catch before it becomes a scope dispute (Success Criteria #4: requirements/task documents should be the first place the team looks, not a re-derivation exercise). **Suggested concrete fix:** relabel Group 3's heading from "Copy-in-Layout Sign-Off (#141)" to "Copy-in-Layout Sign-Off (#141, also closes #137/#138)", and add a clause to task 4.1 noting it's the wiring half of #137/#138's closure. Two small edits, not a new task.

## 2. Does task 1.5 (standing CI test) and its downstream references (2.2, 6.1) stay consistent with proposal.md's framing?

**Internally consistent across design.md and tasks.md — yes.** Task 1.5 implements design.md D3 faithfully, and both downstream references check out:
- 2.2 cites 1.5's test passing as evidence for the no-animation verdict, not an ad hoc grep — matches D3's stated reasoning exactly.
- 6.1 includes "the no-animation test added in 1.5" in the regression suite — consistent, no drift.

**But proposal.md itself never mentions this test, and its Impact section is now incomplete as a result.** Proposal.md's Impact section lists `ReauthRequiredTreatment.tsx` and `ConnectionStatusBanner.tsx` as the touched code files; it does not list `ReauthRequiredTreatment.test.tsx`, which task 1.5 adds a new standing test to. Checking the record: this addition traces to Tomás Ferreira's security design review (D3's stated rationale — a one-time manual grep isn't sufficient enforcement against a later change silently reintroducing a countdown-surrogate animation), which happened after proposal.md was written. That makes this a legitimate, well-justified design-stage refinement, not scope creep or drift in the concerning sense — the reasoning is sound and 1.5's downstream wiring is clean.

Still, proposal.md's own Impact section is a place "the requirements documents are the first place the team looks" (Success Criteria #4), and right now it would send a reader looking for test-file impact to the wrong list. **Not a tasks.md defect** — tasks.md is correct and complete on this point — but worth a one-line addition to proposal.md's Impact section (`ReauthRequiredTreatment.test.tsx` — new standing no-animation test) so the artifact stays accurate after the fact. Low priority; doesn't block Group 1 execution.

## 3. Is task 4.0 specific enough to execute?

**Yes — this is the fix I asked for at Stage 2, adopted almost verbatim.** My Stage 2 review (propose-review-ba.md §3) flagged that the "Signed off with conditions" branch of task 4 didn't specify who verifies a condition was met, or how. Task 4.0 now reads: "record in this task's completion note how each stated condition was verified met — cite the specific change made (e.g., a diff, a re-inspected CSS property, a re-rendered screenshot) — before proceeding to 4.1/4.2. Do not treat 'conditions met' as self-evident..."

This closes the gap: it names *what* evidence counts (diff / re-inspected CSS property / re-rendered screenshot — concrete, not open-ended), *when* it happens (before 4.1/4.2), and *where* it's recorded (this task's completion note). It ties itself explicitly to D4's evidence-citation discipline rather than inventing a new standard. Nothing further needed here.

## 4. Open threads from my own Stage 2 review (propose-review-ba.md)?

Checked both items I raised at Stage 2:

1. **Task 4's "conditions met" gap** — closed by 4.0 (see #3 above). No longer open.
2. **Minor precision note on #142/#143 "below the line" framing** (§5 of my Stage 2 review) — I explicitly flagged this as "not worth a task" at the time, since the Impact section's fuller language ("#142 still stands between this work and pilot readiness, unconditionally") already resolves it for anyone reading past the header. That's still true at this stage; no task was needed and none is missing.

No other threads from my Stage 2 review remain open.

## Summary for implementation

Nothing here blocks moving forward with Groups 1–6 as written. Two small, non-blocking edits worth making, neither urgent enough to gate implementation start:

1. Add a `(#141, also closes #137/#138)`-style label to Group 3's heading and a one-clause note on task 4.1, so #137/#138's closure path is stated rather than requiring a cross-reference into exploration-notes.md §4 to reconstruct.
2. Add `ReauthRequiredTreatment.test.tsx` to proposal.md's Impact section code-file list, reflecting task 1.5's addition (a legitimate, well-justified design-stage refinement from Tomás's security review — not drift, just a proposal.md artifact that hasn't caught up to it).

Everything else — group-to-issue coverage for #139/#140/#141, task 1.5's internal consistency with 2.2/6.1, task 4.0's specificity, and my own Stage 2 open items — checks out.
