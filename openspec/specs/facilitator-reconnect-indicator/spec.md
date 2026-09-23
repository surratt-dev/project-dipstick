# facilitator-reconnect-indicator

## Purpose

Gives participants a quiet, cause-blind signal that the facilitator's own connection is currently `unknown-reconnecting`, so a participant can tell "she's thinking" from "the room is stuck" without inferring it from stalled progress alone. Today participants receive no visibility into the facilitator's connection health at all — `websocket-session-authorization`'s four content-access events don't cover it, and `websocket-staleness-signal`'s grid marker reports the opposite direction (participants' staleness, to the facilitator).

This is new wire surface: a `facilitator_connection_status` event, delivered through the same Redis-backed `ws:events` pub/sub fan-out every other session-scoped event uses (never a direct, per-pod `ConnectionRegistry` iteration, which would silently fail to deliver across pods in a multi-instance deployment), gated to `pre_session`/`active` session status, and authorized identically to the existing four content-access events.

This spec covers: the broadcast event's trigger conditions, payload shape, and delivery-time authorization; the participant-facing rendered indicator's content, ARIA role, and lifecycle; and the constraint that this indicator's client-side implementation is a dedicated, single-purpose consumer, never a branch or extension of `connectionHealth.ts`'s own state machine.

This spec does NOT cover: any change to `connectionHealth.ts`'s `connected`/`unknown-reconnecting`/`reauth-required` state machine (unchanged); disclosing which of the three possible causes (network drop, `STALE_SIGNAL_CLOSE_CODE`, `REAUTH_GRACE_EXPIRED_CLOSE_CODE`) produced a facilitator disconnect (the payload is cause-blind by construction); or a duration cutoff distinguishing a brief blip from a permanent facilitator loss — a known, named limitation deferred as a follow-up (GitHub issue #145), since resolving it requires a product decision (e.g. a cutoff or a facilitator-reassignment flow) that does not exist yet.

**Implementation status:** Implemented. `packages/backend/src/realtime/ws-pubsub.ts`'s `publishFacilitatorConnectionStatus` publishes on the shared `ws:events` channel; `ws-event-dispatcher.ts`'s `dispatchFacilitatorConnectionStatus` delivers to each candidate that passes `evaluateSessionSubscriberAccess`, excluding the facilitator's own connection (matched by `subscriberPath`). `websocket-routes.ts` wires the publish call into the same two call sites that already call `recordFacilitatorConnectionAudit`, gated to `pre_session`/`active` status, with a small per-session Redis flag (`facilitator_connected:<sessionId>`) tracking prior-disconnect state across pods. `packages/frontend/src/realtime/facilitatorConnectionStatus.ts`'s `useFacilitatorConnectionStatus` hook attaches a `message` listener to the session's live socket (shared via `SessionConnectionHost.tsx` lifting `useConnectionHealth`, per `websocket-staleness-signal`'s Decision 6 note) and `FacilitatorReconnectIndicator.tsx` renders the `role="status"` indicator.

---

## Requirements

### Requirement: Participants receive a cause-blind signal of the facilitator's connection health

While a session is in `pre_session` or `active` status, the server SHALL broadcast a `facilitator_connection_status` event, carrying only `{ connected: boolean }`, to every other session-scoped WebSocket connection registered for that session whenever the facilitator's own connection's observed health changes between "connected" and "not currently connected." "Not currently connected" covers every cause that would put the facilitator's own client into `unknown-reconnecting` or `reauth-required` — a raw network drop, a `STALE_SIGNAL_CLOSE_CODE` close, or a `REAUTH_GRACE_EXPIRED_CLOSE_CODE` close (including the absolute-lifetime case this change's other capabilities fix the routing for) — without distinguishing among them in the broadcast payload.

This event SHALL be delivered only to subscribers who already pass the same session-subscriber authorization check (`evaluateSessionSubscriberAccess`) that governs the existing four content-access events; this capability introduces no new authorization surface.

#### Scenario: Participants are notified when the facilitator's connection drops

- **WHEN** the facilitator's WebSocket connection for session S closes for any reason while session S is `pre_session` or `active`
- **THEN** every other session-scoped connection currently registered for session S receives `facilitator_connection_status: { connected: false }`

#### Scenario: Participants are notified when the facilitator's connection recovers

- **WHEN** a new WebSocket connection for the facilitator of session S registers as session-scoped for session S, following a prior disconnect
- **THEN** every other session-scoped connection currently registered for session S receives `facilitator_connection_status: { connected: true }`

#### Scenario: The broadcast never discloses which cause produced the disconnect

- **WHEN** `facilitator_connection_status: { connected: false }` is broadcast, regardless of whether the underlying cause was a raw network drop, a `STALE_SIGNAL_CLOSE_CODE` close, or a `REAUTH_GRACE_EXPIRED_CLOSE_CODE` close
- **THEN** the event payload contains only the `connected` boolean
- **AND** no field, message, or side channel discloses which of the three causes applies

#### Scenario: Only authorized session subscribers receive the event

- **WHEN** a `facilitator_connection_status` event is broadcast for session S
- **THEN** it is delivered only to connections that pass `evaluateSessionSubscriberAccess` for session S
- **AND** it is not delivered to any connection that would not also be eligible to receive this session's other content-access events

#### Scenario: No broadcast outside pre_session or active status

- **WHEN** the facilitator's connection for a session with status `lobby`, `wrap_up`, or `closed` changes connectivity
- **THEN** no `facilitator_connection_status` event is broadcast for that session

---

### Requirement: Participant-facing rendered treatment is quiet, cause-blind, and non-actionable

The client SHALL render a single, quiet, one-line indicator when the most recently received `facilitator_connection_status` event for the current session has `connected: false`, and SHALL clear it when a subsequent event has `connected: true`. This indicator SHALL use an implicit-polite (`role="status"`) live region — never `role="alert"` — since the viewing participant cannot act on this information; it is not their own connection being reported. The indicator's content SHALL NOT disclose which cause produced the disconnect, MUST NOT include a countdown or numeric time value, and SHALL use plain, non-alarming language (e.g., to the effect of "Facilitator reconnecting…") distinct in register from both `unknown-reconnecting`'s and `reauth-required`'s treatments, since this indicator reports on someone else's connection, not the viewer's own.

This indicator SHALL NOT provide any interactive affordance — no click action, no auto-generated message to the facilitator or other participants, and no mechanism that turns a participant's awareness of the facilitator's disconnect into a room-visible event beyond the indicator itself.

#### Scenario: The indicator appears when the facilitator is reported disconnected

- **WHEN** a participant's client receives `facilitator_connection_status: { connected: false }`
- **THEN** a quiet, one-line indicator appears, using a `role="status"` live region

#### Scenario: The indicator clears when the facilitator is reported reconnected

- **WHEN** a participant's client subsequently receives `facilitator_connection_status: { connected: true }`
- **THEN** the indicator is removed

#### Scenario: The indicator never uses an assertive live region

- **WHEN** the indicator is rendered
- **THEN** its root element uses `role="status"`, not `role="alert"`

#### Scenario: The indicator's copy contains no countdown, cause, or sub-cause disclosure

- **WHEN** the indicator's rendered text is inspected, regardless of which underlying cause produced the facilitator's disconnect
- **THEN** it contains no digit-plus-time-unit pattern
- **AND** it does not name or distinguish among network drop, revocation-adjacent close, or reauth-required close as the cause

#### Scenario: The indicator has no click or auto-notify behavior

- **WHEN** a participant views the indicator
- **THEN** no click handler, ping action, or automatic message is attached to it

---

### Requirement: The indicator consumes a dedicated client-side signal, not connectionHealth.ts

This capability's client-side indicator SHALL be implemented as its own small, single-purpose consumer of the new `facilitator_connection_status` event, and SHALL NOT branch, extend, or add new state values to `connectionHealth.ts`'s `connected`/`unknown-reconnecting`/`reauth-required` state machine, since that machine reports exclusively on the viewing client's own connection, not on another user's. Exactly one such consumer implementation SHALL exist, shared identically by every participant-facing surface that needs it, following the same single-shared-implementation discipline `websocket-staleness-signal` already holds `connectionHealth.ts` to.

#### Scenario: connectionHealth.ts is unmodified by this capability

- **WHEN** `connectionHealth.ts`'s source is inspected after this capability is implemented
- **THEN** it contains no new state value, branch, or reference related to `facilitator_connection_status`

#### Scenario: Exactly one indicator implementation exists

- **WHEN** the codebase is inspected for consumers of `facilitator_connection_status`
- **THEN** exactly one shared client-side module implements the indicator's state and rendering
- **AND** no second, independent implementation exists elsewhere in the client
