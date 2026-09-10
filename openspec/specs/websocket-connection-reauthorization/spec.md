# websocket-connection-reauthorization

## Purpose

Defines connection-lifecycle authorization requirements for open WebSocket connections: periodic re-authorization of connections that receive no push (SEC-25/SEC-27) and silent token refresh to keep a connection's underlying authentication live for up to the full 90-minute session ceiling (SEC-26). This capability closes the gap the websocket-session-authorization spec's delivery-time mechanism names but does not itself cover — a connection that receives nothing is never re-checked by a delivery-time check alone.

This spec is additive to, and depends on, websocket-session-authorization: it reuses that spec's authorization functions (`evaluateSessionSubscriberAccess`, `evaluateTeamAccess`) verbatim, its `STALE_SIGNAL_CLOSE_CODE` non-disclosure convention, and its `ConnectionRegistry`. It does not redefine or duplicate delivery-time authorization, and it does not touch the 90-minute absolute connection lifetime, which remains a separate, untouched axis (see websocket-session-authorization).

This spec covers: the periodic re-authorization sweep for both session-scoped and team-scoped connections; the silent token-refresh mechanism and its grace-period hygiene bound; the disjointness guarantee between the sweep's revocation-close signal and the refresh mechanism's re-authentication signal; preservation of in-flight, composed-but-unsubmitted vote state across both mechanisms; and the facilitator-visible diagnostic trace for a resolved grace-period recovery.

This spec does NOT cover: delivery-time authorization checks on content-access events, or the 90-minute absolute connection lifetime (both: websocket-session-authorization). The client-visible UX for the SEC-26 re-authentication prompt and the facilitator readiness-grid's visual treatment of a dropped/recovered connection are named as hard constraints on signal properties below but are frontend design work this spec does not define — tracked as GitHub issues [#32](https://github.com/surratt-dev/project-dipstick/issues/32) and [#33](https://github.com/surratt-dev/project-dipstick/issues/33). Frontend persistence of composed-but-unsubmitted vote state across the full page reload a SEC-26 recovery requires is also out of scope here — tracked as GitHub issue [#31](https://github.com/surratt-dev/project-dipstick/issues/31).

**Implementation status:** Implemented (issue [#27](https://github.com/surratt-dev/project-dipstick/issues/27), closing the gap websocket-session-authorization's "Idle-connection re-authorization (SEC-25)" requirement tracked as a companion effort). `connection-reauthorization.ts` (SEC-25/SEC-27 sweep) and `connection-token-refresh.ts` (SEC-26 silent refresh + grace period) are live for both session-scoped and team-scoped connections, wired into both WebSocket route handlers. 449/450 backend tests passing (the one skip requires live Redis/Postgres and predates this change).

---

## Requirements

### Requirement: Periodic re-authorization of open WebSocket connections

The application SHALL re-evaluate the authorization of every registered WebSocket connection — session-scoped and team-scoped alike — no less frequently than once every 5 minutes, using the same authorization functions (`evaluateSessionSubscriberAccess`, `evaluateTeamAccess`) that delivery-time authorization already applies. A connection whose authorization fails this check SHALL be closed using `STALE_SIGNAL_CLOSE_CODE`, identically to any other server-initiated close whose cause must not be disclosed. This interval is a fixed, module-local constant and is not exposed as an admin-configurable setting or environment override.

A revocation detected by this sweep SHALL be recorded as an `audit_log` row (`session.access_revoked_live`), in addition to the existing structured-log emission, since a live connection's access being cut off mid-session is a security-relevant event in its own right.

#### Scenario: A session-scoped connection with revoked team membership is closed within the interval

- **WHEN** a participant's `team_memberships.removed_at` is set while their WebSocket connection to session S is open and idle (no events pushed to it)
- **AND** no more than 5 minutes elapse
- **THEN** the periodic sweep evaluates the connection via `evaluateSessionSubscriberAccess`
- **AND** the connection is closed with `STALE_SIGNAL_CLOSE_CODE`
- **AND** no other close code or message discloses the reason
- **AND** an `audit_log` row (`session.access_revoked_live`) is written recording the revocation

#### Scenario: A team-scoped connection with revoked membership is closed within the interval

- **WHEN** a team-scoped dashboard viewer's team membership is removed while their WebSocket connection is open
- **AND** no more than 5 minutes elapse
- **THEN** the periodic sweep evaluates the connection via `evaluateTeamAccess`
- **AND** a grant whose path is `admin` is rejected, exactly as at delivery time
- **AND** the connection is closed with `STALE_SIGNAL_CLOSE_CODE` if the evaluated grant fails or is admin-path

#### Scenario: An EM-promotion mid-connection is detected independently of membership removal

- **WHEN** a user's `users.global_role` or `team_memberships.role` changes such that they no longer pass the applicable authorization check, without their membership being removed
- **AND** their WebSocket connection remains open and idle
- **THEN** the periodic sweep detects this via the same dual-signal check `evaluateSessionSubscriberAccess`/`evaluateTeamAccess` already perform
- **AND** the connection is closed with `STALE_SIGNAL_CLOSE_CODE` within the interval

#### Scenario: An authorized connection is unaffected by the sweep

- **WHEN** the periodic sweep runs against a connection whose authorization still passes
- **THEN** the connection remains open
- **AND** no message or close is sent to the client
- **AND** the client observes no reconnect, flicker, or other distinguishable behavior
- **AND** no `audit_log` row is written

---

### Requirement: Silent token refresh for active WebSocket connections

The application SHALL maintain a valid authentication token for each active WebSocket connection for up to the full 90-minute session ceiling, using silent refresh, without interrupting the connected participant, reusing the same refresh/retry/revocation-distinction logic the HTTP session path uses. If silent refresh cannot be completed — after the existing retry/backoff budget is exhausted, or on a definitive revocation response from the identity provider, or because the underlying session was destroyed by a concurrent HTTP-side action between the refresh read and its write-back — the application SHALL notify the client that re-authentication is required and SHALL terminate that connection once a grace period of approximately 30 seconds elapses, giving the client that long to begin re-authenticating before server-side cleanup. The refresh threshold, the retry budget/backoff delay, and the grace period are all fixed, module-local constants — like the SEC-25 sweep interval above, none is exposed as an admin-configurable setting, a feature flag, or an environment override, including as an operational kill switch to disable the mechanism.

**Recovery is always a fresh connection, never an in-place resume.** This application's re-authentication flow is a full top-level page navigation to the identity provider and back, which tears down the WebSocket connection's JS execution context before the identity provider is even reached; the login callback also always allocates a new session id (`request.session.regenerate()`), so there is no old session id for the original connection to be resumed under even if it were still open. The grace period is therefore a server-side hygiene bound on the *original* connection only — it is always closed once the grace period elapses (in practice, usually torn down earlier by the client's own navigation) — never a window in which the original connection is kept alive by a successful re-auth. A client that successfully re-authenticates establishes a new WebSocket connection under its new session, registered as an ordinary connect; this new connection is what "the participant regains access" means under this requirement.

The write-back of a refreshed token to the session store SHALL use an existence-gated conditional write, never an unconditional write — so that a session destroyed by a concurrent HTTP-side action (revocation, absolute-timeout) can never be silently resurrected by a stale, in-flight refresh completing afterward.

A successful refresh SHALL NOT extend the connection's 90-minute absolute lifetime; token liveness and connection age are enforced as separate, non-interacting axes.

#### Scenario: Silent refresh succeeds and the connection continues uninterrupted

- **WHEN** an active WebSocket connection's underlying token is within the refresh threshold of expiry
- **THEN** the application refreshes the token using the same refresh logic the HTTP session path uses
- **AND** the new token is persisted to the connection's session record via a conditional, existence-gated write
- **AND** the WebSocket connection remains open with no message sent to the client and no interruption

#### Scenario: Silent refresh fails, the client is notified, and the original connection is closed once the grace period elapses

- **WHEN** silent refresh for an active connection exhausts its retry budget, receives a definitive revocation response from the identity provider, or its conditional write-back is rejected because the session was destroyed concurrently
- **THEN** the application sends the client an explicit re-authentication-required signal
- **AND** starts a grace period of approximately 30 seconds
- **AND** an `audit_log` row (`session.token_refresh_failed_live`) is written recording the failure type, with no token values included
- **AND** the original connection is closed with a distinct close code once the grace period elapses, regardless of whether the client has by then begun re-authenticating — the connection is not resumed in place
- **AND** in practice the connection is often already closed before the grace period elapses, because beginning re-authentication itself tears down the connection via a full page navigation

#### Scenario: A client that re-authenticates within the grace period regains access via a new connection, not a resumed one

- **WHEN** a client whose connection was closed following a SEC-26 grace-period expiry (or whose connection was already torn down by beginning re-authentication) completes re-authentication
- **THEN** the client establishes a new WebSocket connection under its new session
- **AND** this registration is treated as an ordinary connect, subject to the same connection-time and subscription-time checks as any other new connection
- **AND** the participant's access is restored via this new connection, not by the original connection remaining open

#### Scenario: A successful token refresh does not extend the 90-minute absolute connection lifetime

- **WHEN** a WebSocket connection's token is silently refreshed, one or more times, during its lifetime
- **THEN** the connection's absolute lifetime is still measured from its original connection time
- **AND** the connection is force-closed at the 90-minute mark regardless of how recently its token was refreshed

#### Scenario: A concurrent session destruction is not resurrected by a stale in-flight refresh write-back

- **WHEN** an HTTP-side action destroys a session (revocation or absolute-timeout) while a WebSocket-side silent-refresh write-back for that same session is already in flight
- **THEN** the conditional write-back observes the session no longer exists and performs no write, regardless of which action reaches the store first
- **AND** the session remains destroyed
- **AND** this is treated identically to a definitive revocation for the purposes of notifying the client and starting the grace period

---

### Requirement: Revocation closes and re-authentication signals are never conflated

The application SHALL implement the periodic re-authorization close (SEC-25) and the token-refresh re-authentication-required signal (SEC-26) as disjoint code paths that do not share a single signal-sending function parameterized by cause, and SHALL use two distinct WebSocket close codes — one for a SEC-25 revocation close, a separate one for a SEC-26 grace-period expiry — never reused across the two mechanisms. A connection closed due to a SEC-25 revocation determination SHALL NOT receive any SEC-26 re-authentication signal, and a SEC-26 grace-period notification SHALL NOT be observable as, or convertible into, a disclosure of another user's revocation.

#### Scenario: A SEC-25 revocation close carries no SEC-26 signal

- **WHEN** a connection is closed because the periodic sweep determined the user's access was revoked
- **THEN** the client receives `STALE_SIGNAL_CLOSE_CODE` and nothing else
- **AND** no SEC-26 re-authentication-required signal is sent, sent-then-withdrawn, or otherwise observable on this connection

#### Scenario: A SEC-26 grace-period close never reuses the SEC-25 close code

- **WHEN** a connection is closed because its SEC-26 grace period expired
- **THEN** the client receives a close code distinct from `STALE_SIGNAL_CLOSE_CODE`
- **AND** the client received the explicit `reauth_required` signal before this close, since the cause is legitimately disclosed to this client (it is a statement about that client's own token, not a secret being withheld)

---

### Requirement: In-flight participant state survives both mechanisms

Neither the periodic re-authorization sweep (in its non-revocation outcome) nor a silent token refresh SHALL cause the loss of a participant's composed-but-unsubmitted vote, or force the participant to re-enter it. This is satisfied structurally: the backend never receives a composed-but-unsubmitted vote value before lock-in, and neither mechanism closes the socket on its success path — so there is nothing for either mechanism to lose.

#### Scenario: A composed but unsubmitted vote survives a silent refresh

- **WHEN** a participant has composed but not submitted a vote for the active topic
- **AND** a silent token refresh completes on their connection
- **THEN** the composed vote value is unchanged and available for submission
- **AND** the participant is not prompted to re-enter it

#### Scenario: A composed but unsubmitted vote survives a non-revocation sweep cycle

- **WHEN** a participant has composed but not submitted a vote for the active topic
- **AND** a periodic re-authorization sweep runs against their connection and passes
- **THEN** the composed vote value is unchanged and available for submission

**Known gap, not covered by this requirement:** a SEC-26 grace-period-expiry-then-recovery requires a full page reload (see the silent-token-refresh requirement above), which clears in-memory JS state the same way closing the tab would. This is a materially different case from an ordinary network blip or a non-revocation sweep pass, neither of which involves a page reload. Composed-but-unsubmitted vote state is not guaranteed to survive a SEC-26-triggered re-login without an explicit frontend persistence mechanism, which this spec does not define — tracked as GitHub issue [#31](https://github.com/surratt-dev/project-dipstick/issues/31).

---

### Requirement: Facilitator-visible diagnostic trace for a resolved token-refresh grace-period recovery

Because recovery from a SEC-26 grace period is always a fresh connection under a new session (never a resumed one — see the silent-token-refresh requirement above), the application SHALL correlate a resulting reconnect to the grace period it followed via a short-lived, single-use marker keyed by user id, and SHALL record a generic diagnostic signal that a token-refresh recovery occurred when that correlation resolves, reaching facilitator-visible session history, without disclosing whether the underlying token failure was a definitive revocation or a transient/exhausted-retry failure.

This mechanism can only ever fire for a resolved SEC-26 grace-period recovery: a SEC-25 non-revocation sweep pass never closes a connection (nothing to recover from), a SEC-25 revocation close does not produce a legitimate reconnect (the user is no longer authorized), and an ordinary network drop is not a mechanism this capability owns or can distinguish from any other disconnect.

The facilitator-scoped read path that surfaces this signal SHALL filter explicitly to this operation only — never a wildcard or prefix match — since the same underlying log also holds the SEC-25 revocation record and the SEC-26 failure record from the requirements above, neither of which is facilitator-visible.

#### Scenario: A resolved grace-period recovery is recorded without disclosing the underlying failure cause

- **WHEN** a participant's connection is closed following a SEC-26 grace-period expiry, and a new connection for the same user registers while that grace period's correlation marker is still live
- **THEN** the marker is consumed (single-use)
- **AND** a generic reconnect-occurred signal (`session.connection_recovered`) is recorded in facilitator-visible session history
- **AND** the signal does not indicate whether the prior refresh failure was a definitive revocation or a transient/retry-exhausted failure

#### Scenario: An ordinary network drop or a SEC-25 sweep pass produces no such signal

- **WHEN** a participant's connection drops for a reason other than a resolved SEC-26 grace-period recovery — an ordinary network interruption, or a SEC-25 sweep finding the connection still authorized
- **THEN** no `session.connection_recovered` signal is recorded for that reconnect

#### Scenario: The correlation marker cannot be resolved or probed by another user's connection

- **WHEN** a new connection registers
- **THEN** the marker lookup is keyed strictly by that connection's own resolved user id, from its own authenticated session — never a client-supplied identifier
- **AND** no connection can resolve or be affected by another user's marker

#### Scenario: The facilitator read path never surfaces the other two operations sharing the same log

- **WHEN** the facilitator-scoped session-history read path queries for connection-recovery signals
- **THEN** it filters explicitly to `session.connection_recovered`
- **AND** neither the SEC-25 revocation record nor the SEC-26 failure record is ever returned by this path

**Open, not yet built — frontend/UX work, not part of this capability's implemented scope:** whether the facilitator's readiness grid renders one uniform visual treatment for "this participant's connection is no longer live" regardless of which of the three causes (sweep revocation, refresh grace-period expiry, ordinary drop) triggered it is an explicit design constraint this capability places on future frontend work, not a built behavior — tracked as GitHub issue [#33](https://github.com/surratt-dev/project-dipstick/issues/33). Similarly, the client-visible treatment of the `reauth_required` signal itself is tracked as GitHub issue [#32](https://github.com/surratt-dev/project-dipstick/issues/32).
