# action-item-owner-reassignment

## Purpose

Facilitator-only reassignment of an action item's `owner_id`, independent of `action-item-status-management`'s status-transition write path. Implements `PATCH /api/v1/action-items/:actionItemId/owner` (`VOTE-004`, GitHub issue #108, per the pre-existing contract in `requirements/design/REST API Contract.md`), deliberately reusing `action-item-status-management`'s (`VOTE-002`) session-scoped facilitator-authorization pattern, anti-enumeration ordering, and resolved-is-terminal precedent rather than re-deriving equivalent-but-different versions of each. `ACTION-002` is the only other place `action_items.owner_id` changes (during a session's `wrap_up` phase); this endpoint is the only way to reassign an item once wrap-up has closed.

This spec does NOT cover the facilitator-facing reassignment UI (GitHub issue #68) — trigger taxonomy, the active-engineer picker, batch reassignment, or any live-vs-quiet visibility distinction for the four realistic triggers (owner departed, misassignment correction, load-balancing, in-room volunteer handoff). This change ships the contract #68 will call; it does not decide how #68 should look or feel. It also does not cover new-owner *availability* modeling (parental/medical/sabbatical leave — adjacent to `team-membership-removal`'s territory) or backfilling `action_item_history` for `ACTION-002`'s existing wrap-up owner edits (a separate, still-open gap, OQ-8).

## Requirements

### Requirement: Only the item's actively-facilitating facilitator may reassign its owner

The application SHALL provide a write path (`PATCH /api/v1/action-items/:actionItemId/owner`, per the pre-existing `VOTE-004` contract in `requirements/design/REST API Contract.md`) that reassigns an action item's owner. Unlike `action-item-status-management`'s status-update endpoint, there is no owner-initiated path here — only a facilitator holding authorization over the item's team may call this endpoint. Authorization SHALL reuse the exact session-scoped mechanism `action-item-status-management` (`VOTE-002`, Decision D10) already established: a session exists for the item's `team_id` with `facilitator_id` equal to the caller and `status` in `lobby`, `pre_session`, `active`, or `wrap_up`. This is deliberately narrower than a standing "I am a facilitator" role check — facilitator write authority is earned by actively running a session for this specific team, not held globally or indefinitely.

The endpoint's URL carries no `teamId`, identical in shape to `action-item-status-management`'s status-update endpoint. The same anti-enumeration ordering (`action-item-status-management`, Decision D12) applies: the action item is loaded by ID alone first; a caller with zero relationship to its team (not a plain team member, not an Application Admin, and has never facilitated a session for this team) receives `404`, indistinguishable from a nonexistent `actionItemId`; `403` is reserved for a caller who has some relationship to the item's team by any of those measures but is not currently an authorized active facilitator. Unlike `action-item-status-management`, "is the owner" is not a relationship signal for this endpoint's 404-vs-403 boundary: this endpoint has no owner-authorized path at all, so a caller being the item's current owner grants them no standing here. The shipped handler (`packages/backend/src/routes/action-items.ts`) also calls `applyTimingFloor` at every pre-authorization short-circuit return (item-not-found `404`, no-relationship `404`, invalid/missing-`sessionId` `422`, not-authorized-facilitator `403`), so that response timing does not reopen the enumeration oracle the status-code ordering closes.

#### Scenario: An authorized active facilitator reassigns an item

- **WHEN** a facilitator with a session for the target item's team in `lobby`, `pre_session`, `active`, or `wrap_up` status requests a reassignment to an eligible new owner
- **THEN** the request succeeds and the item's `owner_id` is updated

#### Scenario: A caller with no relationship to the item's team cannot distinguish it from a nonexistent item

- **WHEN** the authenticated user has no relationship at all to the target item's team — not a member, not an Application Admin, and has never facilitated a session for it
- **THEN** the request is rejected with `404`, identical in response shape to a request against an `actionItemId` that does not exist at all

#### Scenario: A user with some relationship to the team, but no active facilitator authorization, is rejected with 403

- **WHEN** the authenticated user has some relationship to the target item's team — an ordinary member, an Application Admin, or a facilitator whose only session for this team falls outside the `lobby`/`pre_session`/`active`/`wrap_up` window — and requests a reassignment
- **THEN** the request is rejected with `403`, distinct from the `404` a caller with zero relationship receives

#### Scenario: A facilitator outside the active-session window is rejected, even within evaluateTeamAccess's broader grace windows

- **WHEN** a facilitator's only relationship to the target item's team is a `draft` session still within its 24-hour grace window, or a `complete` session still within its `facilitator_access_expires_at` grace window
- **THEN** the request is rejected with `403`, even though this same facilitator would hold a valid grant for read-content endpoints via `evaluateTeamAccess`

---

### Requirement: The new owner must be an active, non-EM participant member of the team, and not the calling facilitator

A reassignment's `newOwnerUserId` SHALL be validated against the following cascade, evaluated in this order:

1. `newOwnerUserId` SHALL NOT equal the calling facilitator's own user ID — rejected with `422` regardless of that user's membership state, checked first as a cheap equality test requiring no database round-trip.
2. `newOwnerUserId` SHALL reference an existing user — rejected with `404` otherwise.
3. That user SHALL have a `team_memberships` row for the action item's team — rejected with `404` otherwise (no membership ever existed).
4. That membership SHALL be active (`removed_at IS NULL`) and SHALL have `role = 'participant'` — rejected with `422` otherwise, whether the membership is soft-removed or belongs to an Engineering Manager. This SHALL be checked precisely against `role = 'participant'`, not merely "a membership row exists," so that a facilitator cannot reassign an item to an Engineering Manager — doing so would place a manager in the position of holding an accountable action item, which this application's no-manager-participation constraint (BRD FR-9.5) does not permit.

The steps 3/4 membership lookup SHALL be its own query, with no `removed_at` filter in its `WHERE` clause — it SHALL NOT reuse `evaluateTeamAccess`'s query shape, which folds a soft-removed member into "no row" and would misclassify step 3's `404` as if the membership never existed.

#### Scenario: A facilitator cannot reassign an item to themselves

- **WHEN** `newOwnerUserId` equals the calling facilitator's own user ID
- **THEN** the request is rejected with `422`, independent of that user's team membership state

#### Scenario: A nonexistent new owner is rejected

- **WHEN** `newOwnerUserId` does not reference any existing user
- **THEN** the request is rejected with `404`

#### Scenario: A new owner with no membership on this team is rejected

- **WHEN** `newOwnerUserId` references an existing user who has no `team_memberships` row at all for the action item's team
- **THEN** the request is rejected with `404`

#### Scenario: A soft-removed member cannot be reassigned an item

- **WHEN** `newOwnerUserId` references a user whose `team_memberships` row for this team has `removed_at IS NOT NULL`
- **THEN** the request is rejected with `422`

#### Scenario: An Engineering Manager cannot be reassigned an item

- **WHEN** `newOwnerUserId` references a user whose active `team_memberships` row for this team has `role = 'engineering_manager'`
- **THEN** the request is rejected with `422`, preserving the no-manager-participation constraint

#### Scenario: An active participant member is a valid new owner

- **WHEN** `newOwnerUserId` references a user with an active (`removed_at IS NULL`), `role = 'participant'` membership on this team, and is not the calling facilitator
- **THEN** the new-owner validation cascade passes

---

### Requirement: Reassigning an item to its current owner is accepted as a no-op, but is still audited

A request whose `newOwnerUserId` equals the action item's current `owner_id` SHALL be accepted as a no-op, mirroring `action-item-status-management`'s same-status no-op precedent. A no-op SHALL update `action_items.updated_at` to the current time but SHALL NOT write an `action_item_history` row, since no ownership transition occurred for that table to record. This determination SHALL be made only after the new-owner validation cascade and the resolved-item precondition have both passed, so a no-op request is not exempted from being validated as if it were a real reassignment.

Unlike `action-item-status-management`'s same-status no-op, this endpoint's no-op SHALL still write an `audit_log` row (and its `emitAuditEvent` structured-log counterpart), distinguished from a real reassignment by `metadata.no_op = true` and by `previous_owner_id` equaling `new_owner_id`. This is because this endpoint's no-op resets `action_items.updated_at` — the pre-session review screen's staleness signal — on demand and repeatably, unlike a status no-op, which has no comparable downstream effect. Skipping the business record (`action_item_history`) while still writing the security record (`audit_log`) is a deliberate, narrower divergence from `action-item-status-management`'s precedent than skipping both would be.

The no-op path's `UPDATE` is also guarded against a concurrent resolve — see the following requirement's concurrency note, which applies identically to both this endpoint's write paths.

#### Scenario: A facilitator reassigns an item to its existing owner

- **WHEN** the facilitator's `newOwnerUserId` equals the item's current `owner_id`, and that owner still passes the new-owner validation cascade
- **THEN** the request succeeds with `200`, `action_items.updated_at` is updated to the current time, no `action_item_history` row is written, and an `audit_log` row is written with `operation = 'action_item.owner_reassigned'` and `metadata.no_op = true`

---

### Requirement: A resolved action item cannot be reassigned

An action item whose current `status` is `resolved` SHALL NOT be a valid target for this endpoint, on either write path (a real reassignment or a same-owner no-op). Matching `action-item-status-management`'s "resolved is terminal, unhedged" precedent, a reassignment attempt against a resolved item SHALL be rejected with `409 Conflict`, not `403` — this is a state-precondition failure, distinct from an authorization failure, and uses a different status code so a caller can distinguish "you may not do this" from "this item is no longer eligible for this operation." This check SHALL be evaluated before the new-owner validation cascade: a request that both targets a resolved item and supplies an invalid new owner SHALL be rejected for the resolved-item reason.

**Enforced twice, not just once, on both write paths:** because the item is loaded via a snapshot read before this precondition and the new-owner cascade are evaluated, this precondition SHALL also be re-enforced at the moment of the write itself, on whichever of the two write paths the request reaches — the same-owner no-op's `UPDATE action_items SET updated_at = NOW() ...` and the real-reassignment's `UPDATE action_items SET owner_id = $1, updated_at = NOW() ...` SHALL both include a `status != 'resolved'` guard. If a concurrent write resolves the item between the snapshot read and either path's own commit, the guarded `UPDATE` SHALL affect zero rows, and that outcome SHALL be treated identically to the snapshot-time `409`: the transaction is rolled back, and neither `action_item_history` nor `audit_log` is written.

**Implementation note:** the design record for this change (design.md Decision D11) originally scoped this guard to the real-reassignment `UPDATE` only. Implementation review (`implementation-review-architect.md`'s "New Finding") caught that the same-owner no-op path has an identical snapshot-then-write race — its snapshot is read before the resolved-item precondition is evaluated against it, exactly like the real-reassignment path — and the guard was extended to the no-op path's `UPDATE` before this change shipped. Both write paths in the shipped code (`packages/backend/src/routes/action-items.ts`) carry the guard; this requirement states that shipped shape, not the design document's earlier, narrower text.

#### Scenario: A reassignment attempt against a resolved item is rejected

- **WHEN** a facilitator requests a reassignment for an action item whose current `status` is `resolved`
- **THEN** the request is rejected with `409`, and the item's `owner_id` is unchanged

#### Scenario: The resolved-item precondition takes priority over new-owner validation

- **WHEN** a facilitator requests a reassignment for a resolved item and also supplies a `newOwnerUserId` that would independently fail the new-owner validation cascade
- **THEN** the request is rejected with `409` for the resolved-item reason, not with the new-owner cascade's `404`/`422`

#### Scenario: A concurrent resolve discovered only at write time is treated as the same conflict, on the real-reassignment path

- **WHEN** a reassignment's snapshot read observes the item as not resolved, but a concurrent request resolves the item before this reassignment's guarded `UPDATE` commits
- **THEN** the `UPDATE` affects zero rows, the request is rejected with `409` identical in shape to the snapshot-time case, the item's `owner_id` is unchanged, and neither `action_item_history` nor `audit_log` is written

#### Scenario: A concurrent resolve discovered only at write time is treated as the same conflict, on the same-owner no-op path

- **WHEN** a no-op reassignment's snapshot read observes the item as not resolved, but a concurrent request resolves the item before the no-op's guarded `updated_at`-only `UPDATE` commits
- **THEN** the `UPDATE` affects zero rows, the request is rejected with `409` identical in shape to the real-reassignment path's concurrent-resolve case, `action_items.updated_at` is unchanged, and no `audit_log` row is written

---

### Requirement: A required sessionId is validated against the item's team's active session state

The request body SHALL include `sessionId`; its absence SHALL be rejected with `422`. When present, it SHALL be validated independently of authorization and new-owner validation, reusing `action-item-status-management`'s Decision D11 rule exactly: rejected with `422` unless it references a session belonging to the action item's team with `status` in `lobby`, `pre_session`, `active`, or `wrap_up`. `sessionId` is not derived server-side from the facilitator-authorization check, even though that check already resolves an active session for the same team — this endpoint's session-validation mechanism does not diverge from `action-item-status-management`'s D11 rule on this point, even though its optionality does.

Unlike `action-item-status-management`'s own `sessionId` field, which is optional because that endpoint's governing use case explicitly supports an out-of-session status update, this endpoint's `sessionId` is REQUIRED. This endpoint's governing use case ("Reassign an Action Item When an Owner Leaves the Team") has no out-of-session path — its precondition requires an active session unconditionally, and its postcondition records the reassignment's session without hedge.

#### Scenario: A valid sessionId for the item's team is accepted

- **WHEN** a facilitator supplies a `sessionId` that references a session for the action item's team with `status` in `lobby`, `pre_session`, `active`, or `wrap_up`
- **THEN** the `sessionId` validation passes and the reassignment proceeds

#### Scenario: A sessionId referencing another team's session is rejected

- **WHEN** a facilitator supplies a `sessionId` that references a session belonging to a different team than the action item's own
- **THEN** the request is rejected with `422`

#### Scenario: A missing sessionId is rejected

- **WHEN** a facilitator omits `sessionId` entirely
- **THEN** the request is rejected with `422`, since this endpoint requires it, unlike `action-item-status-management`'s optional field

#### Scenario: sessionId validation takes priority over the resolved-item precondition

- **WHEN** a facilitator requests a reassignment for an action item whose current `status` is `resolved`, and also omits `sessionId` or supplies one that fails validation
- **THEN** the request is rejected with `422` for the missing-or-invalid-session reason, not `409` for the resolved-item reason — the mirror image of the resolved-item precondition's priority over the new-owner validation cascade, since `sessionId` validation runs earlier in the check sequence than the resolved-item check

---

### Requirement: Every real reassignment is recorded in `action_item_history` within the same transaction as the owner update

Every accepted, non-no-op reassignment SHALL write a row to `action_item_history` in the same database transaction as the `action_items.owner_id` update — the two writes SHALL succeed or fail together. The row SHALL carry: `action_item_id`; `changed_by_user_id` set to the acting facilitator; `previous_owner_id` and `new_owner_id`, the item's owner before and after the write; `previous_status` and `new_status`, both set to the item's own unchanged current status (a reassignment does not change status; these columns are `NOT NULL` on this table and populated equal by construction — see `action-item-status-management`'s cross-referenced note); and `session_id`, always populated with the validated `sessionId`, since this endpoint requires the field. A row where `previous_owner_id` and `new_owner_id` are both non-null is a reassignment-only row by definition, and its `previous_status`/`new_status` SHALL be equal.

#### Scenario: A real reassignment writes a correctly-populated history row

- **WHEN** a facilitator successfully reassigns an item to a new, eligible owner
- **THEN** an `action_item_history` row is written in the same transaction as the `action_items.owner_id` update, with `previous_owner_id` and `new_owner_id` correctly populated and `previous_status` equal to `new_status`

#### Scenario: The owner update and its history row are atomic

- **WHEN** either the `action_items.owner_id` update or its corresponding `action_item_history` insert fails
- **THEN** neither write is committed

#### Scenario: A no-op reassignment writes no history row

- **WHEN** a reassignment is accepted as a no-op (per the same-owner no-op requirement)
- **THEN** no `action_item_history` row is written

---

### Requirement: Every reassignment, no-op included, writes a security audit_log row, distinct from the action_item_history business record

Matching `action-item-status-management`'s Decision D13 precedent, every accepted reassignment SHALL write a row to `audit_log` (`operation = 'action_item.owner_reassigned'`) in the same database transaction as the `action_items.owner_id` (or, for a no-op, `updated_at`-only) update. The `audit_log` row SHALL carry `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, and `metadata` including at minimum `action_item_id`, `previous_owner_id`, `new_owner_id`, and `session_id` (always present, since this endpoint requires the field). A no-op's `audit_log` row SHALL carry `metadata.no_op = true`, with `previous_owner_id` equal to `new_owner_id`; a real reassignment's row SHALL NOT carry `no_op: true`. This departs from `action-item-status-management`'s own no-op precedent, which writes no audit record at all for a same-status no-op; this endpoint's no-op is audited because, unlike a status no-op, it has a real, repeatable, otherwise-invisible effect on `action_items.updated_at`, a signal other people rely on.

#### Scenario: A real reassignment writes an audit_log row alongside the history row

- **WHEN** a facilitator successfully reassigns an item to a new, eligible owner
- **THEN** an `audit_log` row with `operation = 'action_item.owner_reassigned'` and no `no_op` flag is written in the same transaction as the `action_items.owner_id` update and the `action_item_history` insert

#### Scenario: A no-op reassignment writes an audit_log row but no history row

- **WHEN** a reassignment is accepted as a no-op
- **THEN** an `audit_log` row with `operation = 'action_item.owner_reassigned'` and `metadata.no_op = true` is written, in the same transaction as the `updated_at` bump, but no `action_item_history` row is written

#### Scenario: Repeated no-op calls each produce their own audit_log row

- **WHEN** a facilitator (or a retried/double-submitted client) calls this endpoint more than once in succession with `newOwnerUserId` equal to the item's current owner
- **THEN** each call writes its own `audit_log` row with `metadata.no_op = true`, so a pattern of repeated staleness-clock resets on the same item is reconstructable from the audit trail rather than silently overwritten

---

### Requirement: A reassignment resets the staleness clock and publishes no live broadcast

Every accepted reassignment — the no-op case and the real-reassignment case alike — SHALL update `action_items.updated_at` to the current time, so a newly-reassigned owner's staleness clock starts clean rather than inheriting staleness accrued under the prior owner. This endpoint SHALL NOT publish any WebSocket broadcast: no event named or shaped for an owner change exists in this application's WebSocket catalog, and none is introduced by this requirement. This is a confirmed, deliberate absence — whether a live reassignment should be visible to session participants in real time is a distinct UX question left to whichever change eventually builds the facilitator-facing reassignment UI.

#### Scenario: A real reassignment updates the staleness clock

- **WHEN** a facilitator successfully reassigns an item that was previously stale under its prior owner
- **THEN** `action_items.updated_at` is set to the current time, and the item is not shown as stale to its new owner

#### Scenario: No broadcast is published for any reassignment

- **WHEN** any reassignment is accepted, whether a no-op or a real ownership change
- **THEN** no WebSocket message is published as a result
