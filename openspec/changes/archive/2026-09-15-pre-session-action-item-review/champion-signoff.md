# Champion sign-off — pre-session-action-item-review

**Reviewer:** Devon Calloway (Internal Champion / SME)
**Status:** Approved. No blockers. Two items below need to close out before pilot, but neither is a reason to hold this change.

---

## Did this preserve the ritual's intent?

Yes. This is the screen I've been waiting for since I made the case to the VP — the moment the tool says something back about whether last session's commitments actually happened. It ships read-only, which is the right sequencing: the write path (`PATCH .../status`, already shipped under #64/#65/#95) exists, but bolting inline controls onto this screen's first layout pass would have meant designing it twice. Deferring UC1 step 6 and UC2/UC3 to issue #103 with a 2-week target is a named, accountable deferral, not a quiet scope cut — that's the standard I hold this kind of decision to, and it's met here.

## The four constraints, checked directly

- **No-manager rule.** Unaffected, and re-verified twice on this pass, not just inherited by assumption — once during design review (exploration-notes.md traced `evaluateSessionSubscriberAccess`'s structural EM exclusion directly), and again independently during the implementation security review (`session-subscriber-access-helper.ts:155-168` re-read line-by-line, confirming an EM gets a `404` from a `null` grant, never a read). No admin path exists on this endpoint at all. This is exactly the kind of "don't take it on faith" verification I want to see when a new HTTP route touches session access.
- **Simultaneous reveal / simultaneous transition.** Not literally in scope here — this screen doesn't touch vote reveal — but the analogous property for this screen (everyone leaves the review at the same moment) was treated with the same rigor. `begin-voting`'s `session_state_change` broadcast moves every participant off the review screen at once, and design review caught and closed a real race (engineer finding #4: subscribe-before-fetch ordering) so a participant can't get stranded on a stale branch after the facilitator advances. That's the right level of care applied to a mechanic that rhymes with the one I care most about.
- **Facilitator-from-another-team.** Correctly identified as not this screen's problem — enforced at session-creation time, not re-litigated here. No attempt to fold it in or quietly touch it.
- **Not a performance tool.** This is the constraint this screen leans on hardest, since it puts an owner's name next to a staleness color. It holds: scoped to one team's own session, no aggregation, no cross-team or cross-owner comparison anywhere in the spec, and the copy is written descriptively ("carried over N sessions") rather than in judgment language. This wasn't left implicit — a stakeholder-approval gate (Rachel's sign-off, see below) was written directly into the proposal as a scope gate, not a nice-to-have. That's the structural treatment I ask for: a load-bearing property enforced by requiring approval, not by hoping the implementer remembers.

No constraint was implemented as a configurable default in this change. Nothing here is a toggle.

## The two open items, for the record

1. **Item ordering (stale-first).** Implemented as a reasoned default in the absence of a stakeholder session, isolated to one function (`sortForReview`) specifically so it's cheap to flip if real confirmation lands elsewhere. That's the correct way to handle an unconfirmed default — visible, named, and cheap to reverse, not buried. I'd like to see this actually get confirmed rather than settle by default-through-inertia; put it in front of Priya.
2. **Drafted copy, Rachel's sign-off outstanding.** The draft itself is good — "carried over N sessions" is exactly the register I want, and the empty state and per-tier badges read as descriptive, not evaluative. The implementation review flagged one line worth Rachel's specific attention before she signs: the stale-summary variant, "N items need attention," sits closer to evaluative than the rest of the copy — "need attention" implies a should. I agree with that flag. It's minor, and the gate is already open and doing its job, but I'd ask that it's the first line she looks at.

Neither item blocks merge — both are already tracked as open, not silently resolved. My ask is that they actually get closed (Priya on ordering, Rachel on copy) before this goes to a pilot team, per the commitments already written into proposal.md and copy.md.

## One thing I want to name explicitly

This change also shipped a real, previously-invisible gap: without the new "Start Session" control, nothing in the running application could ever move a session out of `lobby` at all. That's not scope creep — it's the kind of finding I want a design review catching, and it was caught and fixed cleanly, gated the same way as every other facilitator-only control on this screen.

— Devon
