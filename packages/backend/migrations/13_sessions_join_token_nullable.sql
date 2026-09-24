-- Migration 13: Relax sessions.join_token to nullable (Migration A)
--
-- join-link-redemption-wiring, design.md Decision 6. This is the first of
-- two migrations that remove sessions.join_token entirely -- this one only
-- relaxes the NOT NULL constraint, so both old-code pods (which still
-- supply a value on INSERT) and new-code pods (which omit it) succeed
-- concurrently for the duration of a rolling deploy. The column and its
-- UNIQUE constraint/index are dropped in a later, follow-up migration
-- (Migration B), only once this release is confirmed fully rolled out.
--
-- Rollback: ALTER TABLE sessions ALTER COLUMN join_token SET NOT NULL
-- (safe only if every row already has a non-null value, which holds until
-- Migration B's application-code counterpart lands).

ALTER TABLE sessions ALTER COLUMN join_token DROP NOT NULL;
