# Explore-Stage Review — Business Analyst

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `openspec/changes/reauth-required-client-prompt/exploration-notes.md` (Devon Calloway, 2026-09-18)
**Scope of this review:** Are the ideas here specific enough to become requirements in Propose? Anything too vague to carry forward, and where the notes hand off a decision, is the handoff itself precise enough to act on.

---

## 1. Factual correction required before Propose — §6's "gap" is stale as written

This is the most important finding in this review and it changes what Propose needs to say.

§6 frames the vote-compose-state-loss issue as **contingent and unresolved**: "either (a) confirm the `sessionStorage` fix D4 named lands before or alongside this prompt... or (b) the prompt's copy needs to account for data loss." §9's open-items list repeats this as item 3, still framed as "contingent on whether the... gap gets closed."

I checked. It's more complicated than either branch, and the notes should have checked before handing this off as an open question:

- **Issue #31** ("Composed-but-unsubmitted vote state does not survive a SEC-26 grace-period recovery") was filed against this exact D4/D7 gap and **closed on 2026-09-11 — a week before these notes were written** — resolved by **PR #42**, which added `packages/frontend/src/realtime/voteDraft.ts`: a `sessionStorage`-backed persist/restore module keyed to `(sessionId, sessionTopicId)`, with explicit discard conditions (topic mismatch, `wrap_up`, already revealed/locked-in, existing lock-in). This is exactly the mechanism D4 named as the open frontend work.
- **But it isn't wired to anything yet.** PR #42's own description states the wiring "into an actual vote-compose UI... is intentionally deferred — that UI doesn't exist in the codebase yet," and I confirmed by grep: `voteDraft.ts` is imported only by its own test file. `SessionConnectionHost.tsx` — the only mounted surface `ConnectionStatusBanner` renders into today — has no vote-compose UI at all (its own header comment says so explicitly).

So the honest state of the world is neither of Devon's two branches: the persistence *mechanism* exists and is tested, but there is currently **nothing for it to protect**, and no guarantee it will be wired in before this prompt ships. That's a materially different — and more precise — condition than "confirm the fix lands."

**Suggested rewrite for Propose**, replacing §6/§9-item-3's either/or with a checkable condition:

> Before this change ships, confirm whether the vote-compose UI (not yet built as of this writing — tracked separately from issue #31/PR #42) calls `voteDraft.ts`'s persist/restore hooks. If it does not yet, the `reauth-required` banner copy MUST include a plain-language statement that continuing will discard an unsubmitted vote. If it does, no such statement is needed. This is a build-time-checkable fact (an import of `voteDraft.ts` from the compose UI), not a judgment call — Propose should name who confirms it and when (at this change's implementation time, not at Design sign-off, since the compose UI's own ship date is the variable).

Citing issue #31 and PR #42 by number in the proposal also closes a traceability gap on its own terms — right now a reader of these notes has no way to discover that the "gap" already has a partial fix in the codebase.

---

## 2. Structural constraints (§9, first list) — buildable as written

Items 1–5 are each independently testable against existing code (`ConnectionHealthState`'s switch, `handleMessageEvent`'s transition point, the `AuthErrorPage.tsx`/`AuthContext.tsx` navigation precedent). No clarification needed here; I'd keep these worded exactly as constraints, not suggestions, in the proposal — they read as hard bounds the way D6's "no shared helper" reads in the backend design, which is the right register for them.

One addition worth folding into constraint 3, not a new constraint: **make "no visible countdown or numeric grace-period value" a stated acceptance test, not just prose.** `ConnectionStatusBanner.tsx`'s own header comment already references a precedent for exactly this pattern — task 3.2's "rendered-output-identity test" that pins `unknown-reconnecting`'s string against variation by cause. The same technique (assert the `reauth-required` string never matches a digit-plus-time-unit pattern) is cheap to write and turns a "please don't" into something CI enforces. Recommend Propose's tasks list name this test explicitly, the way the staleness change did.

---

## 3. Genuinely open items (§9, second list) — mostly fine, one needs a sharper handoff

- **Item 1 (banner vs. something more assertive) and item 4 (visual register):** Correctly identified as Priya's call, correctly not resolved by fiat here. But I want the proposal to name the risk explicitly rather than trust that flagging it once is enough: **this project already has an open, unresolved instance of exactly this failure mode.** Issue #36 — "Gate 6 (websocket-staleness-signal): visual-register mock withheld, live usability test not performed" — is open right now, for the sibling `unknown-reconnecting` banner, for the identical reason (a visual-register decision that got described in prose instead of settled against a mock). Devon's notes gesture at "the same gate language the staleness banner used" but don't name that the staleness banner's gate is *currently failing to close*. Propose should say, plainly: this decision does not get marked resolved by a paragraph of copy guidance — it needs the mock and the usability check, or it will be issue #36's outcome twice.

- **Item 2 (exact wording):** This is smaller than it looks — most of what "exact wording" needs is already implied by the settled constraints (no countdown, no cause, plain statement that action requires leaving the page, tone = expected event not error). I'd downgrade this from "genuinely open" to "needs a content checklist, not a blank page": state the required content elements as a list (what it must say) and leave only the literal sentence construction to Priya. That's a smaller, more buildable ask than "exact wording TBD."

- **Item 3 (vote-loss mention):** See §1 above — this needs the rewrite, not just a caveat.

---

## 4. One gap the notes don't raise at all — ARIA live-region assertiveness

§7 spends real effort on whether a passive banner is prominent enough for a participant mid-topic to notice, and explicitly leaves visual prominence to Priya. But `ConnectionStatusBanner.tsx` currently renders **both** states — `unknown-reconnecting` and `reauth-required` — with the identical `<div role="status">` wrapper (implicit `aria-live="polite"`, low interruption). The notes argue at length that these two states differ in kind (disclosed vs. non-disclosed, actionable vs. not, terminal vs. not) but never ask whether that difference should also show up in the accessibility tree, not just the visible copy and CTA. A `role="alert"` (assertive) region interrupts a screen reader immediately; `role="status"` waits. For a state where the connection is unconditionally ending in ~30 seconds, that's not a cosmetic detail — it's the screen-reader equivalent of the visual-prominence question in §7, and it's currently unexamined.

This doesn't need to be resolved in Explore, but it should be named as part of the same open item Priya owns (§9 item 1/4), not silently left for whoever writes the component to guess at when they copy the existing `role="status"` div because it's already there.

---

## 5. Summary of required changes before Propose

1. Rewrite §6 / §9-item-3 to reflect the actual state of issue #31/PR #42 (mechanism exists, unwired) and replace the either/or with a build-time-checkable condition, per §1 above.
2. Add the digit/countdown-pattern rendered-output test to the settled-constraints list as a named task, not just prose guidance.
3. When naming banner-vs-assertive and visual-register as Priya's open items, cite issue #36 explicitly as the standing precedent for what "not resolved" looks like on this exact class of decision.
4. Add ARIA live-region assertiveness (`status` vs. `alert`) to the list of things Priya's mock/visual-register decision needs to cover — currently unexamined.
5. Downgrade "exact wording" from open-ended to a required-content checklist; only the sentence-level phrasing stays with Priya.
