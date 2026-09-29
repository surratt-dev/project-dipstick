# Facilitator Review — Exploration Notes, Issue #47

**Reviewed by:** Priya Nair (Facilitator persona), reading as the person who will actually be standing in front of a team looking at this screen while making small talk and deciding when to start.

## Overall take

This is thorough, careful work on the parts I can't see — the WebSocket plumbing, the registration gap, the authorization boundary. I trust it more than I could evaluate it myself. But it is almost entirely a trace of the *system*, not a trace of the *moment*. Nowhere in nine sections does the document ask "what is Priya doing with her eyes and attention while this list updates?" That's the question I'd want answered before I'd sign off on this going to usability testing with me. A roster that is architecturally correct but visually noisy will fail the only test I actually care about: does it let me stay present with the room, or does it become one more thing I'm managing instead of the conversation.

## Observations

1. **§4 (registration gap) is the right thing to flag as the hard blocker, and I appreciate it wasn't softened.** An empty roster that can never fill in for a first-time joiner isn't a bug to fix later, it's the feature not existing. Good catch, and I agree it needs its own security review, not a shortcut.

2. **§2's "which page does the facilitator actually look at" question is the second-most important thing in this document, and possibly should be the first.** My success criterion is "facilitate a session without referring to a spreadsheet or external notes." If the roster ships on the page I'm not looking at 90% of the time, I am back to mentally tracking who's here — which means the feature didn't reduce my cognitive load, it just moved the same tracking into a different browser tab I have to remember to check. I'd push hard for Devon's lean (shared component, both surfaces) and would not accept "SessionLobbyPage only, fast-follow for DraftSessionHost" as a real ship of this feature. A roster I don't see isn't a roster.

3. **The anti-flicker keying in §5 (key by userId, hold slot, don't delete-on-left) is exactly the kind of detail that keeps this from becoming a distraction.** A list that jitters every time someone's wifi hiccups is worse than no list — it pulls my eye toward the screen and away from the room every time it happens. Good instinct, correctly prioritized.

4. **§7's refusal to add a "3 of 8 expected" quorum counter — I want to push back gently, not reverse it.** I agree with the reasoning (the app doesn't know who's expected, and a counter invites quorum-pressure that isn't mine to create). But the notes don't address the problem that counter would have solved: right now I still have to hold "who's missing" in my head, because the roster only ever tells me who's *here*. That's not nothing — it's most of what I'm doing mentally during the wait today. I'm not asking for a counter. I'm asking that the design stage at least name this as a known residual gap rather than letting the quorum-counter rejection read as "the waiting-room cognitive load problem is solved." It isn't solved, it's partially solved.

5. **Nothing addresses what happens to a blocked join attempt from the facilitator's side.** §4 traces that a first-time Engineer hitting the D7 gap lands on a "no access" screen — silently, from my point of view. That's a real workflow-friction case worth naming explicitly: I could be looking at a roster that appears complete-and-current while someone on my team is stuck on an error screen with no way for me to know it's happening. A roster that looks authoritative but can silently omit a stuck person is arguably a worse failure mode than an obviously-incomplete one, because it doesn't invite me to check. I'd want the design stage to at least decide whether this is acceptable for v1 or whether the facilitator needs some signal (even a passive one) that a join attempt failed.

6. **List ordering and visual presentation aren't discussed at all.** Is this alphabetical, join-order, or does a disconnect re-sort someone to the bottom? If names move around the list as people connect and disconnect, that's the same jitter problem as §5's flicker fix, just reintroduced at the layout level instead of the identity level. I'd want a stable sort (alphabetical, most likely) so my eye can find a name in the same place every time I glance over, the way I'd scan a seating chart rather than a live leaderboard.

7. **The disconnect marker's visual weight isn't specified beyond "borrow the disclosure-blind posture."** I agree with the principle (don't diagnose cause, just show the fact) but I'd want to see it before I'd sign off — a marker that's too quiet gets missed, one that's too loud reads as an alert and pulls focus the same way an aggressive outlier callout would in the live-voting view. This is exactly the kind of thing that should be in the usability pass I've already offered to do, and I'd flag now so it isn't forgotten: don't finalize the visual treatment without showing it to me first.

8. **No mention of what happens to this context when the session actually starts.** Do I carry any sense of "who was here during the wait" into the live session, or does the roster just disappear and I'm looking at `FacilitatorReadinessGrid` cold? Given §8 already correctly keeps these as separate components, I'm not asking for a merge — I'm asking whether there's a jarring context-loss moment at the transition that's worth naming, even if the answer is "yes and that's fine."

## Questions for the design stage

- If the roster only ships on one surface initially (contrary to Devon's lean), who decides that's acceptable, and does it get tested with a real facilitator before that decision ships? I don't want to find out in usability testing that I'm looking at the wrong tab.
- Is there any plan to surface a failed/blocked join attempt to the facilitator, even in a low-key way, or is that explicitly deferred? I'd rather it be a named deferral than an unnoticed gap.
- What's the sort order, and is it stable across join/leave/reconnect events?
- Will the disconnect indicator's visual design go through a review before implementation, or only after, as part of my usability pass? I'd rather catch it earlier — a wrong visual metaphor is more expensive to unwind after usability testing than before.

## Suggested additions to the exploration notes

- A short section (or an explicit note in §9's open questions) naming the "who's missing" residual cognitive-load gap as accepted-but-unsolved, so it doesn't get lost between "we rejected a quorum counter" and "the roster solves the tracking problem."
- A note on list ordering/stability, parallel to the connection-flicker fix already in §5 — same failure mode, different layer.
- A note that the facilitator-visible failure mode for a blocked join (§4/D7) should be an explicit design-stage decision, not something that falls out implicitly from whichever registration fix gets chosen.
- One line acknowledging that the visual design of the disconnect marker is in scope for my usability review before ship, not just conceptually consistent with `connectionHealth.ts`'s posture.

None of this changes my read of the hard technical findings — §4 in particular is correctly identified as the real blocker, and I wouldn't want that deprioritized in favor of the polish items above. But polish is exactly what turns "technically satisfies the AC" into "disappears into the background," and right now this document is stronger on the former than the latter.
