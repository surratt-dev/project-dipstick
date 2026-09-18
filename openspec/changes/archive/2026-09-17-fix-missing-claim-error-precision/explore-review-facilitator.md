# Facilitator Review — Exploration Notes: MissingClaimError precision (Issue #7)

**Reviewed by:** Priya Nair (Facilitator / SME), acting in her spot-consultation capacity.
**Date:** 2026-09-17

---

## Bottom line up front

This change has no surface I'm the right reviewer for. Nothing in it touches the ritual — no reveal mechanic, no readiness grid, no outlier flagging, no session pacing, no facilitator or participant view. It's a one-branch fix to which string gets thrown from `tokens.claims()` returning `null` in the OIDC callback, plus a matching spec-scenario split. I'm recording that assessment rather than silently declining, because the review brief asked three direct questions and the honest answer to all three is "not applicable, and here's why."

## Answering the brief directly

**Does this capture real user pain points and workflow friction?**
The pain point it fixes is real, but it's an *operator's* pain point (someone reading `auth.failure` audit events and getting told the wrong story about what failed), not a facilitator's or participant's. No one running or attending a Health Check session experiences this code path as a workflow. There's no friction here of the kind I'd normally be asked to weigh in on — nothing a facilitator does mid-session, nothing a new team encounters in their first session, nothing that shows up in the trend dashboard.

**Are there usability concerns missing?**
None that apply, because there's no UI and no session-time behavior change. `mapAuthError`'s user-facing message is explicitly confirmed unchanged (the note verifies this and flags it as a risk to *avoid* — good, I'd have flagged the same thing if it drifted). There is no participant- or facilitator-visible surface to evaluate usability on.

**Would this exploration lead to a tool that disappears into the background during sessions?**
This doesn't touch anything that's foreground *or* background during a live session — it's a backend error-diagnostics precision fix in the auth callback path. It neither helps nor hurts my "absorbs cognitive load instead of adding to it" bar, because it isn't in that surface at all.

## One thing worth naming, tangential but real

The note's own framing — "the tool's own account of what happened should match what happened" — is the same species of concern I hold about session history and trend data (see my Success Criteria #3 and #4: a facilitator picking up a team cold needs to trust that the recorded history is accurate). I don't think that overlap makes this *my* review to own, but it's a legitimate connecting principle, and I'd rather see it named explicitly than have someone infer I was consulted on ritual-mechanics grounds when I wasn't.

## Questions

1. Does the OIDC/`auth.ts` login path this touches share any code or audit infrastructure with the Health Check app's own session/trend-data recording? If a facilitator's or participant's SSO login ever fails and surfaces through this same callback, I'd want to know the user-facing message truly doesn't change — the note says `mapAuthError` is untouched, which answers this, but I'd want that stated as a one-line "no facilitator/participant-facing surface" note in the proposal itself so it doesn't need re-deriving later.
2. Is SME/facilitator review being requested on every change in this repo regardless of whether it touches the ritual, or did this one get routed to me by default? If the former, I'd suggest a fast-path: changes that don't touch the four constraints (reveal simultaneity, readiness-without-spoilers, advisory outlier flagging, facilitator-controlled pacing) shouldn't need a full facilitator sign-off pass — just a one-line screen-and-skip, which is effectively what this document is.

## Suggested additions

- To the exploration note itself: none needed on my account — the author (Devon) already scoped this correctly and explicitly said "my four load-bearing constraints are untouched," which is exactly the self-check I'd want to see before a change reaches me.
- To the review process: consider having the "SME consult" step check for ritual-surface relevance before requesting a facilitator review, so cycles aren't spent on changes like this one where the honest review is "not applicable."

## Recommendation

No objection to proceeding to proposal. I don't need to be looped back in on this one — nothing here touches what I'm responsible for protecting.
