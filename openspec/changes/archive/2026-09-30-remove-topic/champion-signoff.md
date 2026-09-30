# Champion Sign-off — remove-topic (#51)

**Reviewer:** Devon Calloway, Principal Software Engineer (Internal Champion / Founding Advisor)

## Verdict: Approve

## Ritual intent — preserved

I checked this the way I check everything: not by reading the proposal's framing, but by looking for what touched the load-bearing constraints. Nothing did. The no-manager-participation rule, the simultaneous reveal, and the facilitator-from-another-team requirement are named explicitly in proposal.md's "Not touched" list, and I verified that against the actual diff, not just the claim — this entire change lives in the space between sessions (topic configuration), not inside a running session. `topics.ts`'s DELETE handler, the confirmation dialog, the archived-topics view — none of it touches vote mechanics, reveal timing, or facilitator assignment. Priya's review says the same thing from the inside of the ritual ("this whole feature happens off-ritual... I don't have concerns about this feature from that angle at all"), and I trust her read of that more than my own, since she's the one running sessions.

The one place I looked hardest: does the standing, org-wide facilitator model this change extends anywhere loosen "facilitator from another team"? It doesn't — if anything it's the opposite constraint (a facilitator must *not* be a team member to act on that team's topics), and TOPIC-002/004's `evaluateStandingFacilitatorAccess` check enforces it the same way TOPIC-003 already does, unmodified. Good.

The last-active-topic hard block is the one decision I'd have gotten wrong if I'd stayed in the room. My own exploration notes leaned toward a soft warning. Priya's review moved that to a hard `409`, and reading her reasoning — "the moment that actually costs something is standing in front of a team at session start with zero topics configured" — she's right and I was reasoning from the contract inward instead of from the Tuesday-afternoon-between-sessions moment outward. That's exactly the blind spot a founding advisor who isn't in the room every week is supposed to have caught by someone who is. This is the system working as designed, not a miss.

## On scope growth

I was asked to weigh whether this grew legitimately or drifted. My answer: legitimately, with one exception I'd flag for watching, not blocking.

Tested against my own bar — "would skipping this ship something broken, contradictory, or worse than shipping nothing" — every addition except one clears it:

- **The screen and TOPIC-002's correction** aren't scope creep, they're the literal issue. #51 says "confirmation UI missing" and there was no screen to hang a confirmation off of, and no working read endpoint to list topics on it. Skipping either ships an unreachable feature.
- **The FR-8.2 admin-access correction** (Finding 1, Marcus Delgado) closes a bug this exact change would otherwise introduce — an admin seeing a Remove button render and then eating a 403. Correct to fix now, correct to leave TOPIC-003's identical gap as a filed follow-up (#176) rather than silently widen already-shipped code in the same pass.
- **The facilitator-sessions.ts crash fix** is the kind of thing I want engineers to bundle when they find it. It's small, it's contained, and Rachel's review draws the right line: acceptable because it stopped at the crash and didn't try to also solve the deeper session_topics gap.
- **The archived_by column** is the one place I'd have said no on reflex — #51 never mentions provenance — and I'd have been wrong to. Priya's continuity concern ("I inherit teams without a handoff conversation... 'it's just gone' is a worse experience than the spreadsheet era") is precisely the failure mode I care about most, stated better than I stated it in my own exploration notes. This is a real requirement my original notes missed, not an engineer inventing work.

The exception: **the session_topics finding deserved to leave the document, and it did, but only because Rachel forced it.** That gap — no shipped endpoint populates session_topics at session creation, for any team, ever — is a production-severity finding that a "remove topic" design doc surfaced as a side effect of reading a file end to end. It was correctly not fixed here (that would have been real scope drift), and it was correctly escalated out into its own tracked issue (#175) rather than left as a footnote. I want to be on record agreeing with Rachel's framing: finding it here was fine, nearly *leaving* it here was the risk. Watch for this pattern — a "remove topic" change should not be where the team is relying on future readers to notice the ritual's core session flow doesn't work.

One thing I'll note for the record on my own behalf: Rachel flagged that "small and justified, said three times in one proposal" is worth a second look by issue #4 or #5 in this feature area (#52-55, Restore/Reorder/Annotate). I agree, and I'd rather that discipline come from the team continuing to ask the question than from me showing up to ask it for them.

## Success criteria check

- No manager participated, no exception made — unaffected by this change, still true.
- A team adopting this without me explaining it — this change is a small, calm addition (one list, one action, one dialog) to a screen that didn't exist before. It doesn't need me to explain it, which is the bar.
- Escalation path — Marcus's and Rachel's reviews resolved everything material without pulling me in mid-stream. Priya's review is the one doing the real ritual-fidelity work here, which is exactly the division of labor I want: I set direction at the start, the team and its reviewers catch what I'd have missed by not being in the room week to week.

No blocking concerns. Ship it.
