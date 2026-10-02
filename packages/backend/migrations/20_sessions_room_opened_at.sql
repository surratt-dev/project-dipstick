-- Migration 20: sessions.room_opened_at, the "room open" moment
--
-- Implements session-topics-snapshot-at-creation (#175) design.md Decision 5
-- (specs/session-creation/spec.md "Sessions record when their room opened").
--
-- Room open is the moment a session's status first becomes 'lobby' (POST
-- /advance from draft, or POST /teams directly into lobby). It is also the
-- moment the session's session_topics snapshot is written, so this column
-- doubles as "when the topic list was locked in". It is NULL while a session
-- is in draft and is never changed after it is set.
--
-- Nullable, no default, no backfill: sessions that opened before this
-- migration read NULL, and readers fall back to created_at (the reorder
-- hint's openSessionCreatedAt). A nullable ADD COLUMN with no default is
-- metadata-only.
--
-- Rollback: npm run db:migrate:down drops exactly this column.
--
-- Section markers are node-pg-migrate's real ones (as in migrations 18/19).

-- Up Migration
ALTER TABLE sessions
    ADD COLUMN room_opened_at timestamptz NULL;

-- Down Migration
ALTER TABLE sessions
    DROP COLUMN room_opened_at;
