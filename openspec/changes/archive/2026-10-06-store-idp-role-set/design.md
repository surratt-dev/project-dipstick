# Design: Store the IdP role set in `users.roles` (#245, expand step)

See `proposal.md` for motivation and constraints, and the delta specs under `specs/` for the required behaviour. Every decision below traces to `exploration-notes.md` §4 (Q1 to Q11), where alternatives and reviewer feedback are recorded in full. Revision 2 incorporates the design-stage reviews (`design-review-engineer.md`, Marcus Oyelaran; `design-review-security.md`, Tomás Ferreira); see "Design review disposition" at the end.

## Context

- **Resolver** (`packages/backend/src/auth/role-map.ts`): a leaf module (no `config.js` / `db.js` imports, #244 D1/R4). `normalizeClaim` returns non-empty strings; `mapValues` does an own-key `Map` lookup and keeps duplicates; `resolveGlobalRole` returns `{ role, discardedRoles, outcome }` where `role` is the max by `RANK` (admin 4, EM 3, facilitator 2, senior 1) and `engineer` is `FALLBACK_ROLE`, not in `RANK`.
- **One writer of `users`**: `resolveOrCreateAccount` in `auth/account-resolver.ts`, a single `WITH prior AS (…) INSERT … ON CONFLICT DO UPDATE … RETURNING …, (xmax = 0) AS is_new_user, (SELECT global_role FROM prior) AS previous_global_role`. The only other writers are `migrations/4_seed_data.sql` (the system user), which runs before migration 21, and the manual revocation runbook in `docs/deployment.md` (`UPDATE users SET global_role = 'engineer'`).
- **Sign-in audit** (`routes/auth.ts`): `shouldEmitRoleClaimMapped(u)` gates both the transactional `audit_log` insert inside `withAuditTransaction` and the post-commit `emitAuditEvent`. `withAuditTransaction` sets `SET LOCAL statement_timeout = 400` (`TRANSACTIONAL_AUDIT_STATEMENT_TIMEOUT_MS`) immediately before the audit INSERT only; the `users` upsert runs without it. Fail-open audit writers use a 500 ms client timer.
- **`audit_log.actor_global_role` is `TEXT`**, not the enum, so history survives enum changes. There are 52 `INSERT INTO audit_log` sites in 16 files.
- **The `user_role` enum declaration order** (`1_create_enums.sql`) is `engineer < senior_engineer < facilitator < engineering_manager < application_admin`, the same as `RANK`.
- **Latest migration** is `20_sessions_room_opened_at.sql`. No existing migration defines a trigger or a user function.
- **Migration runner**: `npm run db:migrate` passes `--no-single-transaction` (one transaction per migration file). The `npx node-pg-migrate -m migrations up` command in `docs/deployment.md` (~l.247) does not, so it runs all pending migrations in one transaction. The integration lane (`integration.yml`) migrates before tests run, so no test sees an un-migrated database.
- **Test fixtures**: `real-db.ts` has `Fixture.user(globalRole = "facilitator")` (64 call sites, 18 files) with cleanup tracking. The Redis session holds only `userId` and tokens (`buildSessionData`), never a role.

## Goals / Non-Goals

**Goals:**
- `users.roles` exists, is complete for every user who signs in after migration 21, and cannot disagree with `global_role` whoever writes the row, including writes of malformed arrays.
- The sign-in audit trail records the full role set before and after each change.
- The contract step can later drop `global_role` without redefining "highest" or rewriting the firing rule from scratch.

**Non-Goals (design level, beyond the proposal's):**
- No `resolveActorRoles` helper and no change to the other 50 audit insert sites.
- No sync trigger, no generated column, no rewrite of `global_role` derivation in SQL. (The only trigger is D13's transitional legacy-writer shim, which never fires for this build's writes.)
- No change to the `pino` discard log line's fields or to `DISCARDABLE`.
- No migration of existing raw `INSERT INTO users` test statements in this step (moved to F1, see D3).

## Decisions

### D1. Order: highest precedence first
`roles` is sorted descending by precedence, de-duplicated. Then `roles[0]` (TypeScript) / `roles[1]` (Postgres) is `global_role`, which makes the consistency rule simple to state and lets contract step 2 drop `global_role` without redefining "highest". The same order is used in audit metadata and `actor_roles`, so a row reads naturally. Tests assert exact arrays (order and length), never set equality.
*Alternative:* ascending (enum order). Rejected: "first element is the effective role" is easier to state and check than "last element".

### D2. Consistency enforced by a database CHECK that cannot evaluate to NULL
A Postgres CHECK passes when its expression is NULL, and Postgres arrays may contain NULL elements, have more than one dimension, or start at a lower bound other than 1. `NOT NULL` on the column covers none of these, so a rule list written as plain boolean conjuncts accepts `'{NULL}'`, `'{{facilitator}}'` and `'[0:1]={application_admin,facilitator}'` with `global_role = 'facilitator'` (both reviewers, independently). The last one is exactly the drift this constraint exists to prevent.

Migration 21 therefore puts every rule in one function whose checks run in a fixed order and which returns `true` or `false`, never NULL, and wraps the call in `IS TRUE`:

```sql
CREATE FUNCTION users_roles_well_formed(r public.user_role[], g public.user_role)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF r IS NULL OR g IS NULL THEN RETURN false; END IF;
  IF array_ndims(r) IS DISTINCT FROM 1 THEN RETURN false; END IF;  -- 2-D, and '{}' (ndims is NULL)
  IF array_lower(r, 1) <> 1 THEN RETURN false; END IF;             -- '[0:1]={…}'
  IF array_position(r, NULL::public.user_role) IS NOT NULL THEN RETURN false; END IF;
  IF r[1] <> g THEN RETURN false; END IF;                           -- rule 2
  IF cardinality(r) > 1 AND 'engineer'::public.user_role = ANY (r) THEN RETURN false; END IF;  -- rule 3
  FOR i IN 1 .. cardinality(r) - 1 LOOP                             -- rule 4 (strictly descending)
    IF NOT (r[i] > r[i + 1]) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$$;

ALTER TABLE users ADD CONSTRAINT users_roles_consistent
  CHECK (users_roles_well_formed(roles, global_role) IS TRUE);
```

The rules, in order: (0) one dimension, lower bound 1, no NULL element; (1) non-empty (covered by the dimension check, since `array_ndims('{}')` is NULL); (2) `roles[1] = global_role`; (3) `engineer` appears only as the sole element; (4) strictly descending in enum order, which implies uniqueness. The shape checks run first because `array_position` raises `0A000` on a multi-dimensional array; ordered `IF`s in `plpgsql` make every malformed input fail with `23514`, not with a different SQLSTATE depending on planner evaluation order. A single-element array skips the loop and returns `true` (the bare `bool_and` form returns NULL there). The function is not `STRICT` (a strict function returns NULL on NULL input, which a CHECK would accept), and `IS TRUE` is belt and braces.

The no-manager rule's foundation should be structural, not a code convention.
*Alternatives:* (A) code-only guarantee, rejected because any second writer drifts silently; (C) derive `global_role` from `roles` in SQL, rejected as more than an expand step; (D) trigger to sync the columns permanently, rejected as hidden behaviour with two legitimate writers. D13's shim is narrower: one direction, legacy writes only, removed in F1. (E) the rules as separate conjuncts in the constraint wrapped in `COALESCE(…, false)`, with a SQL helper for ordering only. Rejected: Postgres does not guarantee `AND` evaluation order, so `array_position` on a 2-D array could raise `0A000` instead of `23514`, which makes the negative tests depend on the planner.

**Function hardening (security R2, engineer S3).** This is the schema's first user function. `pg_dump` restores with `search_path = ''` and validates CHECK constraints during the data load, so an unqualified reference in the body would fail a restore of `users`. Both functions (this one and D13's shim) declare `SET search_path = pg_catalog, public`, schema-qualify `public.user_role`, are `SECURITY INVOKER`, and use no dynamic SQL. Task 1.1 verifies a `pg_dump` / `pg_restore` round trip of a migrated database containing a multi-role row, once, and records it.

### D3. `NOT NULL`, no `DEFAULT`, and one fixture helper (extending `Fixture.user`)
A `DEFAULT '{engineer}'` would be safe today under rule 2, but once contract step 2 removes rule 2 it would silently make any fixture that omits `roles` an engineer, which is exactly how a manager fixture becomes a participant in a test. Not adding it now is cheaper than remembering to remove it. While D13's shim exists, an INSERT omitting `roles` is filled with `ARRAY[global_role]` rather than rejected, so the not-null protection for fixtures takes effect when F1 drops the shim.

**Fixtures:** extend the existing `Fixture.user` in `packages/backend/src/routes/__tests__/helpers/real-db.ts` to accept `GlobalRole | readonly GlobalRole[]` (a single role becomes a one-element set; `global_role` is element 0), keeping its cleanup tracking, and add `Fixture.setRoles(id, roles)`, which updates both columns. A thin exported `insertUser(db, { roles, … })` is added only for files that do not use `Fixture`. New tests in this change that need a multi-role user use these. No second, untracked way to create users is introduced.

**Existing raw inserts stay as they are in this step.** The roughly 13 files and 36 statements that insert users directly, and the two `UPDATE users SET global_role` sites, keep working unchanged through the shim. Migrating them buys nothing in a behaviour-neutral step; the protection they provide matters only once F1 drops the shim. That migration therefore moves to F1, next to the `23502` test it exists to protect. (`auth.test.ts` mocks `db.js`; its `INSERT INTO users` is a query matcher, not an insert, and is excluded from any such grep.) `auth.test.ts`'s 11 hand-built `ResolvedUser` objects are replaced with a `makeResolvedUser()` factory carrying `roles` and `previousRoles`, and `tsc -p packages/backend/tsconfig.json --noEmit` includes the test files, so a missing field is a type error rather than `roles: undefined` in an assertion. That check is local only: no CI job type-checks backend test files (`tsconfig.build.json` excludes `__tests__`, vitest strips types) and they already carry type errors, so this change records a baseline and adds no new errors to the files it touches (tasks 0.2, 8.5); the existing debt is follow-up F6.

### D4. Resolver returns the set; `global_role` is its first element
Add `resolveRoleSet(claim, map)` to `role-map.ts` (still a leaf) returning `{ roles, role, discardedRoles, outcome }`, where `roles` is `mapValues` output de-duplicated and sorted with an explicit comparator `(a, b) => RANK.get(b)! - RANK.get(a)!` (never `obj[role]`, never a bare or string `.sort()`), or a freshly built `[FALLBACK_ROLE]` when empty, and `role = roles[0]`. The comparator is a reviewer checklist item: the four mappable labels' alphabetical order happens to equal descending precedence, so a comparator-less sort passes every test today and breaks silently when a label is added (security S-a). The non-null assertions are safe because `mapValues` never yields `engineer`; a comment says so and a test pins it. `resolveGlobalRole` either delegates to it or is replaced; no separate max computation remains in `resolveOrCreateAccount`. `discardedRoles` keeps its `DISCARDABLE` filter. `roles` is built only from mapped internal roles, never from `normalizeClaim` output, so claim values cannot leak through it (#243 S7).

### D5. Upsert writes both columns; `previous_roles` from the same `prior` CTE; arrays read as `text[]` and validated
Extend `prior` to `SELECT global_role, roles FROM users …`, write `roles = EXCLUDED.roles` on conflict, and return the sets. Same statement, so the same race-freedom as #244 D4.

**Enum arrays and `pg` (engineer S1, security R5).** node-postgres returns `user_role[]` as the raw string `{a,b}`, because the enum array's OID is assigned per database and is unknown to `pg-types`; indexing it gives `roles[0] === "{"`. The approach is fixed:
- **Read:** `RETURNING …, roles::text[] AS roles, (SELECT roles::text[] FROM prior) AS previous_roles`. `text[]` (OID 1009) is parsed natively. Each array is then validated by one function, `parseRoleArray`: it must be a non-empty JS array whose every element is in `GLOBAL_ROLES`; anything else (non-array, empty, unknown element) throws, which fails the sign-in closed with a 500. No `as GlobalRole[]` cast and no hand-splitting of the string.
- **No global type parser.** Registering `types.setTypeParser` for the enum array's OID would need a catalogue query at boot in `db.ts`, coupling pool start-up to the schema and to migration order.
- **Write:** pass the JS array with an explicit cast, `$6::user_role[]`, which documents intent and survives a refactor into `SET roles = $n`.
- **Mocks:** `account-resolver.test.ts` row factories return what the cast returns (string arrays). Task 5.2's real-Postgres test, asserting `Array.isArray` and the exact elements, is the real guard.

`ResolvedUser` gains `roles: readonly GlobalRole[]` and `previousRoles: readonly GlobalRole[] | null`, both `Object.freeze`d at return so the row and the event cannot later differ.

**When `previousRoles` is null (engineer F4).** It is null when the statement saw no prior row. That happens in two cases: a genuine first sign-in (`isNewUser = true`), and the concurrent-first-sign-in race. In the race, two callbacks for the same new subject (double submit, two tabs) both run the statement; the loser hits `ON CONFLICT DO UPDATE` against a row its snapshot cannot see, so `xmax ≠ 0` (`isNewUser = false`) and `prior` is empty. Today's code already returns `previousGlobalRole: null` in that case. The rule is:
- `previousRoles` is null **if and only if** `previousGlobalRole` is null. Both null with `isNewUser = false` is the race and is passed through honestly, never defaulted to `[]` or `[engineer]` (that would forge audit history).
- `previousGlobalRole` non-null with `previousRoles` null is impossible under `NOT NULL` plus the backfill and shim, so it is an integrity error and throws (security §8).
- `sameRoles(roles, null)` is `false` (treated as changed). In the race the first disjunct (`globalRole !== previousGlobalRole`, since the latter is null) already fires, so this changes nothing.

### D6. Audit: metadata on both rows and events, `actor_roles` column on sign-in rows only
- `auth.first_access_created`: metadata and event gain `roles`; no `previousRoles` key.
- `auth.role_claim_mapped`: metadata and event gain `roles` and `previousRoles`. `previousRoles` is always present. It is non-null except in the concurrent-first-sign-in race (D5), where it is null together with `previousRole`, exactly as `previousRole` already behaves today. `previousRole` is kept, not renamed.
- Both rows set `audit_log.actor_roles` (new `TEXT[] NULL`, added by migration 22, see D9; `TEXT` for the same durability reason as `actor_global_role`), with a `COMMENT ON COLUMN`: "NULL means the actor's role set was not captured for this operation. It does not mean the actor had no roles. Populated only for auth.first_access_created and auth.role_claim_mapped as of migration 22." The same wording goes into the audit-query section of `docs/deployment.md` for auditors.
- The same frozen in-memory array feeds the row and the event, so they cannot differ.
*Alternative:* thread `actor_roles` through all 52 insert sites now. Rejected: contract-step work with no decision depending on it. We accept that the column duplicates metadata on the only rows it fills.

### D7. Firing condition: add an explicit set clause that changes nothing today
`shouldEmitRoleClaimMapped(u) = !u.isNewUser && (u.globalRole !== "engineer" || u.globalRole !== u.previousGlobalRole || !sameRoles(u.roles, u.previousRoles))`, with `sameRoles(x, null) = false`. A set change that ends in `{engineer}` must start from a non-engineer `global_role`, so the clause adds no firing case today (exploration §3). It stays because contract step 2 must delete the first two disjuncts. A comment says so. Tests with hand-built `ResolvedUser`s pin it: (a) `globalRole = previousGlobalRole = 'engineer'`, sets differ, fires (the resolver cannot produce that input); (b) identical sets and an unchanged non-engineer role still fire, through the first disjunct, so contract step 2's deletion has a test telling it what changes; (c) the race shape (`isNewUser: false`, both previous values null) fires with `previousRoles: null`.

### D8. Backfill `ARRAY[global_role]`, no origin marker
The backfill can only under-record: a backfilled `facilitator` may miss `senior_engineer`; an `engineering_manager` may miss `facilitator`; an `application_admin` may miss `engineering_manager` or `facilitator`. None of these grants anything extra, and admins stay excluded by D11. No `previousRolesSource` marker: it would need a persistent flag on `users` for a one-time condition, and it could not tell an auditor more than "this is the user's first `auth.role_claim_mapped` row after migration 21 was applied" (the timestamp is in `pgmigrations`). The `auth-error-handling` delta carries an auditor scenario saying so.

**Under-recording is safe only on the grant side (security R3).** For a deny rule, a backfilled `{application_admin}` without `engineering_manager` is not evidence that the user is not a manager. And a down-then-up cycle of migration 21 re-backfills every row while the user's latest audit row still carries a full `roles` field from before, so "the latest audit row has a `roles` field" alone would call a re-backfilled row resolved. The F1 precondition, recorded verbatim in `tasks.md`, therefore (1) states deny-side semantics: for an unresolved user, absence of a role is not evidence of lacking it, and deny rules must assume the denying role may be present or fall back to a `global_role`-based denial at least as strict as today's; and (2) anchors resolution to the latest `run_on` of migration 21 in `pgmigrations` and to `users.roles` equalling the audit row's `roles`. It recommends, without requiring, that F1's first migration apply this test and reset failing rows to `ARRAY[global_role]`.

### D9. Locking: two migrations, two lock windows
Sign-in, the WebSocket re-authorization sweep and every live check read `users`; 52 sites write `audit_log`. Changing both tables in one migration would hold `users` while waiting for `audit_log` (`lock_timeout` applies per acquisition), stretching the reader worst case to about 11 s, and would queue every new audit INSERT behind the pending `audit_log` lock, where transactional writers fail at their 400 ms statement timeout. Taking `audit_log` first is no better: it reverses the sign-in transaction's order (upsert `users`, then insert `audit_log`) and risks a deadlock (engineer F2).

So the schema change is split:
- **Migration 21 (`users` only).** `ADD COLUMN`, the backfill `UPDATE` and `ADD CONSTRAINT … CHECK` take ACCESS EXCLUSIVE on `users`. `SET LOCAL lock_timeout = '5s'`: it fails and rolls back rather than stall readers. Lock hold time is measured against a 10,000-user seed and MUST be at most 1 s; a larger measurement blocks the change until the migration is reshaped (e.g. `ADD CONSTRAINT … NOT VALID` then `VALIDATE CONSTRAINT`, which takes a weaker lock). Worst case for a `users` reader is one wait of about 6 s (up to 5 s queued behind the pending lock request, plus up to 1 s held). The `users` upsert at sign-in carries no statement timeout, so it waits rather than fails.
- **Migration 22 (`22_audit_log_actor_roles.sql`, `audit_log` only).** A nullable `ADD COLUMN` with no default plus `COMMENT ON COLUMN`: metadata-only, held for microseconds. `SET LOCAL lock_timeout = '200ms'`, deliberately below the 400 ms transactional audit statement timeout and the 500 ms fail-open timer: an audit INSERT queued behind the pending request waits at most about 200 ms and still completes, so no request fails because of migration 22. If it cannot get the lock in 200 ms it fails cleanly and the operator re-runs it; migration 21 has already committed and is unaffected.

Each migration must run in its own transaction. `npm run db:migrate` already passes `--no-single-transaction`; task 7.2 adds the flag to the `npx node-pg-migrate` command in `docs/deployment.md` and warns that without it both migrations share one transaction and the F2 problem returns. Each Up ends with `RESET lock_timeout` so a single-transaction run cannot leak the setting into later migrations. Task 1.1 confirms node-pg-migrate wraps each SQL file in a transaction under `--no-single-transaction` (otherwise `SET LOCAL` does nothing).

Upgrade notes recommend, not require, applying the migrations outside session hours, and say to re-run on lock timeout.

### D10. Migration shape and how it is tested
**`packages/backend/migrations/21_users_roles.sql`**, `-- Up Migration` / `-- Down Migration`, header comment citing #245, this design and the rollback note. Up: `SET LOCAL lock_timeout = '5s'`; create `users_roles_well_formed` (D2); `ADD COLUMN roles user_role[]` (nullable); `UPDATE users SET roles = ARRAY[global_role]`; `SET NOT NULL`; `ADD CONSTRAINT users_roles_consistent CHECK (users_roles_well_formed(roles, global_role) IS TRUE)`; create the D13 shim function `users_roles_fill_legacy()` and trigger `users_roles_fill_legacy`; `RESET lock_timeout`. Down: drop the trigger, then the shim function, the constraint, `users.roles`, the helper. `global_role` is untouched both ways.

**`packages/backend/migrations/22_audit_log_actor_roles.sql`**: Up: `SET LOCAL lock_timeout = '200ms'`; `ALTER TABLE audit_log ADD COLUMN actor_roles TEXT[] NULL`; `COMMENT ON COLUMN`; `RESET lock_timeout`. Down: drop the column.

**Testing (engineer F3).** The integration lane migrates before tests start, so migration tests use the repo's scratch-schema harness (`topic-annotation-integration.test.ts`): slice the Up and Down sections from the file and run them with `SET LOCAL search_path TO <scratch>, public`. Specifics:
- The scratch `users` is built in the **pre-21 shape**: `LIKE public.users INCLUDING ALL EXCLUDING CONSTRAINTS`, re-adding the pre-21 constraints the test needs, then `DROP COLUMN roles`. Copying the post-21 shape would carry a CHECK referencing `public.users_roles_well_formed`, and a Down run in the scratch schema would then resolve against `public`. The helper, shim and trigger created by Up land in the scratch schema (first on `search_path`).
- The test runs **Up → Down → Up** in the scratch schema, asserts the backfill, the constraint and the trigger after each Up and their absence after Down, asserts `global_role` unchanged throughout, and finally asserts that `public.users_roles_well_formed`, `public.users.roles` and the public trigger are untouched. This is the "up → down → up in CI" check; no separate CI step exists or is added.
- Migration 22's test gets its own scratch `audit_log` copy; an unqualified `ALTER TABLE audit_log` must never resolve to `public.audit_log`, which would take ACCESS EXCLUSIVE on it inside the test transaction and stall every parallel real-DB test file.
- The lock-timeout test needs a scratch schema that a second connection can see, so it creates and commits the scratch schema first, holds a conflicting lock on `scratch.users` from a second connection, runs Up, and asserts SQLSTATE `55P03` (`lock_not_available`) within about 5 s and the rolled-back shape (no `roles` column, no `global_role` change), then drops the schema. The non-zero exit is node-pg-migrate's behaviour on any error, not something this harness can observe.
- The 10,000-user hold measurement uses the same harness with a seeded scratch `users`, measured from the first `ALTER` to `COMMIT`, run once and recorded, not in every CI run.
- The live-lobby check (task 8.3) is a manual staging procedure, not an automated test: the implementer runs it against a local Docker Compose stack with the previous build image serving, records the result, and it gates merge.

### D11. Enum order is load-bearing and tested
CHECK rule 4 relies on the enum's sort order matching precedence. Two mandatory tests: `role-map.test.ts` (runs in `ci.yml` without Postgres, already parses `1_create_enums.sql`) asserts `GLOBAL_ROLES` order equals ascending `RANK` order with `engineer` lowest equals the declaration order in `1_create_enums.sql`; a real-Postgres test asserts it also equals `pg_enum.enumsortorder` for `user_role`. Adding an enum value in the wrong place then fails CI rather than corrupting the constraint.
`ALTER TYPE user_role ADD VALUE … BEFORE/AFTER` changes what `users_roles_well_formed` accepts for **existing** rows without revalidating them, and a validated constraint cannot simply be re-`VALIDATE`d. Any future migration that changes `user_role` must re-check existing rows (drop and re-add the constraint, or a verifying `SELECT` that fails the migration). This is recorded in `database-schema.md` (task 3.5).

### D12. Proving no authorization reads the set
Baseline and post-change output of the whole-word search
`rg -nw '(roles|actor_roles|previous_roles|previousRoles)' packages/backend/src --glob '!**/__tests__/**'`
are recorded in `tasks.md`. The baseline is not zero (comments in `content.ts` and `teams.ts` already say "roles"); what matters is the diff. Every hit that is new after the change MUST be in `auth/role-map.ts`, `auth/account-resolver.ts` or `routes/auth.ts`, and each new hit is reviewed and annotated as resolution, persistence, audit or comment, never an authorization decision. Whole-word matching catches SQL such as `SELECT roles` and `RETURNING roles`. The grep finds sites; the review is the evidence. The same check is a reviewer checklist item, alongside the D4 comparator. `roles` is not added to `/auth/me`, to the Redis session or to any client payload.

### D13. Transitional legacy-writer shim (upgrade window)
During a rolling upgrade, or when migrating against a running container, the previous build serves after migration 21 has applied. Its upsert writes `global_role` only, so without help a first sign-in fails NOT NULL and a role-changing sign-in fails the CHECK. Migration 21 therefore adds `users_roles_fill_legacy()` (`plpgsql`, `SECURITY INVOKER`, `SET search_path = pg_catalog, public`, no dynamic SQL), a `BEFORE INSERT OR UPDATE` row trigger on `users`:
- INSERT with `NEW.roles IS NULL` → `NEW.roles := ARRAY[NEW.global_role]` (Postgres checks NOT NULL after BEFORE triggers);
- UPDATE with `NEW.global_role IS DISTINCT FROM OLD.global_role AND NEW.roles IS NOT DISTINCT FROM OLD.roles` → `NEW.roles := ARRAY[NEW.global_role]`;
- otherwise no change.

Traced against the previous build's `INSERT … ON CONFLICT DO UPDATE` (engineer S3): the BEFORE INSERT trigger fires on the proposed row first, so `EXCLUDED.roles` gets the shim value; on conflict, `DO UPDATE SET` does not mention `roles`, so `NEW.roles = OLD.roles`, and BEFORE UPDATE fills `ARRAY[NEW.global_role]` if `global_role` changed. Both legacy paths pass the CHECK. This build never triggers it: it always supplies `roles`, and under rule 2 a writer that states `roles` cannot change `global_role` without changing `roles[1]`. The shim only ever writes the single-element set the backfill writes, so it never adds a role.

Recorded properties:
- **Masking on the UPDATE path (security S-b).** An UPDATE that changes `global_role` without stating `roles` is coerced, not rejected. That is the safe direction (it never adds a role), but "drift is loud" holds only for INSERTs and for UPDATEs that state `roles`. Every rule 2 negative test states `roles` explicitly, and one test UPDATEs with an inconsistent stated `roles` and expects `23514`.
- **Revocation runbook (security R4).** `docs/deployment.md`'s manual demotion currently works only because the shim fills `roles`. Once F1 drops the shim it would fail rule 2 mid-incident, and once checks read `roles` it would not revoke what `roles` grants. The runbook changes now to `UPDATE users SET global_role = 'engineer', roles = '{engineer}' WHERE id = …` (task 7.2), and F1's body records it. Neither this write nor the shim's writes produce an `audit_log` row; #244 follow-up 7 is widened to cover `roles`.
- **Stale-shrink blind spot.** A previous-build sign-in where `global_role` is unchanged but the IdP set shrank leaves `roles` at its earlier value until the next sign-in under this build. That user's `global_role` is not `engineer` (otherwise the set is `{engineer}` and cannot be stale), so the previous build writes an `auth.role_claim_mapped` row with no `roles` field, which makes the case detectable; the F1 precondition (D8) uses exactly that, plus the `users.roles` equality check. The only case that would grant something under F1's rules is `{application_admin, facilitator}` → `{application_admin}`.
- **Trigger naming.** This is the schema's first trigger. Postgres fires BEFORE triggers alphabetically; `users_roles_fill_legacy` must run before any future trigger that reads `roles`, and `database-schema.md` says so.
- **Removal.** F1's first migration drops the shim (by then no pre-21 build can be serving, since F1's build is newer than this one), and with it the `23502` test for an omitted `roles` becomes enforceable and the existing raw test inserts move to the fixture (D3). The shim's lifetime is tied to F1, which is unscheduled (H.4); this is recorded as an accepted risk in the security sign-off.
*Alternatives:* stop-the-world upgrade (old build stopped before migration 21), rejected because it changes the documented operator procedure and drops every live WebSocket; ship a pre-build that writes `roles`, impossible before the column exists.

## Risks / Trade-offs

- [Drift between `roles` and `global_role`, including malformed arrays] → D2's NULL-proof CHECK, one negative test per rule plus the four malformed-array rows and the stated-`roles` UPDATE (all SQLSTATE `23514`).
- [Backup restore fails on the CHECK] → D2 `search_path` pinning and schema qualification; one-off dump/restore check (task 1.1).
- [Someone "helpfully" reads `roles` in an authorization check in this PR] → non-goal in the proposal, the D12 grep, reviewer checklist, and the `oidc-role-mapping` requirement "The role set does not drive authorization in this step".
- [Capability rules later applied with the wrong polarity, e.g. "has `facilitator`" alone lets manager + facilitator open rooms] → rules copied verbatim into F1 with a required test pin: a manager + facilitator user cannot create a draft, and the refusal names no role and is visible to no one else.
- [Deny rule trusts an under-recorded set] → D8 deny-side wording in the F1 precondition.
- [Down-then-up re-backfill read as resolved] → D8 anchor to migration 21's latest `run_on` and to `users.roles`.
- [Claim values leaking through the role set] → `roles` built only from mapped output (D4); the #243 S7 spy test extended to the new fields; S4 re-run.
- [Comparator-less sort passes today by spelling] → D4 explicit comparator, reviewer checklist.
- [Backfilled sets read as truth] → D8 precondition on F1; "unresolved" is fail-closed and never means "assume engineer".
- [Enum order changed later] → D11 tests; future enum migrations must re-check rows.
- [Admin exclusion lost when F1 rewrites the participate rule] → constraint recorded on F1: if admins are ever allowed to participate, the rule must still deny `engineering_manager ∈ roles`.
- [`roles` cached in the session in F1, widening the revocation window] → F1 body states authorization keeps reading the database on every request.
- [Migration lock stalls a live room] → D9 split; `users` bounded at about 6 s once; `audit_log` lock wait below the audit timeouts; lock-timeout test; manual live-lobby, sign-in and join-link check (task 8.3).
- [Both migrations run in one transaction] → `--no-single-transaction` in the deployment doc, `RESET lock_timeout` at the end of each Up.
- [Previous build breaks sign-in after migration 21] → D13 shim, with legacy-writer tests for a first sign-in and a role-changing sign-in.
- [Shim left in place forever] → removal recorded on F1; harmless meanwhile (never adds a role, never fires for this build); accepted risk in the sign-off.
- [pg returns `user_role[]` as a string] → D5 `::text[]` read, `parseRoleArray` validation, real-Postgres test.
- [Concurrent first sign-in] → D5 rule: null together with `previousRole`, never defaulted; integrity error otherwise.
- [Spec wording] The scenario "Discard on a first sign-in is logged, not audited" keeps its name for archive continuity; its body now says the outranked role is in `roles` but no discard flag exists. "Not audited" refers to the discard flag.
- [Trade-off] `actor_roles` duplicates metadata on the only rows it fills in this step. Accepted for SQL-queryable manager history and contract-step readiness.

## Migration Plan

1. Apply migrations 21 and 22 (node-pg-migrate with `--no-single-transaction`, the same way as migrations 1 to 20, before or during the rollout as `docs/deployment.md` already describes). The previous build keeps working against the migrated schema (D13) and ignores `actor_roles`. Recommended outside session hours; not required. If either fails on lock timeout, re-run the command; already-applied migrations are skipped.
2. Existing users get `roles = {global_role}`. No `global_role` changes, so no sign-in, lobby, session or re-authorization outcome changes.
3. Each user's next interactive sign-in (at most about 90 minutes for active users) writes their full set and an audit row with `previousRoles`.
4. Operators switch conflict-finding to the audit SQL query in `docs/deployment.md` for sign-ins after migration 21, keeping the `discardedRoles` log search for earlier ones.

**Rollback (order is mandatory):** (1) redeploy the previous build and confirm no instance of this build is still serving; (2) optionally run the down migrations (22, then 21). The previous build runs correctly on the migrated schema through D13, so step 2 is not required. Running the down migration of 21 while this build still serves breaks sign-in, because this build writes `roles`; running 22's down breaks this build's sign-in audit insert. The down migrations drop only the shim, new column, constraint, helper and `actor_roles`; `global_role` and every authorization outcome are as before. Audit metadata rows already written keep their `roles` / `previousRoles` keys, which older code ignores. A later re-apply of migration 21 re-backfills every row; D8's anchor keeps F1 from trusting those rows.

## Security checks re-run (recorded in `security-review.md`)

- **S1** (manager + admin collapse): claim maps to admin + EM → `roles = [application_admin, engineering_manager]`, `global_role = application_admin`; discard line still fires with `[engineering_manager]`; D11 E1 to E4 tests pass unchanged. Manager status is now durable in audit, which improves S1's "invisible" finding. Exclusion is still closed by admin exclusion, not by the set. Still open for F1: TEAM-006 cannot associate this person as a manager; the D8 deny-side wording carries S1 forward.
- **S4** (own-key targets): `PERMITTED_TARGETS` and `RANK` stay `Set` / `Map`; boot fails on `{"A":"toString"}` and `{"A":"__proto__"}`; claim `["toString","__proto__","constructor"]` → `[engineer]`; a raw insert of `'{toString}'::user_role[]` raises `22P02`; `parseRoleArray` rejects any element outside `GLOBAL_ROLES`.

## Design review disposition

### Accepted

| Item | Change | Rationale |
|---|---|---|
| Engineer F1 / Security R1 (CHECK passes on NULL) | D2 rewritten: one `plpgsql` function with ordered checks for ndims = 1, lower bound = 1, no NULL element, then the four rules; returns `false`, never NULL; not `STRICT`; constraint wrapped in `IS TRUE`. Negative tests for `'{NULL}'`, `'{application_admin,NULL}'`, `'[0:1]={application_admin,facilitator}'`, `'{{facilitator}}'` (task 3.1). | Both reviewers found it independently and they are right. I chose ordered `IF`s over the suggested `COALESCE(<conjuncts>, false)` because `AND` order is not guaranteed and `array_position` raises `0A000` on a 2-D array, which would make the expected `23514` planner-dependent. Same intent, deterministic SQLSTATE. |
| Engineer F2 (audit_log in the users lock window) | `actor_roles` moved to migration 22 with `lock_timeout = '200ms'`; D9 restated; `--no-single-transaction` added to the deployment doc; `RESET lock_timeout`. | The split is the fix. I went one step further than the reviewer's "name the failure": a 200 ms lock wait sits below the 400 ms transactional audit timeout, so the failure mode does not occur rather than being documented. |
| Engineer F3 (migration tests cannot run in the lane) | D10 specifies the scratch-schema harness: pre-21 shape, Up → Down → Up, scratch `audit_log`, committed scratch schema for the lock test, `55P03` instead of exit code, one-off timing. Task 8.3 is a named manual gate. | Matches repo precedent and the lane as wired. |
| Engineer F4 (race gives `previousRoles` null) | D5 rule: null only together with `previousRole` null (no prior row seen); otherwise throw; `sameRoles(x, null) = false`; spec loosened from "never null" accordingly, with a scenario. | Passing null through matches what `previousRole` already does in the race and forges nothing, which also satisfies security §8's "never default it". Throwing would turn a double-click into a 500. |
| Engineer S1 / Security R5 (enum arrays) | D5: `::text[]` on read, `::user_role[]` on write, `parseRoleArray` validating against `GLOBAL_ROLES` and throwing, no global type parser, mocks mirror the cast. | One approach, fail closed. |
| Engineer S2 (fixtures) | Extend `Fixture.user` and add `Fixture.setRoles`; `insertUser` only for non-`Fixture` files; `auth.test.ts` excluded; `makeResolvedUser()`; `tsc --noEmit` on tests (local, against a recorded baseline; not CI-enforced, see D3 and F6). Migration of existing raw inserts (old tasks 2.2, 2.3) moved to F1. | The shim keeps those inserts working, so in this step the churn protects nothing; its value arrives with the `23502` test in F1, so it moves there. |
| Engineer S3 / Security R2 (functions) | Both functions `SET search_path = pg_catalog, public`, schema-qualified, `SECURITY INVOKER`, no dynamic SQL; one-off dump/restore check; trigger ordering note; down drops the trigger first. | A failed restore is a recovery failure. A one-off check rather than a permanent CI job, because the function bodies are fixed until F1 (see open item 2). |
| Engineer S4 (helper form, enum change) | D11 note: future `user_role` changes must re-check existing rows. | Adopted the intent; the loop form replaces `bool_and`. |
| Security R3 (F1 precondition holes) | D8 and the verbatim precondition in `tasks.md`: deny-side wording; anchor to latest `run_on` of migration 21 and `users.roles` equality; recommendation that F1 enforce it in a migration. | This is the main control for F1 and must be right before it is copied. |
| Security R4 (runbook depends on the shim) | Runbook writes both columns (task 7.2); recorded in F1's body. | Fix it before the incident, not during. |
| Security S-a, S-b; §6; §8; D-3 to D-7 | Comparator checklist item (D4); stated-`roles` UPDATE test (D13); no session caching or client exposure, carried into F1; auditor wording for `actor_roles` in docs; shim lifetime as accepted risk; follow-up 7 widened. | |
| Engineer minors | Fresh fallback array; frozen arrays; D11 split across `role-map.test.ts` and an integration test; "comment" as a fourth grep annotation; D7 reverse test; upgrade note about the first trigger on `users`. | |

### Partly accepted

| Item | Disposition | Rationale |
|---|---|---|
| Security R2 (dump/restore round trip in CI) | A one-off scripted check recorded in task 1.1, plus the review note that the bodies reference only `pg_catalog` and schema-qualified `public.user_role`. Not a permanent CI job. | Adding `pg_dump` to the integration lane is a CI infrastructure decision with ongoing cost; the bodies do not change until F1. Flagged for a human (open item 2). |

### Rejected

None.

### Open items needing a human decision

1. **Spec semantics of `previousRoles` in the concurrent race.** I loosened "always present and never null" to "null only when no prior row was seen, together with `previousRole`". It is the honest value and mirrors current behaviour, but it is a contract change to an audit field that auditors may rely on.
2. **Permanent dump/restore CI check** (security R2): whether to add `pg_dump`/`pg_restore` to the integration lane, or accept the one-off check.
3. **Moving the raw test-insert migration to F1** reduces this PR's scope; if the team prefers to keep it here (as preparation for F1), it can go back as tasks 2.2 and 2.3 unchanged.
