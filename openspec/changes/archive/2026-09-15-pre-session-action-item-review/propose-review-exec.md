# Executive Review — Pre-Session Action Item Review

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Focus:** Strategic alignment with adoption goals; scope proportionality

## Verdict

Approve, with two conditions I want tracked before this goes in front of a real team (see below). This is the kind of increment I want more of: it closes a real gap in the ritual, reuses what's already built instead of re-deriving it, and it explicitly refuses to grow into the write-path work that doesn't need to ship yet. That discipline is worth naming, not just accepting silently.

## Where this earns its scope

Today, nobody except the facilitator — for the instant `POST /start` returns — can see what the team committed to last time. That's not a rounding error; it's the exact failure mode I described as my deepest worry: a ritual that quietly stops being trusted because it doesn't visibly follow through on itself. Fixing the read side for every participant, using the access check we already trust (`evaluateSessionSubscriberAccess`) and the query we already trust (`fetchPreSessionActionItems`), is proportional to that problem. No new auth logic, no schema changes, no new WebSocket event type. That's the profile of change I want to see more of, not less.

I also want to call out the follow-up issue commitment (task 1.3, filed before merge) as the right instinct. "Fast follow" that isn't tracked anywhere is how good intentions become permanent gaps — I've watched that happen on other teams. Making it a filed, scoped issue instead of a sentence in a proposal is exactly the discipline that keeps a phased rollout honest.

And the parts this proposal declined to build — the discussion-flag control, resolving the ordering question by fiat, touching `SESSION-005`'s unrelated error-handling debt — are the right calls. Every control this screen doesn't grow is one less thing that can tip the ritual from "the team's conversation" into "software being run on engineers." I'd rather the team under-build this screen than over-build it.

## Two things I want closed before wide rollout

**1. The gap between this ship and the follow-up needs a date, not a queue position.**

This change ships visibility without the ability to act on what you're seeing. That's a legitimate incremental step — right now there's *no* visibility, so this is strictly better — but it means a team's first few sessions on this screen will show them their own staleness creeping toward red with no in-app way to do anything about it. That's a worse first impression than no screen at all if it sits in that state for a month. I don't need the write path bundled into this change — I agree with the decision not to design the screen twice — but I want the follow-up issue to carry a real target, and I want to know before this reaches a pilot team whether that target is weeks or a backlog. My second success criterion — a team actually closing a loop — depends entirely on that follow-up landing, not on this change.

**2. The staleness-tier copy is the one place this change touches my non-negotiable, and I want to see it, not just approve the gate that produces it.**

Task 1.1 treats copy as a scope gate rather than polish, which is the right call — I just want to be explicit about *why* it matters this much: a red badge sitting next to an engineer's name is the single easiest way for this tool to start feeling evaluative. If that badge reads like a compliance flag instead of "this has been sitting a while," the ritual doesn't survive contact with the first team that gets nervous about it. I want to see the drafted copy for the empty state and each tier before it ships — not delegate that approval further down without my eyes on it, given what's at stake if it lands wrong.

## Confirmed against my non-negotiables

- **EM exclusion:** structurally inherited from `evaluateSessionSubscriberAccess`, which the design doc confirms has no admin/EM path in either grant variant, and task 2.5 explicitly tests for it. Good — I don't need to ask for this again on the next change that reuses this helper.
- **No new evaluative surface:** this is read-only, session-scoped, and doesn't introduce any cross-team or cross-owner comparison. Consistent with the access model I've asked for everywhere else in this application.

## On scope proportionality generally

Nothing else here reads as creep to me. The legend and the one-line summary are small, and they're doing onboarding work — they mean a first-time engineer doesn't need the facilitator to explain what a yellow badge means, which is exactly the low-friction first session I've asked the team to optimize for. The defined error states aren't extra scope, they're the bar I'd expect from any surface a whole team looks at simultaneously. I have no notes on the backend shape or the route decision — that's an implementation call, not a strategic one, and I trust the team's judgment on it.

## Bottom line

Ship it. Track the follow-up with a real date, and put the tier copy in front of me before it goes live to a pilot team. Everything else here is proportional to the problem it's solving.
