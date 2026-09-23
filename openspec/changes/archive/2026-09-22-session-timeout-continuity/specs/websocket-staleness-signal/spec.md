## MODIFIED Requirements

### Requirement: Uniform participant-facing rendered treatment

The client SHALL render exactly one treatment for the `unknown-reconnecting` state, applied identically regardless of whether the underlying cause was a rejected subscription, a mid-session force-expiry, or an ordinary network drop, using plain, non-blaming, non-urgent language and an implicit-polite (`role="status"`) live region. The client SHALL render a separate, fixed treatment for the `reauth-required` state, applied identically regardless of SEC-26 sub-cause, distinct from `unknown-reconnecting`'s treatment along all of the following axes: it SHALL use an assertive live region (`role="alert"`, not `role="status"`); it SHALL be persistent — either not dismissible before its call-to-action is used, or, if dismissed, demoted to a small persistent badge rather than removed entirely; it SHALL use a visually distinct register (color, weight, or icon) from the `unknown-reconnecting` treatment, while stopping short of a full modal dialog; and its content SHALL satisfy the required-content checklist defined by the "Reauth-required content requirements" requirement below.

Neither treatment's timing, ARIA role, persistence behavior, visual register, or call-to-action mechanism SHALL vary based on the participant's or facilitator's role. The sole named exception is the `reauth-required` treatment's vote-loss sentence, whose inclusion is conditioned on role per the "Conditional vote-loss disclosure in the reauth-required treatment" requirement below (facilitators never vote — per the ritual narrative, BRD.md §3, and `entities-and-relationships.md`'s Facilitator relationship list, which has no "casts vote" entry — so a vote-loss statement is factually false for that role) — every other aspect of both treatments' content, and all of `unknown-reconnecting`'s content without exception, remains role-blind.

#### Scenario: Rendered output is identical across causes

- **WHEN** the `unknown-reconnecting` state is reached via a `STALE_SIGNAL_CLOSE_CODE` close versus via a raw network close/error
- **THEN** the rendered banner's text and DOM structure are identical in both cases

#### Scenario: The reauth-required rendered output is identical across its two triggers, and distinct from unknown-reconnecting

- **WHEN** the `reauth-required` state is reached via a `REAUTH_GRACE_EXPIRED_CLOSE_CODE` close versus via a `reauth_required` message
- **THEN** the rendered text, DOM structure, and ARIA role are identical in both cases, for a given role
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

#### Scenario: Copy, timing, ARIA role, persistence, visual register, and CTA mechanism are identical regardless of participant or facilitator role, except the vote-loss sentence

- **WHEN** the `reauth-required` treatment is rendered for a participant-facing view versus a facilitator-facing view
- **THEN** the DOM structure (apart from the vote-loss sentence's presence or absence), ARIA role, persistence behavior, visual register, and call-to-action are identical in both cases
- **AND** the only permitted textual difference between the two is the presence (participant) or absence (facilitator) of the vote-loss sentence, per the "Conditional vote-loss disclosure" requirement

#### Scenario: unknown-reconnecting's content remains role-blind without exception

- **WHEN** the `unknown-reconnecting` treatment is rendered for a participant-facing view versus a facilitator-facing view
- **THEN** the rendered text and DOM structure are identical in both cases, with no exception

### Requirement: Conditional vote-loss disclosure in the reauth-required treatment

The `reauth-required` treatment's copy, when rendered for the `participant` role, SHALL include a plain-language statement that continuing will discard an unsubmitted vote, unless, at the time this change is implemented, the vote-compose UI then present in the codebase is confirmed to import and call `voteDraft.ts`'s (`packages/frontend/src/realtime/voteDraft.ts`, from the `vote-compose-recovery` capability) persist/restore hooks. This determination SHALL be made exactly once, at this change's implementation time, by a single checkable fact (whether the vote-compose UI's source imports `voteDraft.ts`'s persist/restore hooks) — not treated as a standing judgment call re-evaluated per reviewer.

The `reauth-required` treatment's copy, when rendered for the `facilitator` role, SHALL NOT include the vote-loss statement, unconditionally, regardless of the `voteDraft.ts` import determination above. Facilitators never vote — per the ritual narrative (BRD.md §3, "each participant votes") and `entities-and-relationships.md`'s Facilitator relationship list, which has no "casts vote" entry; no single requirement ID states this directly — the determination governing the participant case has no bearing on the facilitator case, since the statement is factually inapplicable to that role independent of any frontend persistence mechanism's existence.

The component SHALL receive the caller's role as an explicit parameter (not inferred from ambient context, a route, or a global) so that the same shared component and rendering logic serve both call sites, per the "Single shared implementation" requirement — the facilitator/participant distinction is a single conditional inside that one component, not a second implementation.

**Current status:** as of this requirement's addition, no vote-compose UI in the codebase imports `voteDraft.ts`'s persist/restore hooks — enforced by an automated grep test (`packages/frontend/src/realtime/__tests__/voteDraft.grep.test.ts`) — so the shipped copy includes the vote-loss statement for the `participant` role and omits it for the `facilitator` role. `openspec/specs/vote-compose-recovery/spec.md` carries a forward-pointing note directing whoever wires a real vote-compose UI to `voteDraft.ts` back to this determination, so it is re-checked and the participant-role copy updated in the same change that lands that wiring, rather than left to go stale; the facilitator-role omission is unconditional and is not affected by that future change.

#### Scenario: The vote-loss statement is included for the participant role when the compose UI does not wire voteDraft.ts

- **GIVEN** no vote-compose UI in the codebase imports `voteDraft.ts`'s persist/restore hooks at this change's implementation time
- **WHEN** the `reauth-required` treatment's copy is finalized for the `participant` role
- **THEN** the copy includes a plain-language statement that continuing discards an unsubmitted vote

#### Scenario: The vote-loss statement is omitted for the participant role when the compose UI wires voteDraft.ts

- **GIVEN** a vote-compose UI in the codebase imports and calls `voteDraft.ts`'s persist/restore hooks at this change's implementation time
- **WHEN** the `reauth-required` treatment's copy is finalized for the `participant` role
- **THEN** the copy omits the vote-loss statement

#### Scenario: The vote-loss statement is always omitted for the facilitator role

- **WHEN** the `reauth-required` treatment's copy is rendered for the `facilitator` role, regardless of the `voteDraft.ts` import determination
- **THEN** the copy omits the vote-loss statement
- **AND** every other required content element (leave-and-return statement, no countdown, no sub-cause disclosure) is present, identical to the participant-role copy

### Requirement: Reauth-required call-to-action

The `reauth-required` treatment SHALL include a call-to-action control that triggers a full top-level navigation to `/auth/login`, using the identical navigation call already used by `AuthContext.tsx` and `AuthErrorPage.tsx` (`window.location.href = "/auth/login"`), rather than a new or parallel re-authentication trigger. This control SHALL be present and interactive from the first frame the `reauth-required` treatment renders — it SHALL NOT be hidden, disabled, or otherwise gated behind any elapsed-time threshold within the grace period.

The navigation MAY be parameterized with exactly one additional query parameter, `returnTo`, whose value is the current page's path and query string (never a full origin, never a value derived from connection state, cause, SEC-26 sub-cause, or another user's identifier) — supplied to the treatment as an explicit prop by its caller, not read from ambient state inside the component. No other query string parameter, fragment, or derived value SHALL be appended. This is a narrow, named exception to this requirement's prior blanket ban on parameterization: the ban's purpose was to prevent the navigation from leaking *why* re-authentication was required or *what state* the connection was in, not to prevent the entirely orthogonal concern of returning the user to where they were. `returnTo` discloses neither cause nor connection state — it is the same page path the browser's own address bar already showed the user before the CTA was activated.

#### Scenario: The call-to-action is present and interactive on first render

- **WHEN** the `reauth-required` state is first entered and the treatment renders for the first time
- **THEN** a call-to-action control is present in the rendered output
- **AND** the control is not disabled and requires no elapsed-time threshold to become interactive

#### Scenario: Activating the call-to-action navigates via the existing login route, carrying the current page as returnTo

- **WHEN** a user activates the `reauth-required` treatment's call-to-action control, and a `returnTo` value was supplied to the treatment
- **THEN** the application sets `window.location.href` to `/auth/login?returnTo=<encoded current path and query>`, with no other appended parameter
- **AND** no new or alternate re-authentication route or mechanism is introduced

#### Scenario: Activating the call-to-action without a returnTo value navigates exactly as before

- **WHEN** a user activates the `reauth-required` treatment's call-to-action control, and no `returnTo` value was supplied to the treatment
- **THEN** the application sets `window.location.href` to exactly `/auth/login`, with no query string or fragment, identical to this requirement's prior behavior

#### Scenario: The returnTo value never carries cause, connection state, or another user's identifier

- **WHEN** the `returnTo` value is constructed for the call-to-action
- **THEN** it is derived solely from the current page's path and query string
- **AND** it contains no SEC-26 sub-cause, connection-health state value, or any other user's identifier
