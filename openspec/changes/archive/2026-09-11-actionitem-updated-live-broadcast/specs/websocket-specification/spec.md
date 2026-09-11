## MODIFIED Requirements

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
| `participant.joined` / `participant.left` | `participant_joined` / `participant_left`, delivered to the facilitator only, identity + timestamp, session-scoped, triggered by WebSocket connect/disconnect (not `session_participants` DB membership) | Implemented |
| `actionitem.created` | No event exists | NOT IMPLEMENTED |
| `actionitem.updated` | Wrap-up finalization case: subsumed by `topic_history_update`'s `action_item_finalized` updateType (unchanged by this entry). Live, pre-finalization case: `action_item_status_updated`, session-scoped, delivered to any valid session subscriber, gated to `pre_session` status | Implemented |

#### Scenario: A reader tracing `reveal.trigger` from a prior document reaches the real mechanism

- **WHEN** a reader encounters `reveal.trigger` in `todo.md`, issue #24, or unrevised prose elsewhere
- **THEN** they can resolve it to the REST reveal endpoint plus the post-commit `vote_revealed` WebSocket broadcast via this catalog, without needing to ask the author

#### Scenario: The catalog does not silently reassert an old name as current

- **WHEN** the catalog lists `vote.locked`, `session.revealed`, or `topic.advance`/`topic.advanced`
- **THEN** each entry states both the prior name and the real, currently-implemented mechanism, and does not present the prior name as itself still in use

#### Scenario: A reader tracing `actionitem.updated` finds both cases distinguished, neither silently conflated with the other

- **WHEN** a reader encounters `actionitem.updated` in prior documents or issue #24
- **THEN** they find two distinct real mechanisms — the wrap-up finalization case (`topic_history_update`'s `action_item_finalized`) and the live pre-finalization case (`action_item_status_updated`) — and neither is presented as subsuming the other

---

## REMOVED Requirements

### Requirement: Live `actionitem.updated` is a documented future-state entry, not silently omitted

**Reason**: FR-3.3's live, pre-finalization `actionitem.updated` broadcast is implemented by this change (issues #64 + #95, combined). The event is no longer a future-state-only catalog entry, so a Requirement asserting that its absence is documented rather than silent no longer describes current behavior.

**Migration**: See the new Requirement "The catalog documents live `actionitem.updated`, the pre-session status-change broadcast" below, and the Event Registry table row for `actionitem.updated` (live case), updated directly in the living spec's top-of-file table as part of this change's implementation tasks (the delta-spec format used here does not model that standalone table; it is maintained by hand alongside the Requirement content, consistent with how prior changes to this same document have handled it).

---

## ADDED Requirements

### Requirement: The catalog documents live `actionitem.updated`, the pre-session status-change broadcast

The application's WebSocket message catalog SHALL document the live, pre-finalization `actionitem.updated` broadcast (FR-3.3, `[PREF]`) as **Implemented** (GitHub issues #64 + #95, combined). It is delivered as `action_item_status_updated` to every session subscriber holding a valid grant — participant or facilitator — for the session currently in `pre_session` status that is reviewing the team's action item backlog. Unlike `participant_joined`/`participant_left`, delivery is **not** restricted to the facilitator's connection alone — it matches `session_state_change`'s recipient breadth, because FR-3.3's own text is "visible to all session participants." The payload carries `sessionId`, `actionItemId`, `previousStatus`, `newStatus`, and `updatedAt` (ISO 8601) — matching `SessionStateChangePayload`'s previous/new shape — and does not carry `resolution_note` or `resolvedInSessionId`, consistent with this catalog's existing payload-minimalism convention (`VoteReadinessUpdatePayload`, `ParticipantJoinedPayload`): both are durable-record fields meaningful to the REST caller and to a later re-fetch (per `VOTE-002`'s response shape), not needed by another connection to render a live "this item changed" signal. This event is distinct from, and SHALL NOT be folded into, `topic_history_update`'s existing `action_item_finalized` updateType, which covers only wrap-up finalization — a separate case, unchanged by this Requirement.

Delivery is gated to sessions in `pre_session` status. A status change made with no session currently in live pre-session review for that team, or made after the reviewing session has left `pre_session`, publishes no broadcast — the underlying status mutation still succeeds (see `action-item-status-management`'s requirements); only the broadcast is conditional. How the triggering mutation resolves which session's channel to publish to is resolved in this change's design.md ("Open Questions — Resolved" §2, Decision D11): an optional `sessionId` request-body field on the triggering PATCH, validated against the item's team.

**Resolved (design.md Decision D14, per engineering review finding on dispatcher data availability and security review finding F5):** gating is not publish-time-only. The triggering mutation stamps the session's status onto the internal publish envelope at publish time; the dispatcher uses that value as an initial gate, and — when it indicates `pre_session` — performs one additional live read of the session's current status immediately before delivery, closing the race window between a broadcast being published and a session leaving `pre_session` in the interim.

#### Scenario: Session participants see another participant's status change live during pre-session review

- **WHEN** an action item's status is changed by its owner or an authorized facilitator while the session reviewing it is in `pre_session` status
- **THEN** every session subscriber holding a valid participant or facilitator grant for that session receives an `action_item_status_updated` message carrying `previousStatus` and `newStatus`
- **AND** no other session's subscribers receive it

#### Scenario: A status change made outside any live pre-session review publishes no broadcast

- **WHEN** an action item's status is changed and no session for that team is currently in `pre_session` status reviewing it
- **THEN** the status mutation succeeds
- **AND** no `action_item_status_updated` message is published, because no session-scoped channel is in play

#### Scenario: A same-status no-op does not publish a broadcast

- **WHEN** a status update is accepted as a same-status no-op (per `action-item-status-management`'s no-op requirement)
- **THEN** no `action_item_status_updated` message is published, since no state observable to another participant changed

#### Scenario: A session that leaves pre_session between publish and delivery receives no delivery

- **WHEN** an action item's status is changed while the reviewing session is in `pre_session`, and that session transitions out of `pre_session` before the dispatcher completes delivery
- **THEN** no session subscriber receives the `action_item_status_updated` message, even though the triggering mutation's publish-time status check passed

#### Scenario: The event is distinguished from the wrap-up finalization case

- **WHEN** a reader consults the catalog for live pre-finalization action-item status changes
- **THEN** they find `action_item_status_updated` documented as the mechanism, explicitly distinguished from `topic_history_update`'s `action_item_finalized` updateType (wrap-up only)
