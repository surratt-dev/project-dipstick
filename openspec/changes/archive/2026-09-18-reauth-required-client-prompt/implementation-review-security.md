# Implementation Review — `reauth-required-client-prompt` (issue #32)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** Verifying the shipped implementation against my design-time review (`design-review-security.md`) and the disclosure decisions (D2, D3, D5, D6, D9) it informed. Copy/UX taste out of scope.

**Method:** Read the diff directly (`packages/frontend/src/components/ReauthRequiredTreatment.tsx`, `ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx`, and all new/modified test files), confirmed the three files claimed unmodified are byte-identical to `main` via `git diff main -- connectionHealth.ts AuthContext.tsx AuthErrorPage.tsx` (empty in all three), and ran the full relevant test suite (44/44 passing).

## All three design-time findings closed, verified as real controls

1. **No-countdown test widened to full markup.** `ReauthRequiredTreatment.test.tsx` asserts the digit-plus-time-unit regex against `container.innerHTML` (text + attributes), not just `textContent`. Confirmed by reading the test, not just the task checklist claiming it.
2. **CTA pinned to exact literal.** `ConnectionStatusBanner.test.tsx:166` asserts `window.location.href` with `.toBe("/auth/login")` — strict equality, not a prefix/substring match. A future `?reason=reauth` addition fails this test.
3. **D5 vote-loss gate is build-enforced.** `voteDraft.grep.test.ts` calls a shared `voteComposeUiWiresVoteDraft()` helper (`voteComposeWiring.ts`) that both the regression guard (task 1.1) and the copy-consistency check (task 3.6) call — so the two can't independently drift. Currently returns `false` (no compose UI wires `voteDraft.ts` yet), and the shipped copy correctly includes the vote-loss sentence, matching that fact.

## Core disclosure boundary: still holds, now traced through the extracted component

- `ReauthRequiredTreatment.tsx` takes no props — verified directly, and `connectionHealth.grep.test.ts` adds an explicit assertion (`no exported *Props interface/type`) enforcing this can't regress. This matters more post-refactor than pre-: a props-taking shared component is exactly the shape that would let the two call sites (participant, facilitator) quietly diverge by passing different cause/role data. They can't.
- `connectionHealth.grep.test.ts` extends its existing non-disclosure grep invariants (no `STALE_SIGNAL_CLOSE_CODE` reference, no raw close-code literal comparison, no console logging) to the new component and to both consumers. No sub-cause value is reachable from the rendered branch.
- `reauthRequiredHostParity.test.tsx` mounts the *real* host components (`SessionConnectionHost`, `FacilitatorConnectionHost`) — not two instances of the same banner — and asserts byte-identical rendered output. This is the correct shape of test to catch the facilitator-grid duplication gap (engineer review Finding 1) were it to recur; I confirm it actually exercises `FacilitatorReadinessGrid.tsx`, not a bypass.
- Reveal-window non-special-casing (D6): `connectionHealth.grep.test.ts` greps all four relevant files for `reveal`/`topicStatus`/`SessionTopicStatus` — none present. Consistent with the accepted-risk decision, not silently abandoned.

## Byte-unmodified claim: confirmed

`git diff main -- connectionHealth.ts context/AuthContext.tsx components/AuthErrorPage.tsx` returns empty for all three. The backend disclosure boundary this client change sits on top of (SEC-25 revocation routing to the disclosure-blind bucket, SEC-26's payload-free `reauth_required` message) is untouched, as claimed.

## Minor residual note (not blocking)

Task 5.2 (reveal-in-progress behavioral fixture) and Group 6 (visual-register mock, animation-timing negative constraint, copy/usability sign-off) remain open, as the tasks.md itself states. None of these are disclosure-boundary items — 5.2 is a structural guarantee already covered by the grep check in practice, and Group 6 is Priya Nair's domain (I flagged the animation-timing constraint at design time; it's correctly recorded as a gate item for her sign-off, not something the current placeholder styling could violate since it has no animation at all).

## Verdict

Clean pass. No new findings. All three design-time hardening requests were implemented as real, verified controls (build-enforced tests / CI assertions), not just claimed in prose. Full test suite green (44/44). Nothing here blocks proceeding to the Group 6 sign-off gate.
