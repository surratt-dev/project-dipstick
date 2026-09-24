# Executive Stakeholder Review — Rachel Okonkwo, VP Engineering

**Change:** join-link-redemption-wiring (#166)
**Reviewer role:** Executive sponsor — consulted on scope decisions with organizational-policy implications, not a code reviewer. This review covers strategic alignment only: does this serve adoption, is scope proportional to value, and is the sequencing decision against #164 an acceptable trade.

## Bottom line

Ship it. The core fix is exactly the kind of thing I want prioritized without ceremony: a foundational use case — "a facilitator shares a join link and it works" — is currently dead for every team, discovered through a security review, blocking a paused change (#45) that's further downstream in the experience I actually care about (a facilitator's first session being low-friction). That's not optional polish; that's the floor. I don't need to read the diff to know this should not wait in a queue.

Two decisions in here are worth me weighing in on. One I'm comfortable with as scoped. One I want a commitment attached to before I call it settled.

## On removing `sessions.join_token`: proportional, not creep — conditionally

My instinct on hearing "this touches a migration, two insert sites, a response field, and six test files" is the same instinct I'd have on any internal-tools scope creep: is this required to ship the value, or is it the team polishing something because they're already in the file? Here I don't think it's creep, for a specific reason: this isn't new scope, it's the same root cause. The design doc is explicit that a `NOT NULL` column named `join_token`, returned in a response and formatted into a URL, is *what produced this bug*. Re-documenting it as "inert, don't use" and moving on leaves the exact same attractive nuisance in place for the next engineer who touches this file without the context this document is carrying. I've watched that pattern repeat before — a "temporary" dead field survives three reorgs because removing it always looks like someone else's scope.

The reason I'm not just waving this through unconditionally: the footprint is real — a schema migration touching a live table, bundled into the same commit as six test-file updates specifically so CI never sees a broken intermediate state. That's good discipline, and it tells me the team has already thought about the operational risk rather than me having to ask. What I want confirmed, not because I doubt the engineering but because it's the one thing that would change my answer, is whether this migration requires any deploy-order care in a rolling-deploy environment (old code still reading `join_token` while new code doesn't, mid-rollout). The doc states no data migration and a standard revert path, which reads as low blast radius — if that holds, I'm satisfied this is proportional scope for the fix, not a bolt-on. If a rolling-deploy window turns out to be more delicate than the doc assumes, that's a reason to sequence the column drop as its own follow-up commit *within this change*, not a reason to reject the removal outright.

## On shipping ahead of #164 with a one-line caution: acceptable, with a string attached

The trade here is real and I want to be honest about both sides of it rather than just blessing the convenient answer. Blocking a security-motivated fix on an unrelated, unscoped, no-timeline backlog item is a worse trade — that's how "the fix nobody can ship" becomes its own quiet failure mode, and I've sat through enough of those retros. The gap being shipped into is also genuinely narrow: it only bites an Engineer who redeems mid-`lobby`, and the facilitator was already told (via the reworded badge) not to broadcast the link as "ready" before `draft`. That's a bounded, named gap, not a silent one — which is the standard I actually hold this kind of decision to. I'd have said no to shipping a gap nobody wrote down; I'm not saying no to shipping one that's on the record in `design.md` and surfaced in the product copy itself.

What I'm not willing to treat as closed is the caution string as a permanent answer. My concern about adoption stalling has a specific shape: a facilitator's *first* session needs to be low-friction, and "an engineer clicks the link at exactly the wrong moment and lands on a bare team page with no signal anything happened" is precisely the kind of rough edge that erodes a champion's confidence in the tool during the window that matters most. A one-line caution is a fine stopgap for a bounded window. It is not a fine permanent state. I want #164 to leave "unscoped, no timeline" status soon after this ships — not years-later cleanup, but the next thing this area of the product does. If that commitment exists, ship #166 now, exactly as proposed. If nobody will own turning #164 into a scoped, scheduled change shortly after, then the "interim" caution is doing more strategic work than one line of copy should be asked to do indefinitely.

## Summary for the team

- `sessions.join_token` removal: approved as in-scope, contingent on confirming there's no rolling-deploy hazard in the migration step. Don't split it out for scope-purity reasons alone — it's the same bug, not a different one.
- Ship ahead of #164: approved. The gap is narrow, named, and mitigated. I want a real follow-up commitment on #164, not indefinite reliance on a caution string.
- Nothing else here reads as scope I'd push back on. No new capability is being introduced, which is exactly the shape of fix I want to see move fast.
