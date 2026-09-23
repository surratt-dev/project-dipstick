# Mock Sign-Off — `reauth-required` visual register (GitHub issue #140)

**Reviewer:** Priya Nair (Facilitator SME) — **persona-simulated**, performed by an agent adopting her persona (see standing disclaimer at the end of this document). Not Priya Nair's own review.

**Date:** 2026-09-23

**What was reviewed:** the candidate visual register implemented in `packages/frontend/src/components/ReauthRequiredTreatment.tsx` (task 1.1), rendered through both real host components per design.md Decision D1/D6, using the DOM capture in `visual-register-capture.md` (task 1.4) as the review surface, cross-checked directly against the component source and its test suite.

---

## 1. Per-bound verdict against D1

| Bound | Verdict | Evidence |
|---|---|---|
| Assertive | **Yes** | Both host captures in `visual-register-capture.md` show the root element as `<div role="alert" ...>` (participant capture line 35, facilitator capture line 43). Confirmed against source: `ReauthRequiredTreatment.tsx:142`, `<div role="alert" style={REAUTH_REQUIRED_STYLE}>`. This is a real change from the sibling `unknown-reconnecting` treatment, which remains `<div role="status">{UNKNOWN_RECONNECTING_TEXT}</div>` — confirmed by reading `ConnectionStatusBanner.tsx:43-44` directly, today. |
| Persistent | **Yes** | `ReauthRequiredTreatment.tsx` (full file read, lines 1-185) contains exactly one interactive control — the "Log in again" button (lines 171-182) — and no dismiss affordance, no conditional-visibility state, and no other `onClick`/hide code path. There is nothing in the component that can hide the treatment before the CTA is used. |
| Distinct from `unknown-reconnecting` | **Yes, on every listed axis (color, weight, icon), not just one** | `unknown-reconnecting` renders as unstyled plain text in a bare `<div role="status">` (`ConnectionStatusBanner.tsx:44`) — no color, no border, no icon. `reauth-required` renders `backgroundColor: "#fff3e0"`, `border: "2px solid #ffb74d"`, `borderRadius: "4px"` (`ReauthRequiredTreatment.tsx:96-104`) plus an inline SVG closed-lock icon (`ReauthRequiredTreatment.tsx:152-168`). The two treatments share no color, weight, or icon language. |
| Stops short of modal | **Yes** | Full file read confirms: no `<dialog>` element, no focus-trap library or hook, no overlay/backdrop/scroll-lock code anywhere in the component. It is a plain `<div role="alert">` with in-flow content. |

## 2. No-animation negative constraint

**Verdict: Clears — no animation, transition, keyframe, or elapsed-time-tied duration property present.**

Evidence: the standing, CI-enforced test added per task 1.2, co-located with the digit-pattern test in `ReauthRequiredTreatment.test.tsx` ("no animation, transition, or elapsed-time-tied duration"), asserts `container.innerHTML` does not match `/animation/i`, `/transition/i`, `/@keyframes/i`, or `/duration/i`. I ran the full suite directly (`npx vitest run src/components/__tests__/ReauthRequiredTreatment.test.tsx`) on 2026-09-23: **9/9 tests passing**, this one included. This is the standing-test citation task 2.2 calls for, not an ad hoc grep. The component's styling lives entirely in its inline `style` objects (`REAUTH_REQUIRED_STYLE`, `REAUTH_REQUIRED_ICON_STYLE`), which is within this test's `innerHTML` visibility per design.md D3's file-scope note — no external stylesheet exists yet that would need separate coverage.

## 3. Felt judgment — persona-simulated, not equivalent to a real facilitator's read

**Assertive-vs-alarming call:** This clears, in my judgment. The register commits to an amber/warning tone (`#fff3e0`/`#ffb74d`, reused verbatim from `MemberManagement.tsx`'s existing warning precedent — confirmed by grep, `MemberManagement.tsx:353-354`, `#fff3e0` background / `1px solid #ffb74d`), not a red/error tone. There's no exclamation mark or triangle-of-doom iconography anywhere in the register. The `2px` border (heavier than `MemberManagement.tsx`'s `1px` precedent) reads to me as proportional, not alarmist — it's earning its extra weight because this state, unlike a contextual form warning, is a forced, non-self-resolving disconnect the participant cannot dismiss and cannot wait out. Read cold, next to `unknown-reconnecting`'s completely bare text, this register reads as "this one actually matters" without tipping into "something has gone wrong." That's the distinction I care about most here, and it holds.

**Icon shape screening (countdown-adjacent forms — clock, hourglass, gauge, dial, or similar):** Clears. The icon (`ReauthRequiredTreatment.tsx:152-168`) is an inline SVG built from a rounded rectangle body (`<rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor">`) with an open arc above it (`<path d="M7 10V7a5 5 0 0 1 10 0v3" ...>`) — unambiguously a closed-padlock silhouette. It has no circular face, no hands or needle, no radial gradient of marks, and no tapered/pinched sand-timer profile — the four shape families I was asked to screen for. At the rendered `18x18` size I don't see a plausible misreading toward any of them. It reads as "locked," which is the intended meaning, not as "time is passing."

## 4. Host coverage (design.md Decision D6)

**This verdict covers both real hosts: `SessionConnectionHost.tsx` (participant) and `FacilitatorConnectionHost.tsx` (facilitator).**

Evidence: `visual-register-capture.md` shows both hosts driven through a real `REAUTH_GRACE_EXPIRED_CLOSE_CODE` transition, and the captured register (color, weight, icon, `role="alert"`) is byte-identical between them — the only difference is the conditionally-present vote-loss sentence, which is a copy concern reviewed under #141, not a register concern. `reauthRequiredHostParity.test.tsx` (run directly, 2026-09-23: 2/2 passing) continues to enforce this parity mechanically.

## 5. Closing verdict

**Signed off.**

## 6. Standing disclaimer

This sign-off is a persona-simulated review performed by an agent adopting the Priya Nair (Facilitator SME) persona — it is not Priya Nair's own review, and is explicitly identified as such. It is bounded to the checklist, negative-constraint, and felt-judgment items enumerated above; it is not evidence toward, and must not be read as predicting the outcome of, issue #142's live usability test (evaluating whether the `reauth-required` treatment reads as an alarm without failing to be noticed, in a real session with a real facilitator) or issue #143. Per this change's own `exploration-notes.md`, a clean #140/#141 pass does not predict #142's outcome, and neither issue is attempted, simulated, or partially satisfied by this artifact.
