# Facilitator Review — Exploration Notes, `actionitem-updated-live-broadcast`

**Reviewed by:** Priya Nair (Facilitator SME)
**Reviewing:** `exploration-notes.md`, including §9's decision to fold #64 into this change

Overall take first, since it should frame everything below: this is a real pain point, and I'm glad it's being treated as one change instead of two. Today, when someone updates an action item's status mid-review, the rest of the room doesn't see it until they refresh — which means I'm either asking people to hit refresh out loud, or I'm not sure the room and I are looking at the same list while I'm talking through it. That's exactly the kind of thing that pushes me back toward tracking state in my head instead of trusting the screen, which is the opposite of what I need this application to do for me. So: yes, build it. My comments below are about making sure it actually disappears into the background rather than becoming a second thing I have to manage during the review.

---

## 1. §7 (non-spotlight rendering) doesn't go far enough — this should be a hard constraint, not a "worth a sentence" note

I want to be blunt about this one because it's the same failure mode I've flagged for outlier flagging, applied to a different surface. Devon's instinct here is right, but the framing — "not a blocker, more a keep-an-eye-on-it flag... worth a one-line design.md acknowledgment" — undersells it. A status flip lighting up in front of the whole room the instant someone commits it is not a cosmetic detail to get right eventually; it's the same category of risk as an outlier callout that reads as surveillance instead of information.

Concretely, what I need from design.md, not just a sentence:
- No toast, no animation, no sound, no color flash. The item's own row updates its state indicator, full stop.
- No layout reflow that draws the eye. If the pre-session list groups items by status (Open / In Progress / Resolved), does a live flip make that item visually jump sections while I'm mid-sentence talking through the list with the team? That's worse than a static badge changing color in place — it's motion, and motion pulls attention. I want this named explicitly as a design question, because "group by status" is a very natural UI decision for someone who hasn't sat in the room and doesn't know that a mid-conversation jump is the thing that breaks my flow.
- Whatever ships needs to go through the usability pass I've already offered to do, specifically watching how it renders live during a walkthrough — not just reviewed as a static mock.

## 2. The facilitator-any-on-team override needs a design answer on attribution, not just enforcement

The endpoint side (§9, from #64) is right: server-enforced 403 if not owner, facilitator can update any item on the team. Good — that matches how the ritual actually works when an owner is out or the item's stale and nobody's champion for it anymore.

But the live-broadcast side raises a question the notes don't ask: when I update someone else's item on their behalf, does the room see that I did it, or just that the status changed?

This matters more than it might look like on a payload-minimalism pass. If the event carries a "changed by" field and the UI surfaces it, then the room sees "Priya changed Bob's item to Resolved" in real time — while Bob may or may not be in the room, may or may not agree, and definitely didn't take the action himself. That's not neutral information; it reads as the facilitator overriding an engineer's status in front of the team, which is a genuinely different social moment than the engineer quietly updating their own item. I don't want to create a dynamic where people feel like their backlog items can be closed out from under them live, even when the override is legitimate and exactly what the facilitator-any-on-team rule is for.

I'm not saying suppress attribution — sometimes it's useful, e.g. if I'm updating on behalf of someone who told me the answer but isn't in the room. I'm saying this needs an explicit design.md decision, in the same spirit as §5's session-context question: does the payload/UI show who made the change, and if so, how is it rendered so it reads as "recorded" rather than "performed"? Same register as the non-spotlight principle above — informational, not a callout.

## 3. Same-status no-op handling: good instinct, one usability gap

I like that a same-status PATCH is a graceful no-op — resets the staleness clock, no spurious event or history row. That's exactly right; nothing is worse in a live room than a phantom "status changed!" flicker for something that didn't actually change, especially if it happens because someone double-clicked or a client retried after a slow network response.

One thing the notes don't cover: from the *acting person's* side, does a no-op PATCH still give them confirmation that their click registered? If an engineer clicks "Open" on an item that's already Open (maybe they weren't sure, or their screen was stale), and nothing visibly happens because it's correctly suppressed as a no-op, that can look indistinguishable from "the button didn't work." I don't need this solved in this document, but I want it named as an open UX question for whoever builds the frontend piece — quiet-to-the-room and invisible-to-the-actor are two different things, and I only want the first one.

## 4. Error states should get the same non-spotlight treatment, explicitly

§7 covers the happy path (a status flip rendering live) but the notes don't mention what happens when a PATCH fails mid-review — a 403 because ownership was misjudged, a network blip, whatever. The spec already has a stated principle for this ("connection and error states follow a non-spotlight rendering principle") — I'd like that referenced explicitly here too, so nobody builds a jarring error banner for a failed status update in the middle of a room review. A quiet, local failure indicator on the one row, not a room-visible event. This feels like a one-line addition to the same §7 note rather than new scope.

## 5. Confirm this stays informational, not coupled to pacing

FR-3.4 is mine — I'm the only one who advances the room past action item review, and I don't want automatic nudges or advancement of any kind, from anything. The notes don't suggest otherwise, but I want it stated as an explicit non-goal in design.md: the live broadcast is purely informational, and nothing about "all items now resolved" or similar should auto-advance the review or prompt me to move on. I've been burned before (not on this app — elsewhere) by tools that decide they know when a meeting phase is "done." Worth a sentence now so nobody adds it later as a "nice touch."

## 6. Session-routing question (§5) — no objection to the lean, one practical scenario to sanity-check

I don't have a strong opinion on frontend-supplies-sessionId vs. team-scoped delivery — that's rightly an architect call. But since the notes ask for my read on anything session-flow-related: the scenario I'd want double-checked is a facilitator handoff mid-cycle. If I'm covering a team I don't normally facilitate and I open their pre-session review, is there any chance a status update made through a different open surface (the EM dashboard, per §5's option B risk) reaches my screen when it shouldn't, or fails to reach it when it should? The notes already flag this as "moot in practice" because it's gated to `pre_session` — I'll take that on faith from the architect, just wanted it on record that this is the concrete case I'd be testing during usability review, not a hypothetical.

## 7. Continuity across facilitators — good building block, correctly out of scope here

The `action_item_history` row from #64 is exactly the kind of raw material that eventually feeds the trend/history continuity I care about (success criterion #3 — picking up a team's session with full context, no handoff conversation needed). I don't think this change needs to do anything more with it than write the row correctly. Just noting I see the connection and I'm glad it's being captured now rather than bolted on later as a migration.

## 8. First-session / onboarding — no action needed, just confirming

I don't think this needs any special onboarding treatment for a new team's first session. The low-drama rendering in §1 above is exactly what makes it not need explanation — if it's done right, a first-time facilitator or team won't need it explained any more than they need the connection-health dot explained. If §1 gets watered down to something flashier, that calculus changes and this would need onboarding thought too. Flagging the dependency, not asking for new scope.

---

## Summary of asks

1. Elevate §7 from "worth a sentence" to a stated hard constraint in design.md, with the layout-reflow question (status-grouped lists jumping sections live) named explicitly.
2. Add a design.md decision on whether/how facilitator-made changes to someone else's item are attributed when broadcast live, framed around avoiding an "override performed on the room" read.
3. Flag the no-op-confirmation-to-the-actor question as an open UX item for the frontend piece.
4. Extend the non-spotlight principle explicitly to error states for this event, referencing the existing connection/error-state convention.
5. State explicitly in design.md that the broadcast is informational-only and never coupled to review pacing or auto-advancement.
6. No change requested on §5's technical lean — just want the facilitator-handoff scenario in my usability-test pass once there's something to click on.

I'll take the usability-testing offer from my persona seriously here — please loop me in before this goes in front of a real team, specifically to watch the live-render behavior during an actual walkthrough, not just review it as a static screenshot.
