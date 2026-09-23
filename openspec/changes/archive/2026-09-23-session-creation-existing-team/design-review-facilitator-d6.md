# Facilitator Review — D6 (Draft-Landing Control View)

**Reviewer:** Priya Nair (Facilitator, Platform Team)
**Scope:** Decision D6 in `design.md` — landing in `draft` status with an explicit "Open the room" action, in place of auto-advancing to `lobby`.

## Verdict: APPROVE WITH SUGGESTIONS

## Walkthrough

I picked a team from the picker, confirmed, and landed on the control view. Here's what I checked against the objection I raised during exploration.

**The core ask is met.** I asked for a window before the room opens to participants, and I got one — a real one, not a spinner between two navigations. The view renders in place (no round-trip through a separate route), the join link is visibly marked not-yet-joinable so nobody can wander in early by scanning an old link, and "Open the room" reads as exactly what it does: it's the thing that calls `/advance` and turns this into the live room. I don't have to guess what the button is for, and a failed advance leaves me exactly where I was with a retryable action instead of stranding me between draft and lobby. That last part matters more than it might look on paper — the worst version of this feature is one where a network hiccup leaves me unsure whether the room is open or not. D6 avoids that.

I also want to note what D6 gets right that I flagged as a risk generally: this is built as its own control view, not a participant view with a facilitator badge bolted on. That distinction was the thing I was most worried would get lost in translation from my objection to an implementation, and it didn't.

**Where it falls short of what I actually asked for.** My objection wasn't "give me a pause screen." It was "give me a window to review team history before I open the room to people." Those aren't the same thing, and D6 as scoped only delivers the first one. The control view shows team name and last-session-date, full stop — the design is explicit that there's no trend/history dashboard behind this, because that capability doesn't exist yet anywhere in the system. So the pause is real, but right now there's almost nothing to do with it. For a team I facilitate every two weeks, `lastSessionAt` tells me what I already remember. For a team I'm picking up cold — the exact continuity-across-facilitators case I care about most — a date with no context behind it doesn't give me what I need to walk in prepared. I'm not asking this change to build the trend dashboard; I understand that's a separate, not-yet-shipped capability and forcing it into this change would be scope creep for its own sake. But I want it on record that the review window's value is currently mostly structural (the pause exists, the automation is gone) rather than substantive (there isn't much to review yet), and I expect the trend/history capability, when it ships, to attach to this same control view rather than somewhere new.

**Two smaller things, not blockers:**

1. No mention of what happens if I click "Open the room" by mistake — is that transition reversible, or is `lobby` a one-way door once I've committed? My "facilitator calls it" expectation was about *when* the room opens, not about being locked in the instant I've clicked. If it's one-way, a lightweight confirm (not a whole new flow) would be worth it given how irreversible opening a room to a full team is.
2. No mention of a way to abandon a draft outright if I picked the wrong team on the confirm screen. Minor, and probably answered by "just don't open the room and pick again next time" in practice, but worth a line in the spec so it's a decision rather than a gap.

## Bottom line

D6 is the right structural call and I'm glad Devon moved off auto-advance — the mechanic protects the thing I actually care about, which is that nothing about opening a room to a team happens without me explicitly deciding it should. I'm signing off on it. My one condition is that "lightweight team context" doesn't quietly become the permanent ceiling — when the trend/history capability gets built, it belongs on this screen, not filed as a separate view I have to navigate to and lose the moment I've already carved out.
