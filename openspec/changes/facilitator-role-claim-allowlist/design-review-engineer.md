# Design Review — Engineer (Marcus Oyelaran)

**Change:** facilitator-role-claim-allowlist (#235) · **Artifact:** design.md · **Verdict:** Approve with minor changes (none blocking)

I read the design against the code it changes, not just the prose: `auth/account-resolver.ts`, `routes/auth.ts:280-390`, `auth/audit-write-transaction.ts`, `auth/audit-logger.ts`, `routes/__tests__/auth.test.ts`, `auth/__tests__/account-resolver.test.ts`, `routes/__tests__/helpers/real-db.ts`, `.github/workflows/integration.yml`, `migrations/8_audit_log.sql`, and `docker/oidc/*`. I couldn't run tests (no `node_modules`), so everything below comes from reading the source. Decisions 4, 6 and 7 are User decisions, and I haven't reopened them.

## What holds up

- **D1 is the right shape.** With one ordered constant, the allowlist and the precedence can't drift apart, and the literal-set test makes widening the list a deliberate act. Backend already imports `@dipstick/shared` (`join-link-creation.ts`, etc.), and CI builds shared before it tests, so `satisfies readonly UserRole[]` will compile.
- **`senior_engineer` really is non-privileged.** Every authorization gate in `packages/backend/src` matches positively (`=== "facilitator" | "engineering_manager" | "application_admin"`: `teams.ts:305,412`, `sessions.ts:150,382`, `auth.ts:742`, the access helpers). The only `!== "engineer"` sites are the two audit gates at `auth.ts:336` and `:374`, and D5 replaces both. The frontend doesn't read `globalRole` at all. Nothing grants on "not engineer".
- **D5 extraction is clean.** `withAuditTransaction` already lets the `auditInsert` closure decide whether to insert anything, so moving the body into `writeAccountResolutionAuditRow(client, user, …)` only changes where the code lives. `auth.test.ts` mocks `account-resolver.js` and `audit-logger.js` but not the new module, so the existing SQL-text assertions (~l.1001, `'auth.role_claim_mapped'`) keep exercising the real writer. Task 2.5 (demotion INSERT fails → rollback → `internal_error`, no log event) covers the error path that matters most.
- **D7 matches `middleware.ts`.** Refresh doesn't re-read claims, and the 90-minute cap and the `invalid_grant → revoked` path are real. The docs promise nothing faster.

## Findings

**F1. The pino argument-order bug is real. Fix it as D4 says, but know that the type won't enforce it.** `routes/auth.ts:318` passes `request.log` (pino via Fastify 5), and `account-resolver.ts:86` calls `warn(message, { claimName })`. When pino's first argument is a string, it formats that string with the remaining args as interpolation values, and an object with no `%o`/`%j` placeholder is dropped. In production, then, the warning is a bare string with no `claimName`. Every other `warn` in the backend uses `(obj, msg)` (`origin-check.ts:51`, `ws-pubsub.ts:243`, `websocket-routes.ts:149…`). The catch: `Pick<FastifyBaseLogger,"warn">` still accepts `warn(msg, obj)`, because pino's `LogFn` has a `(msg: string, ...args: any[])` overload. The compiler won't flag a regression. The guard is the task 1.4 assertion (`calls[0][0]` is an object, `calls[0][1]` is a string), so keep it on **both** warnings (D2 and D3), not just the allowlist one. *Change:* add one sentence to D4 saying the type documents the order but doesn't enforce it, and the tests do.

**F2. D2's "one `warn` per sign-in at most" contradicts D3.** `["facilitator","engineering_manager","superuser"]` emits the allowlist warning *and* the outranked-EM warning, and task 1.8 says "one additional warning". *Change:* reword D2 to "at most one allowlist warning per sign-in; D3 may add one outranked warning". Add that exact mixed case to 1.8, asserting `warn` was called twice with the two distinct messages.

**F3. Overclaim on concurrency in D5.** "the demotion row records the value that was actually overwritten, even under concurrent sign-ins" isn't guaranteed. The `prior` CTE reads the statement snapshot. Under READ COMMITTED, when two callbacks for the same user race, `ON CONFLICT DO UPDATE` waits on the row lock and updates the latest version, but `prior` still returns the pre-race value. Two tabs completing sign-in together can therefore both write `facilitator → engineer`. For an audit trail that's harmless (a duplicate row, never a missed transition to a new role, because the second writer's `globalRole` is still compared to a non-null prior). *Change:* replace the sentence with "captured in the same statement; concurrent sign-ins for one user may each record the same transition". Don't add a test for it.

**F4. New module must stay dependency-free.** `account-resolution-audit.ts` should import types only (`PoolClient`, `ResolvedUser`) and nothing from `db.js`, `config.js` or `audit-logger.js`. That keeps `auth.test.ts`'s current `vi.mock` set sufficient, and lets the integration test import it with no mocks. Put this in D5 as a constraint, not a hope. Also type the predicate's argument with `ResolvedUser` from `account-resolver.ts` (a type-only import), so there's no circular runtime import.

**F5. Integration test (section 3): small practicalities the design should name.**
- The repo's real-Postgres pattern is `describe.skipIf(!infraUp)` plus `requireInfraOrThrow` (it fails in `integration.yml` under `REQUIRE_DB=1` and skips in `ci.yml`), with env fallbacks and dynamic imports after the fallbacks. Every existing file lives in `routes/__tests__/`. Putting the new one in `auth/__tests__/` and importing `../../routes/__tests__/helpers/real-db.js` is fine. Note that `probeInfra()` also requires Redis, so locally the file skips when Redis is down, even though it doesn't use Redis. That's acceptable for consistency, but say it.
- `ROLE_CLAIM_NAME` is fixed when the module loads (`config.OIDC_ROLE_CLAIM ?? "role"`). Task 3.4's "`roles`-style array under the configured claim name" has to put the array under `role` (the env default in both lanes), not under `roles`. Write that in the task so nobody sets `OIDC_ROLE_CLAIM` mid-file and wonders why it does nothing.
- Cleanup works: `audit_log` has no append-only trigger (`8_audit_log.sql`) and no FK to `users`, so the `Fixture.cleanup` order (`audit_log` by `actor_user_id`, then `users`) applies. Use `randomUUID()` subjects with a fixed test issuer.
- The test-fixture `UPDATE users SET global_role` is only needed if a test wants a prior role that the IdP path can't produce. Every case in 3.1–3.4 can get its prior role from an earlier sign-in, so the exception may go unused. That's better, so prefer it.

**F6. Proposal Impact wording.** "possibly `docker/oidc/__tests__/interactions.test.js`": it's definitely affected. Line 35 asserts `accounts["facilitator-001"].role` is `undefined`, and `auth.test.ts:282` asserts `seeded === false`. Tasks 5.1/5.3 already handle both, so this is only a doc fix. The stale comment at `docker/oidc/server.js:82` ("Only manager-001 and admin-001 carry a role claim") is also in 5.2. Good.

**F7. Optional: narrow the return type.** With `ROLE_PRECEDENCE` typed, `mapRoleClaimToGlobalRole` can return `UserRole` instead of `string` at no cost. `ResolvedUser.globalRole` should stay `string` (it's what Postgres returns), so this doesn't spread.

## Hidden coupling / error paths checked, no action

- `resolveOrCreateAccount` has one caller (`auth.ts:318`), so changing the logger type breaks nothing else.
- The rollback path (old build, array claims) goes back to `String()` coercion, and the Migration Plan already accepts that.
- `emitAuditEvent` forces `info` on a child logger, so adding `previousRole` to the log line needs no level change.
- Exact-match failure goes to `engineer` with a warning. That's the right direction.

## Requested edits (design.md only)

1. D4: one sentence saying the type doesn't enforce argument order and the tests do (F1).
2. D2: reword the "one warn" rule. Tasks 1.8: add the mixed-case two-warning test (F2).
3. D5: drop the concurrency guarantee (F3) and add the dependency constraint for the new module (F4).
4. Tasks 3 preamble / 3.4: claim name is `role`; note the Redis-coupled skip; prefer IdP-path prior roles (F5).
5. Proposal Impact: "possibly" → "definitely" for `interactions.test.js` (F6).
