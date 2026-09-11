## ADDED Requirements

### Requirement: Client-local persistence of a composed-but-unsubmitted vote draft

The application SHALL persist a participant's composed-but-unsubmitted vote value to `sessionStorage`, keyed to the `(sessionId, sessionTopicId)` tuple it was composed under, on every compose-value change. The write SHALL NOT be conditional on detecting any specific cause (a SEC-26 recovery event or otherwise) — it fires on every change to the compose control's value regardless of why a later reload might occur. The persisted value SHALL NOT be transmitted to the backend by this mechanism, and this mechanism SHALL NOT introduce any new server-side or database-side store of vote content; the backend's existing SEC-26 recovery marker remains a content-free, single-use flag.

#### Scenario: A compose-value change is persisted client-locally

- **WHEN** a participant changes the value in the compose control for the current topic
- **THEN** the new value is written to `sessionStorage`, keyed to the current `(sessionId, sessionTopicId)`
- **AND** no network request is made as part of this write
- **AND** no backend or database state is created or modified by this write

#### Scenario: The persisted record never becomes a second source of submitted vote state

- **WHEN** a draft is persisted for a topic
- **AND** that topic's vote is later locked in through the normal submission path
- **THEN** the persisted `sessionStorage` record remains client-local and unsubmitted-only; the locked-in vote's own storage and transmission path is unaffected by, and independent of, this mechanism

---

### Requirement: Single-use restore on the tab's first WebSocket registration after page load

The application SHALL attempt to restore a persisted draft exactly once per page load: on the first WebSocket registration this tab performs after that load, and never again for subsequent reconnects within the same page load. An ordinary in-tab reconnect that does not involve a page reload SHALL NOT trigger a restore attempt. Whether the draft is restored or discarded, the stored entry SHALL be cleared at the end of that one attempt and SHALL NOT persist in `sessionStorage` for the remainder of the tab's life.

#### Scenario: The first registration after a page load attempts exactly one restore

- **WHEN** a tab performs its first WebSocket registration following a page load (whether triggered by a SEC-26 grace-period recovery or an ordinary manual refresh)
- **THEN** exactly one restore attempt is made against any persisted draft
- **AND** the persisted `sessionStorage` entry is cleared at the end of that attempt, regardless of whether the draft was restored or discarded

#### Scenario: A later in-tab reconnect within the same page load does not re-attempt a restore

- **WHEN** a tab's connection drops and reconnects without a page reload (e.g. an ordinary network blip)
- **THEN** no restore attempt is made on that reconnect
- **AND** no `sessionStorage` read for this mechanism occurs on that reconnect

---

### Requirement: Restoration is subordinate to server-authoritative state, in a fixed order

The application SHALL wait until the fresh connection's registration payload — including the server-authoritative current topic and this participant's own lock-in status for it — has been received before reading or applying any persisted draft. There SHALL NOT be a code path in which the `sessionStorage` read, or the application of its result to UI state, precedes receipt of that payload. If the registration payload indicates this participant already has a locked-in vote for the current topic, by any mechanism, the persisted draft SHALL be discarded and the UI SHALL reflect the server-reported locked-in state, never the draft value.

**The registration payload is a real capability this change delivers, not an external dependency.** The application SHALL send a `session_registration_snapshot` message directly to a session-scoped WebSocket connection (`GET /ws/sessions/:sessionId`) on every successful registration, carrying `{ sessionId, sessionStatus, currentTopic: { sessionTopicId, status } | null, hasLockedInVote }` (design.md Decision D3a). The payload SHALL be assembled from a live database read at send time — never cached or reused across sends — scoped so that `hasLockedInVote` reflects only the connecting participant's own lock-in status, never another participant's (design.md Decision D3d). The payload SHALL be sent only after `evaluateSessionSubscriberAccess` has already granted the connection access to the session; it composes with that existing access-control gate rather than performing a separate authorization check, and discloses no session or vote state beyond what that grant already permits. This requirement's ordering guarantee (no code path precedes receipt of the payload) is verifiable both at the contract level, using fixture data (design.md D7, unit tests in tasks.md Group 4), and at the integration level, against the real payload built in tasks.md Group 7 — once the compose UI exists to wire the two together (tasks.md task 8.1).

#### Scenario: Restore logic never runs before server-authoritative state arrives

- **WHEN** a fresh connection registers
- **THEN** the persisted-draft read does not occur, and no draft value is applied to UI state, until after the registration payload (current topic, this participant's lock-in status) has been received

#### Scenario: An existing server-reported lock-in always overrides a persisted draft

- **GIVEN** a persisted draft exists for the current `(sessionId, sessionTopicId)`
- **WHEN** the registration payload indicates this participant has already locked in a vote for that topic, via any mechanism (a stale second tab, a retry that actually succeeded, or otherwise)
- **THEN** the draft is discarded
- **AND** the UI reflects the server-reported locked-in state, never the draft value, regardless of which the local code would have computed first

#### Scenario: A successfully-registered session-scoped connection receives its registration snapshot

- **GIVEN** a client's WebSocket connection to `GET /ws/sessions/:sessionId` has been granted access by `evaluateSessionSubscriberAccess`
- **WHEN** the connection is registered
- **THEN** the server sends that connection a `session_registration_snapshot` message carrying the session's current status, its current topic (or `null` if none), and this participant's own `hasLockedInVote` for that topic, computed from a live database read
- **AND** this happens on every successful registration, not only the tab's first one

#### Scenario: A rejected connection receives no registration snapshot

- **WHEN** `evaluateSessionSubscriberAccess` does not grant a connection access to a session (e.g. the session has closed)
- **THEN** the connection is closed without ever receiving a `session_registration_snapshot` message
- **AND** no session or vote state for that session is disclosed to the rejected connection

#### Scenario: The registration snapshot discloses only the connecting participant's own lock-in status

- **GIVEN** another participant has locked in a vote for the current topic, and the connecting participant has not
- **WHEN** the connecting participant's connection receives its `session_registration_snapshot`
- **THEN** `hasLockedInVote` reflects only the connecting participant's own status (`false`)
- **AND** the payload contains no other participant's vote value, lock-in status, or identity

---

### Requirement: Discard conditions for a persisted draft are enumerated, not left as "anything else"

The application SHALL discard a persisted draft, silently and without applying it to UI state, when any of the following hold: (a) the server-authoritative current topic for the session differs from the draft's persisted `sessionTopicId`; (b) the current topic matches but its status is no longer `voting` (revealed or complete); (c) the session has transitioned to `wrap_up` and has no current topic; or (d) the `sessionId` no longer matches an active session for this participant. The application SHALL restore a persisted draft only when none of these conditions hold and the topic's status is `voting` (subject also to the lock-in precedence above).

Condition (d) is a defensive/race condition given the current WS access gate, not a normal-path branch like (a)–(c). `evaluateSessionSubscriberAccess` authorizes a session-scoped WS connection only while the session's status is `lobby`, `pre_session`, `active`, or `wrap_up`; a session that has already closed fails the connection outright, so a tab never reaches a successful registration to attempt a restore against in the first place. Condition (d) is reachable only in the gap between a successful connect and the restore attempt reading the registration payload — it is retained as an enumerated condition because the discard behavior it specifies is correct regardless of how rarely it fires, not because it is expected to occur in ordinary use.

#### Scenario: A draft is discarded when the topic has advanced

- **GIVEN** a persisted draft for `(sessionId, sessionTopicId=A)`
- **WHEN** the fresh connection's registration payload reports the session's current topic as `B`
- **THEN** the draft is discarded and not applied to UI state

#### Scenario: A draft is discarded when its topic is no longer accepting votes

- **GIVEN** a persisted draft for `(sessionId, sessionTopicId=A)`
- **WHEN** the registration payload reports the current topic as `A` but its status as `revealed` or `complete` rather than `voting`
- **THEN** the draft is discarded and not applied to UI state

#### Scenario: A draft is discarded when the session has moved to wrap_up

- **GIVEN** a persisted draft for `(sessionId, sessionTopicId=A)`
- **WHEN** the registration payload reports the session's status as `wrap_up` with no current topic
- **THEN** the draft is discarded and not applied to UI state

#### Scenario: A draft is discarded when the session no longer matches

- **GIVEN** a persisted draft for a given `sessionId`
- **WHEN** the registration payload indicates that `sessionId` is no longer an active session for this participant
- **THEN** the draft is discarded and not applied to UI state

#### Scenario: A draft is restored when the topic and status match and no lock-in exists

- **GIVEN** a persisted draft for `(sessionId, sessionTopicId=A)`
- **WHEN** the registration payload reports the current topic as `A`, its status as `voting`, and no existing lock-in for this participant on that topic
- **THEN** the draft's value is applied to the compose control's initial state

---

### Requirement: Restore-or-discard resolves before the compose control's first paint, with no visible or facilitator-visible trace

The restore-or-discard decision SHALL resolve before the compose control is first painted. The application SHALL NOT render a spinner state, a flash of the stale draft value before it is cleared, or any visible transition from a restored or discarded value to the control's resting state. The application SHALL NOT surface any toast, banner, sound, animation, or devtools-visible console message that distinguishes a restore from a discard from an ordinary empty compose control. The facilitator-visible readiness grid SHALL NOT gain a new state or a variant of an existing state to distinguish "disconnected, mid-recovery, with a draft queued" from any other disconnected state; a participant in this condition SHALL continue to read as one of the grid's existing four baseline states (`connected+not-locked-in`, `connected+locked-in`, `disconnected_voted`, `disconnected_no_vote`), unchanged by this mechanism.

#### Scenario: A restored draft appears with no visible transition

- **WHEN** a persisted draft is restored per the requirements above
- **THEN** the compose control's first paint already reflects the restored value
- **AND** no spinner, flash of an intermediate state, or animation is shown

#### Scenario: A discarded draft is indistinguishable from an empty compose control

- **WHEN** a persisted draft is discarded per the requirements above
- **THEN** the compose control's first paint shows the same empty/resting state as a participant who never composed anything
- **AND** no toast, banner, or console-visible message discloses that a draft existed or was discarded

#### Scenario: The facilitator's readiness grid gains no new state for this mechanism

- **WHEN** a participant is disconnected and reconnecting with a persisted draft pending restoration
- **THEN** the facilitator's readiness grid renders that participant's row as one of the four existing baseline states, exactly as it would for any other disconnected participant with the same lock-in status
- **AND** no grid marker, tooltip, color, or other signal distinguishes this case from an ordinary disconnect
