# Tasks review: Solution Architect (Ingrid Sollenberger)

Change: `store-idp-role-set` (#245, expand step)
Scope of this review: does the task order follow the architectural dependencies, does any task assume something not yet built, and do the referenced files and functions exist in `packages/`.
Inputs read: `tasks.md`, `design.md` (rev. 2), `proposal.md`, plus the backend source, tests, CI workflows and the docs the tasks cite.

## Verdict

**Approve with changes.** The overall order is right: schema (1) → fixtures (2) → resolver (3) → upsert (4) → audit (5) → docs (6) → integration checks (7). The upgrade-safety design (D13 shim, D9 split) means landing migration 21 first breaks nothing, because the current code behaves exactly like the "previous build" the shim exists for. That is a good property, and it is what makes schema-first safe here.

Five tasks still depend on work that comes later, and one verification step relies on a guarantee the repo does not have today. None of this changes the design. The fixes are reorders and one sentence each.

## Blocking: forward dependencies

### A1. Task 1.7's last assertion needs tasks 3.1 and 4.1
"Also assert this build's upsert for `{engineering_manager, facilitator}` stores exactly that set (the shim did not fire)" calls `resolveOrCreateAccount` writing `roles`, which arrives in 4.1, using the resolver from 3.1. At step 1.7 the upsert does not write `roles` yet, so the assertion fails (the shim stores `{engineering_manager}`).
**Fix:** move that sentence to task 4.2 (it is the same real-Postgres test shape and file), or add it as a new 4.4. Leave the legacy-writer cases (a) to (d) in 1.7.

### A2. Tasks 1.2 and 1.7 need the task 2.1 fixtures
D3 says "New tests in this change that need a multi-role user use these" (`Fixture.user([...])`, `Fixture.setRoles`, `insertUser`). Task 1.7(c) needs a stored `{application_admin, engineering_manager}` user, and 1.2's "mapped" positive insert needs a multi-role row. Neither helper exists until 2.1. An implementer following the order will either write raw untracked inserts (which D3 forbids) or skip ahead.
**Fix:** move 2.1 to directly after 1.1 (it needs only the `roles` column), or say in 1.2 and 1.7 that these tests run inside a rolled-back transaction with raw SQL, as the CHECK negative tests have to anyway. I prefer moving 2.1: one way to create users, as D3 says.

### A3. Task 2.2 needs the `ResolvedUser` fields from task 4.1
`makeResolvedUser()` "carrying `roles` and `previousRoles`" cannot be typed against `ResolvedUser` until 4.1 adds those fields. Conversely, once 4.1 adds required fields, the 11 hand-built objects in `auth.test.ts` stop being valid `ResolvedUser`s.
**Fix:** split 2.2. **2.2a** (before 4.1): introduce `makeResolvedUser(overrides)` with today's fields and replace the 11 literals, with no behaviour change. **2.2b** (inside 4.1, same commit): add `roles` and `previousRoles` defaults to the factory when the interface gains them.

### A4. Task 1.5 is a stop gate but runs after the tests it would invalidate
1.5 says "if [the lock hold] is not [≤ 1 s], stop and reshape the migration (D9)". The reshape D9 names (`ADD CONSTRAINT … NOT VALID` then `VALIDATE CONSTRAINT`) changes what 1.4 (scratch Up → Down → Up asserts) and 1.8 (lock-timeout behaviour) test.
**Fix:** move 1.5 to directly after 1.1, before 1.2 to 1.4 and 1.8. Do the same with 1.1(c) (`pg_dump` / `pg_restore`), which is already inside 1.1.

### A5. "`tsc --noEmit` covers the backend test files" is true but proves nothing today
Task 2.2 and D3 depend on "a missing field is a type error rather than `roles: undefined`". I checked:
- `packages/backend/tsconfig.build.json` excludes `src/**/__tests__`, and `ci.yml` type-checks only through `npm run build` (plus the frontend's own `typecheck`). **No CI job type-checks backend test files**, and vitest strips types.
- `npx tsc -p packages/backend/tsconfig.json --noEmit` currently reports **203 errors** in test files, including 13 in `routes/__tests__/auth.test.ts`, 18 in `auth/__tests__/account-resolver.test.ts` and 2 in `helpers/real-db.ts`.

So the check is already red and nothing runs it. The guarantee D3 relies on does not exist.
**Fix (pick one, and record it):** (a) change 2.2's verification to "`tsc --noEmit` reports no errors in `auth.test.ts`, `account-resolver.test.ts`, `real-db.ts` or any file this change touches beyond the baseline count, recorded under Records". This is cheap and honest. Or (b) add a scoped CI typecheck for those files. That would make the guarantee true going forward, but it is scope creep for an expand step. I recommend (a), and adding the test-file type debt to the follow-up list so it is not discovered again.

## Should fix: ambiguity that will cause churn

### B1. Task 3.1 does not say what happens to `resolveGlobalRole`
D4 introduces `resolveRoleSet` and says `resolveGlobalRole` "either delegates to it or is replaced". The only production caller is `account-resolver.ts:87`. If 3.1 replaces it, the build breaks until 4.1 lands.
**Fix:** 3.1 adds `resolveRoleSet` and makes `resolveGlobalRole` delegate to it, so the build stays green. 4.1 switches the caller. Removing `resolveGlobalRole` happens in 4.1 or never. Name `resolveRoleSet` in the task text, since the task currently says only "role-set resolution".

### B2. Task 4.1 does not say where `parseRoleArray` lives
It validates against `GLOBAL_ROLES` and has no I/O, so it belongs in `role-map.ts`, which stays a leaf because it adds no import. But 3.1 says "no new imports, module stays a leaf", and a reader may then put it in `account-resolver.ts` and duplicate the role list.
**Fix:** state "`parseRoleArray` is exported from `role-map.ts` (pure, no new imports)". Its unit tests can then go in `role-map.test.ts` and run in `ci.yml` without Postgres.

### B3. Task 1.2's "positive insert per resolver outcome" is ambiguous
In section 1 there is no resolver output. Read literally, it means "insert the row shapes each outcome produces" (`{engineer}`, `{engineer}`, a mapped set), and that is fine at that point. Read as "sign in through the resolver", it depends on 3.1 and 4.1.
**Fix:** reword to "one positive raw insert per row shape the resolver can produce (`{engineer}`; a single mapped role; a multi-role mapped set)".

### B4. Task 5.1 changes SQL that `auth.test.ts` matches by substring
`auth.test.ts` mocks `db.js` and matches on `INSERT INTO audit_log` (l.928, 2113, 2134, 2169, 2267), then reads parameters by position. Adding `actor_roles` to the column list shifts the parameter positions, and any assertion that indexes `params[n]` breaks without the cause being obvious.
**Fix:** put `actor_roles` last in both INSERTs, and add to 5.1 "update positional parameter assertions in `auth.test.ts`". This is also a natural place to use `makeResolvedUser()` from 2.2b.

### B5. Task 7.3 needs a previous-build image that no task produces
"With the previous build image serving" assumes a tagged image of `main` before this change. It exists only if `docker.yml` has published one or the implementer builds it.
**Fix:** add "build or pull the image of the merge base (`main` @ cc3a66f or later) and record its tag" as the first step of 7.3.

## Minor: references and placement

- **Wrong path, tasks 1.3 and 3.2:** `src/auth/role-map.test.ts` does not exist. The file is `src/auth/__tests__/role-map.test.ts`, and `account-resolver.test.ts` is likewise under `src/auth/__tests__/`. The `describe("claim resolution (task 3.1)")` block exists at l.325. Its "task 3.1" label refers to #243's task, not this change's 3.1, so worth a word in the task to avoid confusion.
- **Task 3.1 "existing leaf-module check":** I found no automated leaf check, only the comment at `role-map.ts:104` and the header of `role-map.test.ts`. Either point to the test that enforces it, or change the verify step to "no new `import` lines in `role-map.ts` (review)".
- **Task 4.2 home:** use the existing `src/auth/__tests__/role-claim-persistence-integration.test.ts` (#235). Do not create a new integration file.
- **Task 2.1 signature:** `Fixture.user(globalRole = "facilitator")` is typed `string` today. Narrowing it to `GlobalRole | readonly GlobalRole[]` may type-break callers that pass a `string` variable (64 call sites). Given A5, CI will not notice, but the runtime CHECK will for a wrong value. Say "accept `string | readonly GlobalRole[]`", or confirm all callers pass literals.
- **Task 1.3 placement:** the D11 enum-order tests guard the assumption that CHECK rule 4 is built on. They do not depend on migration 21. Running them first, or with 1.1, is slightly better: if the enum order is not what D2 assumes, you find out before writing the constraint.
- **Task 0.2 before 1.5:** F1's body does not cite the measured lock time, so drafting follow-ups first is fine.
- **Line references checked and correct:** `docs/deployment.md` ~196 (revocation `UPDATE`), ~214 to 219 (checklist and `discardedRoles`), ~247 (`npx node-pg-migrate`); `database-schema.md` 36 to 39 and 101; TEAM-006 alternate flow at ~271 (task says ~272); `routes/facilitator-sessions.ts` ~318 (`global_role !== "facilitator"`, message matches 7.2); `routes/sessions.ts:189` (participant message matches 7.2).
- **Existence checked:** `migrations/` ends at `20_…`, so 21 and 22 are free; `db:migrate` already passes `--no-single-transaction`; `integration.yml` migrates before `npm run test`, as D10 assumes; the scratch-schema harness in `topic-annotation-integration.test.ts` (l.206 to 220) matches D10's description; D11 E1 to E4 tests exist in `admin-session-exclusion-integration.test.ts` and `facilitator-sessions.test.ts`; the #243 S7 spy logger exists in `auth.test.ts` (~l.2601); `shouldEmitRoleClaimMapped`, `ResolvedUser`, `previousGlobalRole`, the `prior` CTE, `RANK`, `GLOBAL_ROLES`, `DISCARDABLE`, `mapValues` and `FALLBACK_ROLE` all exist as described.

## Proposed order

```
0.1, 0.2
1.1 (incl. 1.1c pg_dump)  →  1.5 timing gate  →  1.3 enum-order tests
2.1 fixtures
1.2, 1.4, 1.7 (a–d only), 1.8, 1.6
2.2a makeResolvedUser refactor (no new fields)
3.1 resolveRoleSet + parseRoleArray in role-map.ts; resolveGlobalRole delegates
3.2
4.1 (+ 2.2b factory fields, switch caller)  →  4.2 (+ moved 1.7 "this build" assertion)  →  4.3
5.1 – 5.4
6.1 – 6.3
7.1, 7.2, 7.3 (with image step), 7.4, 7.5
```

## Architectural note (no task change)

Every intermediate state in the proposed order can be deployed: after 1.1 the running code is a "previous build" covered by D13, and after 3.1 the resolver change is additive. That is the property to protect. If the implementer splits this into several commits, each one should pass the integration lane on its own, and the order above allows that. The original order does not: 1.7 and 2.2 would be red until 4.1.
