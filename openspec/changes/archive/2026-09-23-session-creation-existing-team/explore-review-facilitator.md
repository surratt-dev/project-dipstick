# Facilitator Review — Session Creation for Existing Team

**Reviewed by:** Priya Nair (Facilitator / SME)
**Reviewing:** `exploration-notes.md` (Devon Calloway)

---

## Where this lines up with what I care about

Devon's finding in §3 is the same species of bug I worry about in the reveal mechanic, just in a different part of the app: something that looks correct in the UI and demo but isn't actually enforced where it counts. "The picker will hide my own team, so nobody will ever see the bug" is exactly the reasoning I don't trust — it's the same shape as "the votes will look simultaneous under normal network conditions." I'm glad this got caught before anyone wrote the picker screen, and I agree it belongs in this change, not a follow-up ticket. Good instinct.

The "no silent failure" framing in §2 also matches how I think about this. If I'm ever told no, I want to know *why*, not get a vague rejection — same principle as wanting outlier flags to name what they mean instead of just lighting up.

That said, the notes are almost entirely about whether the constraint holds. Nobody has yet described what it's like to sit in the chair and do this. That's the gap I want to flag.

---

## Observations

1. **The draft → lobby decision in §7 needs to come back to me before it's decided by default.** Devon leans toward auto-advancing straight to lobby. But the notes themselves say draft mode exists specifically so a facilitator can review team history before opening the room (ADR-007). If session creation auto-advances immediately, I never get that window — the room is open to participants before I've looked at the trend dashboard. That directly undercuts my own success criterion: a facilitator picking up a session for an existing team should have full context *before* people start joining, not after. Auto-advance might be right for a brand-new team with no history to review, but for an existing team — which is the entire scope of this change — I'd expect the opposite default. This isn't a minor sequencing detail; please treat it as a real decision, not a resolved one.

2. **"Lands the facilitator in the session room" is ambiguous about which room.** Is that my control view, or the same room participants see? The notes talk about surfacing the join link, which is a participant-facing artifact — but what do *I* see the moment session creation completes? If it's just "here's a URL to hand out," that's not landing me anywhere useful. I want to land on my control surface, with team history/trend data already loaded, and the join link available as one element of that screen — not have the join link stand in for "you're in the room now."

3. **The confirm screen is treated as "a courtesy" (§1) — I'd push back on that a little.** For enforcement purposes, sure, the server-side check is what matters. But for me, the confirm screen is the moment I catch my own mistake before it becomes a real session with real participants joining. What does it actually show? Team name and my name are mentioned per the use case, but does it show anything about that team's history — last session date, how long since I last facilitated them? If I'm picking from a rotating set of teams, "Team Falcon" alone doesn't tell me much at 8:55am before a session. This is worth a design decision, not an assumption that any confirm copy satisfies the step.

4. **The zero-eligible-teams case (§4, §6) needs facilitator-facing copy, not just a correct HTTP distinction.** Devon rightly separates "not a facilitator" from "facilitator with nothing to facilitate" at the API level — good. But what do I actually see on screen in the second case? This is a first-session-support moment in disguise: a facilitator with zero eligible teams (brand new to the role, or every team already has a live session per §8) is exactly the kind of person who needs the app to tell them what's going on and what to do next, not a blank list. Please don't let this resolve as an empty state with no guidance — that's the same failure mode as `NoTeamPage` telling a facilitator to "ask your facilitator for a join link."

5. **Concurrent-session blocking (§8) — I agree this needs to be handled now, and I'd go further on the UX.** If I try to create a session for a team and get blocked because a session already exists, I don't just want "no" — I want to know enough to act: is there already a live session I should join instead of create, and who started it? A flat rejection here will just make me try again later assuming it was a glitch. This is the same "explicit rejection, not silent failure" principle Devon already applied to the team-exclusion case; it should apply here too.

6. **Nothing in the notes addresses repeat-use friction.** I run this exact flow for three teams on a rotation. Devon's notes are about correctness of a single pass through picker → confirm → create, which is right for a first pass, but I'd ask: does the picker remember anything about my last few sessions (most recently facilitated team, say), or is it a flat, unordered list I re-scan every time? Not a blocker for this change, but worth a decision — a tool that's supposed to disappear into the background shouldn't add a small navigation tax every single time I start a session.

---

## Questions

- When the facilitator lands "in the session room" after creation, what is actually rendered — the control view I'd use mid-session (readiness grid, trend data), or a bare join-link display? This should be explicit in design.md, not implied.
- If draft mode is kept as the landing state (per my note above), what does *that* screen look like? Is it the trend dashboard with an explicit "open the room" action, or something thinner?
- For the concurrent-session block in §8: does "block" mean I can't proceed at all, or does the UI offer to take me to the existing session instead?
- Is there a moment in this flow where I'd see anything about the team I'm about to facilitate beyond its name — size, last session date — before I confirm? If not now, should there be, given how thin "Team Falcon" is as a confirmation surface?

---

## Suggested additions to the proposal

- Add an explicit decision on draft-vs-auto-advance to lobby that weighs my need to review history before the room opens, not just the use case's literal postcondition wording.
- Specify what the facilitator's own screen shows immediately after creation — separate from the join link the frontend surfaces to hand out to participants.
- Write the actual copy (or at least the intent) for the zero-eligible-teams state and the concurrent-session-blocked state — both are moments where a facilitator, possibly a new one, needs guidance, not a dead end.
- Note in design.md whether the confirm screen carries any team context beyond name, and make that a deliberate choice either way.

I'd like to see the picker → confirm → land-in-room flow walked through with me once a design.md exists, the same way I've reviewed the voting mechanics and session flow docs before. This is a smaller feature than the reveal, but it's the front door to every session I'll ever run, and a clunky front door is its own kind of friction even if the reveal itself is perfect.
