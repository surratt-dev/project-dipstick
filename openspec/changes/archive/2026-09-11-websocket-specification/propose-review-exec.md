# Executive Stakeholder Review — WebSocket Specification Proposal (issue #24)

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Reviewing:** `proposal.md` (skimmed `design.md` for scope context)
**Date:** 2026-09-11

---

## Verdict up front

Approved. This is one of the rarer proposals that comes across my desk where "we found a problem while doing something else" is followed by "and we fixed the small part of it that mattered, and explicitly declined to fix the parts that didn't." That's the discipline I want more of, not less. I have one condition, not a blocker: the two deferred `[PREF]` events need an actual tracking issue before this is archived, not just a sentence saying none exists.

I'm not going to relitigate the technical decisions — event naming, timestamp placement, dispatcher call sites — that's not my seat, and the design doc shows the right people (Devon, Marcus, Priya) already argued it out. My job here is scope and alignment.

---

## Strategic alignment — does this serve adoption goals?

Indirectly, yes, and more than the "just a docs task" framing suggests. My adoption thesis for this whole product rests on the ritual staying trustworthy: engineers need to believe the reveal is genuinely simultaneous and that nobody — including the facilitator — sees a vote before everyone's shown theirs. That's not a nice-to-have property, it's the thing that makes the Health Check different from "another status meeting with extra steps." FR-4.6.1 exists to make that simultaneity checkable rather than assumed, and right now it isn't checkable in production. If that gap surfaced later — say, a team lead asks "how do we know reveals are actually simultaneous" and the honest answer is "we don't measure it" — that's exactly the kind of quiet erosion of trust I'd rather close now than explain later. So this proposal is buying down a real risk to the thing I actually care about, even though it arrived wrapped in a documentation issue.

The five stated ritual-integrity invariants (no pre-reveal leak, simultaneity measured, no reconnection side door, facilitator visibility structurally excluded, nothing configurable) are also exactly the sentence-level guarantees I'd want to be able to point to if an engineer or a skeptical EM ever asked "how do you know this doesn't leak." Having them stated once, in one place, with citations, is worth more to me than the same guarantees being true-but-scattered across five specs nobody reads end to end.

## Is scope proportional to value?

Yes, on both sides of the ledger.

**The code fix is proportionate.** I asked myself whether bundling a production code change into an issue titled "write a WebSocket Specification doc" is scope creep. On the facts given — one additive field, one already-identified call site, existing test suites plus new ones asserting the invariant that actually matters (identical timestamp per recipient) — this is not scope creep, it's the alternative that would have been worse: shipping a spec that documents a HARD requirement as satisfied when it isn't. I don't want documentation-as-theater. If the honest choice was "fix a one-field gap now" versus "write it down as a known gap and hope a follow-up issue gets prioritized," I'll take the fix every time, provided it's as small and additive as described here. The deployment sequencing (backend field first, frontend logging second, docs last) also tells me this isn't going to destabilize anything — it's staged the way I'd want a low-risk change staged.

**The restraint on the two PREF events is the right call, and I want it noticed as a positive, not just a non-issue.** `participant.joined`/`left` and live `actionitem.updated` would each require new authorization, delivery, and reconnection-safety design — that's a real feature, not a byproduct of reconciliation. Pulling them in here would be exactly the over-engineering-delays-value pattern I've asked this team to avoid. Spec-and-defer, stated plainly as NOT IMPLEMENTED, is correct. I'd rather see two honestly-named gaps than one quietly-scope-crept feature.

**The Appendix D correction is housekeeping, not a decision point for me.** Following existing precedent, consolidated into one note — fine, no comment needed.

## Governance question I do want on record

This change touches a production wire frame (`vote_revealed`) and a dispatcher five other shipped changes depend on being stable, inside a change whose title is about documentation. I'm not blocking on it, but I want it said out loud in the review chain (it should be, by whoever does technical/security review) that this got the same scrutiny a standalone "add a field to the reveal event" change would have gotten, and wasn't waved through faster because it was riding inside a docs proposal. The mitigations listed — additive only, existing test coverage, new tests for the cross-recipient invariant — read as adequate to me, but that's a technical judgment for Tomas/security review to confirm, not mine to bless on strategic grounds alone.

## The one thing I'd push back on if I were closer to the process

Open Question 1 in `design.md` — whether an SLA violation ever becomes visible to the facilitator or the session record — is explicitly deferred, and that's the correct call for *this* change. But I want to flag now, while it's cheap: that question is adjacent to my non-negotiable on data access controls (who sees what, and whether it can ever read as evaluative). If and when that question comes back for a decision, I want to be in that conversation, not informed after the fact. Noting it here so it's on record rather than raised as a surprise later.

## Condition for archiving this change

The two deferred events are marked "no follow-up issue currently exists." I don't need them scheduled — I explicitly don't want them built as part of this change — but an unowned, unnumbered gap is exactly the kind of thing that's true today and forgotten in six months. Before this change is archived, open two lightweight tracking issues (or one combined issue) for `participant.joined`/`left` and live `actionitem.updated`, even with no target date, so the gap has an address. That's a five-minute action, not a scope change.

---

## Summary

- Strategic fit: strong — this protects the trust property my whole adoption thesis depends on, even though it arrived as a docs issue.
- Scope proportionality: correct on both the thing it built (small, additive, closes a real HARD-requirement gap) and the things it declined to build (two PREF events that would have been real feature work).
- Not a blocker, but wanted on record: confirm the code change gets full technical/security scrutiny rather than a lighter pass because it's riding inside a documentation change.
- Condition before archiving: file tracking issues for the two deferred events so they don't rot as an unowned gap.
- Loop me in before Open Question 1 (facilitator/session-record visibility of an SLA violation) is resolved — it borders my data-access-control non-negotiable.
