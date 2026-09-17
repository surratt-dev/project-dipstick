# Executive Stakeholder Review — restrict-team-005-em-promotion

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Focus:** Strategic alignment and scope proportionality
**Verdict:** Approve. This is not a feature — it's a repair to a promise I already signed off on. Prioritize it accordingly, and don't let the open-questions list turn it into a bigger program than it needs to be.

---

## Strategic alignment: yes, directly

I told the team when we scoped this application that data access controls are non-negotiable: a team's metrics stay inside that team's reporting structure, with EM and facilitator as the only exceptions — and even that exception is supposed to be a deliberate, audited act, not a side door. That's not a preference I hold loosely. It's the thing that keeps engineers believing this is their data and not a surveillance tool. If that belief cracks, the whole ritual dies, and three years of me telling peers "this is cheaper than one bad attrition event" dies with it.

TEAM-005 lets an EM on one team grant themselves — or anyone — silent, unaudited read access to a different team's session history. That is the exact failure my access-control promise was supposed to prevent, and it's currently possible with no admin decision and no record of it happening. I don't need to read the diff to know this has to ship before we put a second or third team on this thing. It's correctly flagged as a Phase 2 production gate, and I'd have pushed back hard if it weren't.

This also protects the audit-trail claim I make to engineers directly: that establishing EM access to their data is "a deliberate, audited action," not something that happens quietly. Restoring that TEAM-006 is the only door that opens is table stakes for the trust argument, not a nice-to-have.

## Scope: proportional, and I want to note the team showed restraint

I've seen internal tools projects balloon past the point of shipping value. This proposal doesn't do that, and I want to call out specifically where it stayed disciplined, because it's not automatic:

- **In scope, correctly:** the read-side fix, the write-side fix, and the requirements-doc correction. That last one isn't scope creep — a doc that asserts the broken behavior as intentional design is the same failure mode that created this bug in the first place (a comment asserting a check that doesn't exist). Fixing the code without fixing the doc leaves the trap loaded for the next engineer. Keeping it at the same priority as the code fix is the right call, and it's cheap.
- **Correctly scoped out:** issue #13's rate limiting, and the manager-removal endpoint. Both are real, both are someone else's lane, neither belongs bundled into this fix. Good.
- **Correctly deferred without blocking:** the database-layer defense-in-depth question and the historical audit-relabeling question are pushed to later, non-blocking, with an explicit statement that they shouldn't hold up the core fix. That's exactly the judgment call I want a team making under a security gate — fix the door, don't redesign the house.

The one place I want a sharper answer, not a bigger scope: **Open Question 6 — whether any phantom EM relationships already exist in production from this gap.** This is marked non-blocking for shipping the code fix, and I agree it shouldn't hold up the fix. But it sits closer to my success criteria than the framing suggests — "no engineer has raised a concern that the data is being used in a way that feels evaluative or punitive" only holds if nobody's data was actually exposed under the old gap. I don't need a full remediation program. I need someone to run the query and tell me the answer is "checked, nothing found" or "checked, here's what we found and here's who we told." Don't let "non-blocking" quietly become "never answered." I'd like this closed out within the same sprint as the fix, not parked indefinitely as a someday-item.

On the seven open questions generally: I don't see this as scope creep, because the proposal is explicit that questions 1-5 don't gate the core fix, and questions 6-7 are recorded rather than silently dropped. That's the discipline I want — decisions routed to the right specialist without turning a contained fix into a cross-team design review. If I come back in two weeks and the code fix hasn't shipped because five specialists are still debating the else-branch behavior, that's a process failure, not a proposal failure — hold the team to the proposal's own stated sequencing.

## Bottom line for adoption

This fix costs us a contained backend change plus a doc correction, in exchange for making a promise I already made to engineering teams actually true. That's the cheapest kind of trust to buy back. Ship it, get me the answer on Question 6, and don't let the open-questions list become its own project.
