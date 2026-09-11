# websocket-specification

## Purpose

The connective document issue #24 was always supposed to produce: one place with the full WebSocket event catalog (corrected event names, matching shipped code), the connection lifecycle end to end, envelope/wire-frame shapes, error/close-code handling, the FR-4.6.1 `serverTimestamp` requirement and its client-side latency computation, the five named ritual-integrity invariants, and the facilitator/participant visible-behavior requirements for connection health and recovery.

This spec assembles from and points into five existing specs rather than re-deriving their mechanics: `websocket-session-authorization` (delivery-time authorization, content-access events), `websocket-connection-reauthorization` (periodic re-authorization, silent token refresh, the 90-minute absolute lifetime, audit-log rows), `websocket-staleness-signal` (client-side connection-health state machine and its rendered treatment), `vote-compose-recovery` (session registration snapshot, vote-draft restore), and `session-topic-lifecycle` (session/topic phase transitions).

This spec does NOT cover: authorization mechanics, idle re-auth/token refresh, client connection-health rendering, vote draft persistence, or session/topic phase-transition logic — all owned by the five specs above and cited, not redefined, here.

**Production trigger status:** the event catalog reflects shipped production code as of this spec's introduction. `serverTimestamp` on `vote_revealed` is implemented and tested, including a cross-pod case, closing a compliance gap against FR-4.6.1 that existed in the shipped payload prior to this change. `participant.joined`/`participant.left` (FR-2.5, `[PREF]`) and a live, pre-finalization `actionitem.updated` broadcast (FR-3.3, `[PREF]`) are documented future-state entries only — **NOT IMPLEMENTED**, tracked in issue #94 and issue #95 respectively, implementation unscheduled.

---

## Event Registry

This table is the authoritative, exhaustive list of every WebSocket event this application sends to a client, checked automatically against `WsClientMessage` (`packages/shared/src/types/realtime.ts`) by `packages/shared/src/__tests__/websocket-spec-conformance.test.ts`. Every event in that union SHALL have a row here marked Implemented, and no row marked Implemented SHALL be absent from that union — this is the anchor the automated check reads, so an entry added or removed here without a matching code change (or vice versa) fails CI. The narrative catalog below (prior-name corrections, requirements, scenarios) explains and cross-references these same events; this table exists so a machine doesn't have to parse that prose to verify it.

| Event | Status |
|---|---|
| `vote_readiness_update` | Implemented |
| `session_state_change` | Implemented |
| `vote_revealed` | Implemented |
| `reauth_required` | Implemented |
| `topic_history_update` | Implemented |
| `session_registration_snapshot` | Implemented |
| `participant.joined` / `participant.left` | NOT IMPLEMENTED — tracked in issue #94 |
| `actionitem.updated` (live, pre-finalization case) | NOT IMPLEMENTED — tracked in issue #95 |

`actionitem.created` (see the corrected-names table below) is deliberately excluded from this registry: no FR names it directly, per design.md's original scoping decision, so it is not carried forward as a tracked future-state entry — it remains only as a historical note that the old dot-notation name maps to no event.

---

## Requirements

### Requirement: The event catalog states corrected, shipped event names and supersedes prior dot-notation naming

The application's WebSocket message catalog SHALL be documented using the event names and mechanisms actually implemented in production, not the dot-notation names used in issue #24, `todo.md`, or `requirements/design/REST API Contract.md` Appendix D prior to this change's correction. Any document referencing the old names SHALL be understood to mean the corresponding real mechanism listed below.

| Prior name | Real mechanism | Status |
|---|---|---|
| `reveal.trigger` | REST `POST /api/v1/teams/:teamId/sessions/:sessionId/reveal` performs the state-transition write; WebSocket `vote_revealed` is published to all session subscribers only after that transaction commits | Implemented |
| `vote.submit` | REST `POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in`; no WebSocket trigger | Implemented |
| `vote.locked` | `vote_readiness_update`, delivered to the facilitator only, identity + readiness status, never the vote value | Implemented |
| `session.revealed` | Folded into `vote_revealed` | Implemented |
| `topic.advance` (trigger) | REST `POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance` (`SESSION-012`) | Implemented |
| `topic.advanced` (broadcast) | `topic_history_update`, team-scoped (not session-scoped) | Implemented |
| `participant.joined` / `participant.left` | No event exists | NOT IMPLEMENTED |
| `actionitem.created` | No event exists | NOT IMPLEMENTED |
| `actionitem.updated` | Partially subsumed by `topic_history_update`'s `action_item_finalized` updateType (wrap-up finalization only); the pre-finalization live-broadcast case does not exist | NOT IMPLEMENTED (live case only) |

#### Scenario: A reader tracing `reveal.trigger` from a prior document reaches the real mechanism

- **WHEN** a reader encounters `reveal.trigger` in `todo.md`, issue #24, or unrevised prose elsewhere
- **THEN** they can resolve it to the REST reveal endpoint plus the post-commit `vote_revealed` WebSocket broadcast via this catalog, without needing to ask the author

#### Scenario: The catalog does not silently reassert an old name as current

- **WHEN** the catalog lists `vote.locked`, `session.revealed`, or `topic.advance`/`topic.advanced`
- **THEN** each entry states both the prior name and the real, currently-implemented mechanism, and does not present the prior name as itself still in use

---

### Requirement: The catalog documents `session_state_change`, the session-status-transition broadcast

The application's WebSocket message catalog SHALL document `session_state_change` as **Implemented**. It is published to session subscribers after each committed session-status transition (`draft`→`lobby`, `lobby`→`pre_session`, `pre_session`→`active`, `active`→`wrap_up`/`complete`), carrying `sessionId`, `teamId`, `previousStatus`, `newStatus`, and `changedAt`. This event had no prior dot-notation name in Appendix D and was absent from this document's catalog at introduction, despite this document's Purpose promising the full event inventory. Ownership of the underlying phase-transition logic that triggers each publish belongs to `session-topic-lifecycle` (per this document's Non-Goals) — this entry documents only the wire-level event itself.

#### Scenario: A reader consults the catalog for the session-status-transition event

- **WHEN** a reader looks for the WebSocket event fired on any session-status transition
- **THEN** they find `session_state_change` listed as Implemented, with its payload fields, and the underlying phase-transition logic correctly attributed to `session-topic-lifecycle` rather than redefined here

---

### Requirement: The `vote_revealed` event carries a server-generated timestamp satisfying FR-4.6.1

The `vote_revealed` WebSocket message SHALL include a `serverTimestamp` field (ISO 8601, UTC) alongside its existing `payload`. This field SHALL be captured exactly once per reveal, at publish time — before the event's trigger payload is published for delivery to any backend pod — and the identical value SHALL be included in every recipient's copy of the event for that reveal, regardless of which backend pod holds that recipient's connection. A dispatch-time or per-pod capture point does not satisfy this requirement, because it produces an identical value only within one pod's local candidates, not across pods.

Concretely, as shipped: `VoteRevealedTriggerPayload` (the Redis envelope payload, `packages/shared/src/types/realtime.ts`) carries `serverTimestamp`, stamped once by the reveal endpoint (`packages/backend/src/routes/facilitator-sessions.ts`, `POST .../reveal`) after its transaction commits, at the same publish-after-commit call site that invokes `publishVoteRevealed`. Every pod's `dispatchVoteRevealed` (`packages/backend/src/realtime/ws-event-dispatcher.ts`) reads `envelope.payload.serverTimestamp` off the single published envelope and forwards that one value, unmodified, into every local recipient's `vote_revealed` `WsClientMessage` — it does not generate a fresh timestamp itself. An earlier draft of this decision (design.md Decision D2) called for capture inside `dispatchVoteRevealed`, before its `Promise.all` fan-out; that was corrected on design-stage review because `dispatchVoteRevealed` runs once per pod, independently, and per-pod capture produces a different value per pod under the multi-pod topology this system runs in production. The corrected, shipped placement is publish-time capture, not dispatch-time.

#### Scenario: Every recipient of one reveal receives an identical serverTimestamp, including across backend pods

- **WHEN** a facilitator triggers a reveal for topic T with N connected, authorized subscribers, distributed across more than one backend pod
- **THEN** all N delivered `vote_revealed` messages carry the same `serverTimestamp` value
- **AND** that value does not vary based on the order in which each recipient's authorization or payload construction completed, nor based on which pod holds that recipient's connection or when that pod's event-dispatch handler fired

#### Scenario: serverTimestamp reflects the moment the server decided to reveal, not per-connection or per-pod processing time

- **WHEN** authorization evaluation or payload serialization takes measurably longer for one candidate connection than another during the same reveal's fan-out, or one backend pod's dispatch handler fires measurably later than another's
- **THEN** the `serverTimestamp` delivered to every connection, on every pod, is unaffected by either difference

---

### Requirement: Clients compute and log observed reveal delivery latency against the 15-second SLA

Upon receiving a `vote_revealed` message, the client SHALL compute `observed_latency = received_at − serverTimestamp` (both wall-clock, UTC) and log the result. This computed value SHALL be surfaced to system monitoring, via a destination access-controlled at least as tightly as the application's other session-tagged operational logs — this metric is necessarily tagged with `sessionId` to be useful, and is therefore session-timing metadata even though it carries no vote content.

As shipped: the frontend module `packages/frontend/src/realtime/voteRevealedLatency.ts` attaches a listener to the WebSocket connection `useConnectionHealth` returns (via `addEventListener`, layering on top of that connection rather than opening a second one). On each `vote_revealed` message it computes `observed_latency_ms = Date.now() - Date.parse(serverTimestamp)`, logs it via `console.info`, and reports it (best-effort, never throwing) to `POST /api/v1/sessions/:sessionId/reveal-latency` with `{ serverTimestamp, observedLatencyMs }`. That endpoint (`packages/backend/src/routes/sessions.ts`) reuses `evaluateSessionSubscriberAccess` unmodified for authorization — the same grant check `vote_revealed` delivery itself requires — and logs the observation via `emitAuditEvent` under `session.reveal_latency_observed`, the same structured-log pipe (Fastify's audit-level child logger) as this application's other session-tagged operational logs (e.g. `session.access_revoked_live`). No new monitoring infrastructure or destination is introduced; access-control parity with session-tagged audit logs is satisfied by construction (same pipe), confirmed at implementation review rather than assumed.

Whether an SLA violation (`observed_latency` exceeding 15 seconds) produces any facilitator-visible or session-history-visible consequence beyond system monitoring is explicitly out of scope for this requirement — see the corresponding open question in this change's design.md, addressed jointly to the BA and facilitator SME and not yet decided.

**Known gaps, confirmed non-blocking and NOT closed by this change (per implementation review, Security):**
- `observedLatencyMs` has no upper-bound validation — the endpoint accepts any finite number, including values many orders of magnitude past the 15-second SLA window this metric exists to measure. A legitimate session participant could script repeated calls with fabricated values to pollute the metric stream; this cannot escalate privilege or disclose another session's data. Recommended as a cheap signal-quality improvement, explicitly not gated as a security control, and not implemented as part of this change.
- The `POST /api/v1/sessions/:sessionId/reveal-latency` endpoint has not been added to `requirements/design/REST API Contract.md`. The endpoint's behavior was reviewed and found correct; its absence from the contract document is a documentation-completeness gap, not a behavioral one, flagged for a future architect/BA pass rather than closed here.

#### Scenario: A client logs observed latency on every reveal

- **WHEN** a client's WebSocket connection receives a `vote_revealed` message
- **THEN** the client computes `observed_latency` from `serverTimestamp` and its own receipt time
- **AND** the computed value is logged and reported to `POST /api/v1/sessions/:sessionId/reveal-latency`, which records it via the `session.reveal_latency_observed` audit-log pipe

#### Scenario: An SLA violation is detectable in monitoring without requiring facilitator action

- **WHEN** `observed_latency` for some recipient exceeds 15 seconds
- **THEN** that fact is discoverable through system monitoring
- **AND** no requirement in this document obligates any change to what the facilitator or that session's participants see as a result

**Related, unmet requirement in a sibling spec (named, owned, and gated — not merely documented):** `websocket-session-authorization` separately requires ("Cross-recipient delivery skew is bounded for simultaneous fan-out events") that the delivery-time skew across all recipients of the same `vote_revealed` fan-out — the delta between the first-delivered and last-delivered timestamps — be measured under realistic concurrent-session load and checked against a documented budget. That measurement (Group 6 of the archived `2026-09-07-websocket-delivery-time-authorization` change, tasks 6.1–6.7) was never performed and is marked DEFERRED; no skew budget has been set. This is a second, complementary, server-side measurement obligation, distinct from this requirement's client-side `observed_latency` computation. **Owner: Marcus Oyelaran (FSE)** — the Group 6 measurement work is now tracked in issue #92. **Mitigating factor, not a substitute control:** this requirement's `observed_latency` computation gives the system a partial, indirect detection capability it didn't have before — it doesn't measure cross-recipient skew directly, but if skew were large in practice it would very likely show up as increased variance in `observed_latency` across recipients of the same reveal, in the monitoring data this change already produces. That is not a substitute for the formal measurement-against-a-budget this sibling requirement demands — no budget exists to check variance against.

---

### Requirement: No pre-reveal vote value leak, anywhere in the message catalog

No WebSocket event in this catalog SHALL disclose any participant's vote value before that value's topic reaches `reveal_status = 'revealed'` (FR-4.6, FR-4.7). This is a single, catalog-wide invariant checkable against every event listed in this document, not a property that must be independently reconstructed from each event's own definition.

#### Scenario: The full catalog is checked against the invariant in one pass

- **WHEN** every event in this document's catalog is reviewed against this requirement
- **THEN** `vote_readiness_update` is confirmed to carry identity and readiness only, never a vote value (per its own structural exclusion)
- **AND** `vote_revealed` is confirmed to include vote values only for topics whose `reveal_status = 'revealed'`
- **AND** no other cataloged event carries vote-value content at all

---

### Requirement: Reconnection does not create a side door around the pre-reveal restriction

No message delivered to a reconnecting or newly-registering client SHALL disclose another participant's vote value or lock-in status before that topic's reveal (FR-4.6, FR-4.7). This includes `session_registration_snapshot`, which SHALL disclose only the connecting participant's own lock-in status.

#### Scenario: A registration snapshot discloses only the connecting participant's own state

- **WHEN** another participant has locked in a vote for the current topic and the connecting participant has not
- **THEN** the connecting participant's `session_registration_snapshot` reflects only their own `hasLockedInVote` status
- **AND** contains no other participant's vote value, lock-in status, or identity

---

### Requirement: The facilitator's elevated visibility cannot see vote values pre-reveal

The facilitator's authorization grant, though broader than a participant's for other content, SHALL NOT extend to seeing any vote value before that topic's reveal (FR-4.6, FR-4.7). `VoteReadinessUpdatePayload`'s structural exclusion of vote value applies identically regardless of recipient role.

#### Scenario: A facilitator's readiness-grid update never contains a vote value

- **WHEN** a participant locks in their vote and the facilitator's connection receives the corresponding `vote_readiness_update`
- **THEN** the payload contains the participant's identity and readiness status only
- **AND** contains no vote value, regardless of the facilitator's elevated access level for other content

---

### Requirement: Connection lifecycle is a fixed sequence of independently-owned checks

An open WebSocket connection's authorization SHALL pass through, in order: a connection-time check (before the WebSocket upgrade completes), registration (grant evaluation via `evaluateSessionSubscriberAccess` or `evaluateTeamAccess`), and delivery-time authorization on every content-access event thereafter. None of these three checks SHALL be treated as a substitute for either of the others. A registered connection remains subject to periodic re-authorization no less often than every 5 minutes and to silent token refresh up to the connection's 90-minute absolute lifetime.

#### Scenario: A connection-time pass does not exempt a later delivery-time check

- **WHEN** a connection passes its connection-time check and later attempts to receive a content-access event
- **THEN** delivery-time authorization is still independently evaluated for that event
- **AND** a revocation that occurred after connection-time but before delivery is enforced

#### Scenario: An idle, unrevoked connection remains open across the full lifecycle

- **WHEN** a connection is registered, receives no events, and its authorization remains valid
- **THEN** it survives periodic re-authorization sweeps and silent token refresh up to the 90-minute absolute lifetime without being closed

---

### Requirement: Server-initiated connection closes follow the established disclosure rules

Every server-initiated close of a WebSocket connection in this catalog SHALL use either `STALE_SIGNAL_CLOSE_CODE` (disclosure-blind: unauthorized subscription, periodic-sweep revocation, or absolute-lifetime force-close) or `REAUTH_GRACE_EXPIRED_CLOSE_CODE` (disclosed: SEC-26 grace-period expiry following an in-band `reauth_required` message). No third, undocumented close code SHALL be introduced by any event in this catalog.

#### Scenario: A revocation-triggered close and an absolute-lifetime close are indistinguishable to the client

- **WHEN** a connection is closed because its authorization was revoked, or because it reached the 90-minute absolute lifetime
- **THEN** both closes use `STALE_SIGNAL_CLOSE_CODE`
- **AND** the client cannot determine which reason applies from the close code alone

**Related audit-log surface (named, not redefined by this change):** three lifecycle events in this catalog are additionally recorded as `audit_log` rows, not merely structured logs, per `websocket-connection-reauthorization`, because each is security-relevant in its own right:

| Lifecycle event | `audit_log` row |
|---|---|
| Periodic re-authorization sweep finds a revoked grant | `session.access_revoked_live` |
| Silent token refresh exhausts its retry budget or receives a definitive revocation response | `session.token_refresh_failed_live` |
| A connection reconnects and recovers session state | `session.connection_recovered` |

---

### Requirement: Connection-health state is a facilitator-visible signal distinct from vote-readiness

The facilitator's readiness grid SHALL render a participant's connection-health state (as produced by the client-side connection-health state machine) as a signal distinct from, and not collapsible into, that participant's vote-readiness state ("voted" / "not yet voted"). A silently-stale connection SHALL NOT be visually indistinguishable from a participant who is still deliberating.

#### Scenario: A stale participant is distinguishable from a deliberating one

- **WHEN** a participant's connection becomes stale mid-vote
- **THEN** the facilitator's readiness grid renders a connection-health marker distinct from the "not yet voted" state
- **AND** the facilitator is not required to infer connection trouble solely from the absence of a vote

#### Scenario: The connection-health marker does not disclose vote readiness or value

- **WHEN** the connection-health marker is rendered for a participant
- **THEN** it conveys connection state only, and does not itself disclose whether that participant has locked in a vote or what its value is

---

### Requirement: Each connection-recovery mechanism has a stated visible-behavior answer

For each of the three recovery mechanisms in this catalog, the visible behavior during recovery SHALL be documented, not left to be inferred from mechanics-only descriptions:
- **Staleness signal**: renders the existing participant banner and facilitator grid marker; reads as informational, not alarming.
- **Silent token refresh (successful)**: produces no visible state change of any kind.
- **Forced re-authentication (grace-period expiry)**: is visible by necessity — a full top-level re-login — using the existing generic `reauth-required` rendered treatment.
- **Vote-compose-recovery**: a restored draft reappears without requiring the participant to notice or re-enter it, resolving before the compose control's first paint, with no visible or facilitator-visible trace of the restore having occurred.

#### Scenario: A successful silent refresh produces no visible change

- **WHEN** a WebSocket connection's underlying authentication is silently refreshed
- **THEN** no banner, indicator, or state change is visible to the participant or facilitator as a result

#### Scenario: A restored vote draft reappears without a visible restoration event

- **WHEN** a participant's composed-but-unsubmitted vote is restored after a page reload
- **THEN** the draft appears in the compose control before its first paint
- **AND** no spinner, flash, toast, or facilitator-visible trace indicates that a restoration occurred

---

### Requirement: Connection and error states follow a non-spotlight rendering principle

Connection and error states in this catalog SHALL be rendered as recoverable and low-drama by default: informative rather than performative, and SHALL NOT visually prescribe a specific facilitation response or amplify discomfort for the affected participant. This extends the same principle OR-2.4 already establishes for statistical outlier flagging to connection and error UX generally.

#### Scenario: A dropped connection mid-topic does not become a room-facing spectacle

- **WHEN** a participant's WebSocket connection drops mid-topic
- **THEN** the resulting UI communicates the disruption without a visual treatment that draws the room's collective attention to that one participant

**Out of scope:** connection/error UX during a team's first session is not being re-litigated by this change. If first-session connection/error experience needs dedicated attention, that is a future onboarding-experience change, not an extension of this one.

---

### Requirement: `participant.joined`/`participant.left` and live `actionitem.updated` are documented future-state entries, not silently omitted

The catalog SHALL document `participant.joined` (FR-2.5, `[PREF]`) and `participant.left` (FR-2.5, `[PREF]`) as normative future-state entries, marked **NOT IMPLEMENTED** and tracked in issue #94, and a live `actionitem.updated` broadcast for pre-finalization status changes (FR-3.3, `[PREF]`) marked **NOT IMPLEMENTED** and tracked in issue #95, implementation unscheduled. These events SHALL NOT be built as part of this change.

#### Scenario: A reader checking FR-2.5's real-time lobby list finds a documented gap, not silence

- **WHEN** a reader consults this catalog for the WebSocket event backing FR-2.5's real-time participant list
- **THEN** they find `participant.joined`/`participant.left` listed as NOT IMPLEMENTED, tied to FR-2.5, with a pointer to tracking issue #94

#### Scenario: A reader checking FR-3.3's live status-update requirement finds the same treatment

- **WHEN** a reader consults this catalog for the WebSocket event backing FR-3.3's live pre-session status-update requirement
- **THEN** they find live `actionitem.updated` (the pre-finalization case) listed as NOT IMPLEMENTED, tied to FR-3.3, with a pointer to tracking issue #95, distinguished from the already-implemented wrap-up finalization case (`topic_history_update`'s `action_item_finalized`)
