-- Migration 12: Normalized (case-insensitive, trimmed) team-name uniqueness
--
-- inline-team-creation design.md Decision D4: the existing teams_name_unique
-- constraint (2_create_tables.sql:23) is a plain UNIQUE (name) -- exact
-- string match. "Platform Team" and "platform team" must collide, and an
-- app-level pre-check alone has a real race (two concurrent requests for
-- normalized-duplicate, differently-cased names can both pass the
-- pre-check and both insert). This migration adds a functional unique index
-- as the structural, database-level backstop.
--
-- Additive only: the existing teams_name_unique constraint is left in place
-- (harmless, strictly narrower than this new index) -- not dropped.
--
-- Migration numbering note (design.md D4, engineer review Finding 4): chosen
-- as 11 at implementation time, since no other migration has yet claimed
-- that number on main. inline-team-creation is formally blocked on
-- fix-default-topic-seed-data merging first (tasks.md 1.1) and that change
-- also adds a new migration -- tasks.md 2.1a requires re-confirming this
-- number is still unclaimed immediately before this change merges, and
-- renumbering here if it has been.

-- Up Migration

CREATE UNIQUE INDEX teams_name_unique_normalized
  ON teams (lower(btrim(name)));

-- Down Migration

DROP INDEX teams_name_unique_normalized;
