## BA Review — WebSocket Specification Proposal (issue #24)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `proposal.md`, `design.md`, `specs/websocket-specification/spec.md`
**Date:** 2026-09-11

---

## Verdict up front

The three decisions I made explicit in `explore-review-ba.md` all made it into the proposal as decisions, not preferences. I checked each one against the actual proposal text, not against my memory of the conversation that produced it, and none of them got softened back into a "leans toward." This is buildable. There is one substantive gap I did not catch in the exploration review, surfaced by reading `websocket-session-authorization`'s spec directly rather than taking this document's citations of it at face value — see Section 2. It should be closed (as a documented acknowledgment, not new engineering work) before I'd sign off.

---

## 1. Confirmation: the three decisions held

**Open Question 1 (`serverTimestamp`: build-now vs. defer) → Option A, taken cleanly.** Proposal.md line 12: "Close the FR-4.6.1 gap now, in this change (not deferred)." Design.md D2 states the prior shipped payload is "non-compliant with FR-4.6.1 as of this requirement's introduction; this requirement is satisfied by the same change that states it, not by a deferred follow-up" — that is spec.md's actual sentence, word for word. Both of my suggested acceptance conditions are met: the requirement cites FR-4.6.1 by ID and states plainly (not "effectively" or "close enough") that the current payload does not comply. No Option-B language survived anywhere I checked.

**Open Question 2 (`participant.joined`/`left`, live `actionitem.updated`: build vs. spec-and-defer) → spec-and-defer, taken cleanly.** Proposal.md line 14 uses my exact suggested framing: "Spec-and-defer, not build," each marked NOT IMPLEMENTED, each stating plainly that no follow-up issue currently exists. Spec.md's requirement (line 181) matches this word-for-word against both FR IDs. Tasks.md 5.1–5.2 close the loop on the build side explicitly ("Do not open new implementation work for either event as part of this change"). Good.

**Open Question 3 (Appendix D correction ceremony) → inline correction, no new sign-off round, taken cleanly.** Design.md D6 states it outright: "no new sign-off ceremony." Tasks.md 4.3 frames my involvement correctly as "a review pass, not a sign-off ceremony, per existing precedent" — that's the distinction I drew, preserved. One consolidated note, not six scattered edits, per my explicit ask (tasks.md 4.1).

**Citation precisions from my exploration review, also folded in.** Proposal.md line 3 and design.md line 3 both state the `session-lifecycle-transitions` / `session-topic-lifecycle` two-capability-spec relationship explicitly, and design.md additionally notes the archive-directory-vs-capability-name mismatch (`websocket-session-authorization` archived as `2026-09-07-websocket-delivery-time-authorization`) inline where it's first cited. That was a "small thing, but gets asked in review if left implicit" in my prior note — it's no longer implicit.

I don't have anything to add on scope-shape or the Appendix D/Validation-Report consistency check; that was already confirmed clean in the exploration round and nothing in the proposal reopens it.

---

## 2. Gap not caught in exploration review: the sibling skew-budget requirement goes unmentioned

This document's stated job is to be the place "one document holds the full picture up against the BRD at once" (proposal.md line 3) and to state, catalog-level, that "simultaneity is measured, not assumed" (design.md D4, invariant 2). Reading `websocket-session-authorization/spec.md` directly (not just this proposal's citations of it), I found a second, already-normative measurement requirement that this document never mentions:

> **Requirement: Cross-recipient delivery skew is bounded for simultaneous fan-out events** (`websocket-session-authorization/spec.md`, line 165) — "the application SHALL keep the delivery-time skew across all recipient connections... within a documented budget measured under realistic concurrent-session load." Measurement is defined as the delta between first-delivered and last-delivered timestamps for the same `vote_revealed` fan-out.

I traced this forward into the archived change that produced it (`2026-09-07-websocket-delivery-time-authorization/tasks.md`, Group 6) and found the whole group — the p95/p99 latency measurement, the skew measurement, and the pass/fail budget itself — marked **DEFERRED, not performed**, with every checkbox in 6.1–6.7 unchecked. No documented budget exists today. This is a normative SHALL requirement, already shipped in a spec this document cites and delegates to, sitting exactly as unmeasured in production as the FR-4.6.1 `serverTimestamp` gap was before this change.

This matters for three reasons, not one:

1. **It's the same failure mode this change exists to fix, one document over.** This proposal's own Why section says, of the `serverTimestamp` gap: "I'm not willing to write a spec that describes that payload as compliant when it isn't, and I'm not willing to let it sit open indefinitely once named." The skew-budget gap is the same shape of problem — a stated SHALL, unmet in shipped code, discoverable by anyone who reads the cited spec instead of trusting the summary of it. I'm not asking this change to go measure skew (that's real engineering work, out of scope for a docs-and-reconciliation change, and correctly not something I'd want bolted onto this proposal). I'm asking that the connective document not walk past a named, adjacent gap in silence when its whole reason for existing is to stop exactly that from happening.
2. **It undercuts invariant 2's completeness as written.** Spec.md's "Simultaneity is measured, not assumed" section (and design.md D4 item 2) describes only the new client-side `observed_latency` computation. A reader who trusts this document as the single place to check "how do we know reveal is simultaneous" — which is precisely the role this document claims — comes away not knowing that a second, server-side skew measurement is also a stated requirement, and that it's currently unmet. `exploration-notes.md` (line 56, Devon's own words) already worked out that these are "two different, complementary latency guarantees; only one of them got built" — that reasoning exists in the exploration notes but never made it into anything a future reader would actually cite.
3. **It's exactly the kind of edge case I've flagged before as a risk of this project** — a gap discovered late getting treated as silently out-of-scope rather than a named thing to close. Precedent already exists in this same proposal for the right way to handle an adjacent unmet item without expanding scope: `participant.joined`/`left` is NOT IMPLEMENTED, no issue exists, stated plainly. The skew-budget gap deserves the identical treatment, not silence.

**Required change:** add one short, explicit note — in spec.md's invariant 2 section, or design.md D4, or both — stating that `websocket-session-authorization`'s cross-recipient skew-budget requirement is a second, complementary, currently-unmet measurement obligation (Group 6 of its originating change was deferred; no budget has been set or measured), distinct from this change's client-side `observed_latency` computation, and that closing it is not in this change's scope. That's it — one paragraph, no new engineering work, no new decision to make. It's the difference between this document actually holding "the full picture" and holding most of it.

**Suggested acceptance condition:**
- AC: Spec.md's invariant 2 (or an adjacent note) names the `websocket-session-authorization` skew-budget requirement, states its measurement was deferred and remains unset, and states explicitly that this change does not close it.
- AC: If there's a reason this was deliberately left out that I'm not seeing, I want that reason stated in design.md's Risks or Open Questions section, not just absent — the same standard I'm holding the rest of this document to.

---

## 3. Capability and acceptance-criteria specificity — no other issues found

I went through every requirement in `spec.md` checking for implicit or vague acceptance criteria (the thing I flagged repeatedly in the exploration round). All ten requirements have at least one WHEN/THEN/AND scenario, and none of them rely on adjectives doing load-bearing work except one, which is not a flaw:

- "Connection and error states follow a non-spotlight rendering principle" is stated at the same qualitative register as OR-2.4 itself ("advisory," "without visual treatment that prescribes a specific facilitation response"). That's consistent with an already-accepted BRD requirement's level of precision, not a new vagueness this proposal introduced — I'm not asking for a rewrite here.

Everything else — the event catalog table, the `serverTimestamp` capture-once requirement, the reconnection/facilitator-visibility invariants, the connection lifecycle sequence, the close-code catalog, the four recovery-mechanism visible-behavior statements — is falsifiable as written: a tester could take any one of these scenarios and write a test against it today without asking me what I meant.

---

## Summary of required changes before this proposal is final

1. Add the skew-budget acknowledgment described in Section 2 — one paragraph, no new scope, same treatment already given to `participant.joined`/`left`.
2. Nothing else. The three decisions from my exploration review are correctly and explicitly carried through, the citation precisions are folded in, and the capability/acceptance-criteria language is specific enough to build against as drafted.
