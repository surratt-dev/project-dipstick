## MODIFIED Requirements

### Requirement: Server-initiated close codes do not disclose the cause of connection termination

When the server terminates a WebSocket connection for a reason it must not disclose to the client — specifically, an unauthorized subscription attempt (rejected at subscription time, after the WebSocket upgrade has completed) — it SHALL use `STALE_SIGNAL_CLOSE_CODE` for that case. (A connection-time authentication or origin failure is rejected before the WebSocket upgrade completes — via an ordinary HTTP error response, not a WebSocket close code — so it is outside this requirement's scope; there is no established connection for such a rejection to "terminate.")

The scheduled absolute-lifetime force-close (the 90-minute cap defined in the Idle-connection re-authorization requirement, below) is no longer covered by this non-disclosure requirement: it SHALL instead use the disclosed `REAUTH_GRACE_EXPIRED_CLOSE_CODE` defined by `websocket-connection-reauthorization`, routing the client to the same `reauth-required` state and CTA that capability's own SEC-26 refresh-failure path already uses. This is a deliberate, narrow reversal of this requirement's prior scope, not an erosion of the non-disclosure principle generally: an unauthorized-subscription rejection discloses a fact about *this specific user's access* (which must not be disclosed, since it could reveal a revocation to the person it was revoked from), while the absolute-lifetime cap is a fact about *elapsed wall-clock time*, identical and predictable for every session regardless of who is in it or why — disclosing "your 90 minutes are up" leaks nothing about anyone's authorization status. A client MUST still be unable to distinguish "your access was revoked or was never granted" from "an ordinary network failure occurred" by inspecting the close code alone — that pairing is unchanged. A client CAN now distinguish either of those from "your absolute session lifetime elapsed," which is the intended, corrected behavior.

This requirement covers the connection-close layer specifically. It is the counterpart, at that layer, to the silent mid-connection event withholding the Membership revocation requirement establishes at the event-delivery layer: both exist to prevent a subscriber from learning the reason their access was *revoked*, and neither may leak that reason through the other's mechanism (a delivery-time rejection never closes the socket — it silently withholds the event — and a revocation-caused close never carries a distinguishable reason code). The absolute-lifetime cap was never a revocation and this modification stops treating its close code as though it were.

This requirement does not require or preclude a client-visible signal, banner, or message beyond the close code itself; the specific rendered treatment for the disclosed absolute-lifetime case is defined by `websocket-staleness-signal`. This requirement governs only the wire-level close code the server emits.

#### Scenario: A rejected subscription still uses the disclosure-blind close code

- **WHEN** the server rejects a WebSocket subscription attempt because the connecting user is not authorized
- **THEN** the connection is closed with `STALE_SIGNAL_CLOSE_CODE`
- **AND** a client cannot determine the reason for the rejection by inspecting the close code alone

#### Scenario: The absolute-lifetime force-close uses the disclosed reauth close code, not the disclosure-blind one

- **WHEN** the server force-closes a connection because it exceeded the 90-minute absolute session lifetime
- **THEN** the connection is closed with `REAUTH_GRACE_EXPIRED_CLOSE_CODE`, the same code `websocket-connection-reauthorization`'s SEC-26 grace-period-expiry path uses
- **AND** the connection is NOT closed with `STALE_SIGNAL_CLOSE_CODE`

#### Scenario: A rejected subscription and an absolute-lifetime force-close are now distinguishable from each other, but a rejected subscription and an ordinary network failure remain indistinguishable

- **WHEN** the server rejects a WebSocket subscription attempt because the connecting user is not authorized, and, separately, the server force-closes a different connection because it exceeded the 90-minute absolute session lifetime
- **THEN** the two closes use different close codes, and a client CAN determine from the close code alone that the second case is the absolute-lifetime cap
- **AND** the rejected-subscription close remains indistinguishable, by close code alone, from an ordinary network failure

#### Scenario: A user revoked within the same window their absolute lifetime expires is denied at the destination, not at the disclosed close code

- **WHEN** a user's connection crosses the 90-minute absolute-lifetime cap and is closed with the disclosed `REAUTH_GRACE_EXPIRED_CLOSE_CODE`, and that same user's team membership or role was also separately revoked, but the SEC-25 periodic re-authorization sweep (which runs on its own ~5-minute cadence and is what actually force-closes a *live* revoked connection with `STALE_SIGNAL_CLOSE_CODE`) has not yet run against this connection at the moment the absolute-lifetime close fires
- **THEN** the user receives the disclosed reauth-required signal and CTA exactly as any other absolute-lifetime expiry would produce, learning nothing about the separate revocation from the close code
- **AND** the user can successfully re-authenticate against the identity provider (revocation here is this application's own team/role membership state, not IdP-side)
- **AND** the destination route reached via the `returnTo` redirect (`reauth-return-to`) independently re-evaluates the user's current authorization and denies or restricts access there, exactly as it would for any direct, unprompted navigation to that route
- **AND** this is a timing artifact of which mechanism happens to run first, not a disclosure regression: the denial still happens at the correct layer (the destination's own authorization check), one hop later than it would if the SEC-25 sweep had won the race

### Requirement: Idle-connection re-authorization (SEC-25) is tracked, not satisfied, by delivery-time checks alone

**Companion effort resolved by `websocket-connection-reauthorization`:** the gap this requirement names is now closed — see the `websocket-connection-reauthorization` spec's "Periodic re-authorization of open WebSocket connections" and "Silent token refresh for active WebSocket connections" requirements for the SEC-25/SEC-27 sweep and SEC-26 silent-refresh mechanisms. This requirement's own text is left unchanged below because it remains an accurate, standing statement of what delivery-time checks do and do not do on their own — that structural fact did not change; only the "gap is open" framing has, and that resolution lives in the companion spec rather than being folded into this one.

Delivery-time authorization checks, as defined in this spec, evaluate a subscriber's authorization only at the moment an event is about to be pushed. A connection that receives no content-access event for an entire token-expiry window is not re-evaluated by any mechanism this spec defines. This is a real, named gap distinct from the revocation guarantee this spec establishes (which governs connections actively receiving events) — it is not satisfied by this spec's delivery-time mechanism and MUST NOT be treated as closed by it.

This gap, together with SEC-26 (token expiry / silent refresh mid-connection), was tracked to a single named companion effort with an assigned owner. This spec still does not itself define the idle-connection heartbeat mechanism, its interval, or its close behavior — that mechanism now lives in the `websocket-connection-reauthorization` capability, referenced above.

**Tracking destination:** filed as GitHub issue [#27](https://github.com/surratt-dev/project-dipstick/issues/27), resolved by the `websocket-connection-reauthorization` capability.

**Compensating bound:** independent of the periodic sweep the companion capability now runs, a connection is not left with a fully unbounded window even before that sweep's interval elapses. The application SHALL apply the existing absolute session-lifetime cap (BRD SEC-26, 90 minutes, already enforced for HTTP requests) to WebSocket connections as well: a connection open longer than the cap MUST be rejected at its next delivery-time check and MUST be independently closed by the server at the cap regardless of activity, using the disclosed `REAUTH_GRACE_EXPIRED_CLOSE_CODE` per the "Server-initiated close codes do not disclose the cause of connection termination" requirement above. This bounds the *outer edge* of any connection's window to 90 minutes regardless of the sweep's own cadence.

#### Scenario: An idle connection is not re-authorized by delivery-time checks alone

- **WHEN** a facilitator's connection to session S receives no `vote_readiness_update`, `session_state_change`, or `vote_revealed` event for an entire token-expiry window (e.g., a quiet pre-session lobby)
- **THEN** no delivery-time authorization check runs against that connection during that window, because no event is pushed
- **AND** this is not a violation of this spec's delivery-time requirements, which apply only when an event is pushed
- **AND** the connection is nonetheless re-evaluated by the `websocket-connection-reauthorization` capability's periodic sweep, independent of this spec's delivery-time mechanism

#### Scenario: An idle connection is closed at the absolute session lifetime cap using the disclosed close code

- **WHEN** a connection to session S has been open for longer than the 90-minute absolute session lifetime (BRD SEC-26), whether or not it has received any content-access event during that time
- **THEN** the connection is closed by the server using `REAUTH_GRACE_EXPIRED_CLOSE_CODE`, independent of whether an event was ever pushed to it
- **AND** this bound does not re-evaluate the subscriber's team membership or role at any point before the 90-minute mark — only total connection age is checked — so it is not a substitute for the `websocket-connection-reauthorization` capability's periodic sweep, which is what actually re-evaluates membership and role within that window
