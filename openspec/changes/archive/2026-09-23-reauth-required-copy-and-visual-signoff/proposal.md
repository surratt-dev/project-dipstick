## Why

`reauth-required-client-prompt` shipped the mechanism — CTA, `role="alert"`, persistence, content-checklist-satisfying draft copy — but left `websocket-staleness-signal`'s pilot-readiness gate open for `reauth-required`, the same way its sibling gate stayed open for `unknown-reconnecting` under issue #36. That gate exists so this capability cannot reach a real pilot team's first live session on the strength of a placeholder that was never actually judged. Right now `ReauthRequiredTreatment.tsx`'s styling is exactly that kind of placeholder: `border: "2px solid currentColor"` with no color, weight, or icon commitment of its own — the same shape of artifact that got #36's sign-off attempt withheld, for the same reason (nothing to form a felt judgment about). Closing #137–#141 honestly requires producing a real candidate register first, then attempting sign-off against it — not attempting sign-off against what's already shipped. That is also why a sign-off/gate change reaches into real component styling work: no sign-off — simulated now, or real at #142 later — can be formed against a placeholder that commits to nothing, so the register has to actually exist before anyone can render a judgment about it.

This change exists to do that: finalize the copy sign-off, implement a real visual register, and produce the two sign-off artifacts the gate names — while explicitly not reaching for #142/#143, which require a live facilitator in a live session and cannot be simulated by this pipeline or any other static review.

## What Changes

- Implement a real candidate visual register (color, weight, icon-or-no-icon) in `ReauthRequiredTreatment.tsx`, replacing the `currentColor`-border placeholder, rendered through both real host surfaces (`SessionConnectionHost.tsx`, `FacilitatorConnectionHost.tsx`) rather than in isolation.
- Produce a Priya Nair (Facilitator SME) sign-off artifact on the visual-register mock, per-bound against design.md Decision D1 (assertive / persistent / distinct-from-`unknown-reconnecting` / non-modal) and against the no-countdown-surrogate negative constraint, with the felt-judgment portion (assertive-vs-alarming) explicitly separated from the mechanical checks.
- Produce a Priya Nair sign-off artifact on the copy-in-layout coherence (copy from `reauth-required-client-prompt` reviewed against the now-real mock), covering tone-match, contradiction, and now-redundant/now-missing content.
- Each sign-off artifact states, per real host surface, which host(s) the verdict covers — a register that reads correctly through `SessionConnectionHost.tsx` is not automatically cleared for `FacilitatorConnectionHost.tsx`, and vice versa.
- Each sign-off artifact carries a standing persona-simulated disclaimer and closes with exactly one of: `Signed off`, `Withheld — <reason>`, `Signed off with conditions — <conditions>`. A withheld or conditional verdict is an acceptable outcome of this change — this proposal does not presuppose a clean pass.
- Conditional on a positive (or conditions-met) sign-off landing: update the stale "COPY IS NOT FINAL" / "STYLING IS A PLACEHOLDER" header comments in `ReauthRequiredTreatment.tsx`, and correct `ConnectionStatusBanner.tsx`'s already-stale "both strings below are placeholders" framing (`unknown-reconnecting`'s copy sign-off closed independently and predates this change).
- Update `specs/websocket-staleness-signal/spec.md`'s pilot-readiness gate "Current status" notes to reflect the actual outcome of #137–#141, whatever that outcome is — including if it remains partially open.

**Explicitly out of scope for this change** (not for issue #136's overall scope, where #142/#143 remain tracked): #142 (live usability test — "reads as an alarm without failing to be noticed," both directions, evaluated by a real facilitator in a real session) and #143 (blocked on #142). Neither is attempted here, simulated, or partially satisfied by the sign-off artifacts above. A clean #140/#141-equivalent pass is not evidence toward #142 and must not be read as such by any later stage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `websocket-staleness-signal`: the "Pilot-readiness gate on the staleness signal" requirement's descriptive "Current status" text is updated to reflect this change's outcome for the `reauth-required` copy sign-off, visual-register mock sign-off, and visual-register implementation status — while its normative SHALL text (the gate's actual bar) is unchanged, and its statement that the live-usability-test items remain open is preserved, not weakened.

## Impact

- **Code:** `packages/frontend/src/components/ReauthRequiredTreatment.tsx` (real register implementation, header comment updates), `packages/frontend/src/components/ReauthRequiredTreatment.test.tsx` (new standing test asserting no animation/transition/keyframes/elapsed-time-tied duration property, per design.md Decision D3), `packages/frontend/src/components/ConnectionStatusBanner.tsx` (stale comment correction only — no behavioral change), rendered through the existing `SessionConnectionHost.tsx` / `FacilitatorConnectionHost.tsx` hosts (no changes to those files expected; they're the review surface, not the implementation target).
- **Docs:** `openspec/specs/websocket-staleness-signal/spec.md` (Pilot-readiness gate status notes), two new sign-off artifacts (mock, copy-in-layout) added to this change directory.
- **Not impacted:** `connectionHealth.ts`, the state machine, ARIA role, CTA mechanism, persistence behavior, and copy content itself (all settled by the prior `reauth-required-client-prompt` change) — this change touches visual presentation and sign-off status only.
- **Downstream:** does not unlock a real pilot session by itself — #142 still stands between this work and pilot readiness, unconditionally. Issue #33 (facilitator-disconnect blast radius) is unaffected and remains separately tracked; this change's closure of #137–#141 must not be read as resolving it.
