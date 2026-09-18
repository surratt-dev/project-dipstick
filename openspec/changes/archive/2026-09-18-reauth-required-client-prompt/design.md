## Context

`websocket-staleness-signal` built the state machine and the component structure `reauth-required` needed to exist as a legitimately-disclosed third state, distinct from the disclosure-blind `connected`/`unknown-reconnecting` pair — that work is done, tested, and not reopened here. What it explicitly deferred (its own spec.md: "issue #32's fuller re-login UX for the `reauth-required` state... this capability builds the state and a minimal generic message only") is the actual content of the one moment in this whole reauthorization effort where the disclosure discipline the backend spent two design documents building (two close codes, two modules, no shared "send signal" helper, no cause ever crossing the wire) meets a person who has a few seconds to understand they're about to be signed out and what to do about it.

Today, `ConnectionStatusBanner.tsx` renders `reauth-required` as `<div role="status">{REAUTH_REQUIRED_TEXT}</div>` — the identical wrapper `unknown-reconnecting` uses, no button, no navigation wiring anywhere in the component. This is confirmed by reading the component directly (Priya Nair's explore-review, §4), not inferred from the design doc. Everything below is new work against that starting point.

That same placeholder exists a second time, independently: `FacilitatorReadinessGrid.tsx` renders its own `reauth-required` case as `<div role="status">{REAUTH_REQUIRED_TEXT}</div>`, with its own separately-declared `REAUTH_REQUIRED_TEXT` constant — not a call into `ConnectionStatusBanner.tsx`. `FacilitatorConnectionHost.tsx` mounts `FacilitatorReadinessGrid`, never `ConnectionStatusBanner` (confirmed: `ConnectionStatusBanner` is imported only by `SessionConnectionHost.tsx` and its own test file). This duplication was unexamined, not decided, prior to Marcus Oyelaran's engineer design-review (Finding 1) — see Decision D9 for the resolution.

**Mechanical timeline this design is held against** (traced in `exploration-notes.md` §3 directly against `connectionHealth.ts`, confirmed by Priya's review): silent refresh has already failed by the time the `reauth_required` message is ever sent — there is nothing to show before it arrives, and nothing lost by waiting for it. The state is sticky and terminal at message-receipt; the ~30s grace-period close arriving later is a backstop `connectionHealth.ts`'s own guard makes a no-op, not a second phase. **The prompt's only real job is to get the user to act inside a window that's already running, not to narrate the window's passage.**

**Stakeholders:** Priya Nair (Facilitator SME) owns the visual-register mock, the literal copy sentence, and the usability-check sign-off — the same bar `websocket-staleness-signal`'s Group 6 gate set for the sibling banner, currently open against that banner via issue #36. Marcus Delgado (BA) supplied the build-time-checkable rewrite of the vote-loss condition and the digit-pattern test requirement. Devon Calloway (Internal Champion) supplied the structural bounds this design must not violate: no fork of `connectionHealth.ts`, no wording/timing/behavior overlap with `unknown-reconnecting`, no exposed grace-period value.

## Goals / Non-Goals

**Goals:**
- A functioning call-to-action wired to the existing `/auth/login` navigation pattern, live from first render of `reauth-required`.
- An ARIA and visual treatment for `reauth-required` that is assertive and persistent, distinct from `unknown-reconnecting`'s passive register, without becoming a full modal.
- A required-content checklist for the copy, narrow enough that only literal sentence construction remains open.
- A single, deterministic, build-time-checkable rule for whether the vote-loss sentence is included, owned and checked at a named point in time.
- An explicit, stated answer for the reveal-window collision scenario — not a mechanism, a documented decision.
- Zero change to `connectionHealth.ts`, to the `unknown-reconnecting` rendering, and to the disclosure-blind pair's behavior.
- A single shared `reauth-required` rendering implementation consumed by both the participant-facing banner and the facilitator's readiness grid — extending Decision D8's no-fork principle from the state machine to the rendered treatment itself, so the two surfaces cannot silently drift apart the way they already had (Decision D9).

**Non-Goals:**
- The literal copy sentence. Settled by Priya Nair against a mock, per the content checklist below — not decided in this document.
- The visual-register mock itself (color, weight, icon). Named as a required, tracked deliverable; not produced here, matching the precedent `websocket-staleness-signal`'s Group 6/issue #36 already set for the sibling banner.
- Building or wiring the vote-compose UI. This change only reads whether that UI (when it exists) imports `voteDraft.ts`'s hooks — it does not build that UI or that wiring.
- Any reveal-timing-aware behavior in `connectionHealth.ts` or `ConnectionStatusBanner.tsx`. Declined by design — see Decision D6.
- Issue #33's facilitator-specific reauthorization grid distinction, and any second, more-insistent facilitator-only cue. Out of scope, named only as a forward note for whoever scopes #33. This is distinct from, and does not overlap with, Decision D9 below: D9 makes the facilitator receive the same baseline treatment everyone else gets; issue #33 is about an additional, facilitator-only cue layered on top of that baseline, which remains deferred.
- Any change to `connectionHealth.ts`'s state machine, its triggers, or its cause-blindness. Out of scope entirely — this is a rendering-and-behavior change within the existing `reauth-required` branch of `ConnectionStatusBanner.tsx` only.

## Decisions

### D1 — ARIA role and visual register: assertive, persistent, non-modal

`reauth-required` renders with `role="alert"` (assertive `aria-live`), replacing the `role="status"` wrapper it currently shares with `unknown-reconnecting`. This is Priya Nair's resolution of the tension Devon named but deliberately did not resolve by fiat (exploration-notes.md §7): the application should disappear into the background once a session is underway, but a passive banner is exactly the kind of chrome a participant mid-topic can plausibly miss entirely — and missing this one isn't stale-but-harmless, it's a silent forced disconnect.

Concrete bounds, settled here as decisions, not left open:
- `role="alert"`, not `role="status"` — immediate screen-reader interruption, the opposite of `unknown-reconnecting`'s "nobody's required to notice" treatment. This also closes the ARIA gap Marcus's BA review flagged: the two states currently share the identical wrapper, and that was unexamined, not decided. It's decided now.
- Persistent, not auto-dismissing. Either it isn't dismissible before the CTA is used, or dismissing it demotes it to a small persistent badge — never to nothing. Rationale: if it can be dismissed without acting, someone will dismiss it out of habit and get disconnected anyway (Priya's review, §1).
- Visually distinct register (color/weight/icon) from the neutral `unknown-reconnecting` banner — not just different words in the same gray box.
- Stopping short of a full modal. This is the part that honors Devon's original bound; Priya's resolution sits inside it, not over it.

**What is not settled here:** the concrete mock realizing these bounds. Issue #36 is the open, standing example of exactly this failure mode on the sibling `unknown-reconnecting`/grid-marker treatment — a visual-register decision described in prose instead of settled against a mock. This change does not repeat that outcome: `tasks.md` names the mock and Priya's sign-off, plus a live usability check specifically evaluating whether the treatment reads as an alarm without becoming one, as required gate items before this treatment reaches a real pilot session (see the extended pilot-readiness gate in `specs/websocket-staleness-signal/spec.md`).

**Alternative considered:** a full modal. Rejected — Priya's own instinct, shared with Devon's persona concern, is that a hard modal stealing focus mid-compose makes the tool feel like it's running the session rather than the room being in conversation. `role="alert"` plus persistence gets the interruption property without the focus-theft property.

### D2 — Call-to-action: reuse the existing `/auth/login` navigation, live from first render

The CTA is a single `<button>` calling `window.location.href = "/auth/login"` — the identical pattern already live at `AuthContext.tsx:82` and `AuthErrorPage.tsx:29`, the latter already rendering this exact call behind a labeled button ("Try Again") for its own retryable-error case. No second re-authentication trigger is invented.

The button is present and functional from the very first frame `reauth-required` renders — not gated behind grace-period expiry. Per the mechanical timeline in Context, there is no meaningful "phase two" to wait for: the state is already terminal at message-receipt, and waiting would waste part of an already-short ~30-second window for no benefit.

`/auth/login` is already provider-agnostic at this call site — confirmed by reading both existing call sites, neither of which branches on which OIDC provider is configured. The CTA added here inherits that property without needing to know or care about it, consistent with this project's standing constraint that OIDC support multiple providers, not just Entra.

The navigation target is the fixed literal `/auth/login` — never parameterized with anything derived from connection state (no `?reason=...`, `?from=reauth`, correlation id, or other query string). Per Tomás Ferreira's security review, this is an explicit acceptance criterion, not an assumed property: the natural next request from analytics or support tooling ("can we tell how often people land here via reauth versus a fresh login") is exactly the kind of innocuous-seeming addition `websocket-connection-reauthorization`'s Decision D9a already warns erodes a non-disclosure boundary over time. Task 2.4's test asserts the exact literal string, not a prefix match, so a future PR adding a query parameter fails the test instead of silently reopening this boundary.

**Alternative considered:** a dedicated `/auth/reauth` route distinct from `/auth/login`, to allow different post-login redirect behavior. Rejected — no such distinction exists anywhere else in the codebase's two existing call sites, and inventing one here would be exactly the kind of second re-authentication mechanism this decision is written to avoid.

### D3 — No countdown, no numeric grace-period value, CI-enforced

The copy never renders a countdown, a digit-plus-time-unit string, or any other representation of the ~30-second grace period. This restates `websocket-connection-reauthorization`'s Decision D9a directly: "the moment [the interval] is exposed... someone will eventually tune it to 'basically never,'" a rationale that document states applies even to well-intentioned cases — and a live ticking countdown is a softer version of the same exposure, pinning an expectation via a support conversation or a screenshot even without making the value formally configurable.

This is enforced, not just written as prose: a rendered-output test (mirroring the existing task 3.2 pattern for `unknown-reconnecting`'s rendered-output-identity test) asserts the `reauth-required` rendered string never matches a digit-plus-time-unit pattern (e.g. `/\d+\s*(s|sec|second|m|min|minute)s?\b/i`). Cheap to write, turns "please don't" into something CI enforces rather than something a future edit can silently regress.

Per Tomás Ferreira's security review, this enforcement is widened in two ways. First, the test asserts against the full rendered markup — including attribute values (`aria-label`, `title`, `data-*` attributes) — not only the visible text node, since a countdown could leak through an attribute a digit-only text-node check would miss. Second, because a countdown doesn't have to be numeric to disclose the interval, Priya Nair's mock sign-off (tasks.md task 6.2) is checked against an explicit negative constraint: no animated element (progress bar, spinner, CSS animation) whose duration or visual timing is derived from or approximates the grace-period constant. This is the same reasoning `websocket-connection-reauthorization`'s Decision D9a and this design's own paragraph above already apply to numeric disclosure, extended to non-textual countdown surrogates before a mock exists to regress against.

### D4 — Copy as a required-content checklist, not a blank page

Per Marcus Delgado's downgrade of this from "open-ended" to "needs a content checklist" (BA review §3): most of what "exact wording" requires is already implied by the settled constraints elsewhere in this document. The checklist Priya Nair's copy must satisfy:

1. No countdown or numeric grace-period value anywhere (D3).
2. No cause disclosed beyond what SEC-26 already legitimately discloses — this client's own token needs re-authentication. No mention of revocation, retry-budget exhaustion, or session destruction as distinct causes (`reauth-required` remains cause-blind to its own sub-cause, per `websocket-staleness-signal`'s existing requirement, unmodified by this change).
3. A plain-language statement that continuing requires leaving and returning to the page (i.e., that the CTA is a navigation, not an in-place action).
4. Tone register: an expected token-lifetime event, not an error — no "error," no exclamation, no alarm-toned phrasing, distinct from `unknown-reconnecting`'s existing "plain, non-blaming, non-urgent" register in that it should still read as assertive-but-not-alarming rather than blank.
5. Conditionally, per D5: a plain-language statement that continuing discards an unsubmitted vote.

Only the literal sentence construction realizing this checklist remains with Priya, reviewed against actual layout — same bar as the existing copy sign-off gate.

### D5 — Vote-loss disclosure: a build-time-checkable gate, not a judgment call

`websocket-connection-reauthorization`'s Decision D4 names the vote-loss gap and explicitly scopes its fix as separate frontend work. `vote-compose-recovery` (issue #31, closed 2026-09-11, PR #42) built that fix: `packages/frontend/src/realtime/voteDraft.ts`, a tested `sessionStorage`-backed persist/restore module. But PR #42's own description defers wiring it into a vote-compose UI because that UI doesn't exist in the codebase yet, and a grep confirms `voteDraft.ts` is imported only by its own test file today.

This is neither "the fix landed, omit the sentence" nor "the fix doesn't exist, always include it" — it's a third, more precise condition: the mechanism exists but currently has nothing to protect. The rule, to be checked once and only once, at this change's implementation time (not at this Design sign-off, since the compose UI's own ship date — not this change's — is the variable):

> Does the vote-compose UI, as it exists in the codebase at the time this change is implemented, import and call `voteDraft.ts`'s persist/restore hooks?
> - **If no:** the `reauth-required` banner copy MUST include the plain-language vote-loss statement (checklist item 5, D4).
> - **If yes:** that statement is omitted.

This is a single grep-checkable fact (an import of `voteDraft.ts` from the compose UI's source), not a subjective call — `tasks.md` names who performs this check and when. Because no vote-compose UI exists in the codebase as of this writing, the practical default at implementation time, absent that UI shipping first, is that the statement is included.

Per Tomás Ferreira's security review, this determination is checked by an automated test (tasks.md task 1.1), not a one-time human grep recorded in a PR description — the test asserts consistency between the codebase's actual current wiring state and the shipped copy's vote-loss statement, so a future drift fails the build instead of going unnoticed. The one piece of this that remains genuinely manual is tasks.md task 1.3's forward-pointing recheck for whoever eventually builds the vote-compose UI: that future file doesn't exist yet for today's test to check automatically, so that step is explicitly flagged as discipline-dependent rather than silently assumed to be covered by 1.1's automation.

**Why not decide this now as a fixed yes/no:** Priya Nair's review asked for a firm answer before copy is drafted, and this design gives her one — but a literal yes/no today would be dishonest, since the compose UI doesn't exist yet to check. What this decision provides instead is a single governing rule that resolves to exactly one of two copy variants deterministically, which is what her request was actually after: one rule to review now, not two speculative drafts.

### D6 — Reveal-window collision: accepted as rare, no special-case mechanism

Priya Nair's review (§2) named a gap the original exploration notes didn't consider: `reauth_required` arriving in the few seconds around a reveal moment could, to a facilitator watching the grid, read as a desync bug rather than an unrelated auth event, because one participant's reauth-triggered UI change lands at the same instant as an unrelated ritual moment.

**Decision: accepted as rare, no special-case mechanism.** The server-side truth of *when* a reveal fires is untouched by anything in this change — this is not a disclosure-discipline problem the way the `unknown-reconnecting`/`reauth-required` wording split is. Building a mechanism to detect, delay, or otherwise coordinate this co-occurrence would require `connectionHealth.ts` or `ConnectionStatusBanner.tsx` to become aware of reveal timing — a new, cause-specific coupling between two previously-independent systems. `websocket-connection-reauthorization`'s Decision D9a argues against exactly this shape of carve-out ("this applies equally to a well-intentioned... case"), and Decision D2/D3's scope sections establish no role- or moment-aware special casing anywhere in this signal pair. Extending that reasoning to a session-moment-aware special case here would be inconsistent with the rest of this effort's design discipline.

This is a stated, considered trade-off, not a silently unconsidered gap: the co-occurrence can happen, it will occasionally look confusing in the moment, and no mechanism is built to prevent or soften it. `specs/websocket-staleness-signal/spec.md` records this as an explicit non-behavior (a requirement stating no reveal-aware branching exists), so the decision is verifiable by code review/grep, not just asserted in prose.

**Alternative considered:** briefly suppress or delay the banner if a reveal is in progress. Rejected — this would make `connectionHealth.ts` reveal-aware (violating the shared-module, no-special-casing bound Devon's persona holds as load-bearing), and would trade a rare, already-brief moment of visual confusion for a new, permanent, cause-specific code path whose own edge cases (a reveal that never resolves, a facilitator navigating away mid-reveal) would need to be designed and tested.

### D7 — Role-uniform copy and CTA

The banner's copy and CTA are identical for participants and facilitators — no role fork. This is not a new policy choice this change is making; it's compliance with an existing, already-shipped requirement. `websocket-staleness-signal`'s own "Facilitator-only, cause-blind grid marker with a defined lifecycle" requirement (`openspec/changes/archive/2026-09-10-websocket-staleness-signal/specs/websocket-staleness-signal/spec.md:99`) states directly: "when the facilitator's own connection is in `reauth-required` instead, no grid-marker variant SHALL be shown — the facilitator's client SHALL instead render the same top-level `reauth-required` treatment used elsewhere, in place of the grid." That line settles the *intended* behavior — the facilitator's `reauth-required` experience is meant to be the same top-level treatment, superseding the grid entirely, with no separate facilitator-grid variant of this state for a role fork to even apply to.

**That intent was not, in fact, met by the code this design was originally scoped against.** Marcus Oyelaran's engineer design-review (Finding 1) found that `FacilitatorReadinessGrid.tsx` has its own independently-duplicated `reauth-required` rendering — its own `REAUTH_REQUIRED_TEXT` constant, its own `<div role="status">` — not a call into the shared treatment. This change as originally scoped (touching `ConnectionStatusBanner.tsx` only) would have shipped leaving that duplication in place: the facilitator's higher-blast-radius case (this document's own Risks section) would have received none of this change's improvements, while this Impact section and this decision both asserted it already had. Decision D9 resolves this: the shared treatment is now made real by construction, not merely asserted by citation to a requirement two files happened to each independently satisfy.

`websocket-connection-reauthorization`'s Decision D2/D3 "Scope" sections and Decision D9a's rationale (identical treatment with no role-aware special case, reading broadly enough to cover a role-differentiated *prompt*, not just a role-differentiated *interval*) are consistent with this and independently support it. `04 - Live Voting - Use Cases.md` already establishes that a facilitator reconnecting-and-reauthenticating resumes full facilitation control with session state intact — existing app behavior this prompt doesn't need to encode or explain.

Priya Nair's review confirms this independently (§5): she agrees the shared banner is the right baseline for both roles, while flagging that issue #33's eventual dedicated facilitator control surface (the readiness grid) would be a reasonable place for a *second*, more insistent, facilitator-specific cue about the facilitator's own connection — additive to this mechanism, not a fork of it. Named here for the record; not built by this change.

### D8 — No fork of `connectionHealth.ts` or the `unknown-reconnecting` treatment

Everything in this change is scoped to the `reauth-required` case of `ConnectionStatusBanner.tsx`'s and `FacilitatorReadinessGrid.tsx`'s existing `switch` statements (see D9 below for why both, not just the former). `connectionHealth.ts` — the state machine, its two triggering signals, its sticky/terminal guard, its cause-blindness — is untouched. Both files continue to share `connectionHealth.ts` and their own switch statement structure, per `websocket-staleness-signal`'s existing "Single shared implementation" requirement; this change changes what each file's `reauth-required` case's branch renders and does, not the structure holding each file's branches together. `unknown-reconnecting`'s rendering, timing floor, and retry behavior are unmodified by anything in this document, in either file.

### D9 — Shared `reauth-required` rendering subcomponent, consumed by both surfaces

Extract the `reauth-required` case's rendering — copy, CTA button, `role="alert"`, persistence behavior — out of `ConnectionStatusBanner.tsx` into a new, small presentational subcomponent (e.g. `packages/frontend/src/components/ReauthRequiredTreatment.tsx`; exact name chosen at implementation time). Both `ConnectionStatusBanner.tsx`'s and `FacilitatorReadinessGrid.tsx`'s `reauth-required` case render this same subcomponent, in place of each maintaining its own copy. `FacilitatorReadinessGrid.tsx`'s existing, independently-declared `REAUTH_REQUIRED_TEXT` constant and its own `<div role="status">` are deleted, not left in place alongside the new subcomponent.

This is now explicitly in scope for this change (tasks.md task 2.5), correcting the scope Marcus Oyelaran's engineer design-review found understated (Finding 1): the design's Impact section and Decision D7 both previously asserted the facilitator already gets the same treatment, when the code shows two independently-maintained copies instead.

This extends Decision D8's principle — no fork of `connectionHealth.ts` — one layer up, to the rendered output the state machine feeds. The two `reauth-required` call sites already share `useConnectionHealth` directly (D8; verified by tasks.md task 4.12's existing cross-surface import check); after this decision, they also share the one piece of UI that state drives when it fires. This is consistent with, not a departure from, the "single shared implementation" discipline this whole effort has held since `websocket-staleness-signal`.

The subcomponent takes no props derived from cause, role, or session-moment state — matching D6/D7/D8's role- and cause-blindness bounds. If it took such props, the two call sites could quietly diverge again by passing different values, which is exactly the failure mode this decision closes.

**Alternative considered:** apply every edit in tasks.md Groups 2–4 to both `ConnectionStatusBanner.tsx` and `FacilitatorReadinessGrid.tsx` by hand, keeping them as two hand-synced copies. Rejected — this is the same shape of risk that produced today's gap in the first place (two copies, one edited, the other silently not), and Marcus's review named the extraction as the preferred resolution for exactly this reason.

## Risks / Trade-offs

- **[Risk]** An assertive, persistent, CTA-bearing treatment could tip into feeling alarming or "software running on engineers" in exactly the way Devon's persona is most protective of. → **Mitigation:** D1's bound stops short of a modal by design, and the usability-check gate (extended pilot-readiness gate, `specs/websocket-staleness-signal/spec.md`) specifically evaluates whether the shipped treatment reads as an alarm, not just whether it's noticeable — the same check already committed to for the sibling banner.
- **[Risk]** The vote-loss sentence, once shipped, could go stale if a vote-compose UI later ships and wires `voteDraft.ts` without anyone revisiting this banner's copy. → **Mitigation:** not left to institutional memory. `openspec/specs/vote-compose-recovery/spec.md` already tracks the UI-wiring follow-up against "whichever change builds the compose UI" (its own tasks.md task 8.3); `tasks.md` task 1.3 of this change adds this banner's copy re-check as an explicit forward-pointing item against that same future change, so whoever builds the vote-compose UI is told, in their own proposal's inherited task list, to re-run D5's grep check and update this banner's copy — not expected to rediscover the coupling by rereading this document.
- **[Risk]** The reveal-window collision (D6) is accepted, not fixed — a facilitator could genuinely misread the co-occurrence as a bug during a live session before this document's reasoning is available to them. → **Mitigation:** none beyond documentation; this is the explicitly accepted cost of declining a special case. If live usability testing (gate item) surfaces this as a recurring, not rare, confusion, that is new evidence this decision did not anticipate and would warrant revisiting D6, not silently working around it.
- **[Trade-off]** `role="alert"` is more disruptive to a screen-reader user's flow than `role="status"` would have been. → Accepted deliberately: the disruption is proportional to the actual stakes (an unconditionally ending connection with a real action available), and D1 treats this as the correct trade rather than an oversight.

## Migration Plan

No data migration. This is a client-rendering and behavior change to an existing, already-deployed component branch (`reauth-required` in `ConnectionStatusBanner.tsx` and, per Decision D9, `FacilitatorReadinessGrid.tsx`). No feature flag is introduced — consistent with this effort's standing refusal to make protective/behavioral constants configurable, and because there is no meaningful "old" and "new" server contract to bridge: the `reauth_required` message and `REAUTH_GRACE_EXPIRED_CLOSE_CODE` are unchanged by this change. Rollback, if needed, is a plain revert of this change's file set (the new shared subcomponent and its two call-site edits); `connectionHealth.ts` is never touched, so no coordinated backend change accompanies this.

Per the extended pilot-readiness gate, this treatment is deployable to non-pilot/staging environments as soon as it's built, but MUST NOT be used for a real pilot team's first live session until its own mock sign-off and usability check close — mirroring the bar `websocket-staleness-signal` already set and has not yet fully closed for the sibling banner (issue #36).

## Open Questions

- **Visual-register mock.** The decision (assertive, persistent, distinct, non-modal) is made (D1); the mock realizing it is not. Priya Nair's to produce and sign off, against real session-screen mocks rather than `SessionConnectionHost.tsx`'s and `FacilitatorConnectionHost.tsx`'s current bare placeholders — one mock realized through the D9 shared subcomponent, reviewed in both host contexts.
- **Literal copy sentence(s).** The content checklist (D4) is settled; the exact sentence construction, including which vote-loss variant per D5 applies at implementation time, is Priya Nair's to finalize against actual layout.
- **Live usability check.** Whether the shipped treatment reads as an alarm rather than an informative, actionable prompt can only be answered by a real facilitator in a real session, per the same standing limitation already named for the sibling banner's gate.
