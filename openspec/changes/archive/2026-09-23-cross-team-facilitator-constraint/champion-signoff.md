# Champion Sign-off — cross-team-facilitator-constraint

**Reviewer:** Devon Calloway, Principal Software Engineer (Internal Champion)
**Verdict: approve.**

## Does this preserve the ritual's intent?

Yes, and it's a boring kind of yes, which is what I want from anything touching this rule. The facilitator-from-another-team constraint was already a hard block with no toggle — that's the load-bearing property I care about, and this change doesn't touch the production code that implements it at all. What it does is close the gap between "someone read the SQL and it looked right" and "a test breaks if the SQL stops being right." That's exactly the direction I want changes near this constraint to move in, not away from it. Zero production diff, verified independently by security review down to actually mutating the handler and watching the new test catch it — I don't need to re-verify that; the reviewer did more diligence on it than I would have asked for.

The other three constraints I care about most — no-manager-participation, simultaneous reveal, topic-flexibility-with-a-visible-default — are untouched and unaffected. Nothing here goes near them.

## The session-record-validity scenario

The new scenario ("a facilitator joining the facilitated team after creation doesn't invalidate the existing session") is true, and it's the kind of true that's easy to state sloppily. My first read of the spec language, before I checked the disclaiming sentence, was that it could get quoted later as "facilitators joining their own team mid-session is a handled case" — it isn't, it's just that the session record itself doesn't fall over. The spec text draws that line explicitly: it says in plain words that this is a statement about the session record's continued validity, not about participation or voting eligibility, and that those are governed by `session-participation` and untouched here. That's clear enough that I don't think a future reader mistakes it for a broader guarantee. Good catch by security review, and good that it landed in both the test comment and the spec text, not just one of them.

## On issue #154

This is the part I actually want on record. A facilitator who later joins the team they're facilitating can, today, add themselves as a participant and vote in the session they're running. That's not a hypothetical — it's the exact failure mode the whole constraint exists to prevent, just arriving by a side door (join-after-creation) instead of the front door (facilitate-while-already-a-member) this change closes. I don't consider it in scope for a test-only PR, and I'm not asking anyone to reopen this change to fix it. But I want it said plainly: this is a real gap, not a theoretical one, and it should get a deliberate decision — fix it, or write down why the risk is accepted — not sit open indefinitely because it's narrow. #154 being filed and correctly scoped as separate is the right outcome. I'll be watching that one; if it stalls, I'll be the one asking about it.

## Process note

Running this on the full seven-stage track for what turned out to be a three-test, zero-production-diff change is more ceremony than the change needed, and the proposal says as much — that's fine, sequencing decisions made at kickoff don't need to be refought once the smaller scope is known. I'd rather see that judgment applied prospectively next time a duplicate-issue exploration turns up something this narrow, so the track gets right-sized before the ceremony starts, not just noted afterward. Not a blocker, just a preference on record.

No further action needed from me on this change.
