# Executive Review — `reassign-action-item-owner` (VOTE-004 / issue #108)

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Lens:** Strategic alignment — adoption impact, scope proportionality, access-control boundaries I hold non-negotiable. I'm not reviewing implementation detail here; I'm reviewing whether this is the right amount of work, aimed at the right thing, at the right time.

## Bottom line

Approve to proceed. This is scoped the way I want to see backend work scoped: narrow, explicit about what it doesn't do, and reusing an already-reviewed pattern instead of inventing a new one. My comments below are about sequencing risk and one thing I want named on a roadmap, not about anything in this proposal I want changed.

## What I checked for

### 1. Does this move adoption forward?

Not by itself, and the proposal is unusually direct about that — it says plainly, twice, that landing #108 does not change anything a facilitator experiences in a live session, and that nobody should internally treat this as "facilitators can now fix misassigned items" until #68 ships the UI that calls it. I want to acknowledge that directness: I'd rather have a team tell me "this is plumbing, not a feature" than have it quietly rebranded as a win in a status update. That kind of self-discipline is exactly what keeps a scope decision honest six weeks later.

That said, plumbing only pays off if the fixture gets attached to it. My one real ask coming out of this review: **I want #68 named on a roadmap with a rough timeframe, not left "open and unscheduled" indefinitely.** A facilitator-only, session-scoped reassignment endpoint that nothing calls for two quarters isn't a defensible use of the engineering time that went into it — including the migration, the audit trail, and the twelve-plus test cases in this plan. I'm not blocking this change on that; I'm flagging it as the thing that turns this from "well-sequenced" into "shelfware" if it drifts.

### 2. Is scope proportional to value?

Yes, and notably the team pushed back on scope in the right direction rather than the wrong one. What stands out to me as good judgment, not just process compliance:

- It explicitly declines to also validate the *departing* owner's status, declines an off-session correction path, declines new-owner *availability* modeling, declines server-side `sessionId` derivation, and declines fixing the adjacent `ACTION-002`/history-write gap (OQ-8) even though the schema work here would make that fix tempting and cheap to bolt on. Every one of those is named as a deliberate exclusion with a stated reason, not silently dropped. That's the opposite of the internal-tools scope creep I've seen balloon projects before — I want more of this, not less.
- The one piece of rigor that isn't trivial — the `action_item_history` schema change, the dual-write transaction, the audit event, roughly a dozen test scenarios — isn't decoration. It's the mechanism that directly serves two things I've said are non-negotiable: that a facilitator's write authority is earned by *actively running a session*, not held as a standing role flag, and that an Engineering Manager can never end up holding an accountable action item through a loosely-written membership check. Reusing VOTE-002's already-reviewed session-scoped authorization pattern verbatim, and checking `role = 'participant'` exactly rather than "membership exists," is precisely the kind of precision I described wanting when I said the tool should encode intent correctly without a team having to ask me. I'd rather this be over-tested than under-tested at exactly this seam.
- The documentation corrections (the 403→409 fix and `sessionId` wording in the REST contract, the stale blocker language in `team-membership-removal`'s README, the cross-reference sentence in the status-management spec) are small, but they prevent a future team from either treating a stale doc as gospel or discovering a corrected precedent got re-litigated because nobody wrote it down twice. Cheap now, expensive later — right call to do it inline.

Nothing here reads as gold-plating to me. It reads as a team being precise about a narrow thing because the thing it's adjacent to (no-manager-participation, facilitator trust boundary) is load-bearing.

### 3. Anything that touches my non-negotiables?

The access-control shape is consistent with what I've required elsewhere in this product: team-scoped, session-scoped, role-exact. I have no concerns with the authorization model as designed. I'd have raised a flag immediately if "who can reassign" had been a standing role check instead of "actively facilitating right now" — it isn't, and the proposal calls that out as a deliberate choice, which tells me the team is thinking about this the way I'd want them to without my having to say so.

### 4. One thing I want on the record, not as a blocker

The proposal is honest that the endpoint's own namesake scenario — reassigning away from an owner who left the team — can't happen organically yet, because nothing in this codebase sets `removed_at`. That's fine as an accepted limitation for this change; the other reachable use cases (misassignment correction, load-balancing) justify shipping now. But I don't want "VOTE-004 is done" to get read internally as "the departed-owner problem is solved." It solves the mechanism; `team-membership-removal` still has to exist before the headline scenario is real. Naming this so it doesn't get lost between this change and that one.

## Questions for the team, not objections

1. Is there a rough target for #68? I don't need a date, I need to know it's on a list somewhere and not just "unscheduled" in perpetuity.
2. When `team-membership-removal` does get picked up, will its scope note (which this change corrects) actually get read by whoever picks it up, or should there be a lighter-weight flag (a tracked issue link) in addition to the README correction?

Neither of these should hold up implementation of this change. They're sequencing questions for whoever owns the roadmap, not design questions for this proposal.
