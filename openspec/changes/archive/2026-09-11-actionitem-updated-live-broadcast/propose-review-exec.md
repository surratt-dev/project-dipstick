# Executive Review — `actionitem-updated-live-broadcast`

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Scope of this review:** strategic alignment, scope proportionality, and the #64/#95 fold-together call. Not a technical review — I'm trusting the architect and engineers on transition semantics, payload shape, and dispatcher wiring.

## Verdict

Approve the fold. This is one of the rare cases where combining two issues *reduces* risk rather than inflating scope, and I'd have asked the team to justify the opposite call if they'd proposed shipping #64 alone. My only asks are below, and none of them block starting implementation.

## Strategic alignment

Action item follow-through is not a side feature of this application — it's half of why a team keeps doing the ritual at all. My second success criterion for this whole investment is explicit: *at least one team closes a loop, where something surfaced in a session gets addressed and marked resolved later.* There is currently no code path anywhere that lets that happen. That's not a gap I noticed in this proposal — the proposal surfaced it to me. Good. I'd rather learn "the write path doesn't exist yet" from a change proposal than from a team lead six months from now asking why the tool doesn't do the one thing they were told it does.

So FR-3.2 belongs on the roadmap regardless of what happens with #95's broadcast. The question this proposal actually answers is narrower and better-framed than "should we build #64": it's "given #64 has to get built, does it get built *with* the correctly-cataloged live event or without it." Framed that way, this isn't scope creep wearing a WebSocket costume. It's closing a [HARD] gap that happened to surface while someone was doing due diligence on a [PREF] ticket, which is exactly what good exploration work is supposed to do.

## Scope proportionality — was the fold the right call?

Yes, and for a reason I care about specifically: the alternative isn't "ship #64 now, #95 later, save some effort." The alternative is "ship #64 now with *some* ad hoc real-time bolt-on because #64's own acceptance criteria already promises real-time propagation, then either adopt or rip that out when #95 eventually gets built." That's not deferred work, that's double work, plus a live precedent for a second real-time pattern outside `websocket-specification` — the exact kind of inconsistency I've watched other engineering orgs accumulate until nobody trusts their own conventions anymore. I said in my own success criteria that I want a common language this org can point to without depending on any one person to keep it alive. A catalog that individual features feel free to route around when it's inconvenient is not that.

I also want to name what did *not* happen here, because it's the failure mode I actually worry about: nobody used the #64 dependency as a excuse to also pull in #65 (resolution notes) or #69 (the review screen itself). Both stayed out. The design doc is explicit that everything added — ownership enforcement, transition validity, the audit row — was already implicit in FR-7.3 and #64's own stated scope; this just stopped leaving it implicit. I'd rather see a team hold that discipline under pressure to bundle "while we're in there" than watch a two-ticket fold quietly become a five-ticket one. This one held the line.

One thing I want tracked, not blocked on: this change ships zero end-user-visible behavior. No UI consumes this endpoint or this event yet — #69 is unscheduled. I'm fine funding infrastructure that's built once, correctly, so #69 doesn't have to renegotiate its contract later. But I want someone keeping an eye on the gap between "endpoint exists" and "an engineer can actually close a loop in the product," because that gap is exactly what my second success criterion measures. If #69 sits unscheduled for two quarters, this becomes shelf-ware and I'd want to know that before I'm asked about adoption numbers.

## Does the proposal undersell or oversell what's shipping?

Slightly undersells, in framing rather than substance. The change is named and introduced around the broadcast (`actionitem-updated-live-broadcast`, opening paragraph leads with #95), but the majority of what's actually being built — a new authenticated mutation endpoint, an authorization model with a facilitator-override boundary, transition-validity enforcement, an audit trail — is the #64 half. That's the half that actually moves my success criteria; the broadcast is a UX nicety on top of it. I don't think this is dishonest, and tasks.md item 5.4 (update both GitHub issues to show they shipped together) is the right fix for the part that matters — nobody should look at the issue tracker after this merges and conclude #64 is still open. I'd just ask that when this gets reported up past the team level, it's described as "shipped the action-item status mutation and its live broadcast," not "shipped a WebSocket event," so the org gives itself credit for the part that was actually the harder and more valuable lift.

## Milestone framing

This is the one place I want a cleaner answer before this merges. #64 sits under "Action Item Management"; #95, by the two source issues, sits under "Pre-Session Action Item Review." Neither the proposal nor the design doc says a word about how this shows up in milestone-level reporting once one change closes issues in two milestones. That's a fine engineering decision to leave implicit in a design doc; it's not a fine thing to leave implicit in whatever view I or the CTO eventually look at to gauge progress. If "Action Item Management" is tracked as a milestone with its own completion percentage, I don't want it to look stalled because its one completed item is filed under a different milestone's PR, and I don't want "Pre-Session Action Item Review" claiming full credit for work that's really shared. Tasks.md 5.4 already has someone touching both issues on close — I just want that same step to confirm both milestones reflect the shared delivery, not just the two issue bodies.

## What I'm not weighing in on

Facilitator authorization scope (Open Question 1), session-context plumbing (Open Question 2), and the 409 response code (Open Question 3) are correctly flagged as architect decisions, not proposal-stage ones. I'll note only that Open Question 1 — whether a facilitator gets standing write access to another team's backlog vs. a session-scoped grant — is exactly the class of access-boundary question I'd want escalated to me if the default-deny mitigation weren't already sitting right there in the risks section. It is. That's the right instinct and I don't need to be in the room for the architect to make that call.

## Bottom line for the team

Ship it as one change. Hold the line on scope the way this design already has. Fix the milestone-reporting visibility before close, not after. And put a name on when #69 is likely to pick this up, even informally — I don't need a date, I need to know it's not falling off anyone's radar the moment this merges.
