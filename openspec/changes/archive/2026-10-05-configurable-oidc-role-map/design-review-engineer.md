# Design Review: Configurable OIDC role map (#243): Engineer

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Reviewed:** `design.md`, `proposal.md`, `tasks.md`, `specs/*/spec.md`
**Checked against:** `packages/backend/src/auth/account-resolver.ts` (+ test), `packages/backend/src/config.ts` (+ `__tests__/config.test.ts`), `packages/backend/src/routes/auth.ts` (+ `routes/__tests__/auth.test.ts`), `auth/audit-write-transaction.ts`, `auth/standing-facilitator-access-helper.ts`, `docker/oidc/accounts.js`, `docker-compose.yml`, `.env.example`
**Out of scope (binding user decision):** fixed precedence and single-value `global_role`.

## Verdict

**Approve with required changes.** The shape is right. A pure `role-map.ts` called from `loadConfig`, `Map`-based own-key lookup, fail-at-boot for the manager hole, and audit lockstep in `routes/auth.ts` all fit the codebase's existing patterns. I'd build it this way. But two of the design's claims are false against the code as it stands today, and if nobody fixes them the safety properties the design relies on just won't exist. The first is "the compiler rejects any new string". The second is that the warn lines carry `{ claimName, correlationId }`. Both are cheap to fix and need to be in the design before implementation starts.

---

## Required changes

### R1. There is no global-role union type. D7's compile-time guarantee does not exist.

D7 says: *"The returned role type is the existing global-role union, so the compiler rejects any new string."* That type doesn't exist. `ResolvedUser.globalRole` is `string`, `mapRoleClaimToGlobalRole` returns `string`, `standing-facilitator-access-helper.ts` types `global_role: string`, and `packages/shared/src/types/team-content-access.ts` uses `actorGlobalRole: string`. I searched `packages/backend/src` and `packages/shared` and found no `GlobalRole` type.

**Fix:** have `role-map.ts` define and export `GlobalRole = "engineer" | "senior_engineer" | "facilitator" | "engineering_manager" | "application_admin"`, with `MappableRole = Exclude<GlobalRole, "engineer">`. Type the `RANK` constant as `Record<MappableRole, number>` so a missing or extra role becomes a compile error. Narrow `ResolvedUser.globalRole` to `GlobalRole` at the resolver boundary only. Widening the type across the rest of the backend is the "predicates" follow-up and stays out of this change. Task 1.1's check that "the type rejects `engineer` as a target" only holds if task 1.1 defines these types, so add that explicitly. A unit test should also check that the TS union matches the Postgres `user_role` enum labels (or a comment should point at the migration), because nothing else ties the two together.

### R2. The resolver's logger calls use the wrong argument order for pino. Today `claimName` never reaches the logs.

`resolveOrCreateAccount` gets `request.log`, which is Fastify's pino logger, but the code calls `logger.warn("message", { claimName })`. In pino a leading string is the message, and later arguments are only used as `%s/%o` interpolation values. With no placeholder, the object is dropped. So today's unmapped warning is logged without `claimName`. The existing test passes anyway because it uses a hand-rolled `{ warn: vi.fn() }` spy that accepts any argument order. (`node_modules` isn't installed in this checkout so I couldn't run pino, but this is pino's documented signature.)

D7 adds two warn lines whose whole point is their fields (`claimName`, `resolvedRole`, `correlationId`). An operator answering "why can't this person facilitate?" filters on `correlationId`. With the current call style those fields would be silently lost in production, and every test in task 2.3 would still pass.

**Fix:**
- Type the parameter as `FastifyBaseLogger` (or `Pick<FastifyBaseLogger, "warn" | "debug">`), not the custom `{ warn(msg, fields) }` shape.
- Call `logger.warn({ claimName, correlationId }, "…")` with the object first.
- Task 2.3's logger-spy assertions must check `calls[0][0]` is the fields object and `calls[0][1]` is the message, so the test enforces pino's argument order.

### R3. Say how `correlationId` reaches the resolver, and pick one way.

D7 says "a child logger bound to it (or the id itself)". Choose one. My recommendation is a child logger: `request.log.child({ correlationId })` passed as the `logger` argument. That needs no signature change for `correlationId`, every line from the resolver carries it automatically, and there's no risk of passing the id to one warn and forgetting the other. Test it by spying on `child` in `auth.test.ts`, or by asserting the logger passed to the mocked `resolveOrCreateAccount` was built with `{ correlationId }`. Note that `auth.test.ts` mocks `resolveOrCreateAccount` itself, so the resolver tests cannot prove the route wiring. You need one test in each file.

### R4. `account-resolver.ts` should receive the map as a parameter instead of reading `config.roleMap` at call time.

Task 2.2 writes `resolveGlobalRole(claims[ROLE_CLAIM_NAME], config.roleMap)` inside the resolver. 40 backend test files mock `config.js` with hand-built objects. The `account-resolver.test.ts` mock today is just `{ DATABASE_URL, SESSION_SECRET }`, so `config.roleMap` would be `undefined` and `map.get` would throw. Also, `ROLE_CLAIM_NAME` is already captured at module load, so the resolver is coupled to config twice.

**Fix:** export `DEFAULT_ROLE_MAP` from `role-map.ts`. Have `resolveOrCreateAccount` take the map as an injected argument (an options object is cleaner than a fourth positional parameter): `routes/auth.ts` passes `config.roleMap`, and tests pass `DEFAULT_ROLE_MAP` or a custom map. Do **not** silently fall back to the default map when `config.roleMap` is missing. That fallback would be the exact fail-open path this change is meant to close. If the map is ever missing at runtime, throw.

Also state in D1 that `role-map.ts` must not import `config.js` or `db.js`. `config.ts` will import from `auth/role-map.ts`, so any import going back the other way creates a cycle that runs during module load.

### R5. `FullConfig` cannot hold `roleMap` as written, and the raw string should not ride along in `config`.

`FullConfig` is `Record<ConfigKey, string> & Partial<Record<OptionalConfigKey, string>>`. You can't put a `ReadonlyMap` and a `"configured" | "default"` value on it without changing the type. Also, if task 1.6 adds `OIDC_ROLE_MAP` to `optional`, the generic loop copies the raw JSON string onto the exported `config`, and anything that logs `config` in the future will print the full map. That breaks the "never print the full value" property by a side door.

**Fix:** keep `OIDC_ROLE_MAP` out of `optional`, read `process.env.OIDC_ROLE_MAP` directly in `loadConfig`, and extend the exported type: `FullConfig & { roleMap: ReadonlyMap<string, MappableRole>; roleMapSource: "configured" | "default" }`. Update task 1.6 to match.

### R6. `loadConfig` has no test harness. Task 1.6 needs one.

`__tests__/config.test.ts` says outright: *"We can't easily test loadConfig() because it runs at import time and calls process.exit."* Task 1.6 asks for a config test showing that production without the map exits, without saying how. D1's pure-function split already covers almost all of the logic, so the config-level test only needs to prove the wiring. Pick one approach in the task:

- `vi.resetModules()`, set `process.env`, `vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit") })`, spy `console.error`, then `await import("../config.js")`. The test must also satisfy the three earlier production guards: `APP_ORIGIN` set, `SESSION_SECRET` of at least 32 characters, and a public `OIDC_ISSUER`. Otherwise it exits for the wrong reason and still passes. Assert on the `FATAL: OIDC_ROLE_MAP` message, not just on the exit.

The cleaner alternative is to export `loadConfig(env = process.env)` and keep `export const config = loadConfig()`. Either way, write the choice down so the implementer doesn't spend half a day on it.

---

## Recommended changes

### C1. Use one helper for the audit firing condition in both places.

D8 applies `globalRole !== "engineer" || globalRole !== previousGlobalRole` in two places: the transactional INSERT and the post-commit `emitAuditEvent`. They are 40 lines apart, and they already differ in metadata today. The structured log omits `previousRole`, but the `audit_log` row includes it. Extract `shouldEmitRoleClaimMapped(user: ResolvedUser): boolean` (or compute it once into a `const`) so the two can't drift. Separately: the structured event still won't carry `previousRole`, but task 3.1 asserts `previousRole` on the audit row. Either add `previousRole` to the structured event as well (it's an internal role name, so it's safe), or say explicitly that only the audit row has it. As things stand, an operator reading the log stream can't see a demotion's previous role.

### C2. Escape operator keys in error messages.

D4 interpolates keys as `key "Eng-Managers"`. Build the message with `JSON.stringify(key)` so a key containing a newline, a quote or an ANSI escape can't split or forge lines in the boot log. Keys come from config and not from a token, so this is low risk, but the fix costs nothing.

### C3. Startup output goes through `console.*`, not pino, so describe it accurately.

`loadConfig` runs before Fastify exists, so the warnings and the summary line will be `console.warn`/`console.info` plain text, not structured pino lines like everything else. That's fine and matches the existing `FATAL:` guards. But spec R "Startup role map summary" says "info-level line", and the docs and runbook will tell operators to filter on it. Use a fixed, greppable prefix (`OIDC_ROLE_MAP: source=configured engineering_manager=2 facilitator=1 application_admin=0 senior_engineer=0`) and document the prefix. Also: Vitest workers import `config.js` in many test files, so the default-map summary line will print once per worker. That's noise, not a bug.

### C4. Duplicate-key scanner: list the edge cases it has to handle.

D3's budget of two tests is fine, but the function only works if it handles three things. (1) Escaped quotes inside a key (`"a\"b"`): the tokenizer has to skip escape sequences, not just look for the next `"`. (2) Escape-equivalent duplicates (`"a"` and `"a"`): D3 decodes with `JSON.parse`, which handles this, so keep that. (3) A key-position string versus a value-position string: depth tracking on its own isn't enough, so the scanner has to track whether the next string at depth 1 is a key, i.e. it comes after `{` or `,` rather than after `:`. Put (1) into the second of the two tests ("duplicate-looking text inside a key string") so the budget still covers it.

### C5. The spec's "no map key in any log" wording conflicts with D4.

`oidc-role-mapping` §"Role mapping logging never carries claim values" says no line "produced by role mapping" contains a map key. D4 and §"Startup errors do not echo the map" print one key on a failed boot. I read the first as scoped to sign-in, but a test author could read it as covering boot too. Add "at sign-in" to the logging requirement to remove the ambiguity.

### C6. The `debug { ignoredCount }` line for partial matches.

D7 makes it optional, the spec doesn't mention it, and no task covers it. Either delete it from D7 or add it to task 2.3. I'd delete it. An optional log line nobody has asked for is just one more thing to keep value-free.

### C7. Local stub follow-through (task 4.3 scope check).

I confirmed the places that need to change in lockstep with `accounts.js`:
- `routes/auth.ts` `DEV_LOGIN_OPTIONS` has `{ accountId: "facilitator-001", seeded: false }`. Under the default map this becomes `seeded: true`, and the comment calls `seeded` "the single source of truth" for the frontend's unseeded-role caveat.
- `packages/frontend/src/pages/__tests__/DevLoginPage.test.tsx`, `routes/__tests__/auth.test.ts` and `docker/oidc/__tests__/interactions.test.js` all reference `facilitator-001`.
- The `accounts.js` header comment refers to `PERMITTED_GLOBAL_ROLES` by name.

Name these explicitly in task 4.3 so nobody has to find them by grepping.

`docker-compose.yml` doesn't run the backend, so the backend reads `.env`. Task 1.7's `.env.example` entry should therefore stay **commented out**, which it does. A live `OIDC_ROLE_MAP=` line in `.env.example` would be fine (whitespace counts as unset), but a live example map without the identity entries would break persona login for manager-001 and admin-001.

### C8. Task 4.2 integration test: say what level it runs at.

"Signs in as (or seeds the resolved claims of) `facilitator-001` and creates a draft session end to end." The backend test suite mocks `handleCallback` and `db`, so there's no real end-to-end harness. If the test seeds a `users` row with `global_role='facilitator'` and calls the session-create route, it proves the gate and not the mapping. If it runs `resolveGlobalRole(accounts["facilitator-001"].role, DEFAULT_ROLE_MAP)`, it proves the mapping and not the gate. Do both and import `accounts.js` from the stub so the fixture can't drift from it. That pair is a sound acceptance check for R15. Don't promise more than that.

---

## Error paths I checked and found covered

- Bad JSON, a non-object, `null`, a non-string target, an empty or whitespace key, an unknown target, an `engineer` target: all fail at boot with a key-only message (D4, tasks 1.2 to 1.5).
- Production with the map unset, empty or `{}`: all fail at boot. The order in D4 is correct: shape errors are reported before the production guard, so operators fix syntax first.
- A claim of `null`, a number, an object, `""`, `[]` or `["", 42, null]` is treated as missing and logs nothing. Today `String(rawClaimValue)` would turn `42` into `"42"` and `{}` into `"[object Object]"` and warn. The new rule is stricter and better.
- Prototype keys: `Map.get` plus `Object.entries` over `JSON.parse` output is correct, and a `"__proto__"` key in JSON parse output is an own property. Covered by tests.
- Transaction rollback: the resolver's warn lines fire inside `withAuditTransaction` before commit. `audit-write-transaction.ts` has no retry loop, so "one warning per sign-in attempt" holds. A rolled-back attempt still leaves its warning, which is correct for a diagnostic line (it is not an audit claim).
- Mid-session demotion: confirmed that `standing-facilitator-access-helper.ts` reads `u.global_role` live per request, so the interim behaviour in the proposal ("session continues, facilitator-only actions refused") is consistent with the code. It still needs verifying end to end, as the follow-up says.
- Rollback to the previous release: correct. The old code ignores the variable, and new grants decay at the next sign-in.

## Coupling notes

- **`config.ts` → `auth/role-map.ts`** is a new direction: config now imports from `auth/`. That's acceptable only if `role-map.ts` stays a leaf module (R4).
- **Two sources of truth for role names:** the Postgres enum and the new TS union (R1). Tie them together with a test or a comment.
- **#235 reconciliation:** if `resolveGlobalRole` returns `{ role, facilitatorDiscarded, outcome }` and #235 later needs a role *set*, `normalize` and the `map.get` filter can be reused as they are, and only the `max` step changes. Keep `normalize` and `mapValues` as separate exported functions so that rebase only touches a small surface. That's cheap insurance, and it doesn't touch the precedence decision.

## Summary of asks

| # | Severity | Change |
|---|---|---|
| R1 | Required | Define `GlobalRole`/`MappableRole` in `role-map.ts`; D7's compile-time claim is false today |
| R2 | Required | Pino argument order (`warn(fields, msg)`); today's `claimName` is silently dropped; tests must assert the order |
| R3 | Required | Pick child-logger wiring for `correlationId`; test it in route and resolver |
| R4 | Required | Inject the map into the resolver; `role-map.ts` stays a leaf; no silent default fallback |
| R5 | Required | Extend `FullConfig`; keep the raw `OIDC_ROLE_MAP` string off `config` |
| R6 | Required | Specify the `loadConfig` test harness and satisfy the earlier production guards |
| C1–C8 | Recommended | Shared firing-condition helper, key escaping, console-prefix wording, scanner edge cases, spec wording, drop the optional debug line, explicit stub file list, honest integration-test scope |
