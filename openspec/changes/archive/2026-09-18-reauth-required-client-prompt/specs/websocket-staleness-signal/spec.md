## MODIFIED Requirements

### Requirement: Uniform participant-facing rendered treatment

The client SHALL render exactly one treatment for the `unknown-reconnecting` state, applied identically regardless of whether the underlying cause was a rejected subscription, a mid-session force-expiry, or an ordinary network drop, using plain, non-blaming, non-urgent language and an implicit-polite (`role="status"`) live region. The client SHALL render a separate, fixed treatment for the `reauth-required` state, applied identically regardless of SEC-26 sub-cause, distinct from `unknown-reconnecting`'s treatment along all of the following axes: it SHALL use an assertive live region (`role="alert"`, not `role="status"`); it SHALL be persistent — either not dismissible before its call-to-action is used, or, if dismissed, demoted to a small persistent badge rather than removed entirely; it SHALL use a visually distinct register (color, weight, or icon) from the `unknown-reconnecting` treatment, while stopping short of a full modal dialog; and its content SHALL satisfy the required-content checklist defined by the "Reauth-required content requirements" requirement below. Neither treatment's content, timing, or behavior SHALL vary based on the participant's or facilitator's role.

#### Scenario: Rendered output is identical across causes

- **WHEN** the `unknown-reconnecting` state is reached via a `STALE_SIGNAL_CLOSE_CODE` close versus via a raw network close/error
- **THEN** the rendered banner's text and DOM structure are identical in both cases

#### Scenario: The reauth-required rendered output is identical across its two triggers, and distinct from unknown-reconnecting

- **WHEN** the `reauth-required` state is reached via a `REAUTH_GRACE_EXPIRED_CLOSE_CODE` close versus via a `reauth_required` message
- **THEN** the rendered text, DOM structure, and ARIA role are identical in both cases
- **AND** this rendered output differs from the `unknown-reconnecting` state's rendered output

#### Scenario: The reauth-required treatment uses an assertive live region, distinct from unknown-reconnecting's passive one

- **WHEN** the `unknown-reconnecting` and `reauth-required` states are each rendered
- **THEN** the `unknown-reconnecting` treatment's root element has `role="status"`
- **AND** the `reauth-required` treatment's root element has `role="alert"`, not `role="status"`

#### Scenario: The reauth-required treatment is persistent, not auto-dismissing

- **WHEN** the `reauth-required` treatment is rendered and no dismiss affordance is exposed by this change
- **THEN** the treatment remains visible for the full lifetime of the `reauth-required` state, with no code path that hides it before the call-to-action is used or the connection closes

#### Scenario: The reauth-required treatment stops short of a full modal

- **WHEN** the `reauth-required` treatment is rendered
- **THEN** it does not use a native `<dialog>` element in modal mode, a focus trap, or any mechanism that blocks interaction with the rest of the page

#### Scenario: Copy and CTA are identical regardless of participant or facilitator role

- **WHEN** the `reauth-required` treatment is rendered for a participant-facing view versus a facilitator-facing view
- **THEN** the rendered text, DOM structure, ARIA role, and call-to-action are identical in both cases

### Requirement: Pilot-readiness gate on the staleness signal

This capability SHALL NOT be used for a real pilot team's first live session until all of the following are complete: Priya Nair's (Facilitator SME) sign-off on the participant-facing and facilitator-tooltip copy, evaluated in actual layout; Priya Nair's sign-off on the grid marker's visual-register mock; Priya Nair's sign-off on the `reauth-required` treatment's visual-register mock, evaluated against a real session-screen mock rather than a bare placeholder; a live usability test with Priya Nair evaluating specifically whether the `unknown-reconnecting` treatment reads as an alarm; and a live usability test with Priya Nair evaluating specifically whether the `reauth-required` treatment reads as an alarm without failing to be noticed. This capability MAY be deployed to a non-pilot or staging environment before this gate closes.

**Current status:** the copy-sign-off portion of this gate for `unknown-reconnecting` is closed. The `unknown-reconnecting` grid marker's visual-register mock sign-off, its follow-on final-styling task, and its live usability test all remain open, tracked in GitHub issue #36. The `reauth-required` treatment's visual-register mock sign-off and live usability test are new gate items introduced by this change and are open as of this change's own initial implementation — this change replaces the prior placeholder copy and passive treatment with new interactive content, so the prior gate's copy sign-off does not carry forward to this richer treatment.

#### Scenario: The capability is withheld from a pilot team's first live session until the gate closes

- **WHEN** a real pilot team is about to run its first live session using this capability
- **THEN** the session SHALL NOT proceed with this capability enabled unless the copy sign-off, both visual-register mock sign-offs, and both usability tests are all complete

#### Scenario: The reauth-required gate items are open as of this change's initial implementation

- **WHEN** evaluating this capability's readiness for a real pilot team's first live session as of this change's initial implementation
- **THEN** the `reauth-required` treatment's visual-register mock sign-off and live usability test are open, tracked alongside the existing `unknown-reconnecting`/grid-marker gate items in GitHub issue #36 or a linked follow-up
- **AND** the capability therefore remains available in non-pilot and staging environments only, per this requirement's deployment allowance

## ADDED Requirements

### Requirement: Reauth-required call-to-action

The `reauth-required` treatment SHALL include a call-to-action control that triggers a full top-level navigation to `/auth/login`, using the identical navigation call already used by `AuthContext.tsx` and `AuthErrorPage.tsx` (`window.location.href = "/auth/login"`), rather than a new or parallel re-authentication trigger. This control SHALL be present and interactive from the first frame the `reauth-required` treatment renders — it SHALL NOT be hidden, disabled, or otherwise gated behind any elapsed-time threshold within the grace period. The navigation SHALL NOT be parameterized with a query string, fragment, or any other value derived from connection state, cause, or session identifiers.

#### Scenario: The call-to-action is present and interactive on first render

- **WHEN** the `reauth-required` state is first entered and the treatment renders for the first time
- **THEN** a call-to-action control is present in the rendered output
- **AND** the control is not disabled and requires no elapsed-time threshold to become interactive

#### Scenario: Activating the call-to-action navigates via the existing login route

- **WHEN** a user activates the `reauth-required` treatment's call-to-action control
- **THEN** the application sets `window.location.href` to exactly `/auth/login`, with no query string, fragment, or other appended parameter, identical to the call already used by `AuthContext.tsx` and `AuthErrorPage.tsx`
- **AND** no new or alternate re-authentication route or mechanism is introduced

### Requirement: Reauth-required content requirements

The `reauth-required` treatment's copy SHALL satisfy the following content requirements: it SHALL NOT include a countdown, a numeric grace-period value, or any digit-plus-time-unit representation of remaining time; it SHALL NOT disclose which SEC-26 sub-cause (retry-budget exhaustion, definitive revocation, or concurrent session destruction) produced the state, beyond the fact that this client's own token needs re-authentication; it SHALL include a plain-language statement that continuing requires leaving and returning to the page; and it SHALL use a tone register appropriate to an expected token-lifetime event, not an error condition.

The absence of a countdown or numeric grace-period value SHALL be enforced by an automated test asserting the full rendered `reauth-required` output — including element attribute values such as `aria-label`, `title`, and `data-*` attributes, not only the visible text node — never matches a digit-plus-time-unit pattern, mirroring the existing rendered-output-identity test for the `unknown-reconnecting` treatment. The treatment SHALL NOT include any non-textual representation of the grace period either — a progress bar, spinner, or animation whose duration or visual timing is derived from or approximates the grace-period interval is prohibited by the same rationale, verified at the visual-register mock sign-off rather than by pattern-matching rendered text.

#### Scenario: The rendered copy contains no countdown or numeric grace-period value

- **WHEN** the `reauth-required` treatment's rendered output — text content and attribute values alike — is inspected
- **THEN** it does not match any digit-plus-time-unit pattern (e.g. "23s", "30 seconds", "1 min") anywhere in that output

#### Scenario: The mock sign-off is checked against non-textual countdown surrogates too

- **WHEN** the `reauth-required` treatment's visual-register mock is reviewed for sign-off
- **THEN** the mock is rejected if it includes any animated element (progress bar, spinner, or CSS animation) whose duration or visual timing is derived from or approximates the grace-period constant

#### Scenario: The rendered copy does not disclose the SEC-26 sub-cause

- **WHEN** the `reauth-required` treatment is rendered, regardless of whether the underlying cause was retry-budget exhaustion, a definitive revocation, or a concurrent session destruction
- **THEN** the rendered text is identical across all three causes and does not name or distinguish among them

#### Scenario: The rendered copy states that continuing requires leaving and returning to the page

- **WHEN** the `reauth-required` treatment's rendered text is inspected
- **THEN** it includes a plain-language statement that using the call-to-action leaves and returns to the page (a full navigation), not an in-place action

### Requirement: Conditional vote-loss disclosure in the reauth-required treatment

The `reauth-required` treatment's copy SHALL include a plain-language statement that continuing will discard an unsubmitted vote, unless, at the time this change is implemented, the vote-compose UI then present in the codebase is confirmed to import and call `voteDraft.ts`'s (`packages/frontend/src/realtime/voteDraft.ts`, from the `vote-compose-recovery` capability) persist/restore hooks. This determination SHALL be made exactly once, at this change's implementation time, by a single checkable fact (whether the vote-compose UI's source imports `voteDraft.ts`'s persist/restore hooks) — not treated as a standing judgment call re-evaluated per reviewer.

#### Scenario: The vote-loss statement is included when the compose UI does not wire voteDraft.ts

- **GIVEN** no vote-compose UI in the codebase imports `voteDraft.ts`'s persist/restore hooks at this change's implementation time
- **WHEN** the `reauth-required` treatment's copy is finalized
- **THEN** the copy includes a plain-language statement that continuing discards an unsubmitted vote

#### Scenario: The vote-loss statement is omitted when the compose UI wires voteDraft.ts

- **GIVEN** a vote-compose UI in the codebase imports and calls `voteDraft.ts`'s persist/restore hooks at this change's implementation time
- **WHEN** the `reauth-required` treatment's copy is finalized
- **THEN** the copy omits the vote-loss statement

### Requirement: No reveal-timing-aware special casing

None of `connectionHealth.ts`, `ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx`, or the shared `reauth-required` rendering subcomponent they both consume SHALL contain any code path that inspects, branches on, delays, suppresses, or otherwise coordinates the `reauth-required` state or its rendered treatment based on session reveal timing or any other session-moment-specific state. The `reauth_required` signal and its rendered treatment SHALL be handled identically regardless of what is concurrently happening elsewhere in the session.

#### Scenario: The reauth-required treatment renders identically whether or not a reveal is concurrently in progress

- **WHEN** the `reauth_required` message arrives while a topic reveal is concurrently in progress, versus arriving at any other time
- **THEN** the `reauth-required` treatment's rendered text, timing, and behavior are identical in both cases

#### Scenario: connectionHealth.ts, ConnectionStatusBanner.tsx, FacilitatorReadinessGrid.tsx, and the shared reauth-required subcomponent contain no reveal-state references

- **WHEN** `connectionHealth.ts`, `ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx`, and the shared `reauth-required` rendering subcomponent are inspected
- **THEN** none of them reference reveal state, topic status, or any other session-moment-specific signal
