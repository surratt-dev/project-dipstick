# Facilitator Review: Pre-Session Action Item Review — Exploration Notes

**Reviewed by:** Priya Nair (Facilitator / SME persona)
**Reviewing:** `exploration-notes.md` (Devon Calloway) against `requirements/use cases/03 - Pre-Session Action Item Review - Use Cases.md`

I'm reviewing this the way I'd review any proposed change to the ritual: does it hold the line on the things I've learned the hard way, and does it give me — or whoever's facilitating that day — something that reduces what they have to track in their head. I'm not weighing in on the backend archaeology; Devon's done real diligence there and I have no reason to doubt the endpoint tracing. My lane is: does this feel like the ritual, or does it start to feel like a status report.

---

## What this exploration gets right

- **The "not a performance tool" framing is named explicitly, and I trust the reasoning.** The scoping to one team's own session, visible only to that team plus a facilitator who isn't from this team, never aggregated or cross-team comparable — that's the same boundary I'd draw. Good that it was checked structurally (the EM-exclusion trace) rather than assumed.
- **Staleness is correctly treated as advisory.** The use case says so explicitly (does not block advancing) and the exploration notes flag the copy/visual-treatment risk before design happens instead of after. That's the right order of operations — I'd rather catch "red badge with no explanation" in a doc than in a usability session with a real team.
- **"Begin First Topic" stays facilitator-only, server-enforced, no auto-advance.** No timeouts, no nudges, no automatic transition. This matches session pacing under facilitator control, which is non-negotiable for me.
- **Originating session number is preserved in the display.** That's the one piece of continuity-across-facilitators data this screen owes me, and it's there. If I pick up a team I haven't facilitated in two months, "open since session 4, we're now on session 7" tells me something my memory can't.
- **Real-time propagation for status changes exists and is push-based (WS), not polling.** Even though it's out of scope for *this* change's write path, knowing the broadcast mechanism (`publishActionItemStatusUpdated`) already exists and is gated to `pre_session`/`active` is reassuring — it means the eventual write-enabled version won't be bolted onto a polling loop.

---

## Observations and concerns

1. **Ordering is chronological, not priority-based — and that works against "at a glance."** The use case orders items oldest-first; the exploration notes don't question this. But my whole ask for the live session view is that the tool surface what needs my attention without me having to scan for it — that's exactly why I want automated outlier flagging during voting instead of eyeballing a grid. A flat, oldest-first list makes me do the scanning work the color coding was supposed to save me from. The use case's own Notes section already flags ordering as "an assumption... confirm with stakeholders" — I'd like to be one of the people asked. My instinct: stale-first (red, then orange, then yellow, then none), age as a tiebreaker.

2. **No summary at the top of the list.** If a team has been slipping, I might be looking at eight open items with three red ones buried in the middle. A one-line summary — "3 items need attention" or similar, non-judgmental — would do for this screen what the readiness grid does for me during voting: let me absorb the state of the room before I start reading line by line. Right now this reads as "render the list" with no acknowledgment that the list could get long over a team's lifetime, and it will, if a team is struggling.

3. **No legend or first-encounter explanation for what the colors mean.** The empty-state copy is specified in the use case ("no open action items — the team is all clear"), but nothing addresses what a participant sees the *first* time they encounter a red badge next to their own name. This is precisely the kind of onboarding-friction problem I already own for vote types and topic explanations — I don't want to have to explain "orange means two sessions" out loud in every first session for every new team. If the color scale is fixed and known (it is — 1/2/3+ sessions), a static, always-available explanation (tooltip, legend row, whatever design lands on) costs nothing and saves me a live explanation every time.

4. **The screen gives me nothing to do with a red item beyond reading it.** During voting, when something looks off, I decide whether to open the floor — the flag is advisory, the action is mine. Here, I can see that an item is red, but the use case and exploration notes don't give me (or anyone) a way to say "let's talk about this one" as part of the screen itself — it's read, then advance. That might be intentional — this may genuinely be a heads-down status check, not a discussion moment — but I'd want that to be a decision someone made, not a gap nobody noticed. Worth a line in design.md either way: is this screen allowed to spawn a conversation, or is it explicitly just information transfer before the ritual continues?

5. **Fetch-then-subscribe ordering isn't addressed.** The new GET endpoint gives a snapshot; the WS event notifies of subsequent changes. What happens to an update that lands in the gap between the GET response and the WS subscription being live — for the initial page load, not just the late-joiner case in the exploration notes' open question #1? I care about this because it's the same category of risk as "reveal built as close enough": a client trusting a snapshot that's already stale by the time it renders, with no mechanism to reconcile. This doesn't need to be solved with vote-reveal-level rigor since nothing here is secret or simultaneous by requirement, but if two participants can transiently see different lists because of subscribe timing, that undermines trust in the "all participants see this simultaneously" acceptance criterion in the first use case.

6. **The deferred write-path's "last-write-wins" is still an open product question, and it's exactly the kind of thing that will surface a social dynamic I need to be ready for.** The use case says last-write-wins is "assumed but should be confirmed" for the engineer/facilitator concurrent-update case. When I'm updating an item because an owner is unavailable and they update it moments later, whichever of us loses that race doesn't know it happened unless there's a UI signal. That's a smaller version of the same principle behind reveal integrity: don't let the system silently make a decision a human should be told about. I'd rather this get resolved before the write path becomes a "fast follow" than get carried forward as an assumption a second time.

---

## Questions for the propose stage

- Is item ordering staleness-first or chronological-first? (See observation 1 — I'd push for staleness-first.)
- Is there a design intention for a legend/tooltip explaining the color scale, or is that left implicit? (Observation 3.)
- Is this screen purely informational, or is there room for the facilitator to flag an item for discussion the way outlier votes get flagged? If it's intentionally discussion-free, say so explicitly so it isn't rediscovered as a gap later. (Observation 4.)
- What happens to a status update that lands in the window between a client's GET and its WS subscription going live? Not just the late-joiner case already flagged — the first-load case too. (Observation 5.)
- When the write path lands as a fast follow: will a losing concurrent update surface any signal to the person who made it, or does it just silently not take effect? I'd like this decided before it's built, not discovered by a confused engineer mid-session.

---

## Would this disappear into the background during a session?

Mostly, yes — for the read-only slice being proposed. The scoping is disciplined, the EM-exclusion and facilitator-only-advance logic reuse existing, already-trusted checks rather than inventing new ones, and the "not a performance tool" instinct is already baked into how the data is scoped. What keeps it from fully disappearing right now is the list-scanning burden: without staleness-first ordering and an at-a-glance summary, I'm still the one doing the mental sorting this feature exists to take off my plate. That's a small fix relative to the rest of what's here, and I'd rather it get made before design.md is final than after usability testing tells us the same thing.

I'm still glad to be the one who tests the facilitator view before it goes to a real team — put me down for that whenever it's ready, per my standing offer.
