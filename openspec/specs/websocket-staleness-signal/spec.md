# websocket-staleness-signal

## Purpose

Defines the client-side, disclosure-safe rendering of connection uncertainty introduced by `websocket-delivery-time-authorization`'s `STALE_SIGNAL_CLOSE_CODE` and by `websocket-connection-reauthorization`'s SEC-26 signal pair. A server-initiated close using `STALE_SIGNAL_CLOSE_CODE` is, by design, indistinguishable on the wire from a raw network drop — this capability ensures the client never re-introduces the distinction the backend deliberately withheld, while still surfacing the legitimately-disclosed `reauth-required` signal SEC-26 sends.

This spec is additive to, and depends on, `websocket-delivery-time-authorization` (source of `STALE_SIGNAL_CLOSE_CODE` and the pilot-readiness gate this capability closes) and `websocket-connection-reauthorization` (source of `REAUTH_GRACE_EXPIRED_CLOSE_CODE` and the in-band `reauth_required` message). It reuses both close-code constants verbatim (relocated to `packages/shared/src/types/ws-close-codes.ts` as a prerequisite of this capability, with no change to their values or meaning) and does not alter either backend mechanism.

This spec covers: the three-value client connection-health state machine (`connected` / `unknown-reconnecting` / `reauth-required`) and its single shared implementation; the disclosure-blind timing floor and retry policy for `unknown-reconnecting`; the no-retry, page-navigation-only recovery path for `reauth-required`; the participant-facing rendered banner for both non-`connected` states; and the facilitator-only, cause-blind readiness-grid marker, its signal source, lifecycle, and visual bound.

This spec does NOT cover: any new server-side signal, close code, or heartbeat (none is introduced); issue [#33](https://github.com/surratt-dev/project-dipstick/issues/33)'s reauthorization-specific grid distinction (a deferred consumer of this capability's shared module, not built here); the full live-session voting UI (topic display, vote casting, reveal); and session-history or trend-continuity for stale-connection events (declined, not deferred — see design.md Decision D12). Issue [#32](https://github.com/surratt-dev/project-dipstick/issues/32)'s fuller re-login UX for `reauth-required` — previously deferred here as "the state and a minimal generic message only" — is now built out by the `reauth-required-client-prompt` change: the call-to-action, content requirements, and ARIA/persistence/visual-register contract below.

**Implementation status:** Implemented. `packages/frontend/src/realtime/connectionHealth.ts` is the sole implementation, consumed identically by `ConnectionStatusBanner.tsx` (participant) and `FacilitatorReadinessGrid.tsx` (facilitator). All CI-enforced acceptance tests (retry-symmetry, `reauth-required` no-retry, cause-blind grid marker, exhaustiveness) pass; a follow-up closed a CI type-check gap that had left the exhaustiveness guard unverified at build time (`review-followup-summary.md`). `reauth-required`'s rendering is implemented in a shared subcomponent, `ReauthRequiredTreatment.tsx` (design.md Decision D9 of `reauth-required-client-prompt`), consumed identically by both `ConnectionStatusBanner.tsx` and `FacilitatorReadinessGrid.tsx` — the latter's previously independently-duplicated placeholder copy and markup have been deleted in favor of the shared component. **The facilitator-experience gate is only partially closed**: Priya Nair (Facilitator SME) signed off on all three original copy strings for `unknown-reconnecting`, but withheld sign-off on the grid marker's visual-register mock — the shipped marker ships an intentionally neutral, unstyled placeholder (a bare glyph with no color/opacity/spacing differentiation) rather than either candidate visual register, and the live usability test has not been performed. These remaining items are tracked in [GitHub issue #36](https://github.com/surratt-dev/project-dipstick/issues/36) and deferred by product-owner decision rather than oversight. `reauth-required`'s own treatment — CTA, ARIA role, persistence, content-checklist-satisfying copy, and a real visual register replacing the prior `border: "2px solid currentColor"` placeholder — is implemented in code. Both new gate items this treatment introduced have now closed: the copy sign-off (GitHub issues #137/#138, closed via #141) and the visual-register mock sign-off (GitHub issue #139, closed via #140), per the `reauth-required-copy-and-visual-signoff` change. The `reauth-required` live usability test (GitHub issue #142) remains open — a clean #140/#141 pass is not evidence toward, and does not predict, that test's outcome. Per the pilot-readiness gate below, this capability is deployable to non-pilot/staging environments now but MUST NOT be used for a real pilot team's first live session until the `unknown-reconnecting` grid-marker's remaining items and the `reauth-required` live usability test all close.

---

## Requirements

### Requirement: Undifferentiated client-side connection-health state machine

The client SHALL maintain a single connection-health state with exactly two disclosure-blind values, `connected` and `unknown-reconnecting`, plus the separate, legitimately-disclosed `reauth-required` value defined below. A server-initiated close using `STALE_SIGNAL_CLOSE_CODE`, a raw network close, and a raw network error SHALL all be classified into the same `unknown-reconnecting` bucket by the same code path. The state machine SHALL NOT branch on the WebSocket close-code value or on the connection-attempt outcome type anywhere within the `connected`/`unknown-reconnecting` pair — not in state classification, not in retry scheduling, not in rendering — except for the single, named check for `REAUTH_GRACE_EXPIRED_CLOSE_CODE` that routes to `reauth-required` instead.

#### Scenario: A revoked connection and a flaky connection produce identical retry timing

- **WHEN** a connection is closed with `STALE_SIGNAL_CLOSE_CODE` and, separately, a connection experiences a raw network close or error
- **THEN** both are classified into the `unknown-reconnecting` state via the same handler
- **AND** the retry count, backoff schedule, and jitter applied to each are identical, verifiable by forcing both through the same handler and asserting identical retry timing

#### Scenario: An initial-connection failure is not a distinct case from mid-session staleness

- **WHEN** a client's very first subscription attempt is rejected, before any connection was ever established
- **THEN** the client enters `unknown-reconnecting` via the same code path a mid-session close would use
- **AND** no separate "couldn't connect" state or code path exists

#### Scenario: Recovery to a healthy connection is silent

- **WHEN** the connection-health state transitions from `unknown-reconnecting` back to `connected`
- **THEN** no distinct "reconnected" event, toast, or transition treatment is emitted
- **AND** the only observable change is the state value itself

### Requirement: Legitimately-disclosed re-authentication-required state, distinct from the disclosure-blind bucket

The client SHALL maintain a third connection-health value, `reauth-required`, entered when the client receives the in-band `{"eventType": "reauth_required"}` message defined by `websocket-connection-reauthorization`, or — as a fallback, for a client that misses or never receives that message — when the connection closes with `REAUTH_GRACE_EXPIRED_CLOSE_CODE`. This state SHALL NOT be reachable via a `STALE_SIGNAL_CLOSE_CODE` close or a raw network close/error, and the `unknown-reconnecting` state SHALL NOT be reachable via a `reauth_required` message or a `REAUTH_GRACE_EXPIRED_CLOSE_CODE` close. Once entered, `reauth-required` SHALL be sticky and terminal for the lifetime of a given connection-health instance: any pending retry timer SHALL be cleared synchronously on entry, and no subsequent close or error event of any code SHALL be processed once this state is active. No retry SHALL be attempted from `reauth-required`: recovery requires a full top-level page navigation, per `websocket-connection-reauthorization`, never an in-place reconnect. The `reauth-required` state SHALL itself remain cause-blind to which SEC-26 sub-cause produced it (retry-budget exhaustion, definitive identity-provider revocation, or concurrent session destruction), matching that capability's own non-disclosure of that distinction.

#### Scenario: A 4001 close and a reauth_required message both reach the same state without retrying

- **WHEN** a connection closes with `REAUTH_GRACE_EXPIRED_CLOSE_CODE` and, separately, a connection receives a `reauth_required` message
- **THEN** both are classified into the `reauth-required` state via the same handler
- **AND** no retry attempt, backoff computation, or jitter draw occurs for either

#### Scenario: The reauth-required path and the disclosure-blind path never merge

- **WHEN** a connection reaches `reauth-required` via either of its two triggering signals
- **THEN** it was not reached via a `STALE_SIGNAL_CLOSE_CODE` close or a raw network close/error
- **AND** conversely, a `STALE_SIGNAL_CLOSE_CODE` close or raw network close/error never produces the `reauth-required` state

#### Scenario: A close arriving after reauth-required is already active is a no-op

- **WHEN** a `reauth_required` message has already transitioned the state to `reauth-required`, and the socket's own subsequent close (of any code, including its own eventual `REAUTH_GRACE_EXPIRED_CLOSE_CODE` close) then arrives
- **THEN** that close event does not re-trigger, revert, or otherwise re-process the transition
- **AND** a retry timer pending from a prior `unknown-reconnecting` episode is cancelled before it can fire, and never calls `connect()` again

#### Scenario: The reauth-required state does not disclose its own sub-cause

- **WHEN** the `reauth-required` state is active, regardless of whether the underlying SEC-26 failure was retry-budget exhaustion, a definitive revocation, or a concurrent session destruction
- **THEN** no information distinguishing among these three is observable from the connection-health state alone

### Requirement: Uniform timing floor before surfacing connection uncertainty

The client SHALL NOT surface the `unknown-reconnecting` state to any rendered UI until a fixed minimum time has elapsed since the triggering close or error event, applied identically regardless of cause. This floor value SHALL be a fixed, module-local constant, not configurable via environment variable, feature flag, or admin-facing setting. A successful reconnect that completes before the floor elapses SHALL cancel the pending floor timer outright — the state SHALL NOT transition to `unknown-reconnecting` for that episode at all.

#### Scenario: An instantly-failing rejected subscription does not render before the floor elapses

- **WHEN** a subscription attempt is rejected essentially instantly
- **THEN** the `unknown-reconnecting` treatment does not appear in the UI until at least the fixed floor duration has elapsed from the rejection

#### Scenario: The floor applies identically to a slower-failing network drop

- **WHEN** a genuine network failure takes longer than the floor duration to surface as a close or error event
- **THEN** the same floor duration is applied before rendering, using the same code path as the instant-failure case
- **AND** no code path allows the floor to be skipped or shortened based on cause

#### Scenario: An early recovery before the floor elapses is invisible

- **WHEN** a connection fails and then successfully reconnects before the timing floor has elapsed
- **THEN** the state remains `connected` throughout and is never observed as `unknown-reconnecting` for that episode

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

### Requirement: No reveal-timing-aware special casing

None of `connectionHealth.ts`, `ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx`, or the shared `reauth-required` rendering subcomponent they both consume SHALL contain any code path that inspects, branches on, delays, suppresses, or otherwise coordinates the `reauth-required` state or its rendered treatment based on session reveal timing or any other session-moment-specific state. The `reauth_required` signal and its rendered treatment SHALL be handled identically regardless of what is concurrently happening elsewhere in the session.

#### Scenario: The reauth-required treatment renders identically whether or not a reveal is concurrently in progress

- **WHEN** the `reauth_required` message arrives while a topic reveal is concurrently in progress, versus arriving at any other time
- **THEN** the `reauth-required` treatment's rendered text, timing, and behavior are identical in both cases

#### Scenario: connectionHealth.ts, ConnectionStatusBanner.tsx, FacilitatorReadinessGrid.tsx, and the shared reauth-required subcomponent contain no reveal-state references

- **WHEN** `connectionHealth.ts`, `ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx`, and the shared `reauth-required` rendering subcomponent are inspected
- **THEN** none of them reference reveal state, topic status, or any other session-moment-specific signal

### Requirement: Single shared implementation

Exactly one client-side module SHALL implement the connection-health state machine described above. Both the participant-facing view and the facilitator readiness grid SHALL consume this same module. No second, independent implementation of this state machine SHALL exist, including for work that distinguishes revocation from flakiness during the reauthorization flow (GitHub issue #33) or work that builds the client-visible UX for the `reauth-required` state (GitHub issue #32) — such work SHALL consume this module rather than fork it.

#### Scenario: Participant view and facilitator grid share one implementation

- **WHEN** the participant-facing banner and the facilitator grid marker each derive their state
- **THEN** both call the same connection-health module
- **AND** no parallel implementation of the `connected`/`unknown-reconnecting`/`reauth-required` classification, timing floor, or retry logic exists anywhere else in the client

### Requirement: Facilitator-only, cause-blind grid marker with a defined lifecycle

The facilitator readiness grid SHALL display a marker indicating that its currently-rendered state may be stale. This marker SHALL be visible only to the facilitator, exactly as the rest of the readiness grid is restricted. The marker SHALL add at most one new visual state to the grid's existing **four** (`connected+not-locked-in`, `connected+locked-in`, `disconnected_voted`, `disconnected_no_vote`) and SHALL introduce no new color or icon language beyond what the grid already uses for its `disconnected` state. The marker SHALL compose with, and SHALL NOT be suppressed by, the `disconnected_voted` state's "ready" treatment — since the marker's signal source is the facilitator's own connection health rather than any individual row's state, it applies uniformly across all four baseline states, `disconnected_voted` included, without altering that state's own readiness indicator. The marker SHALL be cause-blind: a facilitator SHALL NOT be able to distinguish a connection that is stale because of revocation, because of ordinary network flakiness, or because of a pending reauthorization (GitHub issue #33's case) from the marker alone. The marker's appearance and clearing SHALL be governed by a defined lifecycle rather than left indefinite, and that lifecycle SHALL apply identically regardless of cause. The marker's signal source SHALL be the facilitator's own `unknown-reconnecting` state specifically; when the facilitator's own connection is in `reauth-required` instead, no grid-marker variant SHALL be shown — the facilitator's client SHALL instead render the same top-level `reauth-required` treatment used elsewhere, in place of the grid.

The marker's **final visual register is not yet determined by this capability**: the shipped implementation renders an intentionally neutral, unstyled placeholder (a bare glyph with no color, opacity, spacing, or size differentiation from the row label) satisfying the "no new color/icon language" bound trivially, pending a mock that actually attempts a candidate register and Priya Nair's sign-off on it (tracked in GitHub issue #36). A future change closing that gate replaces the placeholder styling; it does not alter the marker's signal source, lifecycle, or cause-blindness, which are settled here.

#### Scenario: The marker is never visible to a participant

- **WHEN** the readiness grid's stale-state marker is active
- **THEN** no participant-facing view receives or renders any equivalent signal about another participant's connection state

#### Scenario: The marker does not distinguish cause

- **WHEN** the marker is active due to a `STALE_SIGNAL_CLOSE_CODE` closure, a raw network drop, or a pending-reauthorization state
- **THEN** the marker's rendered appearance is identical in all three cases

#### Scenario: The marker composes with the disconnected_voted "ready" treatment

- **WHEN** a participant's row is in the `disconnected_voted` state (rendering "ready" per OR-1.3) and the facilitator's own connection is `unknown-reconnecting`
- **THEN** the row shows both the existing "ready" treatment and the stale-state marker
- **AND** the marker does not suppress, replace, or otherwise alter the "ready" indicator

#### Scenario: The marker does not activate for the facilitator's own reauth-required state

- **WHEN** the facilitator's own connection-health state is `reauth-required` rather than `unknown-reconnecting`
- **THEN** no grid-marker variant is rendered on any row
- **AND** the facilitator's client renders the same top-level `reauth-required` treatment any client would, in place of the grid

#### Scenario: The marker appears and clears in lockstep with connection health, with no independent persistence

- **WHEN** the underlying connection-health state (per the shared module) transitions to `unknown-reconnecting` and later back to `connected`
- **THEN** the marker appears and clears in lockstep with those transitions
- **AND** no separate timer or stored flag causes the marker to persist after the connection-health state has returned to `connected`, or to remain absent after it has entered `unknown-reconnecting`

#### Scenario: An active vote in progress freezes rather than visually mutates when the marker appears

- **WHEN** the marker becomes active while a vote is in progress
- **THEN** the grid's existing per-row content (locked-in counts, per-row states) freezes at its last-known values
- **AND** the marker is overlaid without altering the underlying row content beyond the marker itself

#### Scenario: The shipped marker is an unstyled placeholder, not the final visual register

- **WHEN** the marker renders in the current build
- **THEN** it appears as a bare glyph glued directly to the row label, with no color, opacity, spacing, or size differentiation from the label text
- **AND** this is not yet a rendering of either candidate register (dimmed/hollow vs. disconnected-adjacent) under consideration for the final treatment
- **AND** the final visual register remains withheld pending Priya Nair's sign-off against a mock that actually attempts one, tracked in GitHub issue #36

### Requirement: No outlier-flagging affordances on the grid marker

The grid marker SHALL be a passive, informational display only. It SHALL NOT provide any interactive affordance that turns it into a room-visible event — no click-to-ping, no auto-generated chat message, and no equivalent mechanism — unless the facilitator independently and deliberately chooses to act on it through some other, unrelated facilitator action.

#### Scenario: The marker has no click or auto-notify behavior

- **WHEN** a facilitator views a grid row showing the stale-state marker
- **THEN** no click handler, ping action, or automatic message is attached to that marker

### Requirement: Pilot-readiness gate on the staleness signal

This capability SHALL NOT be used for a real pilot team's first live session until all of the following are complete: Priya Nair's (Facilitator SME) sign-off on the `unknown-reconnecting` participant-facing and facilitator-tooltip copy, evaluated in actual layout; Priya Nair's sign-off on the grid marker's visual-register mock; Priya Nair's sign-off on the `reauth-required` treatment's copy, evaluated in actual layout against the mock; Priya Nair's sign-off on the `reauth-required` treatment's visual-register mock, evaluated against a real session-screen mock rather than a bare placeholder; a live usability test with Priya Nair evaluating specifically whether the `unknown-reconnecting` treatment reads as an alarm; and a live usability test with Priya Nair evaluating specifically whether the `reauth-required` treatment reads as an alarm without failing to be noticed. This capability MAY be deployed to a non-pilot or staging environment before this gate closes.

**Current status:** the copy-sign-off portion of this gate for `unknown-reconnecting` is closed — Priya Nair signed off on all three copy strings against the shipped components. The `unknown-reconnecting` grid marker's visual-register mock sign-off, its follow-on final-styling task, and its live usability test all remain open, tracked in GitHub issue #36. A simulated-persona attempt at the visual-register sign-off was made against real screenshots of the shipped placeholder and was withheld, because the placeholder does not yet attempt either candidate register, so no register judgment could be made from it. The live usability test cannot be satisfied by any static or simulated review by construction — it requires a real facilitator in a real session. The product owner has accepted deferring the remaining `unknown-reconnecting` gate items until the frontend surface is more mature rather than iterating on the mock further now.

The `reauth-required` treatment's copy sign-off and visual-register mock sign-off — new gate items introduced by the `reauth-required-client-prompt` change, both open as of that change's own initial implementation — are now closed. The `reauth-required-copy-and-visual-signoff` change replaced the placeholder border with a real, host-rendered visual register (implemented and self-checked in that change's Group 1) and produced two sign-off artifacts against it: `mock-signoff.md` (GitHub issue #140, closed `Signed off`, clean) and `copy-layout-signoff.md` (GitHub issue #141, closed `Signed off with conditions`; the stated condition — rewording `REAUTH_REQUIRED_TEXT_BASE`'s opening clause to lead with the action verb while preserving the literal "leave this page and return to it" phrase — was implemented and verified, per that artifact's §6a, making it a clean pass for #141's purposes). Together these close GitHub issues #137, #138, #139, #140, and #141.

The `reauth-required` live usability test (GitHub issue #142) remains open. **A clean #140/#141 pass is not evidence toward, and must not be read as predicting, #142's outcome.** Per both sign-off artifacts' own standing disclaimers and this change's `exploration-notes.md`, #142 evaluates something a persona-simulated review of the rendered treatment cannot: whether a real facilitator, in a real live session, experiences the treatment as reading as an alarm without failing to be noticed — including near-reveal timing (the highest-friction moment, since this mechanism is deliberately blind to reveal state) and screen-reader/modality behavior, neither of which a DOM/CSS-level review can stand in for.

**#142 has been deferred, not merely left open.** It's been detached from [GitHub issue #136](https://github.com/surratt-dev/project-dipstick/issues/136) (the "01 - Identity and Access" milestone's tracking issue for this gate) and moved to the Polish milestone as an independent issue — no dev shortcut exists to force the `reauth-required` state today (see #142 itself), so it needs real setup time rather than blocking this milestone's close-out. **This does not weaken the gate requirement above** — the capability still MUST NOT be used for a real pilot team's first live session until #142 closes, regardless of which milestone tracks it. Deferral affects only whether #142 blocks the Identity-and-Access milestone's own completion; it does not affect the pre-pilot deployment gate, which remains fully in force. GitHub issue #143 (this status-note update) is no longer blocked on #142 for the same reason — see below.

**This does not close the pilot-readiness gate itself.** The capability still MUST NOT be used for a real pilot team's first live session: the `unknown-reconnecting` grid-marker's visual-register mock sign-off and live usability test (GitHub issue #36) and the `reauth-required` live usability test (GitHub issue #142, now tracked in the Polish milestone) both remain open.

#### Scenario: The capability is withheld from a pilot team's first live session until the gate closes

- **WHEN** a real pilot team is about to run its first live session using this capability
- **THEN** the session SHALL NOT proceed with this capability enabled unless the `unknown-reconnecting` copy sign-off, the grid-marker visual-register mock sign-off, the `reauth-required` copy sign-off, the `reauth-required` visual-register mock sign-off, and both usability tests are all complete

#### Scenario: The gate remains partially, not fully, closed after the reauth-required-copy-and-visual-signoff change

- **WHEN** evaluating this capability's readiness for a real pilot team's first live session as of the `reauth-required-copy-and-visual-signoff` change
- **THEN** the `unknown-reconnecting` copy sign-off is complete
- **AND** the grid-marker visual-register mock sign-off, its follow-on final-styling task, and the `unknown-reconnecting` live usability test are all open, tracked in GitHub issue #36
- **AND** the `reauth-required` treatment's copy sign-off (#137/#138, closed via #141) and visual-register mock sign-off (#139, closed via #140) are now closed
- **AND** the `reauth-required` live usability test (#142) remains open, deferred to the Polish milestone rather than tracked as a blocker of the "01 - Identity and Access" milestone's own tracking issue (#136) — a clean #140/#141 pass is not evidence toward, and does not predict, its outcome
- **AND** the capability therefore remains available in non-pilot and staging environments only, per this requirement's deployment allowance, unaffected by which milestone tracks #142
- **AND** GitHub issue #143 (this status-note update) is no longer blocked on #142 for milestone-tracking purposes and is closed on that basis, even though #142 itself remains open
