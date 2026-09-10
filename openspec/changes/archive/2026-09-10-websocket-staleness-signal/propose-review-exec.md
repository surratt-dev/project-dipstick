# Executive Review — websocket-staleness-signal

**Reviewer:** Rachel Okonkwo, VP of Engineering (Executive Sponsor)
**Date:** 2026-09-09
**Focus:** Strategic alignment, scope proportionality, adoption risk
**Verdict:** Approve. This is the condition I set closing, not new scope arriving unannounced. Build proportion is right. One thing I want watched, not blocked on.

---

## The headline judgment

I want to name where this came from before I evaluate it, because it changes the question I'm asking. When I reviewed `websocket-delivery-time-authorization`, I wrote the gate myself: no real team runs a live session until the generic staleness signal exists, full stop, same teeth as the SEC-25/26 tracking gate. Devon's sign-off on the reauthorization change then named the same thing from the other direction — the non-disclosure guarantee is real on the wire and unverified on the screen, and he was explicit that he didn't want "the disclosure boundary is done" repeated as a blanket claim until that closed. Two independent reviews, six months apart, pointing at the same open door.

So the question in front of me isn't "should we build this." I already answered that. The question is whether what got proposed to close it is the thing I asked for, sized the way I asked for it.

It is.

---

## Is a whole new frontend WebSocket client proportional to a UX banner?

This is the part that could read as scope creep on a skim — "first WebSocket client in the codebase" is a big sentence for what a participant experiences as one line of gray text and a facilitator experiences as one dimmed grid cell. I checked whether the size matches the value, not just the framing.

It does, for a reason specific to this problem: the thing being protected is a disclosure boundary, not a feature. A close-code test can prove a wire protocol says nothing. Nothing enforces that a UI built on top of it says nothing, except the UI itself — wording, timing, and retry behavior are all channels a state machine can leak through even when the byte on the wire is clean. That's not me taking the proposal's word for it; it's the same logic I already accepted when I signed off on the backend half of this guarantee. A state machine with two states, a shared timing floor, and a retry-symmetry test isn't gold-plating — it's the minimum shape that closes a disclosure guarantee rather than gesturing at one. If this had shipped as "just add a banner," I'd have sent it back for exactly the gap Devon named: cause could leak through instant-fail-vs-eventual-fail timing or retry behavior that nobody wrote a test for.

What I was watching for — and didn't find — is the version of this that balloons past the gate into a feature. It isn't here. Task Group 5 is explicit that the host surfaces are "enough to exercise Groups 1–3/4 end-to-end, not a feature-complete live-session page" / "not a feature-complete readiness grid." Issue #33 (reauthorization-specific grid distinction) is named and deliberately deferred to consume this module, not rebuilt inside it. And Open Design Question 2 — Priya's own non-blocking flag about someday recording stale-connection events in session history — gets named and explicitly declined as scope, for the right reason: a record tying connection stability to a named individual over time is precisely the surveillance-adjacent data shape I've told this org is non-negotiable. That the proposal caught that itself, without me having to be the one to say it, is exactly the judgment I want from this team.

This is my "ship fast, iterate" instinct being honored, not ignored. The scope is the gate, and only the gate.

---

## Does this serve adoption?

Directly, and on two fronts I track. First, it unblocks issue #19 (full-stack E2E), which is sitting behind this the same way the pilot gate is. Second, and this is the one closer to my own success criteria: a pilot team's first live session is the single highest-trust-risk moment this whole product has, and "the app just stopped working, out loud, mid-session" was the exact failure mode I flagged as a trust cost last time. This closes that hole before a real team ever hits it, not after.

I'll also note the design correctly keeps its hands off anything that would touch my non-negotiable: this is connection-health rendering, not data access. It doesn't move who sees what, and it explicitly declines the one idea (session-history stale-connection tracking) that would have started drifting toward individual-level surveillance data. Good boundary discipline.

---

## What I want watched, not blocked on

The proposal document itself is dense — verbatim-quoted gate language, two competing copy sketches, an explicitly unresolved design tension flagged rather than guessed at, cross-references to a prior champion sign-off and two archived tasks.md files. For a change whose shipped surface is one hook, one banner component, and one grid marker, the documentation-to-code ratio is high.

I'm not asking for less rigor here — given what's being protected, I'd rather it stayed this careful. But I want to name the pattern out loud: this is the second WebSocket-adjacent change in a row where the proposal's own weight (open questions, gates, cross-file verbatim quoting) is substantial relative to the build. If a third one shows up at this density, I want someone asking whether the process itself has started costing more than the risk it's managing, rather than each proposal being litigated as a one-off. Not a condition on this change — a flag for whoever's watching the pattern across changes.

One structural note, not a blocker: three separate Priya Nair sign-off gates before pilot (copy, visual-register mock, live usability test) is the right number given what each one actually checks — copy wording, color/icon register, and "does this read as an alarm" are genuinely different failure modes, and collapsing them risks rubber-stamping one while reviewing another. Leave them separate.

---

## Bottom line

Approve, no conditions. This is my own gate coming back closed, sized to the gate and not beyond it, with the one adjacent feature idea that would have drifted toward surveillance data correctly declined before I had to say anything. Ship it through the named Priya Nair gates (6.1–6.3) before any real pilot session, exactly as tasks.md already states.
