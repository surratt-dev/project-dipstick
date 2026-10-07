# Design Review: Store the IdP role set in `users.roles` (#245) — Engineer

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Reviewed:** `design.md` (D1–D13), `proposal.md`, `tasks.md`
**Code read:** `migrations/1_create_enums.sql`, `8_audit_log.sql`, `20_sessions_room_opened_at.sql`; `auth/role-map.ts`; `auth/account-resolver.ts`; `routes/auth.ts` (callback, `shouldEmitRoleClaimMapped`); `auth/audit-write-transaction.ts`, `auth/audit-write-timeout.ts`; `db.ts`; `routes/__tests__/helpers/real-db.ts`; `topic-annotation-integration.test.ts` (the migration-19 up/down harness); `auth.test.ts` and `account-resolver.test.ts` (mock shape); `.github/workflows/integration.yml`; `docs/deployment.md` §Database migrations.

## Verdict

**Implementable, with changes.** The shape is right: one writer, set computed once in a leaf module, `global_role = roles[0]`, consistency enforced in the database, and a shim whose trigger conditions I checked against the real upsert (it does the right thing under `INSERT … ON CONFLICT DO UPDATE`). The boundaries hold: the session carries only `userId` (`buildSessionData`), so `roles` does not reach Redis or the client.

Four things need fixing before implementation. The CHECK as written lets malformed arrays through (F1). The audit_log ALTER sits inside the `users` lock window and collides with the 400 ms transactional audit timeout (F2). The migration tests as tasked cannot run in the CI lane as it is wired (F3). The concurrent-first-sign-in race makes `previousRoles` null on a returning user, which the design says cannot happen (F4). The rest are smaller.

---

## Blocking

### F1. The CHECK passes NULL elements, 2-D arrays and non-1 lower bounds (D2)

A CHECK passes when its expression is **NULL**, not just when it is true. Postgres arrays also allow NULL elements, more than one dimension and arbitrary lower bounds, and `NOT NULL` on the column covers none of these. Rows that the four rules as written would accept:

| Row | Why it passes |
|---|---|
| `global_role='facilitator', roles='{facilitator,NULL}'` | Rule 3: `'engineer' = ANY(...)` gives NULL, so `NOT(NULL) OR false` is NULL. Rule 4: any `a[i] > a[i+1]` comparison against NULL is NULL, and `bool_and` gives NULL. The CHECK passes. |
| `global_role='facilitator', roles='{{facilitator}}'` | `roles[1]` on a 2-D array is NULL, so rule 2 is NULL. `cardinality` is 1. The CHECK passes. |
| `global_role='senior_engineer', roles='[0:1]={facilitator,senior_engineer}'` | `roles[1]` is `senior_engineer`, so rule 2 is true. The array is strictly descending, so rule 4 is true. The stored set's real highest role (`facilitator`) disagrees with `global_role`. That is exactly the drift D2 exists to prevent. |

D2's stated purpose is "cannot disagree with `global_role` whoever writes the row". A hand-written SQL fix or a future writer could produce any of these.

**Fix:** add these rules to the constraint and wrap the whole expression so it can never be NULL:
- `array_ndims(roles) = 1`
- `array_lower(roles, 1) = 1`
- `array_position(roles, NULL) IS NULL`

Write the expression as `COALESCE(<all rules>, false)`. Make `users_roles_well_formed` return `true` for a one-element array and `false`, never NULL, otherwise. A bare `bool_and` over zero rows returns NULL, which matters for `{engineer}`. Task 1.2 gains three negative tests (`23514`) for these rows.

### F2. `ALTER TABLE audit_log` inside the `users` lock window breaks the "≤ ~6 s delay" claim (D9, D10)

D9 analyses only `users`. Migration 21 also takes ACCESS EXCLUSIVE on `audit_log`, and D10 puts that last, while the `users` lock is still held. Two consequences the design does not cover:

1. **The hold on `users` can exceed 1 s.** `lock_timeout` applies to each lock acquisition separately. If any transaction has `audit_log` open (52 insert sites, all of them fail-open or transactional writers), the migration can sit holding `users` for up to another 5 s while it waits for `audit_log`. The worst case for a reader becomes about 11 s, not about 6 s.
2. **Audit writes fail fast rather than wait.** Once the migration's ACCESS EXCLUSIVE request on `audit_log` is queued, every new `audit_log` INSERT queues behind it. Transactional writers run under `SET LOCAL statement_timeout = 400` (`TRANSACTIONAL_AUDIT_STATEMENT_TIMEOUT_MS`), so `join.link_created`, `join.link_redeemed` and the sign-in audit row itself throw `AuditWriteError`, and **the request fails**. It is not delayed. Fail-open writers hit their 500 ms client timer. The proposal's "no re-authorization is refused, nobody has to sign in again" holds for `users` readers but not for these paths.

Reordering does not help: taking `audit_log` first and `users` second is the reverse of the sign-in transaction's order (upsert `users`, then insert `audit_log`), which risks a deadlock.

**Fix:** move `audit_log.actor_roles` into its own migration (`22_audit_log_actor_roles.sql`) with its own `SET LOCAL lock_timeout`. It is a metadata-only nullable ADD COLUMN, so its hold is microseconds. It must also run in its own transaction. `npm run db:migrate` already passes `--no-single-transaction`. The `npx node-pg-migrate -m migrations up` command in `docs/deployment.md` (~l.247) does not, and node-pg-migrate's CLI default is a single transaction for all pending migrations, so verify that and add the flag to the doc in task 6.2. Then restate D9's bound, and the proposal's matching sentence, honestly: "while migration 21 holds `users`, sign-in waits; a transactional audit write that overlaps migration 22's lock wait can fail with 400 ms and the user retries". Alternatively, D9 and the scenarios can name the failure explicitly. Either way the "verified by test" claim in task 7.3 needs a sign-in plus a join-link redemption during the migration, not only a WebSocket lobby.

Related: `SET LOCAL lock_timeout` persists for the rest of the transaction. Under single-transaction mode that means every later pending migration. Add `RESET lock_timeout` at the end of Up, or note it.

### F3. Tasks 1.4, 1.5 and 1.8 cannot run as written in the integration lane

`integration.yml` runs `npm run db:migrate` **before** `npm run test`, so migration 21 is already applied when any test starts. Task 1.8 ("run migration 21 up … exits non-zero … no `roles` column") and task 1.4 ("apply migration 21") have no un-migrated database to work on. The repo's precedent is the scratch-schema harness in `topic-annotation-integration.test.ts`: slice the Up and Down sections out of the file, then `CREATE TABLE scratch.x (LIKE public.x INCLUDING ALL)` and `SET LOCAL search_path`. That pattern works here only with care:

- `LIKE public.users INCLUDING ALL` copies the post-21 shape, **including the CHECK that references `public.users_roles_well_formed`**. Running Down first in the scratch schema would then resolve `DROP FUNCTION users_roles_well_formed` against `public`, because the scratch schema has none yet. That fails on the dependency, or worse. Build the scratch `users` from the pre-21 shape (`LIKE … EXCLUDING CONSTRAINTS`, then drop `roles`), run **Up → Down → Up** in the scratch schema, and assert at the end that `public` objects are untouched.
- The scratch schema needs its own `audit_log` copy. Otherwise the unqualified `ALTER TABLE audit_log` resolves to **`public.audit_log`** and takes ACCESS EXCLUSIVE on it inside the test transaction, which stalls every parallel real-DB test file. If F2 is adopted this moves to migration 22's test.
- "Exits non-zero" is runner behaviour that the test cannot observe through the scratch harness. Assert SQLSTATE `55P03` (`lock_not_available`) and the rolled-back shape instead, and leave the exit code to node-pg-migrate.
- D10 says "Up → down → up runs in CI". No CI step does that today, so it has to be this scratch-schema test. Say so in D10, or add a CI step and a task for it.
- Task 1.5's 10,000-user measurement fits the same harness: a seeded scratch `users`, with the time measured from the first ALTER to COMMIT. Record it as a one-off measurement. It should not run in every CI run.
- Task 7.3 (previous build plus live lobby during the migration) is a manual staging procedure, not an automated test. Name who runs it, against what, and that it gates merge.

### F4. Concurrent first sign-in returns `isNewUser = false` with `previousRoles = null` (D5, D6)

The `prior` CTE reads the statement snapshot. When two callbacks for the same new subject race (double-submit, two tabs), the loser hits `ON CONFLICT DO UPDATE` against a row its snapshot cannot see. The result is `xmax ≠ 0` (`is_new_user = false`) and an empty `prior`. The current code already returns `previousGlobalRole: null` for a non-new user in this case. Under this design, D6's "`previousRoles` always present, never null" and D5's "null only when `isNewUser`" are both false here. The `auth.role_claim_mapped` row would carry `previousRoles: null` against a spec that forbids it, and `sameRoles(u.roles, null)` needs a defined answer.

**Fix:** state the race in D5 and D6. Pick a behaviour: emit `previousRoles: null` and loosen the spec to "null only in the concurrent-first-sign-in race", or treat it as changed. Add a unit test with a hand-built `ResolvedUser` (`isNewUser: false, previousGlobalRole: null, previousRoles: null`). Keep the TypeScript type nullable, and fix its doc comment.

---

## Should fix

### S1. Enum array handling with `pg` (D5): be specific

D5 is right that node-postgres returns `user_role[]` as the raw string `{a,b}`. The enum array type's OID is assigned per database and is unknown to `pg-types`. Pick one approach now so the implementer does not invent a third:
- **Read:** `RETURNING roles::text[] AS roles, (SELECT roles::text[] FROM prior) AS previous_roles`. `text[]` (OID 1009) is parsed natively. Then narrow each element through `GLOBAL_ROLES` at runtime and throw on anything else, rather than using an `as GlobalRole[]` cast. Do **not** register a global `types.setTypeParser` for the enum array's OID. That needs a catalogue query at boot in `db.ts`, which couples pool start-up to the schema and to migration order.
- **Write:** pass the JS array with an explicit cast: `VALUES (…, $6::user_role[])`. Inference from the target column works for `VALUES`, but the explicit cast documents intent and survives refactors into `SET roles = $n`.
- **`actor_roles`:** `TEXT[]` takes a JS array directly.
- **Mocks:** `account-resolver.test.ts` mocks return hand-built rows, so they will happily return real arrays and hide a missing cast. Task 4.2's real-Postgres assertion (`Array.isArray`) is the actual guard. Keep it, and have the mock row factory return what the cast returns.

### S2. Test-fixture plan duplicates an existing helper and misclassifies `auth.test.ts` (D3, tasks 2.1–2.3)

- `real-db.ts` already has `Fixture.user(globalRole = "facilitator")`, used in 64 places across 18 files, and it tracks ids for `cleanup()`. A free-standing `insertUser` next to it gives two ways to create a user, one without cleanup tracking. **Extend `Fixture.user` to accept `GlobalRole | readonly GlobalRole[]`**, deriving `global_role` from element 0, and add `Fixture.setRoles(id, roles)`. Export a thin `insertUser(db, …)` only for files that do not use `Fixture`.
- `auth.test.ts` mocks `db.js`. Its `INSERT INTO users` is a `sql.includes(...)` matcher on a mocked query, not an insert. It cannot "migrate to `insertUser`", and task 2.2's verification grep (`rg -il 'insert\s+into\s+users'`) will always match it. Exclude it from 2.2 and from the grep.
- `phantom-em-relationship-detection.test.ts` and others use multi-row `VALUES` inserts, so the helper needs a batch form or those tests become N round trips. That is fine, but say so.
- **Scope question:** while the D13 shim exists, every one of these legacy inserts and both `UPDATE users SET global_role` sites **keep working unchanged**, because the shim fills `roles`. The churn in tasks 2.2 and 2.3 (about 13 files, about 36 statements) therefore buys nothing in this behaviour-neutral step. The guard it provides only matters once F1 drops the shim. I would **move 2.2 and 2.3 to F1**, alongside the 23502 test they exist to protect, and keep 2.1 here. If the team keeps them here, I can accept that, but D3's justification should say "preparing for F1", not "guard".
- `auth.test.ts` has 11 hand-built `ResolvedUser` objects. Vitest does not type-check, so objects missing `roles` and `previousRoles` will silently produce `roles: undefined` in metadata assertions. Add a `makeResolvedUser()` factory with the new fields, and have `tsc --noEmit` cover the test files (check that the backend `tsconfig` includes `__tests__`).

### S3. The shim trigger: confirmed correct, three notes to record (D13)

I traced the old build's upsert through the trigger:
- On `INSERT … ON CONFLICT`, the BEFORE INSERT trigger fires on the proposed row first, so `EXCLUDED.roles` gets the shim value.
- On conflict, `DO UPDATE SET` does not mention `roles`, so `NEW.roles = OLD.roles`.
- BEFORE UPDATE then sees `global_role` changed and `roles` not distinct, and fills `ARRAY[NEW.global_role]`.

Both legacy paths therefore pass the CHECK, and the new build can never match the UPDATE branch under rule 2. Good. Record these in D13:
- **It is the schema's first trigger and first user function** (no existing migration has either). Write the function in `plpgsql` with `SET search_path = pg_catalog, public`, and pin the same on `users_roles_well_formed`. A `pg_dump`/`pg_restore` sets `search_path = ''`, and CHECK constraints are evaluated during the data load, so an unqualified reference in the helper body can fail a restore. Add one test: a dump and restore of a database containing a multi-role row, or at minimum a review note that the bodies reference only `pg_catalog` objects.
- Name the trigger so it sorts predictably if a second BEFORE trigger is ever added (Postgres fires them alphabetically). `users_roles_fill_legacy` is fine; just state that it must run before any future trigger that reads `roles`.
- The down migration must drop the trigger before the column. D10 lists that order. Keep it.

### S4. CHECK helper: write it so the planner can't surprise you

`IMMUTABLE` is legitimate: enum comparison operators are immutable, and D11 pins the enum order. Prefer a set-returning-free form, for example:

```sql
SELECT coalesce(bool_and(a[i] > a[i+1]), true)
FROM generate_subscripts(a, 1) AS i
WHERE i < array_upper(a, 1)
```

with the F1 shape rules checked in the constraint before it. Note in D11 that `ALTER TYPE user_role ADD VALUE … BEFORE/AFTER` silently changes what this function accepts for **existing** rows without revalidating them. The D11 test catches a misordered enum in CI. It does not catch already-stored rows becoming invalid, so any future enum change needs a `VALIDATE` step in its migration.

---

## Minor

- **D4 / `resolveRoleSet`:** sorting with `RANK.get(b)! - RANK.get(a)!` is safe only because `mapValues` never yields `engineer`. Assert that in a comment or a test. The fallback must stay `[FALLBACK_ROLE]` built fresh on each call, not a shared frozen array that callers might mutate (same reasoning as `parseRoleMap`'s copy of `DEFAULT_ROLE_MAP`).
- **D11:** split the test. The existing `role-map.test.ts` already parses `1_create_enums.sql` and runs in `ci.yml` without Postgres, so put the `GLOBAL_ROLES` vs `RANK` order check there. The `pg_enum.enumsortorder` check needs the integration lane. Task 1.3 should name both files.
- **D12 grep:** the whole-word `roles` pattern will also hit new comments in the three named files. Fine, but the annotation in task 7.1 should allow "comment" as a fourth category alongside resolution, persistence and audit.
- **D6:** feeding the row and the event from one array is right. Freeze it (`Object.freeze([...roles])`) at the point `resolveOrCreateAccount` returns, so a later mutation cannot make them differ.
- **D7:** the hand-built-input test is the right pin. Also assert the reverse: identical sets and an unchanged non-engineer role still fire through the first disjunct, so contract step 2's deletion has a test that tells it what changes.
- **Upgrade notes (6.2):** add "the first trigger on `users` exists until F1" so an operator who inspects the schema is not surprised.

## Summary of requested design edits

1. **D2:** add the `ndims`, `lower` and no-NULL rules, make the expression NULL-proof with `COALESCE`, and add three negative tests.
2. **D9/D10:** split `audit_log.actor_roles` into migration 22. Restate the bound, including the 400 ms transactional-audit failure mode. Add `--no-single-transaction` to the deployment doc command, and `RESET lock_timeout` at the end of Up.
3. **D10/tasks 1.x:** specify the scratch-schema harness (pre-21 shape, scratch `audit_log`, SQLSTATE `55P03` instead of the exit code). Name task 7.3 as a manual gate.
4. **D5/D6:** define `previousRoles` for the concurrent-first-sign-in race.
5. **D5:** `::text[]` on read, `::user_role[]` on write, runtime narrowing, no global type parser.
6. **D3/tasks 2.x:** extend `Fixture.user` instead of adding a parallel `insertUser`, drop `auth.test.ts` from 2.2, and consider moving 2.2 and 2.3 to F1.
7. **D13:** pin `search_path` on both functions, and record the dump/restore consideration.
