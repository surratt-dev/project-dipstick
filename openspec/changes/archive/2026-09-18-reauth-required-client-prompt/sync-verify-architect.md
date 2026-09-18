# Sync Verification — Architect Review

**Reviewer:** Ingrid Sollenberger (Principal Solution Architect)
**Date:** 2026-09-18
**Scope:** Verify `openspec/specs/websocket-staleness-signal/spec.md` (just-synced main spec) against the shipped code for `reauth-required-client-prompt` (issue #32).

## Verdict: Clean. No drift found.

## What I checked

Read the main spec in full, `design.md` and `tasks.md` for `reauth-required-client-prompt`, and the actual code: `ReauthRequiredTreatment.tsx`, `ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx`, `connectionHealth.ts`, plus the test suite backing each claim (`ReauthRequiredTreatment.test.tsx`, `reauthRequiredHostParity.test.tsx`, `voteDraft.grep.test.ts`, `FacilitatorReadinessGrid.test.tsx`) and the cross-reference into `vote-compose-recovery/spec.md`.

## Confirmed true of the code as it stands (not aspirational)

- **D9 extraction is real, not asserted.** `ReauthRequiredTreatment.tsx` exists, takes no props, and is the sole renderer for the `reauth-required` case in both `ConnectionStatusBanner.tsx` and `FacilitatorReadinessGrid.tsx`. `FacilitatorReadinessGrid.tsx` no longer has its own `REAUTH_REQUIRED_TEXT` constant or `<div role="status">` — that duplication (engineer design-review Finding 1) is actually deleted, matching the spec's claim.
- **ARIA split is real:** `reauth-required` renders `role="alert"`; `unknown-reconnecting` still renders `role="status"` in both host files. Verified by code and by `4.5`'s test.
- **CTA is real:** a `<button>` calling `window.location.href = "/auth/login"` (exact literal, no query string), present unconditionally from first render — matches spec's requirement and D2's citation of `AuthContext.tsx`/`AuthErrorPage.tsx` precedent.
- **No modal, no dismiss:** confirmed — plain `<div role="alert">`, no `<dialog>`, no focus trap, no dismiss affordance in the JSX.
- **Grid marker is an unstyled placeholder:** the `○` glyph span has no color/opacity/spacing/size styling — matches the spec's "bare glyph glued to the row label" scenario exactly. Marker applies uniformly across rows regardless of row state (composes with `disconnected-voted`), and is excluded entirely when the facilitator's own state is `reauth-required` (renders `ReauthRequiredTreatment` instead, per test at `FacilitatorReadinessGrid.test.tsx:235-256`, which now also asserts the button and `role="alert"` per task 4.8's fix).
- **Copy is genuinely draft, not finalized**, and the code says so explicitly (`COPY IS NOT FINAL` header comment in `ReauthRequiredTreatment.tsx`) — matches the spec's "shipped copy is draft/placeholder text pending Priya Nair's sign-off" framing. Copy does include the vote-loss sentence, correctly conditioned on `voteDraft.grep.test.ts` finding no compose-UI wiring today (confirmed the test and its backing `voteComposeUiWiresVoteDraft()` check exist and pass this condition as coded).
- **Digit/countdown and tone constraints are CI-enforced**, not just prose: `ReauthRequiredTreatment.test.tsx` asserts against `container.innerHTML` (catches attributes, not just text) for the digit-time-unit pattern, and separately asserts no `!` or "error" language.
- **Group 6 gate items are genuinely open**, not closed-but-understated: `tasks.md` tasks 6.1–6.6 are all unchecked, and the spec's "Current status" paragraph states this plainly (mock sign-off, copy sign-off, both usability tests all open, tracked against issue #36).
- **Forward-reference loop (task 1.4) is real:** `openspec/specs/vote-compose-recovery/spec.md:11` contains the pointer back to this change's tasks 1.1/1.2, exactly as claimed.
- **`ws-close-codes.ts` relocation** claimed in the spec's Purpose section is real: `packages/shared/src/types/ws-close-codes.ts` exists.
- **`connectionHealth.ts` is untouched** by this change's concerns — no reveal-state references, no role/cause branching beyond the one named `REAUTH_GRACE_EXPIRED_CLOSE_CODE` check, consistent with D6/D8 and task 7.1's claim.

## Nothing found that the spec claims but isn't real, and nothing real that the spec is missing

One minor observation, not a defect: `tasks.md` task 5.2 (reveal-in-progress stubbed fixture test) is still unchecked and has no test file yet — the spec's own requirement text and scenarios for "No reveal-timing-aware special casing" are satisfied by the code's structural absence of reveal-state references (verified directly, task 5.1's grep-style check), which the spec's scenario wording supports independently of 5.2's fixture test existing. Not a spec/code mismatch — 5.2 is an open task, not a claim the spec makes as done.

## Conclusion

The main spec accurately reflects current reality: what's implemented (state machine, ARIA, CTA, shared subcomponent, placeholder marker, CI-enforced copy constraints) is implemented; what's still open (final copy sign-off, visual-register mocks for both treatments, both live usability tests — Group 6 in full) is stated as open, not glossed over. No corrective action needed.
