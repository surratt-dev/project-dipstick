# Engineering Design Review — `http-auth-audit-log-coverage`

**Reviewer:** Marcus Oyelaran, Full Stack Engineer
**Reviewed:** `design.md`, `proposal.md`, `tasks.md`, `specs/auth-error-handling/spec.md`
**Verified against:** `packages/backend/src/auth/middleware.ts`, `packages/backend/src/routes/auth.ts`, `packages/backend/src/auth/audit-logger.ts`, `packages/backend/src/realtime/connection-reauthorization.ts`, `packages/backend/src/db.ts`, `packages/backend/migrations/8_audit_log.sql`, `packages/backend/src/routes/content.ts`, `tsconfig.base.json`, `eslint.config.mjs`, and the existing test files for both touched modules.

## Verdict

Directionally sound and well-reasoned — the scoping decisions (D1–D4) are the right calls and the write-up shows real engineering judgment, not just box-checking. But it is not implementable exactly as written. One of the two pieces of "already available" data it depends on (`retryCount`) does not actually exist at the call site the design assumes it does, and the stated latency bound doesn't match the mechanism described to achieve it. Both are concrete, checkable-against-the-code problems, not style opinions. I'd send this back for one more pass before implementation starts, not because the shape is wrong, but because an implementer following tasks.md 2.2/2.3 literally will hit a wall partway through and have to make an unplanned decision about `RefreshResult`'s shape that should have been made here.

## Blocking findings

### 1. `retryCount` is not available where Decision D2 and tasks 2.2/2.3 say it is

`design.md` Decision D2 states `retryCount` is "the value already computed by `refreshSessionTokens` at the point of failure," and tasks.md 2.2/2.3 say to source it "from the value already available at this point in `refreshSessionTokens`'s result handling." That's not true of the code today.

`RefreshResult` (`middleware.ts:46-50`) is:

```ts
export type RefreshResult =
  | { status: "refreshed"; session: SessionData }
  | { status: "revoked" }
  | { status: "transient_failure" }
  | { status: "no_refresh_token" };
```

The `revoked` and `transient_failure` variants carry no payload. Inside `refreshSessionTokens`, `retries` is a local variable (`middleware.ts:83`) that never crosses the function boundary — it's used only in the `emitAuditEvent(log, "auth.token_refresh_failure", { ..., retryCount: retries })` calls at lines 114-120 and 144-150, both of which fire *inside* `refreshSessionTokens`, before it returns. The `onRequest` hook's `case "revoked"` (`middleware.ts:198-208`) and `case "transient_failure"` (`middleware.ts:209-219`) only ever see `result.status` — there is no `retries`/`retryCount` in scope at either call site.

To do what Decision D2 and tasks.md describe, `RefreshResult`'s `revoked` and `transient_failure` variants need a `retryCount: number` field added, and `refreshSessionTokens` needs to actually populate it on both return statements. That's a real, if small, change to a function's public return type that's also consumed by the WS-side silent-refresh timer (`connection-token-refresh.ts`, per the file's own header comment at `middleware.ts:54-58`) — worth naming explicitly as an in-scope change with its own task line, not discovered mid-implementation. As written, tasks.md 2.2/2.3 read as "just wire up the value that's sitting right there," which will send an implementer looking for something that isn't there.

**Fix:** Add a task (before 2.1) to extend `RefreshResult`'s `revoked`/`transient_failure` variants with `retryCount: number`, and update both of `refreshSessionTokens`'s return statements (lines ~121 and ~151) to populate it. Confirm the WS-side caller (`connection-token-refresh.ts`) either uses the new field or is unaffected by its addition.

### 2. The write path's own latency bound contradicts itself

Decision D5's mitigation and Decision D6's rationale both describe the write as bounded at "≤500ms" (`design.md` line 103, and the Risks section's first entry). But the actual mechanism in Decision D5 is two *sequential*, independently-timed-out awaits:

```
actor_global_role = await withTimeout(resolveActorGlobalRole(userId), AUDIT_WRITE_TIMEOUT_MS)   // up to 500ms
await withTimeout(db.query(INSERT...), AUDIT_WRITE_TIMEOUT_MS)                                   // up to another 500ms
```

Worst case — SELECT hangs the full timeout, then the INSERT also hangs the full timeout — this adds up to **~1000ms**, not 500ms, to an already-terminating request. The design states the tighter number as if it were the actual bound in three separate places (D5's summary, D6's "a few hundred milliseconds" framing, and the Risks section), and none of them account for the two-timeout stacking. This isn't pedantic: D6's entire argument for why awaiting is safe rests on "a bounded few hundred milliseconds... has no plausible session-visible cost" — that argument gets weaker, not fatally so, but weaker, at ~1s than at ~500ms, and the design should make that comparison honestly rather than by omission.

**Fix:** Either (a) wrap both calls in a single `withTimeout` covering the combined SELECT+INSERT sequence so 500ms is a true end-to-end bound, or (b) keep two independent timeouts but say so explicitly and restate the worst-case added latency as ~1000ms everywhere the bound is cited. (a) is probably the better fix and also simplifies the "distinguish timeout from error" problem in Finding 5 to one call site instead of two.

## High-severity findings

### 3. Existing unit tests will start touching `db.js` with no mocking plan stated

`middleware.test.ts` mocks `oidc-client.js`, `token-encryption.js`, `session-store.js`, `audit-logger.js`, and `config.js` (lines 9-23) — it has **no mock of `db.js` today**, because `middleware.ts` has no DB dependency today. Once `resolveActorGlobalRole` is imported from `connection-reauthorization.ts` (which imports `db.js`, constructing a real `pg.Pool` at module load), every existing test that exercises the `absolute_timeout`, `token_revoked`, or `transient_failure` branches — tests that pass today with zero DB interaction — will, unless `db.js` (and/or `connection-reauthorization.js`) is newly mocked, attempt a real `db.query()` against a `Pool` built from an unset `DATABASE_URL`. That's either a fast connection-refused error (which happens to get caught by the new fail-open path, coincidentally "passing" for the wrong reason) or a hang, and either way it's nondeterministic, environment-dependent behavior leaking into what were previously pure unit tests.

`connection-reauthorization.test.ts` already mocks `../../db.js` (line 8) for exactly this reason — that's the precedent to follow, not a new problem to solve. But neither `middleware.test.ts` nor `routes/__tests__/auth.test.ts` currently mocks `resolveActorGlobalRole`'s module path at all (confirmed — no reference to `connection-reauthorization` in either file today). `auth.test.ts` already mocks `db.js` (line 18) for its existing `db.query` calls, so it needs less new scaffolding, but `middleware.test.ts` needs a `db.js` mock added from scratch.

Task 4.7 states the existing suites should "pass unmodified apart from the new assertions above." That's not achievable as stated — at minimum `middleware.test.ts` needs a new `vi.mock("../../db.js", ...)` and both files need a mock for wherever `resolveActorGlobalRole` resolves to, just to keep the *existing* assertions passing, before any new assertions are added. This should be its own task line, not an implicit side effect discovered while writing task 4.1's tests. Worth flagging too: `middleware.test.ts` runs under `vi.useFakeTimers()` (line 65) for the retry-backoff tests — combining that with `withTimeout`'s internal `setTimeout` and a real (mocked-to-hang) DB promise needs `vi.advanceTimersByTimeAsync`, not `vi.advanceTimersByTime`, or the hang test (4.5) will deadlock the test runner rather than exercise the timeout path.

**Fix:** Add an explicit task under "Tests" (or fold into 1.4): update `middleware.test.ts` to mock `db.js` and the `resolveActorGlobalRole` import path; confirm `auth.test.ts`'s existing `db.js` mock is extended to also satisfy the new SELECT/INSERT calls without altering its other query mocks' call-count assertions, if any exist.

## Medium-severity findings

### 4. `withTimeout` racing a hung query doesn't stop the query — pool exhaustion risk under the exact failure mode this design targets

`Promise.race` against a `setTimeout` makes the *caller* stop waiting; it does not cancel the underlying `pg` query or return its connection to the pool. If `resolveActorGlobalRole`'s SELECT or the INSERT is slow because the pool is under real pressure (the scenario D5 is explicitly designed for), `withTimeout` gives up on it after 500ms but the query keeps running against a checked-out connection until Postgres actually responds or the connection errors out. Under a sustained degradation — plausibly correlated with a burst of `absolute_timeout` invalidations, which is exactly a "many requests hit this branch at once" scenario — every one of those abandoned queries continues holding a pool connection for its own real duration, compounding the pool pressure that caused the timeout in the first place. This doesn't break the fail-open guarantee for the *response* (that part is fine — the reply still goes out), but it works against the design's own stated goal of not letting a DB blip cascade, and it's worth naming as a real trade-off rather than leaving pool behavior implicit. It's also worth confirming the abandoned promise's eventual settlement doesn't produce an unhandled-rejection warning if it rejects after the race is already decided — `withTimeout` should attach a no-op `.catch` to the losing promise if it doesn't already resolve/reject cleanly into the void.

**Not a blocker** — `db.ts`'s `pg.Pool` has no configured max size to reference either way, so I can't say how bad this gets in practice, but it should be named as an accepted trade-off in the Risks section rather than left undiscussed, since right now the Risks section's pool-adjacent risk (the 500ms value itself) doesn't mention this second-order effect at all.

### 5. Decision D7's "imported but never called" is self-contradictory under this repo's lint config

Decision D7 says both new call sites "import `resolveTeamIdForAudit`... but... never [call it] with a non-NULL-producing intent... it is not needed here." Taken literally — imported, never called — this is an unused import. `eslint.config.mjs` sets `@typescript-eslint/no-unused-vars` to `"error"` project-wide (line ~20 of that file, no `varsIgnorePattern` exemption). An unused `resolveTeamIdForAudit` import in either `middleware.ts` or `auth.ts` fails lint and therefore CI. This is a wording problem, not a design problem, but it needs a wording fix before implementation, or an implementer will either (a) hit the lint error and have to improvise, or (b) suppress it with an eslint-disable comment that nobody asked for.

**Fix:** Simplest correct statement: neither file imports `resolveTeamIdForAudit` at all, since D4 already establishes the outcome is `NULL` at every call site regardless. Drop the "imported but" framing from D7 entirely.

## Low-severity / implementation-detail findings (worth a line in tasks.md, not a design rework)

- **`writeSessionInvalidatedAuditRow`'s signature carries both `request` and `log` separately** (tasks.md 1.3: `(userId, sessionId, reason, request, metadata?, log)`). Every call site already has `request` in scope, and `request.log` is the same logger already passed to every other `emitAuditEvent` call at these sites (`middleware.ts:172`, `auth.ts:424`). Taking `log` as a second, independent parameter is surface area with no call site that would ever pass a different logger than `request.log`. Simplify to `(userId, sessionId, reason, request, metadata?)` and derive `log = request.log` inside.
- **Timeout-vs-error disambiguation isn't specified.** `withTimeout`'s rejection needs to be distinguishable from a genuine DB error so the single `catch` block can set `failureMode: "error" | "timeout"` correctly (spec.md's own scenarios require this distinction to be observable). A `class AuditWriteTimeoutError extends Error` (or similar sentinel) that `withTimeout` throws on the timer branch, checked with `instanceof` in the `catch`, is the obvious answer — but tasks.md 1.1 doesn't say it, and "compare error messages" is the kind of fragile thing an implementer reaches for under time pressure if it isn't specified.
- **`exactOptionalPropertyTypes: true`** is set in `tsconfig.base.json`. Building `metadata` as `{ reason, sessionId, ...(failureType && retryCount !== undefined ? { failureType, retryCount } : {}) }` (conditional spread) will compile; assigning `failureType: condition ? "revoked" : undefined` directly will not, under this repo's strict settings. Worth a one-line note in tasks.md 1.3 so nobody loses ten minutes to a compiler error that's really just "this repo doesn't let you assign `undefined` to an optional key."
- **Clear the timer on the winning branch.** Not mentioned in tasks.md 1.1 — a `Promise.race`-based `withTimeout` that doesn't `clearTimeout` on the non-timeout path leaves a dangling timer per call. Low-impact (500ms, not user-visible) but easy to get right the first time.

## Confirmed-correct claims (spot-checked against code, not assumed)

- `db.ts`'s `pg.Pool` genuinely sets no `statement_timeout`/`query_timeout` — confirmed, it's a bare `new Pool({ connectionString: config.DATABASE_URL })`. D5's "nothing to reuse" claim is accurate.
- `content.ts`'s `denyAdminContentAccess` (lines 65-96) really does an unguarded `await db.query(...)` with no try/catch before its 403 — D5's contrast against this precedent is accurate, and the decision to depart from it here is justified.
- `connection-reauthorization.ts`'s `runSweepCheck` INSERT (lines 93-97) really has no try/catch and runs under `void runSweepCheck(...)` (line 128) — D5's claim that the WS side offers no fail-handling precedent to copy is accurate, and correctly *not* used as a model here.
- `resolveActorGlobalRole`'s `"unknown"` fallback (line 54) is a no-row-found default, not an error path — D5's parenthetical about this being unaffected by the new timeout wrapping is correct.
- `migrations/8_audit_log.sql`: `actor_user_id UUID NOT NULL` (line 31) and `actor_global_role TEXT NOT NULL` (line 32) are both satisfiable at all four call sites (session's `userId` is already null-checked before any of these branches execute; `resolveActorGlobalRole` never returns null). `team_id` is nullable (line 38) and has a partial index that already excludes NULLs (line 50), so D4's uniform-NULL choice costs nothing on the index side.
- `auth.ts`'s logout `destroy()` really is awaited via the promise wrapper at lines 420-422, and `middleware.ts`'s three `destroy()` calls really are fire-and-forget (lines 171, 201, 212) — D6's characterization of both is accurate.

## Recommendation

Not a rewrite. Fix Findings 1 and 2 before implementation starts — both are "the design as literally written can't be built/doesn't do what it claims" issues, not judgment calls. Findings 3-5 should each get a line in tasks.md so they're not rediscovered mid-implementation. The low-severity items are fine to leave as implementer judgment calls but are cheap enough to just state now.
