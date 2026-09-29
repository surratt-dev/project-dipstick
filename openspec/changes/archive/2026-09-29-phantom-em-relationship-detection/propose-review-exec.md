# Executive Stakeholder Review — phantom-em-relationship-detection

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Focus:** Strategic alignment and scope proportionality
**Verdict:** Approve building the artifact. Do not let this proposal, once merged, be treated as closure of my original ask — it isn't one. It converts "nothing built" into "something built but still not run," which is real progress but not the answer I asked for six months ago. I want that gap named explicitly and escalated, not absorbed quietly into Stage 3.

---

## Strategic alignment: yes, and scope is proportional

Two read-only-adjacent SQL scripts and a result template, no application code, no schema migration, explicit refusal to collapse detection and annotation into one accidental-write script. That's the right shape and the right size for what's left of Decisions H and I. I don't see scope creep here — if anything the opposite: the proposal is disciplined about naming what it is *not* doing (no remediation program, no new EM capability, no rewriting `audit_log`) as carefully as what it is doing. The split between the detect script and the annotate script, kept as two deliberately separate invocations, is exactly the kind of guardrail I want when the second script is a write against an append-only audit table — good instinct, and it matches Decision I's own reasoning almost word for word.

Carrying Decision J and the notification recipient/channel forward to Stage 3 rather than deciding them here is also correct. Neither is an organizational-policy call I need to make; both are the Solution Architect's to settle.

So on "does this serve adoption goals, is scope proportional" — yes, cleanly.

## Does building-but-not-running close my original ask? No — and the proposal is honest that it doesn't

My ask in the archived review was specific: *"I need someone to run the query and tell me the answer is 'checked, nothing found' or 'checked, here's what we found and here's who we told.'"* Not a script. An answer.

This proposal's own Impact section says plainly: *"This change delivers the artifact; it does not deliver an executed result."* I want to be clear about what I think of that sentence: it's the right thing to write, because it would have been worse to bury the gap or to imply that a merged SQL file is equivalent to a checked population. Credit for not dressing this up. But it does not change the substance — as of today, six months after the fix that created this exposure and six days past the deadline I was told would hold, we still do not know whether any phantom EM relationship exists in production, and my success criterion that no engineer's data was exposed under the old gap is exactly as unverified now as it was on 2026-09-16.

So my answer is: this is a necessary step, not an acceptable resolution by itself. It only resolves my concern in substance on the day someone with production access actually runs both scripts and a result lands in `query-result.md`. Until then, the risk I originally flagged is still fully open — it has just moved from "no artifact exists to check it" to "artifact exists, still unchecked." Don't let anyone downstream file this proposal's merge as "Question 6/Decision H, done."

## The missed deadline: yes, this needs escalation beyond what the proposal states

The proposal states the fact of the miss honestly — "written 2026-09-29, six days after the original 2026-09-23 target," no revisionist dating. I appreciate that; restating history accurately is table stakes for trusting anything else in the document.

But stating a missed deadline in a proposal's Why section is documentation, not escalation. Nobody with the authority to actually get the on-call Production Data Engineer to run two scripts has been notified that this slipped. Decision H named an owner and a date with real intent behind it — my same-sprint ask, Tomás's concurrence — and it still slipped silently for six days until a GitHub issue forced it back into view. That is the failure worth naming on its own, separate from the scripts: a same-sprint executive ask, with a named owner and a hard date, missed its date with no one in this pipeline noticing until issue #117 manufactured the follow-up. If that can happen once, it can happen to the *next* deadline this proposal sets, for the same structural reason — this pipeline has no production access and therefore no way to independently verify its own deadlines get met.

What I want, concretely:

1. **A real deadline, not a placeholder.** Design.md should not just "set a new explicit execution deadline" in the abstract — I want an actual date attached before this proposal moves to Stage 3, and I want to know it.
2. **A named escalation path if it slips again.** Not "the pipeline will track it" — that's what failed the first time. Whoever hands this artifact to the on-call Production Data Engineer needs to also tell that person's manager, and needs a mechanism (a ticket, a calendar hold, a direct ping to me) that fires if the new date passes without a `query-result.md` entry. I do not want to find out about a second miss from a GitHub issue three weeks from now.
3. **A short acknowledgment, separate from this specific query, that "same-sprint executive ask" needs a tracking mechanism that survives a pipeline with no production access.** I'm not asking this proposal to solve that generally — it's a process question, not a scope item for this change — but I want it raised to me directly outside this document, because it's bigger than one query.

## Bottom line for adoption

Build it — the artifact is well-scoped, appropriately restrained, and honest about its own limits. But don't close the loop on my ask when this merges. The loop closes when `query-result.md` has an actual run date, an actual operator, and an actual row count in it. Until then, tell me this is still open, not done.
