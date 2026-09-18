# Facilitator Review — SEC-26 `reauth_required` Client-Visible Prompt

**Reviewer:** Priya Nair, Facilitator (Subject Matter Expert)
**Reviewing:** `exploration-notes.md` (Devon Calloway), against `ConnectionStatusBanner.tsx`, `connectionHealth.ts`, `AuthErrorPage.tsx`, `SessionConnectionHost.tsx`, and issue #32.

---

## Overall

The tracing in §3 is careful and I believe it — I checked the same three files myself before writing this and Devon's read of the code is accurate: the state is genuinely terminal at message-receipt, there's no "phase two" to design for, and `AuthErrorPage.tsx`'s "Try Again" button really is the exact pattern to reuse. The structural constraints in §9's first list (no wording overlap with `unknown-reconnecting`, no countdown, render-on-receipt, role-uniform copy) are sound and I'm not relitigating any of them.

Where the notes are thinner is exactly where I'd expect them to be thin, coming from someone tracing code rather than running sessions: the actual moment-in-a-session this interrupts, and what it costs a participant or a facilitator to have it land badly. That's my job, not Devon's, so here it is.

## 1. My call on §7 — banner vs. assertive

Devon asked me not to dodge this, so: **not a passive parity banner.** I want this elevated above the `unknown-reconnecting` treatment, for one reason that overrides my own "disappear into the background" instinct — missing this one isn't a stale-but-harmless outcome, it's a silent forced disconnect. For a participant, that's a person who vanishes from my grid mid-topic with no idea why. For a facilitator, design.md's own Risks section already says it can stall the whole room. Both of those are worse ritual-fidelity failures than a slightly louder interrupt.

Concretely, what I want carried into Propose:

- **Not a full modal.** I don't want this to feel like the application is running the session rather than the room. A hard modal that steals focus from someone mid-compose is the wrong tool.
- **But not `role="status"` either.** That's `aria-live="polite"` — it queues behind other announcements and is exactly the treatment built for a state nobody's required to notice. This state is the opposite of that. I want `role="alert"` (assertive) considered specifically for this branch, distinct from the shared-file/shared-switch-statement structure Devon is right to preserve. Sharing a component doesn't mean sharing an ARIA role — those are independent decisions and I don't think anyone's actually decided this one yet.
- **Persistent, not auto-dismissing.** If it can be dismissed without acting, someone will dismiss it out of habit and get disconnected anyway. Either it isn't dismissible before the CTA is used, or dismissing it demotes it to a small persistent badge rather than removing it — never to nothing.
- **Visually distinct register** from the neutral staleness banner — color/weight/icon, not just different words in the same gray box. I need a real mock to sign off on this, same as I said I would for the staleness banner. Prose won't settle it.

## 2. A gap the notes don't name: this can land during the reveal window

Nobody in the notes considers what happens if `reauth_required` arrives in the few seconds around a reveal — right after someone locks a vote, or during the reveal moment itself. Reveal simultaneity is the single property I care most about, and while I understand the server-side truth of *when* the reveal fires isn't touched by any of this, the participant's *experience* of it can be. If this banner pops up on one person's screen right as votes are revealing, that person's reveal moment gets stepped on, and depending on how the grid renders it, it could look to me — mid-session, managing a room — like a desync bug rather than an unrelated auth event. I want this scenario explicitly named in Propose, even if the answer ends up being "acceptable, rare, no special handling" (consistent with D9a's no-special-casing stance) — I just don't want it to be an unconsidered case that only surfaces the first time it happens live.

## 3. §6 — the vote-loss gap needs a decision now, not at Propose

I agree with Devon's framing but I want to be more forceful about it: this isn't a "flag it and let Propose decide (a) or (b)" item for me. I want to know which path we're taking *before* I sign off on copy, because the two options produce genuinely different sentences, and I don't want to review two half-drafted variants against a mock. If the `sessionStorage` fix isn't landing alongside this, the copy has to say plainly that an unsubmitted vote won't survive clicking the button — and I'd rather that sentence exist and turn out unnecessary than ship without it and have a participant find out by losing their vote silently mid-session.

## 4. The current placeholder isn't just copy-TBD — the CTA is entirely missing from the code

I read `ConnectionStatusBanner.tsx` directly. Today it renders `<div role="status">{REAUTH_REQUIRED_TEXT}</div>` — text only, no button, no `window.location.href` wiring at all. Devon's §9 constraint #4 (CTA live from first render) is a design intent, not yet a fact about the code. Worth stating plainly so this doesn't get treated as "just swap the string" when tasks get scoped — it's a new interactive element in a component that currently has none.

## 5. Forward note for whoever picks up #33's control surface

This is out of scope here and I'm not asking Devon or this change to solve it, but I want it on record: my tolerance for missing this signal about *my own* connection is lower than a participant's, because when I lose the room I lose the room. The shared banner in this change is the right baseline for both roles — I agree with §8, one signal, one copy, no role fork. But the facilitator's eventual dedicated control surface (the readiness grid) would be a reasonable place for a *second*, more insistent cue about the facilitator's own connection specifically — additive, not a fork of this mechanism. Naming it now so it isn't forgotten by the time #33 is scoped.

## 6. Smaller usability questions, not blocking

- Is there any accessibility consideration for a facilitator running the session on a shared/projected display while controlling from a laptop? A banner at the top of their own screen may not be where their attention is during a live topic. I don't have an answer, just want it asked when we get to a mock.
- I noticed the notes don't mention whether the CTA should be a `<button>` matching `AuthErrorPage.tsx`'s exact visual style, or just the same *behavior*. I'd assume same behavior, consistent visual family with the rest of the app rather than a pixel-identical copy — but that's a small thing for the mock, not a design question.

## Bottom line

Structural constraints in §9 are solid, I'm not touching them. The open items are genuinely open and Devon was right not to resolve them by fiat. My answer to the one he explicitly deferred to me: assertive, not passive — `role="alert"`, non-auto-dismissing, visually distinct, still short of a modal. I want a real mock before I sign off on anything, same bar as the staleness banner got, and I want the vote-loss question (§6/§3 above) decided as a yes/no before copy gets drafted, not carried into Propose as an open branch.
