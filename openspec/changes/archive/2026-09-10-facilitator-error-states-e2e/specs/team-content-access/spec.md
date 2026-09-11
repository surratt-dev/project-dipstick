## MODIFIED Requirements

### Requirement: Live session error states for facilitators are distinct from general 403/404 responses

The application SHALL provide distinct, named error states for facilitators encountering access control failures during a live session. These error states MUST NOT inherit the general 403/404 error presentation. An authorization failure during a live session is a UX emergency: the facilitator is in a room with participants and cannot navigate away to investigate.

**Implementation note — full-stack E2E coverage (`facilitator-error-states-e2e`):** Error States 1 (both the recoverable and non-recoverable paths), 1a, 1b (backend contract only), 2, 3 (real-trigger case), and 4 have real full-stack test coverage — real Postgres, real Redis, no mocked `db.query` anywhere in the covering tests — run via the existing `integration` CI workflow with no new CI wiring required. Error State 3's coverage is asserted against its real production trigger: a real committed session-state transition (via the topic-advance wrap-up-entry branch or session completion) that publishes `session_state_change` and delivers it to a real subscriber over the actual Redis pub/sub channel, not a directly-invoked function call or a manually-published stand-in event. Error State 3's "system timeout" trigger variant is explicitly not covered by this test suite: no timeout-driven auto-transition mechanism exists anywhere in this codebase, so there is nothing to trigger. The frontend "Required display" behavior each state below describes remains open follow-up work, tracked under GitHub issue #38 — this coverage proves the backend/WebSocket contract these displays will consume, not the UI itself.

**Named error states:**

**Error State 1 — Authorization failure during vote reveal:**
- Trigger: The facilitator triggers the reveal and the backend authorization check fails (unexpected session status transition, server-side error, facilitator's session row not found).
- Required display: An inline error that distinguishes between:
  - *Recoverable:* "The reveal could not be completed. Your session is still active. Try again." — The panel remains visible; the facilitator can retry.
  - *Non-recoverable:* "This session is no longer in an active state. Please review the session status." — The facilitator knows to check session state before retrying.
- MUST NOT display: A generic error modal, a blank results panel, or technical details.

**Error State 1a — Reveal attempted on an already-revealed topic:**
- Trigger: The facilitator triggers reveal for a topic whose `session_topics.status` is already `revealed` (a duplicate click, a stale tab, a race with another reveal request for the same topic).
- Required display: The facilitator's screen renders **indistinguishably from a successful reveal** — the topic's revealed state is shown, using the `revealedAt` timestamp returned with the response. No error modal, toast, or banner implying something went wrong. The facilitator did nothing incorrect; the topic is, and remains, revealed.
- MUST NOT display: Any error chrome, or a message suggesting the reveal failed or must be retried.

**Error State 1b — Topic advance attempted before the current topic is revealed:**
- Trigger: The facilitator attempts to advance to the next topic (or into wrap-up) while the current topic's `session_topics.status` is still `voting`.
- Required display: A blocked-advance state that offers the reveal action directly, rather than requiring the facilitator to back out and locate the reveal control themselves. The response's `requiresReveal: true` field signals this to the client.
- MUST NOT display: A generic error modal, or a dead-end state with no actionable next step.

**Error State 2 — Historical data unavailable during active session:**
- Trigger: The facilitator is viewing historical trend data during the session and an authorization check fails or the data endpoint returns an error.
- Required display: An empty state labeled "Historical data is temporarily unavailable. Your session is still active." — This communicates a transient data issue, not an access denial.
- MUST NOT display: "You do not have access to this data." (This phrasing suggests a session problem and may cause the facilitator to end the session unnecessarily.)

**Error State 3 — Session status transition during live facilitation:**
- Trigger: The session status changes while the facilitator is mid-flow (system timeout, accidental state advance, WebSocket connection drop).
- Required display: A persistent non-blocking banner (not a modal) showing current session state and a clear action: "Session state has changed. [Current state]. Resume or review." The facilitator MUST be able to see the participant grid and topic state while the banner is displayed.
- MUST NOT display: A modal that blocks the screen or hides the session view.

**Error State 4 — Cross-team access denial during active session:**
- Trigger: A facilitator operating across multiple teams attempts to access Team A's history while in a session for Team B.
- Required display: "This data is not available in your current session." — The phrasing communicates a contextual constraint (current session scope) without revealing Team A's existence.
- MUST NOT display: "You do not have access to Team A's session history." (This reveals Team A's existence and that it has session data.)

#### Scenario: Facilitator sees recoverable error when reveal fails transiently

- **WHEN** the facilitator triggers the reveal
- **AND** the backend authorization check fails transiently
- **THEN** the facilitator view shows the recoverable error message
- **AND** the session panel remains visible and the session is still in an active state

#### Scenario: Facilitator sees the revealed state, not an error, on a duplicate reveal

- **WHEN** the facilitator triggers reveal for a topic that is already `revealed`
- **THEN** the facilitator view shows the topic's revealed state, using the `revealedAt` timestamp from the response
- **AND** no error modal, toast, or banner is displayed

#### Scenario: Facilitator can reveal directly from a blocked-advance state

- **WHEN** the facilitator attempts to advance past a topic that has not yet been revealed
- **THEN** the response is rejected with the `advance_blocked` error state and `requiresReveal: true`
- **AND** the facilitator view offers the reveal action directly from the blocked state, without requiring navigation to find it

#### Scenario: Facilitator sees non-blocking banner on unexpected session status change

- **WHEN** the session status changes unexpectedly while the facilitator is mid-flow
- **THEN** a persistent non-blocking banner appears above the session view
- **AND** the facilitator can still see the participant grid and topic state
- **AND** no modal blocks the screen

#### Scenario: Cross-team denial does not reveal other team's existence

- **WHEN** a facilitator in a session for Team B requests historical data for Team A
- **THEN** the response message does not mention Team A by name or confirm Team A has data
- **AND** the facilitator's Team B session is unaffected by the denial
