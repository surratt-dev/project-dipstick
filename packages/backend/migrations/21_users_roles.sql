-- Migration 21: users.roles, the full IdP role set (#245, expand step)
--
-- Implements openspec/changes/store-idp-role-set design.md D2, D9, D10 and
-- D13 (specs/oidc-role-mapping "The full mapped role set is stored").
--
-- users.roles holds every internal role the IdP claim maps to, de-duplicated
-- and sorted highest precedence first, so roles[1] is always global_role. A
-- user with no mapped role has exactly {engineer}. Existing rows are
-- backfilled to ARRAY[global_role]. Nothing reads roles for authorization in
-- this step; global_role stays the effective role.
--
-- users_roles_consistent (D2) calls users_roles_well_formed, which runs its
-- checks in a fixed order and returns true or false, never NULL (a CHECK
-- passes on NULL): one dimension, lower bound 1, no NULL element, then
-- roles[1] = global_role, engineer only as the sole element, and strictly
-- descending enum order. The enum's declaration order is load-bearing for
-- that last rule (D11); any future change to user_role must re-check rows.
--
-- No DEFAULT on roles (D3). While the legacy-writer shim below exists, an
-- INSERT that omits roles is filled with ARRAY[global_role] instead of being
-- rejected.
--
-- users_roles_fill_legacy (D13) is a transitional BEFORE INSERT OR UPDATE
-- trigger so a build that predates #245, which writes global_role only, keeps
-- working after this migration: it fills roles on an INSERT that omits it, and
-- on an UPDATE that changes global_role without changing roles. It only ever
-- writes the single-element set the backfill writes, so it never adds a role.
-- It is the schema's first trigger; it must fire before any later trigger
-- that reads roles (BEFORE triggers fire in name order). Follow-up F1's first
-- migration drops it.
--
-- Both functions pin search_path to pg_catalog, public and schema-qualify
-- public.user_role, so a pg_dump restore (which runs with an empty
-- search_path and validates CHECKs during the data load) succeeds. Both are
-- SECURITY INVOKER and use no dynamic SQL.
--
-- Locking (D9): this migration touches users only and holds ACCESS EXCLUSIVE
-- on it. lock_timeout 5s makes it fail and roll back rather than stall
-- readers; re-run it after a lock timeout. Run with --no-single-transaction
-- (npm run db:migrate does) so migration 22 is a separate transaction.
--
-- Rollback: redeploy the previous build first and confirm no instance of
-- this build is serving, then optionally run the down migrations, 22 before
-- 21. The down section drops the trigger first, then the shim function, the
-- constraint, users.roles and the helper. global_role is untouched.

-- Up Migration
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION users_roles_well_formed(r public.user_role[], g public.user_role)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF r IS NULL OR g IS NULL THEN RETURN false; END IF;
  -- Shape first: array_position raises 0A000 on a multi-dimensional array.
  IF array_ndims(r) IS DISTINCT FROM 1 THEN RETURN false; END IF;  -- 2-D, and '{}' (ndims is NULL)
  IF array_lower(r, 1) <> 1 THEN RETURN false; END IF;             -- '[0:1]={...}'
  IF array_position(r, NULL::public.user_role) IS NOT NULL THEN RETURN false; END IF;
  IF r[1] <> g THEN RETURN false; END IF;                           -- rule 2
  IF cardinality(r) > 1 AND 'engineer'::public.user_role = ANY (r) THEN RETURN false; END IF;  -- rule 3
  FOR i IN 1 .. cardinality(r) - 1 LOOP                             -- rule 4 (strictly descending)
    IF NOT (r[i] > r[i + 1]) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$$;

ALTER TABLE users ADD COLUMN roles user_role[];
UPDATE users SET roles = ARRAY[global_role];
ALTER TABLE users ALTER COLUMN roles SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_roles_consistent
  CHECK (users_roles_well_formed(roles, global_role) IS TRUE);

CREATE FUNCTION users_roles_fill_legacy()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.roles IS NULL THEN
      NEW.roles := ARRAY[NEW.global_role]::public.user_role[];
    END IF;
  ELSIF NEW.global_role IS DISTINCT FROM OLD.global_role
        AND NEW.roles IS NOT DISTINCT FROM OLD.roles THEN
    NEW.roles := ARRAY[NEW.global_role]::public.user_role[];
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_roles_fill_legacy
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_roles_fill_legacy();

RESET lock_timeout;

-- Down Migration
DROP TRIGGER users_roles_fill_legacy ON users;
DROP FUNCTION users_roles_fill_legacy();
ALTER TABLE users DROP CONSTRAINT users_roles_consistent;
ALTER TABLE users DROP COLUMN roles;
DROP FUNCTION users_roles_well_formed(public.user_role[], public.user_role);
