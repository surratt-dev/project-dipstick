## ADDED Requirements

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

The client SHALL maintain a third connection-health value, `reauth-required`, entered when the client receives the in-band `{"eventType": "reauth_required"}` message defined by `websocket-connection-reauthorization`, or — as a fallback, for a client that misses or never receives that message — when the connection closes with `REAUTH_GRACE_EXPIRED_CLOSE_CODE`. This state SHALL NOT be reachable via a `STALE_SIGNAL_CLOSE_CODE` close or a raw network close/error, and the `unknown-reconnecting` state SHALL NOT be reachable via a `reauth_required` message or a `REAUTH_GRACE_EXPIRED_CLOSE_CODE` close. No retry SHALL be attempted from `reauth-required`: recovery requires a full top-level page navigation, per `websocket-connection-reauthorization`, never an in-place reconnect. The `reauth-required` state SHALL itself remain cause-blind to which SEC-26 sub-cause produced it (retry-budget exhaustion, definitive identity-provider revocation, or concurrent session destruction), matching that capability's own non-disclosure of that distinction.

#### Scenario: A 4001 close and a reauth_required message both reach the same state without retrying

- **WHEN** a connection closes with `REAUTH_GRACE_EXPIRED_CLOSE_CODE` and, separately, a connection receives a `reauth_required` message
- **THEN** both are classified into the `reauth-required` state via the same handler
- **AND** no retry attempt, backoff computation, or jitter draw occurs for either

#### Scenario: The reauth-required path and the disclosure-blind path never merge

- **WHEN** a connection reaches `reauth-required` via either of its two triggering signals
- **THEN** it was not reached via a `STALE_SIGNAL_CLOSE_CODE` close or a raw network close/error
- **AND** conversely, a `STALE_SIGNAL_CLOSE_CODE` close or raw network close/error never produces the `reauth-required` state

#### Scenario: The reauth-required state does not disclose its own sub-cause

- **WHEN** the `reauth-required` state is active, regardless of whether the underlying SEC-26 failure was retry-budget exhaustion, a definitive revocation, or a concurrent session destruction
- **THEN** no information distinguishing among these three is observable from the connection-health state alone

### Requirement: Uniform timing floor before surfacing connection uncertainty

The client SHALL NOT surface the `unknown-reconnecting` state to any rendered UI until a fixed minimum time has elapsed since the triggering close or error event, applied identically regardless of cause. This floor value SHALL be a fixed, module-local constant, not configurable via environment variable, feature flag, or admin-facing setting.

#### Scenario: An instantly-failing rejected subscription does not render before the floor elapses

- **WHEN** a subscription attempt is rejected essentially instantly
- **THEN** the `unknown-reconnecting` treatment does not appear in the UI until at least the fixed floor duration has elapsed from the rejection

#### Scenario: The floor applies identically to a slower-failing network drop

- **WHEN** a genuine network failure takes longer than the floor duration to surface as a close or error event
- **THEN** the same floor duration is applied before rendering, using the same code path as the instant-failure case
- **AND** no code path allows the floor to be skipped or shortened based on cause

### Requirement: Uniform participant-facing rendered treatment

The client SHALL render exactly one treatment for the `unknown-reconnecting` state, applied identically regardless of whether the underlying cause was a rejected subscription, a mid-session force-expiry, or an ordinary network drop, and a separate, fixed treatment for the `reauth-required` state, applied identically regardless of SEC-26 sub-cause. Both treatments SHALL use plain, non-blaming, non-urgent language.

#### Scenario: Rendered output is identical across causes

- **WHEN** the `unknown-reconnecting` state is reached via a `STALE_SIGNAL_CLOSE_CODE` close versus via a raw network close/error
- **THEN** the rendered banner's text and DOM structure are identical in both cases

#### Scenario: The reauth-required rendered output is identical across its two triggers, and distinct from unknown-reconnecting

- **WHEN** the `reauth-required` state is reached via a `REAUTH_GRACE_EXPIRED_CLOSE_CODE` close versus via a `reauth_required` message
- **THEN** the rendered text and DOM structure are identical in both cases
- **AND** this rendered output differs from the `unknown-reconnecting` state's rendered output

### Requirement: Single shared implementation

Exactly one client-side module SHALL implement the connection-health state machine described above. Both the participant-facing view and the facilitator readiness grid SHALL consume this same module. No second, independent implementation of this state machine SHALL exist, including for work that distinguishes revocation from flakiness during the reauthorization flow (GitHub issue #33) or work that builds the client-visible UX for the `reauth-required` state (GitHub issue #32) — such work SHALL consume this module rather than fork it.

#### Scenario: Participant view and facilitator grid share one implementation

- **WHEN** the participant-facing banner and the facilitator grid marker each derive their state
- **THEN** both call the same connection-health module
- **AND** no parallel implementation of the `connected`/`unknown-reconnecting`/`reauth-required` classification, timing floor, or retry logic exists anywhere else in the client

### Requirement: Facilitator-only, cause-blind grid marker with a defined lifecycle

The facilitator readiness grid SHALL display a marker indicating that its currently-rendered state may be stale. This marker SHALL be visible only to the facilitator, exactly as the rest of the readiness grid is restricted. The marker SHALL add at most one new visual state to the grid's existing **four** (`connected+not-locked-in`, `connected+locked-in`, `disconnected_voted`, `disconnected_no_vote`) and SHALL introduce no new color or icon language beyond what the grid already uses for its `disconnected` state. The marker SHALL compose with, and SHALL NOT be suppressed by, the `disconnected_voted` state's "ready" treatment — since the marker's signal source is the facilitator's own connection health rather than any individual row's state, it applies uniformly across all four baseline states, `disconnected_voted` included, without altering that state's own readiness indicator. The marker SHALL be cause-blind: a facilitator SHALL NOT be able to distinguish a connection that is stale because of revocation, because of ordinary network flakiness, or because of a pending reauthorization (GitHub issue #33's case) from the marker alone. The marker's appearance and clearing SHALL be governed by a defined lifecycle rather than left indefinite, and that lifecycle SHALL apply identically regardless of cause. The marker's signal source SHALL be the facilitator's own `unknown-reconnecting` state specifically; when the facilitator's own connection is in `reauth-required` instead, no grid-marker variant SHALL be shown — the facilitator's client SHALL instead render the same top-level `reauth-required` treatment used elsewhere, in place of the grid.

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

### Requirement: No outlier-flagging affordances on the grid marker

The grid marker SHALL be a passive, informational display only. It SHALL NOT provide any interactive affordance that turns it into a room-visible event — no click-to-ping, no auto-generated chat message, and no equivalent mechanism — unless the facilitator independently and deliberately chooses to act on it through some other, unrelated facilitator action.

#### Scenario: The marker has no click or auto-notify behavior

- **WHEN** a facilitator views a grid row showing the stale-state marker
- **THEN** no click handler, ping action, or automatic message is attached to that marker

### Requirement: Pilot-readiness gate on the staleness signal

This capability SHALL NOT be used for a real pilot team's first live session until all of the following are complete: Priya Nair's (Facilitator SME) sign-off on the participant-facing and facilitator-tooltip copy, evaluated in actual layout; Priya Nair's sign-off on the grid marker's visual-register mock; and a live usability test with Priya Nair evaluating specifically whether the treatment reads as an alarm. This capability MAY be deployed to a non-pilot or staging environment before this gate closes.

#### Scenario: The capability is withheld from a pilot team's first live session until the gate closes

- **WHEN** a real pilot team is about to run its first live session using this capability
- **THEN** the session SHALL NOT proceed with this capability enabled unless the copy sign-off, the visual-register mock sign-off, and the usability test are all complete
