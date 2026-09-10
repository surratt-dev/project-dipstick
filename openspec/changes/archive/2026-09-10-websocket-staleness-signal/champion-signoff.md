# Internal Champion Sign-Off: websocket-staleness-signal

**Author:** Devon Calloway (Internal Champion / SME)
**Change:** websocket-staleness-signal, archived 2026-09-10

## Sign-off, with one condition carried forward as a real gate, not a formality

I'm signing off. This is the change that closes the half of the guarantee I flagged as missing in my `websocket-connection-reauthorization` sign-off: "the backend keeps its promise, but the actual screen a facilitator looks at during a session hasn't been verified to keep the same promise." That was issue #33's territory then, and this change is the frontend half showing up to do the work — a facilitator watching the readiness grid, or a participant watching their own connection, genuinely cannot tell "revoked," "flaky wifi," and — now, correctly separated out — "needs to log back in" apart from each other, except in the one case (`reauth-required`) where the wire protocol itself says that distinction is no longer a secret. That's not a UI team's guess at what disclosure-safety should feel like; it's the same guarantee I've been asking for since exploration, actually reaching the pixels.

What makes me comfortable calling this closed rather than "closed in spirit": the disclosure-safety properties are CI-enforced, not code-reviewed on faith. Retry-symmetry, the `reauth-required` no-retry behavior, and grid-marker cause-blindness are each a named test, not a paragraph in a design doc I have to trust an engineer read carefully. That's the difference between a constraint and a preference, and it's exactly the distinction I care about most.

## Core ritual constraints: unaffected, and correctly so

None of the mechanics this change touches — connection health, retry timing, a grid marker — sit near the no-manager-participation rule, the simultaneous reveal, or the facilitator-from-another-team requirement. That's as it should be; this was never going to be the change that threatens those. Two things worth naming instead of assuming:

- **D12 (declining session-history/trend-continuity for stale-connection events) is the one place this change came close to my actual red line, and it got it right.** A record tying a connection blip to a named individual across sessions is exactly the kind of thing that starts as "harmless operational data" and ends as a performance surface — the thing I'd rather the feature not exist than get wrong. Design didn't defer this as a someday-maybe footnote; it declined it outright and had `tasks.md` confirm by inspection that nothing in the implementation adds such a record. That's the right instinct, applied before anyone asked for it.
- **Nothing here grew a toggle.** The timing floor, the retry backoff, the jitter — all module-local constants, none reachable via env var, config, or admin surface, matching the precedent I already blessed for the reauth interval constants. I'd have pushed back if any of these had grown a knob. None did.

## On deferring Group 6 (copy / visual-register / usability sign-off) to issue #36

This is the part I was asked to weigh in on directly, so I'll be direct: **yes, this is an acceptable trade, and I want to say precisely why, because the reasoning matters more than the verdict.**

The urgency I felt — and the reason this whole change exists — was about the *structural* disclosure gap: a facilitator or participant inferring cause-of-revocation from wording, timing, or behavior. That gap is closed, and closed at the mechanism level, independent of what the marker eventually looks like. Cause-blindness here is a property of *which signal drives the marker* (Decision D7 — the facilitator's own connection health, not a per-participant flag) and *how the state machine is built* (D1, D2, D1a), not a property of its final styling. A marker that looks different next month, once Priya signs off on a real visual register, is exactly as cause-blind as the placeholder shipping today. Deferring the *look* doesn't reopen the *leak*. Those are genuinely separable, and this design treated them that way instead of gating the safety-critical work behind the polish work.

What actually reassures me about this deferral is task 6.2 itself. A simulated review looked at the real shipped placeholder and **withheld** sign-off — correctly, because the placeholder is unstyled rather than dimmed-or-hollow-or-disconnected-adjacent, and signing off on it would have meant pre-approving a future visual nobody has actually seen. That's the gate working, not the gate failing. My deepest standing concern for this whole project is that a protective constraint quietly becomes a rubber stamp once a deadline gets close. This is the opposite of that: the review had every incentive to wave it through and didn't.

The condition I want on record, in the same language the originating task used and that `archive-note.md` already carries forward: **this capability must not be used for a real pilot team's first live session until issue #36 closes** — copy is done, visual register isn't, and the live usability test hasn't happened and can't be simulated. That gate needs to stay a hard gate tracked against #36, not soften into "the frontend shipped, we'll get to the mock eventually." Task 6.3 in particular — Priya's actual point about noticing a marker in peripheral attention while running a real session under load — is not something a document review, mine included, can stand in for, and I don't want anyone treating my sign-off here as if it does.

## One thing to watch, not a blocker

D7's grid-marker signal-source interpretation (facilitator's own connection health, not independent per-participant staleness) is a design-stage inference confirmed via a lightweight checkpoint (task 4.1a) rather than something I or the BA stated outright at proposal time. I think the inference is right — it's the only reading that doesn't require inventing a new server-side signal — but I'm naming it here so it doesn't get treated as more settled than it is if #33 or #32 later needs to build against it.

**Verdict: signed off to ship the frontend mechanism and let it run in non-pilot/staging environments now. Group 6's deferral to issue #36 is a legitimate trade of UI polish against structural safety, not a softening of the disclosure guarantee — but the pilot-go-live gate on #36 needs to hold as a real gate, the same way task 6.2 held today.**
