## MODIFIED Requirements

### Requirement: Every real status transition is recorded in `action_item_history` within the same transaction as the status update

Every accepted, non-no-op status transition SHALL write a row to `action_item_history` (`packages/backend/migrations/2_create_tables.sql:152-161`) in the same database transaction as the `action_items.status` update — the two writes SHALL succeed or fail together. The row SHALL carry: `action_item_id`; `changed_by_user_id` set to the acting authenticated user (the owner or the authorizing facilitator — not necessarily the item's `owner_id`); `previous_status` and `new_status`; `resolution_note` set to the supplied note when the transition's target is `Resolved` and one was provided (see the following requirement), `NULL` for any non-resolving transition or when omitted; and `session_id`, populated with the resolved session ID when the transition occurs during a live pre-session review for that team (per the session-context decision in `websocket-specification`'s updated catalog entry) and `NULL` otherwise.

**Scope boundary (added by `reassign-action-item-owner`):** this requirement governs status-change rows only — rows where `previous_status ≠ new_status`, or a same-status no-op that is exempted from writing a row at all by the following requirement. Owner-reassignment rows, written by `VOTE-004`'s `PATCH /api/v1/action-items/:actionItemId/owner`, are a distinct requirement of the `action-item-owner-reassignment` capability, not a status transition: they carry non-null `previous_owner_id`/`new_owner_id` and populate `previous_status`/`new_status` with the item's own unchanged current status, equal by construction. A future reader of this table SHALL NOT treat a row with equal `previous_status`/`new_status` as evidence of a no-op status update without first checking whether `previous_owner_id`/`new_owner_id` are non-null — that combination identifies a reassignment-only row instead.

#### Scenario: A real transition writes a correctly-populated history row

- **WHEN** an owner or authorized facilitator completes a valid, non-no-op status transition to `In Progress` (no resolution note applicable)
- **THEN** an `action_item_history` row is written in the same transaction as the `action_items.status` update, with `changed_by_user_id` identifying the acting user, correct `previous_status`/`new_status`, and `resolution_note = NULL`

#### Scenario: The status update and its history row are atomic

- **WHEN** either the `action_items.status` update or its corresponding `action_item_history` insert fails
- **THEN** neither write is committed

#### Scenario: A reassignment-only row is not a status transition

- **WHEN** a row in `action_item_history` has non-null `previous_owner_id` and `new_owner_id`
- **THEN** that row is a reassignment record governed by the `action-item-owner-reassignment` capability, and its equal `previous_status`/`new_status` values SHALL NOT be interpreted as a status no-op or counted as a status transition by any consumer of this table
