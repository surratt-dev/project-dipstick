# Exploration Notes — SEC-26 `reauth_required` Client-Visible Prompt

**Author:** Devon Calloway, Internal Champion
**Date:** 2026-09-18 (revised same day, post-review, to fold in Priya Nair's and Marcus Delgado's explore-stage feedback)
**Scope:** GitHub issue #32 — Open Question 1 from `websocket-connection-reauthorization/design.md`. Design/Frontend only; backend (`connectionHealth.ts`'s `reauth-required` state, the `reauth_required` wire message, the ~30s grace period, `REAUTH_GRACE_EXPIRED_CLOSE_CODE`) is already shipped and not reopened here.
**Explicitly out of scope:** Issue #33 (facilitator readiness grid distinguishing revocation from flakiness *during* reauth for *other* participants). This is about a client's experience of its own connection needing re-auth, not the grid's view of someone else's. Named here only so this doesn't contradict that work, same as my earlier staleness notes did for the same reason.

---

## 1. The actual question, restated narrowly

Design.md's Open Question 1 asks one thing: does this prompt reuse the existing `unknown-reconnecting` treatment, or does it need its own? I read the code before answering rather than reasoning from the design doc alone, because the design doc predates the state machine's actual shape and I wanted to check whether the implementation had already answered part of this by construction.

It has, partially. `connectionHealth.ts` already treats `reauth-required` as a structurally separate third state — not a variant of `unknown-reconnecting`, not reachable by the same code path, sticky/terminal, entered exactly two ways (the `reauth_required` message, or the grace-expiry close code as a backup path). `ConnectionStatusBanner.tsx` already renders it as a separate `switch` case with its own string. So the code-sharing question is already answered correctly at the state-machine and component-structure level, before I ever got involved: **the two states share a file and a switch statement, not a wording or behavior.** That's the same discipline the backend's Decision D5 enforces (two close codes, two modules, no parameterized "send signal" helper) — I don't need to relitigate it, I need to make sure the *content* of the reauth-required branch honors it instead of accidentally undoing it.

So the real open question isn't "reuse or don't" — it's narrower: **what does this state's own rendering need to say and do**, given it's the one state in this machine that is legitimately disclosed, actionable, and finite.

## 2. Why the staleness wording can't just be copied over, in one sentence

`unknown-reconnecting`'s copy is deliberately empty of information because the whole point of that state is that a revoked connection and a flaky one must be indistinguishable — right down to the individual word choice (my own staleness notes, §2, walk through wording/timing/behavior as three separate leak vectors). `reauth-required` has the opposite constraint: the client already knows, specifically, that *this* connection's *own* token needs re-authentication — the server told it so, on purpose, via an application-level message with no cause field (I checked `realtime.ts:305` — `{ eventType: "reauth_required" }`, no payload). There is nothing left to protect by being vague here. Being vague here doesn't add privacy, it just makes the one state in the system where the user has something to *do* read like the one state where there's nothing to do. That's a usability regression dressed up as consistency.

## 3. Tracing the actual moment, mechanically, before designing anything

I didn't want to design this against my own mental model of "a session's about to end" without checking what the client code actually does, frame by frame. Here's what happens, read directly out of `connectionHealth.ts` and `design.md` Decision D3/D4:

```
Silent refresh already failed          reauth_required message         Grace period ends (~30s)
(retries exhausted, or a               arrives → state machine          server unconditionally closes
definitive revocation) — this           transitions to                  socket with
already happened BEFORE the             "reauth-required"                REAUTH_GRACE_EXPIRED_CLOSE_CODE
message is ever sent                    (sticky, terminal)               (state machine: no-op, already
        │                                       │                        in reauth-required — the close
        │                                       │                        code path is a backstop, not
        ▼                                       ▼                        the primary trigger)
  [server-side,                          [THIS is the one moment
   invisible to client]                   the UI has anything
                                           to render]
```

Two things fall out of this that answer questions the task explicitly raised:

- **Does the UI need to show anything before the grace period starts?** No — there's nothing to show before the message arrives, and nothing is lost by waiting for it: refresh has *already* failed by the time `reauth_required` is sent (Decision D3: the message is the consequence of `"revoked"` or exhausted-retry `"transient_failure"`, not a heads-up that refresh is *about* to be attempted). So there's no premature-alarm risk to design around — by the time this fires, it's not a warning, it's a fact.
- **Does the UI need to distinguish "grace period active" from "grace period expired"?** No, and trying to would be pointless work: the state is already terminal at message-receipt. The close code arriving later changes nothing the user sees, because `handleTerminalEvent` bails immediately when already in `reauth-required`. The banner should render its full, final content on the very first frame it appears — there is no meaningful "phase two."

This matters for a reason beyond tidiness: Decision D4 itself notes that the grace-period timer "rarely fires" in the real flow, because the moment a user acts on the prompt (see §5) — a top-level navigation — tears the socket down well before 30 seconds is up. **The prompt's only real job is to get the user to act inside that window, not to narrate the window's passage.**

## 4. The countdown-timer instinct, and why I'm pushing back on it before Priya gets a chance to like it

The obvious next idea — mine, before I caught myself — was "show a live countdown: you'll be disconnected in 23s." I want to name why I don't think that's right, rather than let it arrive at Propose stage unexamined:

- **It doesn't help.** The grace period exists so a fresh connection under a new session id counts as recovery (Decision D4) — nothing about the *client's own countdown display* speeds that up or is required for it. The countdown would be decorative urgency, not functional information.
- **It quietly turns a tuning constant into a user-facing contract.** Decision D9a is explicit and, per that document, hard-won: no interval or grace period becomes exposed *anywhere*, including as an innocuous operational convenience — "the moment [it] is exposed... someone will eventually tune it to 'basically never,'" and that reasoning is stated to apply even to well-intentioned cases. A literal ticking "23... 22... 21" is a softer version of the same exposure: it doesn't make the value *configurable*, but it does make it something a support conversation or a screenshot could pin an expectation to, which is exactly the kind of soft constraint that makes a value harder to change later for reasons that have nothing to do with this feature. I'd rather the copy commit to "soon" than to a number.

My recommendation, to carry into Propose: no visible countdown. Time-bounded urgency conveyed through wording and visual register, not a clock.

## 5. The prompt needs a call-to-action, and there's already an established pattern for it

This is the one state in the connection-health machine where "do nothing, it'll resolve itself" is false — the connection is ending, unconditionally, and staying on the current page cannot prevent that (D4 again: recovery is *never* in-place; it is always a fresh connection after a full re-authentication). A banner that only informs, with no action, fails the actual moment.

I checked what re-authentication looks like today rather than inventing something new. It's a single, established pattern, used twice already:

- `AuthContext.tsx:82` and `AuthErrorPage.tsx:29` both do the same thing: `window.location.href = "/auth/login"` — a full top-level navigation to the OIDC provider and back through `/auth/callback`. `AuthErrorPage.tsx` already renders exactly this as a labeled button ("Try Again") for its own retryable-error case.

There's no reason to invent a second re-authentication trigger. The reauth-required banner's call to action is the same navigation, ideally the same button pattern already proven in `AuthErrorPage.tsx` — "Log in again" (exact copy TBD, same as everything else here, pending Priya's sign-off) wired to the identical `window.location.href = "/auth/login"` call. This also confirms something worth stating for the record given the standing project constraint that OIDC must support multiple providers, not just Entra: `/auth/login` is already provider-agnostic at this call site — the button doesn't need to know or care which IdP is configured, same as the existing two call sites don't.

One consequence worth flagging rather than quietly deciding myself: **the CTA should be live from the first render, not gated behind grace-period expiry.** Waiting to show it would waste part of an already-short 30 seconds for no benefit — see §3, there's no "phase two" to wait for.

**Confirmed on review (Priya): this is new code, not a copy swap.** I checked `ConnectionStatusBanner.tsx` again after her review pointed it out. Today it renders `<div role="status">{REAUTH_REQUIRED_TEXT}</div>` for this state — text only, no button, no `window.location.href` wiring anywhere in the component. Everything above is a design intent I'm recording, not yet a fact about the code, and both states currently share the identical `role="status"` wrapper. Whoever scopes Tasks should treat wiring the button — and, per §7 below, differentiating the ARIA role — as new interactive-element work in a component that currently has none of it, not as a string swap.

## 6. The vote-loss gap — corrected and resolved into a checkable condition (was open, per Marcus's finding)

My original framing of this (below, for the record) was an either/or I handed to Propose unresolved. Marcus checked the actual state of the codebase and found it's neither branch — the honest situation is more specific, and better, than what I wrote:

Decision D4 says the grace-period recovery path is *always* a full page reload (a new connection under a new session id, reached through top-level navigation), and D4 states plainly that this "clears in-memory JS state the same way closing the tab would." Decision D7's protection for composed-but-unsubmitted vote state — "the client's own in-memory compose state... preserves the draft" — is stated to *not* automatically hold here. D4 calls this "a real gap... newly surfaced by this redesign," and explicitly scopes a fix (e.g. `sessionStorage` persistence) as separate frontend work, outside that design's own migration plan.

**What's actually true, per Marcus:** Issue #31 ("Composed-but-unsubmitted vote state does not survive a SEC-26 grace-period recovery") was filed against this exact gap and closed 2026-09-11 — a week before my original notes — via PR #42, which added `packages/frontend/src/realtime/voteDraft.ts`: a tested `sessionStorage`-backed persist/restore module keyed to `(sessionId, sessionTopicId)`. The mechanism D4 named as open work exists and is tested. But it isn't wired to anything: PR #42's own description defers wiring it into a vote-compose UI because that UI doesn't exist yet, and `voteDraft.ts` is currently imported only by its own test file. There is, right now, nothing for it to protect.

So this was never a "confirm the fix lands" question — it's a "the fix exists but the thing it protects doesn't yet" question, which is a different and more precise condition. Carrying Marcus's rewrite forward as the actual requirement:

> Before this change ships, confirm whether the vote-compose UI (not yet built as of this writing — tracked separately from issue #31/PR #42) calls `voteDraft.ts`'s persist/restore hooks. If it does not, the `reauth-required` banner copy MUST include a plain-language statement that continuing will discard an unsubmitted vote. If it does, no such statement is needed. This is a build-time-checkable fact (an import of `voteDraft.ts` from the compose UI), not a judgment call — Propose should name who confirms it and when: at this change's implementation time, not at Design sign-off, since the compose UI's own ship date is the variable, not this change's.

**One pushback, gently, on Priya's ask for a firm yes/no before copy is drafted:** I understand why — she doesn't want to review two half-drafted copy variants against a mock, and I agree with that. But taken completely literally, "yes/no now" isn't available honestly, because the compose UI doesn't exist yet to check. The honest answer today isn't "yes" or "no," it's "not yet checkable." I don't think that's a dodge of her request, though — Marcus's build-time-checkable condition *is* the firm resolution she's asking for: it replaces my open-ended "(a) or (b), Propose decides" with a single mandatory gate, owned and checked at a named point in time, that produces exactly one of two copy variants deterministically rather than by someone's judgment call at Propose. That should let Priya review one governing rule now instead of two speculative drafts. Citing #31/PR #42 by number in the proposal also closes a traceability gap on its own terms — a reader of these notes previously had no way to discover the partial fix already in the codebase.

## 7. Banner vs. something louder — resolved by Priya, recorded here as settled

*(Original framing of the tension, kept for the record, since the reasoning is still the reasoning the resolution rests on.)* My own standing concern (own words, stated plainly in my persona): the application should disappear into the background once a session is underway — I don't want this feature to be the thing that makes the tool feel like software being run on engineers rather than a conversation they're having. That instinct says: keep this a banner, same visual family as the existing `role="status"` div, nothing modal, nothing that steals focus.

But I named the tension rather than resolving it by fiat: a passive banner is exactly the kind of chrome a participant mid-topic can plausibly miss entirely, and if they miss it, the outcome isn't "stale but harmless" the way missing an `unknown-reconnecting` banner might be — it's a forced disconnect with no idea why. For a facilitator, design.md's own Risks section already names facilitator connection loss as having "a strictly higher blast radius." I supplied the bound (never fork the state machine, never vary wording by cause, no countdown, nothing that requires a special-cased mechanism) and left the mockup call to Priya, the same way the staleness banner's visual register was hers to make against Marcus's structural bound.

**Priya's call, now settled, not open:** not a passive parity banner, and not a full modal either. Specifically:

- `role="alert"` (assertive), not `role="status"` — this state deserves immediate screen-reader interruption, the opposite of `unknown-reconnecting`'s "nobody's required to notice" treatment. This also closes the ARIA gap Marcus separately flagged (§4 of his review): the two states currently share the identical `role="status"` wrapper, and that was unexamined, not decided. It's decided now.
- Persistent, not auto-dismissing — either it isn't dismissible before the CTA is used, or dismissing it demotes it to a small persistent badge, never to nothing.
- Visually distinct register (color/weight/icon) from the neutral `unknown-reconnecting` banner, not just different words in the same gray box.
- Stopping short of a modal — this is the part that honors my original bound. Nobody overrode it; Priya's resolution sits inside it.

**What's still genuinely open is narrower than before:** the *decision* (assertive, persistent, distinct, non-modal) is made. What's left is the concrete mock realizing it — and per Marcus, that mock is not optional prose-guidance work. Issue #36 is open right now, for the sibling `unknown-reconnecting` banner, for exactly this failure mode: a visual-register decision described in prose instead of settled against a mock. I'm citing it here explicitly so this change doesn't repeat it — "we agreed on the words" is not the same as "we have a mock," and this item doesn't close on the former.

## 8. A gap I didn't consider: this can land during the reveal window (Priya's finding, new)

I traced the mechanical timeline in §3 but only asked what the *banner* does, not what it does to the surrounding session UI at the moment it appears. Priya caught this: nothing in my original notes considers what happens if `reauth_required` arrives in the few seconds around a reveal — right after someone locks a vote, or during the reveal moment itself.

Reveal simultaneity is the property the whole ritual protects most carefully. The server-side truth of *when* the reveal fires isn't touched by anything in this change — that's real, and it means this isn't a disclosure-discipline problem the way §2's wording question was. But the *participant's experience* of their own reveal can still be stepped on by an unrelated banner appearing at the same moment, and — this is the part that makes it worth naming rather than shrugging off — to a facilitator watching the grid, one person's reauth-triggered UI change landing exactly at reveal time could read as a desync bug, not an unrelated auth event, in the moment it happens.

I'm not resolving this here, and I don't think it needs a special-cased mechanism — that would cut against D9a's reasoning, which I already checked in §8 (now §9) for the role-uniformity question and don't think should get relitigated per-scenario. But it needs to be named explicitly in Propose, with an explicit answer, even if that answer is "acceptable, rare, no special handling." What it can't be is unconsidered — Priya's point is that this shouldn't be the kind of thing that only gets noticed the first time it happens live, in front of a room.

## 9. Role-uniformity — checking my own instinct against the backend design instead of assuming

I went in assuming the facilitator case might need different wording given the blast-radius asymmetry in §7. Checking the backend design talked me out of it: Decision D2 and D3's own "Scope" sections are explicit that both session-scoped and team-scoped connections get identical treatment, with no role-aware special case, and Decision D9a's rationale is written broadly enough ("this applies equally to a well-intentioned... case") that I read it as covering a role-differentiated *prompt* too, not just a role-differentiated *interval*. The existing use cases (`04 - Live Voting - Use Cases.md`) already establish that a facilitator reconnecting-and-reauthenticating resumes full facilitation control with session state intact — that's existing app behavior this prompt doesn't need to encode or explain, it just needs to get the facilitator to the same "Log in again" action a participant gets. One prompt, one piece of copy, same for both roles. The *consequence* of clicking it differs by role already, structurally, elsewhere in the app — this prompt doesn't need to know or say which.

Priya's review confirms this independently and adds a forward note worth recording for whoever eventually scopes issue #33: her tolerance for missing this signal about *her own* connection is lower than a participant's, because losing her own connection means losing the room. She agrees the shared banner in *this* change is the right baseline for both roles — no role fork here — but flags that #33's dedicated facilitator control surface (the readiness grid) would be a reasonable place for a *second*, more insistent, facilitator-specific cue later, additive to this mechanism rather than a fork of it. Out of scope for this change; naming it here only so it isn't lost by the time #33 is scoped, same reason I named issue #33 itself in this document's header.

## 10. What I think Propose stage should carry forward

**Structural constraints, settled:**

1. No wording, timing, or behavioral overlap with `unknown-reconnecting` — this is the disclosed/non-disclosed line, and it runs the opposite direction from that state's constraints, not the same direction.
2. Render on first receipt of the `reauth_required` message; no distinct "grace period active" vs. "expired" visual phase — there isn't a meaningful second phase to design for.
3. No visible countdown or numeric grace-period value anywhere in the copy. Per Marcus, this should not stay prose-only: Tasks should include a rendered-output-identity test (mirroring the existing task 3.2 pattern for `unknown-reconnecting`) that asserts the `reauth-required` string never matches a digit-plus-time-unit pattern. Cheap to write, turns a "please don't" into something CI enforces.
4. A call-to-action wired to the existing `window.location.href = "/auth/login"` pattern (`AuthErrorPage.tsx`'s button is the precedent), live from first render, not gated behind grace expiry. Confirmed per §5: this is new interactive code — `ConnectionStatusBanner.tsx` currently has no button and no navigation wiring for this state — not a copy-only change.
5. Identical copy and identical CTA regardless of participant/facilitator role.
6. `role="alert"` (assertive), persistent/non-auto-dismissing (or demotes to a small persistent badge, never to nothing if dismissed), visually distinct register from `unknown-reconnecting`, stopping short of a full modal. This is Priya's resolution of the former §7 tension — no longer open as a decision, only its concrete mock is (below).

**Genuinely open, Priya's to own:**

1. **Visual-register mock.** The decision (assertive, persistent, distinct, non-modal) is made; the mock realizing it — color, weight, icon, against a real session-screen mock rather than `SessionConnectionHost.tsx`'s current bare placeholder — is not. This does not close on a paragraph of guidance. Issue #36 is the standing, currently-open example of exactly this failure mode on the sibling banner; this item closes on a mock plus a usability check, or it repeats #36's outcome.
2. **Reveal-window interaction (new, §8).** Whether `reauth_required` landing near a reveal moment reads as a desync to a facilitator watching the grid needs an explicit answer in Propose — "acceptable, rare, no special case" is an acceptable answer, but it must be a stated one, not an unconsidered one.
3. **Exact wording — narrowed to a content checklist, not a blank page**, per Marcus. Most of what "exact wording" needs is already implied by the settled constraints: no countdown or numeric value, no cause disclosed beyond what's already true, a plain statement that continuing requires leaving and returning to the page, tone = expected token-lifetime event, not an error, plus the vote-loss sentence from item 4 below if the build-time check requires it. Only the literal sentence construction stays with Priya.
4. **Vote-loss copy — resolved into a build-time-checkable condition, per §6.** At this change's implementation time (not Design sign-off), confirm whether the vote-compose UI imports `voteDraft.ts`'s (issue #31/PR #42) persist/restore hooks. If not, the banner copy MUST include a plain-language statement that continuing discards an unsubmitted vote. If it does, omit that sentence. This replaces the earlier either/or framing.

## 11. One thing I want said plainly before this moves on

This is a small surface — one message type, no payload, one rendering branch that already exists as a placeholder. It would be easy to treat it as a copy-writing task and move on. I don't think it is one. It's the one place in this whole reauthorization effort where the disclosure discipline the backend spent two design documents building — two close codes, two modules, no shared "send signal" helper, no cause ever crossing the wire — meets an actual human being who has to understand, in a few seconds, mid-conversation, that they're about to be signed out and what to do about it. Getting the *content* of that moment right matters as much as getting the mechanism right did; it's just a different kind of rigor — usability rigor, not disclosure rigor — and it deserves the same "filed isn't the same as signed off" bar the staleness banner got, not a lighter one because the backend half is already done. Priya's and Marcus's review only sharpened that bar — nothing they raised weakened it, and nothing in it asked me to soften a constraint I'd want to hold the line on.
