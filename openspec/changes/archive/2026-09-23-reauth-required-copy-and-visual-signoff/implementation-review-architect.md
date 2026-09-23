# Architecture review — Group 1 implementation (`reauth-required-copy-and-visual-signoff`)

Reviewer: Ingrid Sollenberger, Principal Solution Architect. Scope of this review is limited to what falls inside my remit — boundary discipline, consistency with design.md's committed decisions, and whether anything here should block downstream sign-off stages. I have no opinion on the copy, the felt "does it look right" question, or UX — that's Priya's and the facilitator sign-off's job, not mine.

## What I reviewed

- `design.md` (this change) in full.
- `git diff main -- packages/frontend/src/components/ReauthRequiredTreatment.tsx packages/frontend/src/components/__tests__/ReauthRequiredTreatment.test.tsx`.
- `visual-register-capture.md` and `tasks.md`.
- The full current source of `ReauthRequiredTreatment.tsx` (including its header comment block) and `MemberManagement.tsx`'s color precedent.
- Ran the existing test suite: `ReauthRequiredTreatment.test.tsx` (9 tests) and `reauthRequiredHostParity.test.tsx` (2 tests) — both green.

Groups 2–5 are correctly unimplemented (checkboxes unchecked in tasks.md) — not flagged as missing, per instruction.

## Findings

**1. D9 (no new prop, no branching on role/cause/session-moment state) — respected.**
`REAUTH_REQUIRED_STYLE` and `REAUTH_REQUIRED_ICON_STYLE` are unconditional module-level constants; nothing in the diff reads `role`, `returnTo`, or any other state to decide styling. The component signature is unchanged (`returnTo?`, `role` — both pre-existing exceptions from a prior change, not new). The only role-conditioned thing remains the vote-loss sentence, which predates this diff. Clean.

**2. Icon accessible name — respected.**
The `<svg>` carries `aria-hidden="true"` and no `<title>`, `aria-label`, or `title` attribute. I confirmed by hand-tracing the digit-pattern regex (`/\d+\s*(s|sec|second|m|min|minute)s?\b/i`) against every attribute value now in the rendered output (`width="18"`, `viewBox="0 0 24 24"`, the path `d` string, `stroke-width="2"`, the inline `style` string including `0.125rem`, `2px solid rgb(255, 183, 77)`, `rgb(255, 243, 224)`) — no digit is ever immediately followed by `s`/`m`-initial text. Backed by the actual test run (green). Sound.

**3. Color reuse — verified exact, not approximate.**
`MemberManagement.tsx:353-354` uses `backgroundColor: "#fff3e0"`, `border: "1px solid #ffb74d"`. The new `REAUTH_REQUIRED_STYLE`/`REAUTH_REQUIRED_ICON_STYLE` use the identical hex values (`#fff3e0`, `#ffb74d`). Only the border weight differs (2px vs. 1px), and that's an explicit, commented decision (forced non-self-resolving disconnect vs. contextual dialog), not a drift from the precedent. This is a real reuse, not a "same neighborhood" color pick — matches D2's intent to keep the app's color vocabulary from growing for no reason.

**4. No-animation standing test — present, correctly scoped, asserts what D3 requires.**
The test at `ReauthRequiredTreatment.test.tsx:22-41` is co-located immediately after the digit-pattern test, scans `container.innerHTML` (same visibility argument the digit-pattern test already relies on, correctly justified in the code comment for why that's sufficient today and what changes if styling ever moves to an external stylesheet), and checks the four terms D3 names: `animation`, `transition`, `@keyframes`, `duration`. That's a faithful, mechanical implementation of D3's negative constraint, not a weakened proxy for it.

**5. Task-numbering cross-reference — a pre-existing doc nit, not a code defect.**
`design.md`'s D3 prose says "Group 1's self-check (task **1.2**) ... cite[s] this test's passing result," but `tasks.md`'s actual numbering has the test added in **1.2** and the self-check in **1.3** (which is what the test's own comment and the implementation match). The implementation and tasks.md agree with each other and with D3's substance; only design.md's parenthetical task-number citation is off by one. This is a documentation cross-reference slip in design.md itself, not something Group 1 introduced or should have caught during implementation — I'm noting it so it isn't miscounted as an implementation gap. Not a blocker.

**6. Boundary/pattern consistency with existing code.**
No new dependency, no new abstraction, no new prop, inline SVG per D2's stated preference (avoids the emoji-color-presentation failure mode called out in design.md), style object pattern matches the rest of the file (`REAUTH_REQUIRED_STYLE` following the same shape as the pre-existing `PARTICIPANT_VOTE_COMPOSE_UI_WIRES_VOTE_DRAFT`-adjacent constants). Header comment block is untouched — correctly, since D7 conditions that update on Group 2/3's sign-off outcome, which hasn't happened yet.

**7. Host parity — not re-verified by new code, but not broken either.**
`SessionConnectionHost.tsx`, `FacilitatorConnectionHost.tsx`, and `ConnectionStatusBanner.tsx` show zero diff against `main`, consistent with visual-register-capture.md's account that the register was captured by driving the real hosts, not modifying them. `reauthRequiredHostParity.test.tsx` still passes, confirming no regression to the parity the hosts depend on.

## Verdict

No architectural boundary violations, no scope creep beyond `ReauthRequiredTreatment.tsx`/its test file, no re-litigation of settled decisions from the prior change, and the one discrepancy found (finding 5) is cosmetic and pre-existing in design.md rather than introduced by this implementation. Nothing here should block the change from proceeding to the next sign-off stage.
