-- Migration 15: Add owner-reassignment columns to action_item_history
--
-- Implements design.md Decision D7 (reassign-action-item-owner /
-- VOTE-004, GitHub issue #108).
--
-- Numbering note: design.md's Migration Plan calls this "next in sequence
-- after migration 9" because that was the latest migration on `main` when
-- this change was proposed. By implementation time, `main` had already
-- merged migrations 10-14 (session/team-join-link work from other,
-- unrelated changes) that this feature branch was cut before and does not
-- yet contain. This migration is numbered 15 — next after main's actual
-- latest (14_sessions_drop_join_token.sql) — rather than 10, to avoid
-- colliding with those already-integrated migrations once this branch is
-- rebased onto or merged with main. No decision in design.md depended on
-- the literal number 10; only on this being the next additive migration
-- after whatever the current head is.
--
-- Why additive and nullable, not a new table:
--   `action_item_history` (migration 2) is a status-history table today:
--   `previous_status`/`new_status` are NOT NULL, and every existing row
--   records a real status transition. VOTE-004's owner-reassignment
--   endpoint (PATCH /api/v1/action-items/:actionItemId/owner) needs a
--   durable, auditable record of who owned an item before and after a
--   reassignment, in the same table `action-item-status-management`
--   already writes to and that its own consumers already read.
--
--   A separate action_item_owner_history table was considered and
--   rejected (design.md D7's "Alternative considered"): it would double
--   the write-path surface (two tables, two transactions to coordinate)
--   and duplicate changed_by_user_id/session_id/changed_at for no benefit
--   proportional to the cost. Widening this table's meaning is the
--   smaller diff, and a grep across packages/ and openspec/ confirmed no
--   existing consumer beyond VOTE-002's own write path and tests assumes
--   "one row = one status transition."
--
--   previous_status/new_status remain NOT NULL and unchanged in shape.
--   A reassignment-only row (this migration's new columns both non-null)
--   writes the item's own unchanged current status into both columns —
--   an application-level invariant ("a reassignment-only row's
--   previous_status SHALL equal its new_status"), not one this migration
--   enforces at the database level. It is stated normatively in
--   openspec/changes/reassign-action-item-owner/specs/
--   action-item-owner-reassignment/spec.md instead: this table's only
--   call site that will ever write a non-null-owner-column row is
--   VOTE-004's own handler, and a CHECK comparing two enum columns for
--   equality only when a third condition holds is more constraint
--   complexity than the actual corruption risk justifies today.
--
-- What IS enforced at the database boundary: symmetric nullability.
--   previous_owner_id and new_owner_id must both be NULL (a status-change
--   row) or both be non-NULL (a reassignment row) — never one without the
--   other. This is cheap and catches a malformed insert regardless of
--   which code path writes it in the future.
--
-- Backfill: none required. Every existing row has both new columns NULL,
-- which is a valid, correctly-typed status-change row under the new
-- schema (previous_owner_id IS NULL) = (new_owner_id IS NULL) holds
-- trivially as NULL = NULL is not violated by the CHECK below, since
-- Postgres CHECK constraints only reject rows that evaluate to FALSE —
-- NULL = NULL evaluates to NULL/unknown, which passes.
--
-- Rollback: a normal migration revert (drop the two columns and the
-- constraint). No data-loss risk, since no pre-migration data depends on
-- these columns.

-- Up
ALTER TABLE action_item_history
    ADD COLUMN IF NOT EXISTS previous_owner_id uuid NULL REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS new_owner_id uuid NULL REFERENCES users(id);

ALTER TABLE action_item_history
    ADD CONSTRAINT action_item_history_owner_columns_symmetric
    CHECK ((previous_owner_id IS NULL) = (new_owner_id IS NULL));

-- Down
-- ALTER TABLE action_item_history DROP CONSTRAINT IF EXISTS action_item_history_owner_columns_symmetric;
-- ALTER TABLE action_item_history DROP COLUMN IF EXISTS previous_owner_id;
-- ALTER TABLE action_item_history DROP COLUMN IF EXISTS new_owner_id;
