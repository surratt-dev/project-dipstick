# Facilitator SME Review — reauth-required-copy-and-visual-signoff (exploration stage)

**Reviewer:** Priya Nair (Facilitator SME persona)
**Reviewing:** `exploration-notes.md` (Devon Calloway, Stage 1)
**Also read:** `packages/frontend/src/components/ReauthRequiredTreatment.tsx`, `openspec/specs/websocket-staleness-signal/spec.md`'s Pilot-readiness gate requirement and its #36 status note, and `design.md`'s D1/D4/D9 decisions from the archived `reauth-required-client-prompt` change, since the exploration leans on all three and I wanted to check its citations rather than take them on faith.

I'm reading this the way the brief asked me to: not as "does this document read well" but "if I were actually the person this sign-off gate names, would I recognize my own judgment in how it's being represented here." Mostly, yes. A few places I want to sharpen or push back on.

---

## 1. Does this capture real pain points and workflow friction? Would it disappear into the background?

Yes, and I want to name specifically why, because it's not a vague endorsement.

The thing I care about most, structurally, is the same thing across both the voting ritual and this gate: **a mechanism that looks like it's doing its job is worse than one that's visibly not built yet.** The exploration's whole argument in §1–2 is that a simulated sign-off against `currentColor`-border placeholder would produce exactly that failure mode — a checked box with nothing under it. That's the correct read of what I'd object to, and it's the same objection I'd raise about a facilitator app that shows "all votes locked in" when it actually means "server received something." I don't need this document to cite my persona to get this right; it independently derived the right instinct.

On "disappears into the background": the reason D1 lands correctly, in my read, is that it does *not* try to make everything quiet. `unknown-reconnecting` stays passive (`role="status"`) because it resolves on its own and doesn't deserve my attention. `reauth-required` goes assertive (`role="alert"`) because missing it silently disconnects someone. That's the right split. A tool that's uniformly quiet isn't calm, it's just unreliable — I'd rather have one loud, well-earned interruption than a dozen soft ones I've trained myself to ignore. So: the exploration and the design decision it's building on both pass this bar for me.

---

## 2. Is the exploration's read of "reads as an alarm without failing to be noticed" correct?

Mostly, and I want to spell out what I think that phrase actually requires, since the exploration treats it a little more narrowly than I would.

"Failing to be noticed" is the easier failure direction to reason about statically — `role="alert"`, non-dismissible-to-nothing, visually distinct from the neutral banner. Those are real, checkable properties and the exploration is right that they're closer to a design review than a felt reaction.

"Reads as an alarm" — in the *bad* sense, meaning it reads as an *error*, or as something has gone catastrophically wrong, or as a scolding — is where I'd push back slightly on how confidently this can be pre-judged. The exploration's §6 steering (amber/warning register, not red/error register; no clock-shaped icon) is the right direction, and I appreciate that it's careful to frame this as "the direction I'd point the next stage toward," not a decision made on my behalf. That carefulness matters to me. But color is necessary, not sufficient, for the alarm question. The thing that actually makes something read as alarming in a live session is *timing and context*, not just hue: getting yanked out of the room mid-topic, with a hard color-and-icon interruption, while everyone else keeps going without you, is going to feel jarring regardless of whether the border is amber or red — because the content of the interruption ("you're being disconnected right now") is inherently unwelcome news, not just its paint job. A perfectly-chosen amber mock can still fail the live test if the *moment* it fires feels like being ejected from the room. I don't think a mock — however well-composed — can settle that, and I don't think the exploration claims it can (§3 is explicit that #142 is a live-only claim). I just want it on the record that "amber, not red" is necessary work for #140 but isn't a proxy for "will read as calm-but-serious in the room," and nobody should treat a clean #140/#141 pass as a soft signal that #142 will probably also pass.

One thing I'd add that isn't in the exploration: I'd want #142, when it eventually runs, to specifically include the case where the disconnection happens *during a reveal or immediately before one* — because that's the highest-friction moment for this to fire, and it's exactly the moment named as explicitly out of scope for reveal-awareness (D6, "no reveal-timing awareness"). I understand and don't object to D6's scope decision — I don't want a special-cased mechanism either — but the usability test still needs to actually put a participant in that moment, not just any moment, or it isn't testing the case I'd actually worry about.

---

## 3. Is the honesty plan for #140/#141 sound?

Yes. I want to affirm two things specifically, because they're exactly what I'd insist on if I were doing this myself:

- **The distinction in §3 between checklist/negative-constraint judgments and felt judgments is real, and I want it kept, not softened in the next stage.** "Is there a CSS animation tied to a duration" is a yes/no I'd trust a careful simulated review to get right without me in the room. "Does this read as assertive without reading as alarming" is not that — it's downstream of twelve years of watching rooms react to things, and a simulated pass at it should be labeled as a reasoned guess, not a verdict, exactly as §3's last paragraph commits to. If a later stage's sign-off note drops that distinction and presents both kinds of judgment with the same confidence, that's the failure mode to watch for, and it's the one I'd be angriest about finding after the fact.
- **Withholding is a legitimate, complete outcome, not a stall.** The #36 precedent this document leans on is being read correctly (§1) — the gate isn't there to eventually always say yes, it's there to make sure a no is possible. I'd rather see four sign-off issues stay open with an honest "here's specifically what's missing" than see them closed against a border with no color in it.

The one gap I'd flag in the plan itself, not just its honesty: §9's four-step plan for the next stage says #139 (the real mock) has to land before #140/#141 are attempted. Good. But it doesn't say what happens if the *next* stage's #139 attempt is itself thin — e.g., picks a color without rendering it through both real hosts, or renders it only in `SessionConnectionHost.tsx` and skips `FacilitatorConnectionHost.tsx`. §7 is good on this (insists on both real hosts, citing the parity test), I just want it said plainly that a mock reviewed in only one host doesn't clear #140/#141 for the surface it wasn't rendered in — the facilitator's readiness grid is a different visual context from the participant banner and I'd want to see the register in both before signing either.

---

## 4. Usability concerns — the copy, and deferring #142

**Copy:** I read §4's flagged phrasing question ("Continuing will take you to log in again" vs. the actual button, labeled "Log in again") and I agree it's worth fixing now rather than waiting to notice it live. My actual preference, for the record, since the exploration correctly left this as mine to decide rather than deciding it for me: lead with the action, not "continuing" as an abstract subject — something closer to *"Your session needs to be renewed. Log in again to pick up where you left off."* — so the sentence's verb matches the button's verb. I'm not signing off on that wording here (that's still #140/#141's job, against the real mock, not this exploration), but I want it in front of whoever drafts next so it isn't rediscovered for the first time during #142.

One thing not raised anywhere in the notes: `role="alert"` means this interrupts screen readers immediately and assertively. For a sighted participant "reads as an alarm" is a visual/color question. For a screen-reader user it's entirely a *language and timing* question — there's no color to soften, just the announced text landing on top of whatever they were already listening to. I'd want #142's live test to explicitly include a screen-reader participant, not fold that case into "reads as an alarm" generally and assume the visual-register work covers it. That's a real gap in scope as currently described, not a hypothetical one.

**Deferring #142/#143:** I fully agree with leaving these out of scope for this stage, and I want to say clearly why, in my own terms: I already told this team I expect to be brought in for a real usability pass before this goes in front of an actual team, and I meant it as a condition, not a courtesy. A simulated pass at "does this feel like an alarm in the room" would be worth less than nothing to me — it would let someone downstream believe that question has an answer when it doesn't yet. The exploration's §3 explicit refusal to let #140/#141 substitute for #142 is the correct boundary and I don't want it relitigated later under schedule pressure. If anyone proposes closing #142 with "we reviewed the mock very carefully," that's the moment to reread §3 of this document back to them.

**One facilitator-specific gap I want tracked, not solved here:** the exploration and D9 both correctly note that the facilitator losing connection is higher-blast-radius than a participant losing connection — if I'm mid-session and this fires on me, the whole room is stuck with no facilitator and, per D6/D9's scope, no special handling for that fact. I don't object to today's shared-treatment decision (D9) or to issue #33 being where a second, facilitator-specific cue eventually lives — that's the right layering, additive not forked, matching how I described it in the design review already cited here. I just want it on record again from me, in this review, that #33 isn't a nice-to-have: a room where the facilitator silently vanishes with no signal to participants is a worse failure than anything this gate is currently scoped to prevent, and I don't want it to quietly fall off the backlog because this change's gate closed and looked like the whole problem was handled.

---

## Summary

- Exploration's core governance read (don't manufacture a sign-off against an uncommitted placeholder) is correct and matches exactly what I'd object to if I were doing this review myself.
- The dual-register design (passive `unknown-reconnecting`, assertive `reauth-required`) is the right shape for "disappears into the background except when it shouldn't."
- "Reads as an alarm without failing to be noticed" is bigger than color — timing/context (especially near a reveal) and modality (screen-reader users specifically) both need to be in #142's actual test plan, not assumed covered by the visual-register work.
- The checklist-vs-felt-judgment split for #140/#141 is the right discipline; keep it explicit in whatever sign-off note gets written next, and don't let a clean #140/#141 read as predictive of #142's outcome.
- Copy nit: match the CTA verb ("log in again") in the base sentence's lead, not "continuing" — mine to finalize against the real mock, not decided here.
- Add explicit host-pairing requirement to #140/#141: a register isn't signed off for a surface it wasn't rendered in.
- Deferring #142/#143 is correct and I don't want it relitigated. Track issue #33 (facilitator-specific stronger cue) as a real gap, not a footnote.
