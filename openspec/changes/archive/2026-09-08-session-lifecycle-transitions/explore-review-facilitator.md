# Facilitator Review: Session Lifecycle Transitions Exploration Notes

**Reviewer:** Priya Nair, Facilitator (Subject Matter Expert)
**Reviewing:** `exploration-notes.md` (Devon Calloway, Internal Champion)
**Date:** 2026-09-08

---

## Top-line reaction

This is the right document to have written before anyone touches code, and I want to say that first because most of what follows is me pushing on edges, not disagreeing with the shape of it. Devon found real gaps I would have hit blind in a live session — the state machine not actually reaching `active`, the reveal endpoint not writing anything. That would have been a genuinely bad afternoon with a real team.

My read of this document is entirely through one question: when I'm standing in front of a team, mid-session, does any of this design produce a moment where I don't know what just happened, or where I'm stuck? A few places, yes — not fatally, but enough that Propose needs to close them before I'd sign off.

---

## 1. The reveal 409 — right call on the backend, unanswered on the screen in front of me

I agree completely that a second reveal call should not silently re-fire `vote_revealed`. That would be worse than an error — a second broadcast of "revealed" for something that already happened is exactly the kind of desync-under-the-hood risk I care about most (Section 26 of my own persona notes, if anyone wants to check: the reveal has to be a single atomic gate, once).

But here's the moment-to-moment scenario Section 4.1 doesn't walk through: I click Reveal. The screen doesn't visibly change fast enough for my taste — maybe there's a half-second where nothing looks different, maybe my own hesitation, maybe a real network hiccup. I click it again, because in the room, in front of eight people, "wait and see" is not a comfortable posture. What happens on my screen?

If a 409 surfaces to me as an error state — a red banner, a toast, anything that reads as "something went wrong" — that is a problem I did not have with index cards and a spreadsheet. I did not do anything wrong. The system did exactly what it should have. But now I'm looking at my laptop instead of the room, wondering if I broke something, at the exact moment I'm supposed to be watching faces for the outlier reaction.

**What I need from Propose:** the client's handling of a double-reveal 409 needs to be specified, not left as "the backend returns 409 and the frontend will figure it out." My ask is that a second reveal attempt on an already-revealed topic resolves, from my point of view, indistinguishably from success — the screen shows the revealed state (because it already is revealed), and nothing on my screen implies an error occurred. The 409 is correct API design. It cannot leak into my UI as a moment of doubt.

## 2. The advance-past-unrevealed 409 — same recovery-path question, plus a scenario I don't think is covered

Same principle, same ask: if I fat-finger "next topic" out of habit before revealing — and I will, especially in a team's first few sessions where I'm also managing onboarding and half-watching the clock — I need to land somewhere sensible, not at a dead end I have to puzzle out. Ideally the blocked-advance state actively offers me the reveal action right there, rather than making me back out and find the right button. That's a UI decision more than a state-machine one, but Propose should say so explicitly so it doesn't get lost between this document and implementation.

The bigger question, though: **is there ever a legitimate reason to move past a topic without voting on it at all?** Devon's document asserts "nothing suggests the facilitator can skip a reveal" and treats that as settled. In practice, this comes up. A team's roster or context changes between when the topic list was set and when we get to a topic — a topic that assumes an on-call rotation for a team that just deprecated on-call, a topic that references a practice the team stopped doing three sprints ago. Today, physically, I just say "let's skip this one" and move on. Nobody votes, nothing is revealed, we go to the next topic.

If the only path forward through this state machine is "vote → reveal → advance," there is no way to skip a topic in a live session — I would have to either force a vote on something nobody has anything to say about, or go edit the team's topic list outside the session (FR-8.2, and only after the first session per that requirement) to remove it retroactively. Neither is what I'd do today.

**What I need from Propose:** either confirm explicitly that topic skipping is not supported and I should be told to manage this via the topic list before the session starts (in which case, fine, but say so, because it changes how I run pre-session prep), or add a real skip path distinct from reveal-then-advance. Don't let this fall out of scope by default because the hard-409 framing made it sound settled.

## 3. Session-phase entry points — this maps to something real, and that's good, but the document undersells it

I went and checked FR-2.6 and FR-3 in the BRD before writing this, because Section 4.2's framing — "two undocumented session-phase entry points" — reads like bureaucratic overhead, two extra clicks between me and voting. It isn't. `pre_session` is the pre-session action item review (FR-3.1–3.5): the screen where open action items from the last session get looked at before we start voting on anything new. That's not friction, that's the part of my job I actually most need the tool to carry for me — it's exactly the "continuity across facilitators" and "trend/history without a handoff conversation" value I care about most.

So I actually want Propose to lean into this rather than treat it as two generic phase transitions to wire up symmetrically. `start` (lobby→pre_session) and `begin-voting` (pre_session→active, matching FR-3.4's "advance past the pre-session review to the first voting topic") are two different facilitator moments with two different jobs — one opens the room, one is a deliberate "we've dealt with old business, now new business." Losing that distinction in implementation (e.g., collapsing them into one button because they're adjacent in the state machine) would take away something FR-3 clearly intends me to have.

One thing I do want confirmed: FR-3.5 says a first session or all-resolved case should let me "proceed immediately" with a clear indicator. Good — that's the low-friction-first-session behavior I need. I want Propose to state plainly that this is a one-click pass-through in that case, not a screen I have to consciously dismiss every time even when there's nothing on it.

## 4. Membership removal mid-session — genuinely not addressed, and it should be

Section 5 treats removal as purely a roster-management event, decoupled from anything happening in a live session — "triggered by an HR/org event... not by anything happening inside a live session." I understand why that's true of the *trigger*. It is not true of the *effect*, if the event happens to land while a session is running.

Concretely: I have a session in progress. An EM removes someone from the team mid-topic, for reasons that have nothing to do with the session — maybe they're handling an unrelated personnel matter in real time and don't even know a session is live. What happens to that person's connection? Do they just vanish from my readiness grid, and if so, do I get any signal about why, or does it just look like a vote count that no longer adds up ("waiting on 1 of 8" when it's actually 1 of 7)? If they had already locked in a vote for the current topic, does it survive to reveal, or does it silently disappear? If I'm mid-reveal when this happens, does it change what gets published?

I don't need this document to resolve all of that — that's genuinely a runtime/session-state question at the boundary of both changes, and I understand why membership removal was scoped out of the session-runtime change. But right now nobody has been asked to think about it at all, and it's exactly the kind of gap that turns into a confusing, unexplainable moment in front of a live team the first time it happens. This is BRD open-question territory the same way OQ-5 is (line 730 area), and it deserves the same explicit "not resolved here, but named" treatment issue #23 got. I'd ask Propose to at minimum name this as an explicit open question with an owner, the way Section 5.2 did for action-item orphaning.

## 5. The two-change split — yes, this matches how I actually encounter this work

From where I sit, this split is right. I never trigger a membership removal, I'm explicitly excluded from its authorization model (correctly, in my view — my job is to be the uninvested outsider, not the person managing someone's roster status), and outside of the mid-session-disappearance scenario in item 4, it isn't part of my moment-to-moment experience of running a session at all. The topic lifecycle change — start, pre-session review, voting, reveal, advance, wrap-up — is the entire spine of what I do in a session. Bundling the two would have made the change I actually care about wait on a decision (issue #23) that has nothing to do with whether I can reveal a vote correctly.

## 6. Things this document correctly leaves alone

Worth saying so it doesn't get read as a gap: nothing here talks about the readiness grid, outlier flagging, or how the reveal *looks* on screen. That's right — this is a state-machine and transaction document, not a UX document, and conflating the two would have made it worse. I just want to flag, for whoever picks up the actual reveal-screen design, that Section 4.1's "reveal is a genuine one-way gate" framing is the correct foundation for that later work — the visual "event" quality of the reveal (my success criterion #2) depends on this being true underneath, and this document gets the underneath right.

## 7. Tie-breaking — confirmed, no notes

Section 4.1's conclusion that there's no tie-breaking mechanism to build is correct. None of the three vote types produce a value that a "tie" applies to. Glad this was checked rather than assumed.

---

## Summary of asks for Propose

1. Specify client-side handling of the reveal-already-happened 409 and the advance-before-reveal 409 explicitly as non-error, non-alarming states from the facilitator's screen — this is a UX requirement, not just an API contract detail, and needs to be named as such so it doesn't get implemented as a generic error toast.
2. Resolve explicitly whether a facilitator can skip a topic without voting/revealing it, mid-session. If not supported, say so and tell facilitators to manage this via the topic list beforehand. If it should be supported, design the path — it isn't covered by the current reveal→advance chain.
3. Preserve the FR-3-grounded distinction between `start` (opens pre-session action item review) and `begin-voting` (advances past it) as two meaningfully different facilitator actions, not a single generic "next phase" affordance. Confirm the FR-3.5 no-open-items case is a true one-click pass-through.
4. Name, as an explicit open question with an owner (mirroring how issue #23 was handled), what happens when a team membership removal lands while that member is an active participant in a running session — connection handling, in-flight vote handling, and what (if anything) I see in my readiness grid.
