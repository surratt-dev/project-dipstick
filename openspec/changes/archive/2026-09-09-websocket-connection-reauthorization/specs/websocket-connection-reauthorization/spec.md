## ADDED Requirements

### Requirement: Periodic re-authorization of open WebSocket connections

The application SHALL re-evaluate the authorization of every registered WebSocket connection — session-scoped and team-scoped alike — no less frequently than once every 5 minutes, using the same authorization functions (`evaluateSessionSubscriberAccess`, `evaluateTeamAccess`) that delivery-time authorization already applies. A connection whose authorization fails this check SHALL be closed using `STALE_SIGNAL_CLOSE_CODE`, identically to any other server-initiated close whose cause must not be disclosed.

#### Scenario: A session-scoped connection with revoked team membership is closed within the interval

- **WHEN** a participant's `team_memberships.removed_at` is set while their WebSocket connection to session S is open and idle (no events pushed to it)
- **AND** no more than 5 minutes elapse
- **THEN** the periodic sweep evaluates the connection via `evaluateSessionSubscriberAccess`
- **AND** the connection is closed with `STALE_SIGNAL_CLOSE_CODE`
- **AND** no other close code or message discloses the reason

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

### Requirement: Silent token refresh for active WebSocket connections

The application SHALL maintain a valid authentication token for each active WebSocket connection for up to the full 90-minute session ceiling, using silent refresh, without interrupting the connected participant. If silent refresh cannot be completed — after the existing retry/backoff budget is exhausted, or on a definitive revocation response from the identity provider — the application SHALL notify the client that re-authentication is required and SHALL terminate that connection once a defined grace period of approximately 30 seconds elapses, giving the client that long to begin re-authenticating before server-side cleanup.

**Corrected during Design-stage review (responds to Engineer/Security findings on Decision D4):** re-authentication in this application is a full top-level page navigation, which tears down the WebSocket connection itself before the identity provider is even reached. The grace period is therefore a server-side hygiene bound on the *original* connection, not a window in which that same connection can be kept open by a successful re-auth — the original connection is always closed once the grace period elapses (in practice, usually torn down even earlier by the client's own navigation). A client that successfully re-authenticates does not resume the original connection; it establishes a new one, under its new session, which is registered as an ordinary connect. This new connection is what "the participant regains access" means under this design — see the diagnostic-trace requirement below for how a resulting reconnect is correlated for facilitator visibility, without implying the original connection ever stayed open.

#### Scenario: Silent refresh succeeds and the connection continues uninterrupted

- **WHEN** an active WebSocket connection's underlying token is within the refresh threshold of expiry
- **THEN** the application refreshes the token using the same refresh logic the HTTP session path uses
- **AND** the new token is persisted to the connection's session record
- **AND** the WebSocket connection remains open with no message sent to the client and no interruption

#### Scenario: Silent refresh fails, the client is notified, and the original connection is closed once the grace period elapses

- **WHEN** silent refresh for an active connection exhausts its retry budget, or receives a definitive revocation response from the identity provider
- **THEN** the application sends the client an explicit re-authentication-required signal
- **AND** starts a grace period of approximately 30 seconds
- **AND** the original connection is closed once the grace period elapses, regardless of whether the client has by then begun re-authenticating — the connection is not resumed in place
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

### Requirement: Revocation closes and re-authentication signals are never conflated

The application SHALL implement the periodic re-authorization close (SEC-25) and the token-refresh re-authentication-required signal (SEC-26) as disjoint code paths that do not share a single signal-sending function parameterized by cause. A connection closed due to a SEC-25 revocation determination SHALL NOT receive any SEC-26 re-authentication signal, and a SEC-26 grace-period notification SHALL NOT be observable as, or convertible into, a disclosure of another user's revocation.

#### Scenario: A SEC-25 revocation close carries no SEC-26 signal

- **WHEN** a connection is closed because the periodic sweep determined the user's access was revoked
- **THEN** the client receives `STALE_SIGNAL_CLOSE_CODE` and nothing else
- **AND** no SEC-26 re-authentication-required signal is sent, sent-then-withdrawn, or otherwise observable on this connection

### Requirement: In-flight participant state survives both mechanisms

Neither the periodic re-authorization sweep (in its non-revocation outcome) nor a silent token refresh SHALL cause the loss of a participant's composed-but-unsubmitted vote, or force the participant to re-enter it.

#### Scenario: A composed but unsubmitted vote survives a silent refresh

- **WHEN** a participant has composed but not submitted a vote for the active topic
- **AND** a silent token refresh completes on their connection
- **THEN** the composed vote value is unchanged and available for submission
- **AND** the participant is not prompted to re-enter it

#### Scenario: A composed but unsubmitted vote survives a non-revocation sweep cycle

- **WHEN** a participant has composed but not submitted a vote for the active topic
- **AND** a periodic re-authorization sweep runs against their connection and passes
- **THEN** the composed vote value is unchanged and available for submission

### Requirement: Facilitator-visible diagnostic trace for a resolved token-refresh grace-period recovery

**Scope corrected during Design-stage review (responds to Security Analyst Finding 2 — the original text below claimed a three-way non-disclosure signal design.md does not build):** re-authentication in this application is a full top-level page navigation, which tears down any open WebSocket connection before the identity provider is even reached — there is no "same connection" to resume in place. Recovery is therefore always a fresh connection under a new session, correlated to the grace period it followed via a short-lived, single-use Redis marker (design.md Decision D4). This mechanism can only ever fire for a resolved SEC-26 grace-period recovery — a SEC-25 non-revocation sweep pass never closes a connection (nothing to recover from), a SEC-25 revocation close does not produce a legitimate reconnect (the user is no longer authorized), and an ordinary network drop is not a SEC-25/SEC-26 mechanism this capability owns or can distinguish from any other disconnect.

When a new WebSocket connection registers and a live grace-period correlation marker exists for that user, the application SHALL record a generic diagnostic signal that a token-refresh recovery occurred, reaching facilitator-visible session history, without disclosing whether the underlying token failure was a definitive revocation or a transient/exhausted-retry failure.

#### Scenario: A resolved grace-period recovery is recorded without disclosing the underlying failure cause

- **WHEN** a participant's connection is closed following a SEC-26 grace-period expiry, and a new connection for the same user registers while that grace period's correlation marker is still live
- **THEN** a generic reconnect-occurred signal (`session.connection_recovered`) is recorded in facilitator-visible session history
- **AND** the signal does not indicate whether the prior refresh failure was a definitive revocation or a transient/retry-exhausted failure

#### Scenario: An ordinary network drop or a SEC-25 sweep pass produces no such signal

- **WHEN** a participant's connection drops for a reason other than a resolved SEC-26 grace-period recovery — an ordinary network interruption, or a SEC-25 sweep finding the connection still authorized
- **THEN** no `session.connection_recovered` signal is recorded for that reconnect

#### Scenario: The facilitator's readiness grid shows one uniform treatment regardless of cause

- **WHEN** a participant's connection leaves the registry for any of the three possible causes (sweep revocation, refresh grace-period expiry, ordinary drop)
- **THEN** the facilitator's readiness grid renders the same visual treatment for "this participant's connection is no longer live" in every case
- **AND** no visual or data element on the grid distinguishes which cause occurred
