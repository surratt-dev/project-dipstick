# Facilitator Review: auth-audit-correlation-fields

**Reviewed by:** Priya Nair (Facilitator SME)
**Date:** 2026-09-17

---

## Bottom line

This one isn't mine to weigh in on, and I want to say that plainly rather than stretch to find a facilitator angle that isn't there. I was brought in to protect things like reveal simultaneity, readiness-without-spoilers, advisory-not-prescriptive outlier flagging, facilitator-controlled pacing, and first-session onboarding. None of that surface is touched here. This is a backend fix to three audit-event emit calls in the OIDC callback handler, adding `sourceIp` and `correlationId` fields that every sibling event in the same handler already carries. There's no UI, no session flow, no facilitator control surface, and nothing a participant or facilitator would ever see or feel differently as a result of this change.

I read the exploration notes in full rather than skimming for something to flag, and I agree with Devon's framing: this is conformance, not design. My review is short because the change is genuinely out of scope for what I evaluate, not because I skipped the exercise.

## Checked against my usual criteria — none apply

- **Reveal simultaneity** — not implicated. This is authentication/session audit logging, unrelated to vote reveal timing.
- **Readiness without spoilers** — not implicated. No vote-state or readiness-state surface here.
- **Outlier flagging tone** — not implicated. No participant-facing signal at all.
- **Facilitator-controlled pacing** — not implicated. Nothing here touches topic advancement or session control.
- **First-session onboarding** — not implicated. This fires during sign-in, before a session exists.

If I strain, the only tissue connecting this to anything I care about is that audit logs are what someone would pull if a facilitator or participant account had a login problem during a live session — "why did my vote submission fail, was it an auth issue" type of incident forensics. Good `correlationId` threading makes that kind of after-the-fact investigation faster. But that's a mild positive externality, not something the change needs my sign-off on, and I don't think it belongs in the proposal's motivation — it would overstate my involvement in a change that doesn't need it.

## One honest observation, not a UX concern

The notes are candid that the only real risk is a copy-paste mistake (minting a fresh `correlationId` per emit site instead of reusing the one bound in the closure), and that this is a code-review catch, not a design decision. I have nothing to add to that — it's outside my domain (I don't have engineering judgment to offer on closures and call-site correctness), but I'll note it reads as well-scoped self-awareness rather than a gap. Good sign for how boring this change is going to stay.

## Suggested addition to the proposal (procedural, not substantive)

When this reaches a proposal.md, I'd suggest the "who needs to review this" section explicitly note that facilitator/SME sign-off is **not required** for this change, with a one-line reason (no session-flow or facilitator-surface impact). That's not for my benefit — it's so a future reader of the change doesn't wonder why I'm absent from the reviewer list, or worse, route this to me for a spot consultation I have nothing to contribute to. Better to say "out of scope for Facilitator SME" once, in writing, than to have someone loop me in later out of process habit.

## Would this exploration lead to a tool that disappears into the background?

Not a question this change can answer either way — it has no user-facing surface to disappear or not. The honest answer is "not applicable," and I'd rather say that than manufacture a usability angle to seem thorough.
