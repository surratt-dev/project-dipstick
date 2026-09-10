# Tasks Review — Business Analyst (Marcus Delgado)

**Change:** `websocket-staleness-signal`
**Reviewed against:** `proposal.md`, `design.md`, `design-review-incorporation.md` (post design-review-incorporation state)
**Scope of this review:** does every capability and acceptance condition in `proposal.md` have a task that builds and tests it? Anything lost in translation?

## Summary

Coverage is thorough. I traced every proposal.md bullet and every design.md Decision (D1–D12, including the new D1b–D1g/D3a sub-decisions added during design incorporation) to a specific task, and almost everything lands cleanly — including the newer material (Group 0's shared-constant relocation, the sticky-state race tests at 1.14/1.15, the reauth-required third state end to end). That said, I have five items I want resolved before this moves to implementation, ranked by how much I think they matter.

---

## 1. Missing task: the facilitator tooltip is never actually built

**Severity: gap — needs a task added.**

The proposal is explicit that first-session support for the grid marker is "a one-line hover tooltip, not a tutorial," with placeholder text "Last known state may not be current." Group 4 (tasks 4.1–4.10) covers the marker's mechanism, its visual bound, its cause-blindness, its facilitator-only gating, and its no-outlier-flagging behavior — but no task in that group actually attaches a tooltip to the marker. Task 6.1 (the copy sign-off gate) talks about filing "the facilitator tooltip... in their actual layout... tooltip on the actual grid marker" as if the tooltip element already exists by the time that gate runs, but nothing upstream builds it.

This is exactly the kind of thing that becomes a scope dispute mid-implementation: an engineer builds the marker's visual treatment, ships it, and then discovers at task 6.1 that there's no tooltip to review because no task told them to add one.

**Suggested fix:** add a task in Group 4 (e.g., 4.11) — "Attach a hover tooltip to the grid marker, wired to placeholder copy (`'Last known state may not be current.'`), self-explanatory without prior documentation per proposal.md's facilitator-experience requirement — task 6.1 reviews this copy in situ, so the tooltip element must exist before that gate can run."

---

## 2. "Four bullets" gate language doesn't match this proposal's three sketches

**Severity: clarification needed.**

Task 6.1 quotes gate language "filed verbatim" from the originating task: *"a filed draft that does not resolve all four bullets does not close this task."* But the actual copy sketches this proposal names are three: Devon's participant sketch, Priya's participant sketch, and Priya's facilitator-tooltip sketch. I went back through proposal.md's own bullet enumerating this gate and count three sketches, not four.

My read is that "four bullets" is inherited verbatim from `websocket-delivery-time-authorization`'s task 9.1/9.3 gate (a different change, with its own four-item structure), and got carried forward as quoted language without being reconciled to this change's actual three-artifact structure. That's consistent with the instruction to file the language "verbatim, not paraphrased" — but verbatim-copying a number that no longer matches the thing being gated is exactly the kind of thing that trips someone up when they're the one trying to close task 6.1 and can't find a fourth bullet.

**Suggested fix:** either (a) confirm with whoever owns the `websocket-delivery-time-authorization` precedent whether "four bullets" is meant to travel with the quoted sentence as boilerplate (in which case task 6.1 should say so explicitly, so nobody goes hunting for a missing fourth artifact), or (b) adjust the gate language for this task to reference the three artifacts actually in scope here, and note that the "verbatim" instruction was about preserving the *severity* of the gate language, not the literal item count.

---

## 3. TTL/fallback question is answered, but not labeled as answered with the same rigor as the other open questions

**Severity: minor documentation-traceability gap.**

Proposal.md is explicit: *"Design MUST state a TTL or fallback behavior (does the marker persist indefinitely, or collapse into the existing `disconnected_no_vote` state?)."* Design.md's D7 does answer this implicitly — the marker's lifecycle is fully derived from the facilitator's own connection-health state (no independent timer, no collapse into `disconnected_no_vote`) — and task 4.5 tests "lockstep, no separate timer." So the requirement is satisfied in substance.

But this is one of only two proposal-mandated "Design MUST state X" items (the other being the mid-vote freeze behavior, which does get an explicit callout via task 4.6), and unlike D10 and D12 — which are each given their own named Decision and are cross-referenced from an "Open Questions" section — the TTL answer is folded into D7's prose without being flagged as *the* answer to that specific proposal requirement. A future reader skimming design.md's Open Questions section for "did we ever decide on TTL vs. collapse" won't find it named there.

**Suggested fix:** not a task change — a one-line addition to design.md's D7 (or a cross-reference in the Open Questions section) stating explicitly "this also resolves proposal.md's TTL/fallback question: no TTL, no collapse into `disconnected_no_vote` — lifecycle is fully derived from connection state." This is a design.md polish item, not a tasks.md gap, but I'm flagging it here because it's the kind of thing that becomes a "wait, did we ever decide this?" Slack message during implementation otherwise.

---

## 4. Task 1.11's assertion is narrower than the proposal's acceptance condition text

**Severity: minor — suggested tightening.**

Proposal.md's acceptance condition: *"a 4001 close and, separately, a `reauth_required` message, must each drive the state machine to `reauth-required` and MUST NOT invoke the retry/backoff path at all — verifiable by a test that forces both signals through the handler and asserts **zero retry attempts and zero calls to the retry-delay function**."*

That's two distinct assertions: zero retry *attempts* (i.e., no `connect()` call scheduled as a consequence of reaching this state) and zero calls to `computeRetryDelay`. Task 1.11 as written only asserts the second: *"assert `state` becomes `'reauth-required'` in both cases and `computeRetryDelay` is called zero times."* It's plausible that "zero retry attempts" is covered elsewhere — task 1.15 (Race B) does assert `connect()` is never called again, but only in the specific scenario of a *pre-existing* pending timer being cancelled, not as a general property of reaching `reauth-required` cleanly (no prior retry episode in flight).

**Suggested fix:** add "assert `connect()` is not called again as a result of this transition" to task 1.11's assertion list, so the clean-entry case and the race case (1.15) both cover "no retry attempt," not just "no call to the delay function."

---

## 5. Task 4.1a and task 5.3 are checkpoints without a defined "what if" path

**Severity: minor — process clarification, not a build gap.**

Two tasks ask someone to confirm something with stakeholders but don't say what happens if the answer is "no":

- **Task 4.1a** asks Marcus Delgado and Priya Nair to confirm D7's "facilitator's own connection health, not per-participant" interpretation before task 4.1 is considered done. Reasonable, and I'll say now for the record: I agree with D7's reading. A per-participant heuristic would require either a new server signal (which the proposal's Impact section rules out) or a client-side "last update seen N seconds ago" guess, which is precisely the kind of manufactured timing surface this whole change exists to avoid introducing. Reusing the facilitator's own connection state is the right call. I'm comfortable signing off on this now rather than waiting for a separate confirmation round — but if this checkpoint is meant to be a real gate rather than a formality, tasks.md should say what happens to task 4.1 if the confirmation instead surfaces disagreement (does it reopen, does it spawn a new task?).
- **Task 5.3** asks someone to "confirm with whoever is coordinating issue #19" that the host surfaces are sufficient, without naming an owner or stating what "sufficient" means beyond the E2E test passing. This is vague enough that it could be closed by anyone asserting it's fine. I'd tighten this to something concrete: "confirm issue #19's E2E test can exercise both host components without modification; if it can't, file what's missing as a new task before closing this one."

---

## Items I checked and consider fully covered (no action needed)

For completeness, since I went through the whole cross-reference: the core two-state/no-fourth-value machine (1.1–1.4, 1.9), the `reauth-required` third state end to end including the sticky-state races added in design incorporation (1.10–1.15), the shared-module-not-forked requirement (1.1 header comment, 2.1, 2.2), the participant banner and its identity test (3.1–3.3), the timing floor and its early-recovery edge case (1.5, 1.6, 1.6a), initial-connection-failure bucketing (1.7), silent recovery (1.8), the grid marker's four-state bound and composition with `disconnected_voted` (4.2, 4.2a), cause-blindness (4.4), mid-vote freeze (4.6), facilitator-only gating (4.8), no-outlier-flagging (4.9), the reauth-required grid exclusion (4.10), the minimal host surfaces and Vite proxy fix (5.1, 5.1a, 5.2), the copy and visual-register sign-off gates (6.1, 6.2), the usability-test commitment (6.3), the pilot-readiness hard gate (6.4), and the final-sweep regression checks including the declined session-history question (7.1–7.5). The new Group 0 relocation (0.1) correctly precedes and unblocks 1.9/1.10 as designed.

One documentation note, not a task issue: proposal.md's Impact section still describes the close-code constants as living in `packages/backend/src/realtime/staleness-signal.ts` / `connection-token-refresh.ts`, which is now only true of their re-exported location, not their module of record (that moved to `packages/shared` per D1b/task 0.1). `design-review-incorporation.md` already explains why proposal.md was left untouched, so I'm not asking for a proposal.md edit — just noting it so nobody reads proposal.md in isolation post-implementation and flags a false discrepancy.
