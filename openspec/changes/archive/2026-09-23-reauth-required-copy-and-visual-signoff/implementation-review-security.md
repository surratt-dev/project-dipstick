# Security implementation review — Tomás Ferreira

Scope: the two areas flagged in Stage 3 design review as security-sensitive —
(D3) the no-animation/no-duration countdown-surrogate check, and the SEC-26
sub-cause non-disclosure boundary — reviewed against the actual diff in
`ReauthRequiredTreatment.tsx` and `ReauthRequiredTreatment.test.tsx`, plus
the two real call sites (`ConnectionStatusBanner.tsx`,
`FacilitatorReadinessGrid.tsx`) and `visual-register-capture.md`. This is not
a felt-judgment review (icon shape, tone) — that is Priya's scope per D5/D4.

## D3 — standing no-animation/no-duration test

**Verdict: real, not tautological. It would catch a real regression.**

- Evidence: `ReauthRequiredTreatment.test.tsx:22-41` renders the component
  and asserts `container.innerHTML` does not match `/animation/i`,
  `/transition/i`, `/@keyframes/i`, or `/duration/i`.
- Because `REAUTH_REQUIRED_STYLE` and `REAUTH_REQUIRED_ICON_STYLE`
  (`ReauthRequiredTreatment.tsx:96-114`) are plain inline style objects,
  React serializes them into the DOM `style` attribute, which lands in
  `innerHTML`. I confirmed this by hand-checking the serialized attribute in
  `visual-register-capture.md`'s captured markup (`style="display: flex; ...
  border: 2px solid rgb(255, 183, 77); ..."`) — no animation/transition
  properties present, and the regexes would fire on them if they were.
  This is a live check against real serialized output, not a check against
  a fixture that can't fail.
- I tested the claim directly: if `animation: pulse 2s infinite` or
  `transitionDuration: "2s"` were added to either style object, this test
  would fail. Confirmed by inspection of how the regexes bind to the
  attribute string — no anchoring or scoping issue that would let such a
  value slip through.
- Only rendered with `role="participant"`, which is sufficient: the two
  style constants are module-level and unconditioned by `role` — `role`
  only toggles the vote-loss sentence (`ReauthRequiredTreatment.tsx:134-139`).
  No second render for `role="facilitator"` is needed to cover the style
  object.

**Residual gap, not a blocker, worth recording explicitly:** this is a
single-render, static-snapshot check. It has no visibility into a
JS-driven, non-CSS animation — e.g. a future `useEffect` +
`setInterval`/`requestAnimationFrame` loop that mutates a style value (like
opacity or border color) directly via `setState` on a timer, without ever
writing the literal strings `animation`, `transition`, `@keyframes`, or
`duration` anywhere. Such a loop would still function as a countdown
surrogate and would not trip this test, because the test never advances
time or triggers a second render. Today this is not a live risk —
`ReauthRequiredTreatment` is a pure function component with no hooks, no
`useEffect`, no `useState` — so there is nothing for the test to miss right
now. But because D3's intent is exactly "stop a later, unrelated change
from silently reintroducing a countdown-surrogate," and a JS-driven interval
loop is a more likely reintroduction vector than someone typing the literal
word `animation` into a style object, I recommend the test's own comment
(or design.md D3) name this gap explicitly, the same way it already names
the external-stylesheet gap. This is a documentation ask, not a code
blocker — closing it doesn't require new test infrastructure, just an
honest note that the check covers CSS-authored motion, not JS-driven style
mutation over time.

## SEC-26 sub-cause / role / session-moment non-disclosure

**Verdict: boundary is held. No leak found, mechanical or indirect.**

- `ReauthRequiredTreatmentProps` still has exactly two fields — `returnTo`
  and `role` (`ReauthRequiredTreatment.tsx:116-132`) — unchanged in shape by
  this diff. No new prop was introduced for the icon or the new wrapper
  `<div>`.
- Confirmed both real call sites pass only literal, non-cause-derived
  values:
  - `ConnectionStatusBanner.tsx:47-51` — `role="participant"` (hardcoded
    literal, not derived from `ConnectionHealthState`), `returnTo` built
    from `window.location.pathname + window.location.search` only.
  - `FacilitatorReadinessGrid.tsx:80-84` — same pattern, `role="facilitator"`
    hardcoded literal.
  Neither call site threads through the specific `ConnectionHealthState`
  variant, a close-code, a server-supplied reason string, or any other
  cause/sub-cause signal. The component still cannot know *why* it's being
  shown, only *that* it's being shown and *who* (participant/facilitator) is
  looking at it — which is the one narrow, already-reviewed exception D9
  carved out.
- New icon introduces zero branching on `role` or any other state: it's a
  single static `<svg>` block, unconditional, identical in both roles' render
  paths. `visual-register-capture.md`'s two captures confirm byte-identical
  icon markup across both hosts.
- Icon has no accessible name of any kind: `aria-hidden="true"`,
  `focusable="false"`, no `<title>`, no `aria-label`, no `title` attribute
  (`ReauthRequiredTreatment.tsx:152-168`). I hand-checked the icon's `path`/
  `rect` attribute values (`d="M7 10V7a5 5 0 0 1 10 0v3"`, `width="18"`,
  `height="18"`, etc.) against the digit-pattern test's regex
  (`/\d+\s*(s|sec|second|m|min|minute)s?\b/i`) — no digit run in the SVG
  markup is immediately followed by a bare `s`/`m`/`sec`/`min`/etc.
  character, so it does not trip that test, consistent with the
  implementation comment's claim. This isn't just "the test passes" — I
  independently walked the attribute string against the regex rather than
  relying solely on the test result, since a false negative in the test
  itself would be exactly the kind of gap worth catching by hand.
- Color and icon color are both static module-level constants
  (`REAUTH_REQUIRED_STYLE`, `REAUTH_REQUIRED_ICON_STYLE`), reused verbatim
  from `MemberManagement.tsx`'s existing `#fff3e0`/`#ffb74d` precedent
  (verified: `MemberManagement.tsx:353-354`, `1px` there vs. `2px` here per
  the documented, deliberate weight difference). Nothing computes these
  values from props, state, elapsed time, or connection cause. No indirect
  urgency-escalation or countdown-via-color channel exists — confirmed by
  reading the component (no hooks, no derived style) rather than only by
  the design doc's claim.

## Anything deferred or implicit that should be explicit before Facilitator sign-off

1. **The JS-driven-animation blind spot above.** Not a blocker for this
   change (nothing in the current diff exercises it), but I'd rather see it
   named in D3/the test comment now than rediscovered during a future
   incident review, given Tomás's own standing position that a control
   which silently degrades when someone innocently adds a
   `setInterval`-based hover/attention effect is exactly the failure mode
   D3 was written to close.
2. Everything else in scope (icon accessible-name absence, prop shape,
   call-site argument provenance, style staticness) is already correctly
   implemented and already correctly documented in design.md D2/D3/D9 and
   the component's own header comment — no other deferred or implicit item
   found that needs to become explicit before Facilitator sign-off.

## Summary

- No new disclosure of role/cause/session-moment/SEC-26 sub-cause state,
  directly or indirectly, in this diff.
- The standing no-animation test is a real, non-tautological CI check
  against the actual serialized DOM output and would fail on a literal
  CSS-property regression.
- One documentation gap recommended (not a code blocker): name the
  JS-driven/non-CSS style-mutation blind spot in D3 or the test's comment,
  the same way the external-stylesheet limitation is already named.

**Signed off, with one non-blocking documentation recommendation** (item 1
above). Nothing here withholds sign-off on the security-owned checks; the
felt-judgment calls (icon shape read, tone) remain Priya's to make.
