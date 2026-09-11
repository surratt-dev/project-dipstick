# action-item-status-management

## Purpose

Server-side authorization and state-transition rules for changing an `action_items.status` value: who may change a given item's status (owner or an actively-facilitating facilitator), which transitions are valid (FR-7.3's directed, non-reversible model), how a same-status no-op is handled, how a resolution note and its resolving session are captured, and the `action_item_history`/`audit_log` records every real transition produces. Implemented by `PATCH /api/v1/action-items/:actionItemId/status` (issues #64 + #65 + #95, combined; per the pre-existing `VOTE-002` contract in `requirements/design/REST API Contract.md`).

This spec does NOT cover the live WebSocket broadcast of these status changes during pre-session review — that's `websocket-specification`'s `action_item_status_updated` event — or any frontend rendering of the pre-session review screen (issue #69, separate and unscheduled).

---

## Requirements

### Requirement: An action item's owner can update its own item's status

The application SHALL provide a write path (`PATCH /api/v1/action-items/:actionItemId/status`, per the pre-existing `VOTE-002` contract in `requirements/design/REST API Contract.md`) allowing the authenticated user who is `action_items.owner_id` for the target item to change its status (FR-3.2, FR-7.3). Ownership SHALL be enforced server-side — a client-only affordance is not sufficient.

#### Scenario: An owner updates their own item's status

- **WHEN** the authenticated user is the `owner_id` of the target action item and requests a valid forward transition
- **THEN** the request succeeds, `action_items.status` is updated, and an `action_item_history` row is written

#### Scenario: A non-owner, non-facilitator team member is rejected with 403

- **WHEN** the authenticated user is a member of the target item's team, but is neither the item's `owner_id` nor authorized as a facilitator over it (per the following requirement)
- **THEN** the request is rejected with `403`, and `action_items.status` is unchanged

#### Scenario: A caller with no relationship to the item's team cannot distinguish it from a nonexistent item

- **WHEN** the authenticated user has no relationship at all to the target item's team — not a member, not the owner, not an authorized facilitator
- **THEN** the request is rejected with `404`, identical in response shape to a request against an `actionItemId` that does not exist at all

**Resolved (design.md Decision D12, per security review finding F2; relationship test corrected per Ingrid Sollenberger's task-review Finding 1):** this endpoint's URL (`PATCH /api/v1/action-items/:actionItemId/status`) carries no `teamId`, so authorization cannot be evaluated before the item is loaded. The item is loaded by ID alone first; if no row exists, or if a row exists but the caller has zero relationship to its team, the response is `404` in both cases — indistinguishable, so that no caller can learn whether a given `actionItemId` exists anywhere in the system without already having some legitimate standing on its team. "Relationship," for this boundary, is deliberately broader than the following requirement's write-authorization scope: it holds if the caller is the owner, if `evaluateTeamAccess` returns any non-null grant for the team (plain membership, Application Admin, or a facilitator within that helper's own broader grace windows), or if the caller has ever been the facilitator of any session for this team regardless of that session's current status. `403` is reserved for a caller who has some relationship by any of these measures (including, e.g., a facilitator outside the following requirement's narrower authorization window) but is neither owner nor a currently-authorized facilitator.

---

### Requirement: An authorized facilitator can update the status of any action item within their authorization scope

The application SHALL allow a facilitator to update the status of an action item they did not create, when that facilitator holds authorization over the item (FR-3.2's "facilitator-any-on-team"). **Resolved (design.md, "Open Questions — Resolved" §1, Decision D10):** authorization is scoped to any action item belonging to a team the facilitator is actively facilitating — a session for that team exists with `status IN ('lobby', 'pre_session', 'active', 'wrap_up')`. This is deliberately narrower than this codebase's general-purpose team-content-access check (`evaluateTeamAccess`), which additionally grants access during a `draft` session's 24-hour grace window and a `complete` session's post-close grace window — those windows are appropriate for read access to session content but SHALL NOT extend to this write endpoint's facilitator authorization. This SHALL be enforced server-side with the same rigor as owner enforcement, and a facilitator-made change SHALL record the acting facilitator, not the item's owner, as the actor.

#### Scenario: An authorized facilitator updates an item they do not own

- **WHEN** a facilitator with a session for the target item's team in `lobby`, `pre_session`, `active`, or `wrap_up` status requests a valid forward transition on an item they do not own
- **THEN** the request succeeds
- **AND** the resulting `action_item_history` row's `changed_by_user_id` identifies the facilitator, not the item's `owner_id`

#### Scenario: A facilitator outside the narrowed active-session window is rejected, even within evaluateTeamAccess's broader grace windows

- **WHEN** a facilitator's only relationship to the target item's team is a `draft` session still within its 24-hour grace window, or a `complete` session still within its `facilitator_access_expires_at` grace window
- **THEN** the request is rejected with `403`, even though this same facilitator would hold a valid grant for read-content endpoints via `evaluateTeamAccess`

#### Scenario: A user with some relationship to the team, but no ownership or facilitator authorization, is rejected with 403

**Corrected (Marcus Delgado's blocking Finding 1, `tasks-review-ba.md`):** this scenario's prior title asserted `403` applied "regardless of team membership" — the literal opposite of Decision D12, which exists specifically to make the response depend on the caller's relationship to the team. The zero-relationship case (`404`) is covered by the preceding requirement's own scenario ("A caller with no relationship to the item's team cannot distinguish it from a nonexistent item"); this scenario covers only the case where a relationship already exists.

- **WHEN** the authenticated user has *some* relationship to the target item's team — an ordinary member, an Application Admin, or a facilitator whose relationship to the team exists but falls outside this requirement's narrowed authorization window (see the preceding scenario) — and is neither the item's owner nor a currently-authorized facilitator, and requests a status change on an item they do not own
- **THEN** the request is rejected with `403`, per Decision D12's ordering: `403` is reserved for callers who already have some relationship to the item's team, distinct from the `404` a caller with zero relationship receives

---

### Requirement: Status transitions are directionally restricted and reject invalid targets

Status transitions SHALL follow FR-7.3's directed, non-reversible model: `Open → In Progress`, `Open → Resolved`, `In Progress → Resolved` are the only valid transitions. Backward transitions (`In Progress → Open`, `Resolved → anything`) SHALL be rejected. An action item whose current status is already `Resolved` SHALL NOT be a valid target for this endpoint at all — `Resolved` is terminal, not merely protected against backward movement. **Resolved (design.md, "Open Questions — Resolved" §3):** a rejected invalid-transition attempt SHALL return `409 Conflict`, matching the existing FR-7.1a precedent in this codebase for a state-invalid mutation.

#### Scenario: A backward transition is rejected

- **WHEN** a request attempts `In Progress → Open` (or any other backward transition)
- **THEN** the request is rejected, `action_items.status` is unchanged, no `action_item_history` row is written, and no live broadcast is published

#### Scenario: Any PATCH targeting an already-Resolved item is rejected

- **WHEN** a request targets an action item whose current `status` is already `Resolved`, regardless of the requested new status
- **THEN** the request is rejected, even if the requested new status is also `Resolved`

---

### Requirement: A same-status update is accepted as a no-op that resets the staleness clock without generating a history row or broadcast

A request whose target status equals the action item's current status SHALL be accepted as a no-op for any status other than `Resolved` (which is excluded entirely by the preceding requirement). A no-op SHALL update `action_items.updated_at` to the current time — resetting the read-time staleness computation described in the "Flag Stale Action Items" use case — but SHALL NOT write an `action_item_history` row and SHALL NOT publish a live broadcast, since no state observable to another participant has changed.

#### Scenario: An owner re-submits the item's current status

- **WHEN** an owner (or an authorized facilitator) submits a status equal to the item's current status, and that status is `Open` or `In Progress`
- **THEN** the request succeeds, `action_items.updated_at` is updated to the current time
- **AND** no `action_item_history` row is written and no live broadcast is published

#### Scenario: A same-status request against an already-Resolved item is not treated as a no-op

- **WHEN** a request submits `Resolved` as the target status for an item whose current status is already `Resolved`
- **THEN** the request is rejected per the preceding requirement (Resolved is not a valid target at all), not silently accepted as a no-op

#### Scenario: Authorization is enforced identically on a no-op request

- **WHEN** a user without ownership or facilitator authorization submits a same-status no-op request
- **THEN** the request is rejected with `403`, exactly as it would be for a real transition

---

### Requirement: Every real status transition is recorded in `action_item_history` within the same transaction as the status update

Every accepted, non-no-op status transition SHALL write a row to `action_item_history` (`packages/backend/migrations/2_create_tables.sql:152-161`) in the same database transaction as the `action_items.status` update — the two writes SHALL succeed or fail together. The row SHALL carry: `action_item_id`; `changed_by_user_id` set to the acting authenticated user (the owner or the authorizing facilitator — not necessarily the item's `owner_id`); `previous_status` and `new_status`; `resolution_note` set to the supplied note when the transition's target is `Resolved` and one was provided (see the following requirement), `NULL` for any non-resolving transition or when omitted; and `session_id`, populated with the resolved session ID when the transition occurs during a live pre-session review for that team (per the session-context decision in `websocket-specification`'s updated catalog entry) and `NULL` otherwise.

#### Scenario: A real transition writes a correctly-populated history row

- **WHEN** an owner or authorized facilitator completes a valid, non-no-op status transition to `In Progress` (no resolution note applicable)
- **THEN** an `action_item_history` row is written in the same transaction as the `action_items.status` update, with `changed_by_user_id` identifying the acting user, correct `previous_status`/`new_status`, and `resolution_note = NULL`

#### Scenario: The status update and its history row are atomic

- **WHEN** either the `action_items.status` update or its corresponding `action_item_history` insert fails
- **THEN** neither write is committed

---

### Requirement: A transition to Resolved may include an optional resolution note and records the resolving session

Per the pre-existing `VOTE-002` contract, a status transition whose target is `Resolved` MAY include an optional `resolutionNote` (max 500 characters, matching the existing `action_items_resolution_note_length` CHECK constraint). When provided and valid, it SHALL be persisted to **both** `action_items.resolution_note` (the action item's own current-state column — the one `content.ts` and `em-views.ts` read directly, per their existing read paths and the round-trip test at `em-views.test.ts:681`) **and** the resulting `action_item_history` row's `resolution_note` (the audit-trail entry for this specific transition). **Corrected (Marcus Delgado's blocking Finding 2, `tasks-review-ba.md`):** prior drafts of this requirement stated only the `action_item_history` write; omitting the `action_items.resolution_note` write would mean a submitted note validates and audit-logs successfully but never appears anywhere a user can see it, since every existing read path reads the current-state column, not the history table. When the request also supplies a `sessionId`, `action_items.resolved_in_session_id` SHALL be set to that session's ID — a column distinct from, and populated independently of, `action_item_history.session_id` (which records the review context for every real transition, not only resolutions; see the preceding requirement). A `resolutionNote` supplied on a transition whose target is not `Resolved` SHALL be ignored and not persisted anywhere, since it has no defined meaning outside a resolution.

#### Scenario: A resolution with a valid note is persisted

- **WHEN** an owner or authorized facilitator transitions an item to `Resolved` with a `resolutionNote` of 500 characters or fewer
- **THEN** the request succeeds, **both** `action_items.resolution_note` and the `action_item_history` row's `resolution_note` carry the supplied text, the note is visible via `content.ts`'s and `em-views.ts`'s existing read paths, and — if a `sessionId` was also supplied — `action_items.resolved_in_session_id` is set to that session's ID

#### Scenario: An over-length resolution note is rejected

- **WHEN** a transition to `Resolved` supplies a `resolutionNote` exceeding 500 characters
- **THEN** the request is rejected with `422`, and neither `action_items.status` nor `action_item_history` is written

#### Scenario: A resolution note is optional

- **WHEN** a transition to `Resolved` omits `resolutionNote` entirely
- **THEN** the request succeeds and both `action_items.resolution_note` and the `action_item_history` row's `resolution_note` are `NULL`

#### Scenario: A resolution note supplied outside a resolution is ignored, not an error

- **WHEN** a request transitions an item to `Open → In Progress` (not `Resolved`) and includes a `resolutionNote` value
- **THEN** the request succeeds per the ordinary transition rules, and the supplied `resolutionNote` is not persisted anywhere

---

### Requirement: Every real status transition writes a security audit_log row, distinct from the action_item_history business record

**Resolved (design.md Decision D13, per security review finding F3):** `action_item_history` is a business record, read back by ordinary application users, and is not a substitute for this codebase's security audit trail. Every accepted, non-no-op status transition SHALL also write a row to `audit_log` (`operation = 'action_item.status_changed'`) in the same database transaction as the `action_items.status` update and the `action_item_history` insert — the three writes SHALL succeed or fail together. The `audit_log` row SHALL carry `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, and `metadata` including at minimum `action_item_id`, `previous_status`, `new_status`, `authorization_path` (`"owner"` or `"facilitator"`), and `session_id` when one was supplied.

#### Scenario: A real transition writes an audit_log row alongside the history row

- **WHEN** an owner or authorized facilitator completes a valid, non-no-op status transition
- **THEN** an `audit_log` row is written in the same transaction as the `action_items.status` update and the `action_item_history` insert, with `metadata.authorization_path` correctly identifying whether the actor took the owner or facilitator path

#### Scenario: A same-status no-op writes no audit_log row

- **WHEN** a status update is accepted as a same-status no-op (per the no-op requirement above)
- **THEN** no `audit_log` row is written, matching the no-op's existing `action_item_history` skip

#### Scenario: A rolled-back transition writes no audit_log row

- **WHEN** either the `action_items.status` update or its corresponding `action_item_history` insert fails and is rolled back
- **THEN** the `audit_log` insert is rolled back with it — none of the three writes is committed
