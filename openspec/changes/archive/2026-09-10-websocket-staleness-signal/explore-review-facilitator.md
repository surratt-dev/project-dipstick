# Facilitator Review — WebSocket Staleness Signal (Exploration Notes)

**Reviewer:** Priya Nair, Facilitator (SME)
**Reviewing:** exploration-notes.md (Devon Calloway, 2026-09-09)
**Stake:** Task 9.1, Group 9 of the archived `websocket-delivery-time-authorization` change names me as the sign-off gate on this. Treating it that way.

---

## Overall reaction

This is the right instinct, and I want to say that plainly before the pushback below: treating "don't leak cause-of-revocation" as a UI-and-state-machine problem, not just a wire-protocol problem, is exactly the discipline I'd have asked for if I'd been in the room. The three leak vectors (wording, timing, behavioral asymmetry) are real, I've watched people get this wrong in exactly that order — get the copy right, then quietly special-case the retry logic six months later because someone wanted a "smarter" reconnect UX. Good catch, and I want it preserved into Design as a first-class constraint, not a comment.

That said, this document is written entirely from the disclosure-boundary side. It's rigorous about what the system must not reveal. It says almost nothing about what a facilitator running a live session actually experiences when this fires — and that's the half of task 9.1 I actually own. Below is that half.

---

## 1. The readiness grid marker needs to answer "do I need to do something?" in under a second

Bullet (d) and §5.3 both talk about the grid marker as an information-disclosure problem (facilitator-only, minimal, doesn't leak to other participants). Fair. But from my seat, mid-session, the marker also has to answer a completely different question the moment I glance at it: **is this person still in the room or not?**

Today, without any of this, if someone's locked-in dot never appears, I have exactly one interpretation available: they haven't voted yet. That's already something I'm tracking mentally across six to ten people while also watching the room. If we add a "may be stale" state, I now have three states to read at a glance instead of two (voted / not voted / not-voted-but-might-actually-be-gone), and the exploration notes are right that it can't be a fourth alarming state — but it also can't be a state I have to *think about*. It has to resolve into an instinct: "that one, don't wait on them, or don't be surprised if they need to be re-invited."

**Suggested addition to Design stage:** the marker should visually read as "uncertain," not "broken" — closer to a hollow/dimmed version of the existing not-locked-in state than a new icon or color. If it looks like an error, I will start treating it like one during the session (asking about it out loud, which is itself the wrong move — see §3). A greyed-out row with a small, quiet indicator (not a badge, not a color like red/amber that reads as "problem") is the right register. I'd want to see this actually mocked, same ask Devon already flagged in the open questions — I'm not signing off on "visually minimal" as prose.

## 2. Debounce this against real conference-room network flakiness, or the grid will be noisy for the wrong reason

The notes correctly worry about timing-based disclosure (instant-fail vs. eventual-fail leaking cause). I want to flag the adjacent but distinct problem: **normal session wifi flakes constantly**, and if the grid marker flickers on and off every time someone's laptop hiccups for two seconds, that's not a disclosure bug, it's a *usability* bug — it trains me to ignore the marker entirely by session three. That defeats the entire point of having a control surface that reduces what I have to track manually.

Whatever timing floor gets chosen for disclosure reasons should also be evaluated against this: does it produce a stable-looking marker under ordinary bad-wifi conditions, or a flickering one? These two requirements (no timing leak, no visual noise) probably point at the same number, but they're different justifications and I want both on record so nobody trims the floor down later purely for "responsiveness" without remembering the wifi-flicker reason it was sized that way.

## 3. This must not become de facto outlier flagging

I want to name a risk I don't think the notes anticipated: a facilitator seeing "participant X is possibly stale" is one short step from **treating that as a reason to call on them** ("hey, are you still there? did you get to vote?"). That's not what this marker is for, but it's exactly what an unpracticed facilitator — someone in their first session, which is a scenario I explicitly care about — will do with it, because it's new information on their screen and the instinct is to act on new information.

The advisory-not-prescriptive principle I hold outlier flagging to applies here too, maybe more so, because "your connection might be flaky" is a much more awkward thing to surface to a room than "your vote differs from the group." I don't want the UI to make it easy to accidentally out someone's connection trouble to the room by fumbling toward them in the moment. Practically: no click-to-ping, no auto-generated chat message, nothing that turns a quiet facilitator-only signal into a spoken moment unless I choose to make it one.

## 4. First-session support: this needs a tooltip, not a tutorial

Per my own success criteria, the first session for a new team is already the hardest one, and I'm already narrating vote types and format while running it. If a stale marker shows up during someone's very first session and I have to stop and figure out what it means, that's a bad first impression of the tool at the worst possible moment. A one-line hover tooltip ("last known state may not be current") is enough — it should be self-explanatory without me having to have read a doc first. I'd treat "does a first-time facilitator understand this marker without being told" as an actual usability-test criterion, not an assumption.

## 5. Copy (§5.2, §6 last bullet) — my first pass, not final

Devon flagged that the exact wording is my call. Rough draft to react to, evaluated against "must not escalate, must not imply blame, must be identical regardless of cause":

- Participant-facing: **"Your view may be out of date. Refresh to continue."** — I'd avoid "stale" in user-facing copy even though it's the right internal term; it reads slightly technical/cold. "Reconnecting..." (Devon's counter-example of what NOT to use for the revoked case) is out for the reason already given — it promises an outcome ("we'll fix this") that isn't true for the revoked case, and that's the asymmetry risk in prose form even if the *mechanism* is unified.
- Facilitator grid tooltip: **"Last known state may not be current."** Deliberately duller than the participant copy — nothing that reads as "something is wrong with this person," because for me it isn't a problem to solve, it's a fact to note.

Neither is final. I want to see both in context (banner in the actual layout, tooltip on the actual grid) before I sign off — copy reads differently in isolation than it does live.

## 6. Session history / trend continuity — flag, not a blocker

One of the things I lean on across facilitators is the trend dashboard and session history giving a new facilitator full context without a handoff conversation. This change doesn't mention whether a stale-connection event during a session leaves any trace in that history (e.g., "participant X's connection was interruped during topic 3" as a footnote). I don't think this change needs to build that — it's speculative scope creep if forced in now — but I want it named as a question for whoever eventually touches session history, the same way #33 was named and deliberately left alone rather than silently dropped.

## 7. Endorsing the #33 boundary as drawn

The decision to keep this change's grid indicator generic enough for #33 to consume later, without this change wiring up the reauth case, is the right call. I don't want a facilitator-visible indicator built twice with two slightly different visual languages six months apart — that's precisely the "two correct patterns independently rediscovered" trap Devon's notes already call out from the last change's review. Keep the seam clean, as proposed.

---

## Open questions I'd add to Devon's list

- Does the grid marker have its own minimum-display floor separate from the participant-facing banner's floor, or is it driven by the same underlying connection-health state and therefore inherits the same timing automatically? I'd assume the latter (one state, one floor, both surfaces render off it) but want it said explicitly at Design stage — this is the same "one shared source of truth" question Devon raised in §6, just pointed at timing specifically.
- If a participant goes stale *during* an active vote (not pre-session, not idle), does their row's locked-in-or-not status freeze at last-known-state, or does it visually change? A row that silently flips from "not yet voted" to "may be stale" while I'm mid-reveal-countdown is a different cognitive event than one that shows this before voting starts. I'd want Design stage to state which moments in the session lifecycle this marker can appear during, not just what it looks like.
- Usability test: I want to be in the room (virtually is fine) when this is tested against real facilitator judgment calls, not just checked against OR-2.2/OR-4.4 compliance. A marker can satisfy every requirement in this document and still be the wrong thing to have peripheral vision on during a live reveal.

---

## Summary judgment

Real pain point, correctly scoped, disclosure discipline is sound. What's missing is the facilitator-experience half: the marker has to read as calm and unambiguous at a glance, must not tempt a facilitator into treating it as an outlier-flagging or intervention signal, and must be stable under ordinary bad wifi or it trains me to ignore it. None of that changes the shape of the technical design — it changes how the grid marker looks, what it's called in copy, and what test criteria "visually minimal" actually has to pass. I want a mock before I sign off, per my own standing ask, and I want to usability-test the marker specifically for the "does this read as an alarm" failure mode before it reaches a real team.
