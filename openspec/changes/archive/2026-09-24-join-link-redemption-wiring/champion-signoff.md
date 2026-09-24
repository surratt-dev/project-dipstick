# Champion Sign-off: join-link-redemption-wiring (#166)

**Reviewer:** Devon Calloway, Principal Software Engineer (Internal Champion, Health Check SME)
**Date:** 2026-09-24

## Verdict: Sign-off, no concerns on ritual intent

This one didn't touch anything I'd have pushed back on. It's plumbing, not ritual design — it makes a link that was silently dead (`sessions.join_token`, validated nowhere, pointed at an unregistered route) into a link that actually works, and it removes the fake column so the next person doesn't get fooled by it the way this one apparently did.

## Constraint check

I read `proposal.md` and `design.md` looking specifically for the three things I actually care about:

- **No-manager-participation rule** — not touched. This change doesn't add, remove, or alter any role check at redemption. `team_memberships` insertion logic is untouched; the only role lookups added (`actor_global_role` for audit rows) are for *logging who created or redeemed a link*, not for *gating who's allowed to*. Good — audit logging should never quietly become an authorization mechanism, and it hasn't here.
- **Facilitator from another team** — not touched. Nothing in this change goes near session/team pairing logic. Out of scope, correctly.
- **Simultaneous reveal** — not touched, not even adjacent. This is entirely pre-session (getting someone into the room), not in-session mechanics.

The one thing that looked at first glance like it might brush against "structural, not configurable" territory is Decision 3 — accepting a race that can produce two simultaneously-valid join links for a team, instead of closing it with a DB constraint. I want to be clear this is fine: a second valid link is something a facilitator can already do on purpose today (click "generate new link" twice), so the race just reaches a state that's already spec-legal. That's a capacity question, not a ritual-integrity one. Nobody gets into a session who shouldn't; nothing about *who* can join or *how the room works once they're in* changed.

## On the interim gap (#164)

Design.md is upfront that a link redeemed while a session is in `lobby` status still doesn't land the Engineer on a working screen, and that this is being shipped anyway because the badge on the `draft` view tells the facilitator what to expect before they decide to share. I'm fine with that trade as a *named, bounded* stopgap — my actual ask is that it doesn't become the permanent answer. If #164 is still unscoped in a quarter, that's the thing to escalate, not this change.

## One thing worth naming, not blocking

This is the second time in this area (after #45) that a change passed its own acceptance criteria while the underlying use case stayed non-functional. I'm glad the verification section explicitly requires testing against the frontend-constructed URL rather than a known-good token hitting the backend directly — that's the right fix for the actual failure pattern, not just this instance of it. Worth watching whether that verification discipline holds on the next change in this area, since it's evidently not the default the team reaches for on its own.

No blocking concerns. Ship it.

— Devon
