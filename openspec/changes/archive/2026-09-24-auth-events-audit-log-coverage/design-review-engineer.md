# Engineer Review — `auth-events-audit-log-coverage` design.md

Reviewer: Marcus Oyelaran (Full Stack Engineer)
Scope: implementability, boundary cleanliness, technology choices, hidden coupling, missing error paths — checked directly against `packages/backend/src` as it exists today (`session-invalidation-audit.ts`, `teams.ts`'s `establishManagerAssociation`, `auth.ts`, `join-links.ts`, `account-resolver.ts`, `audit-logger.ts`, `error-handler.ts`, `oidc-error-sanitizer.ts`, `db.ts`, `health.ts`, `session-store.ts`, `AuthErrorPage.tsx`, and the existing test-mock patterns in `auth.test.ts`/`teams.test.ts`).

## Summary

This design is well-grounded — every claim I checked against the actual code held up (the `mapRoleClaimToGlobalRole` exclusion of raw claim values, `SessionData`'s missing `globalRole` field, `health.ts`'s plain `SELECT 1`/`redis.ping()` check, `resolveOrCreateAccount`'s single call site, `AuthErrorCategory`'s narrow usage). Decision D2's split between fail-open and transactional mechanisms is the right call, and Decision D7's `AuditWriteError` is a genuinely good fix for a real misattribution bug. I have one finding I consider a real correctness gap in the transactional group's latency-bound claim (Finding 1), and several smaller findings that tasks.md should make explicit before implementation starts, because each is the kind of thing that's easy to get subtly wrong on the first pass and expensive to notice afterward.

Verdict: **implementable as scoped, with Finding 1 needing an explicit decision (not silence) before Migration Plan step 6 is written, and Findings 2–4 worth folding into tasks.md so they aren't rediscovered mid-implementation.**

---

## Finding 1 (Correctness — transactional group's advertised 500ms bound doesn't hold on the rollback path)

**Severity: High — affects a claim the design states as fact in Decision D3.**

Decision D3 states: *"`AUDIT_WRITE_TIMEOUT_MS` (500ms, unchanged) still bounds how long any single request waits before the transaction's audit `INSERT` is treated as failed... This bounds latency per affected request."*

I don't think this holds for the transactional group specifically, and it's worth tracing through carefully because it's exactly the kind of boundary behavior that looks fine on paper and only shows up under real load.

`node-postgres` (`pg`) processes queries on a single `Client`/`PoolClient` **strictly in submission order over one connection** — it does not pipeline. If `withTimeout(client.query(INSERT...), ms)` "loses" the race (the timer fires first), the *caller's* `await` resolves early with `AuditWriteTimeoutError` — but the underlying `client.query(INSERT...)` call is still outstanding on the wire, still occupying that connection's single command slot. The transactional group's `catch` block then does:

```ts
catch (err) {
  await client.query("ROLLBACK");
  throw err;
}
```

That `ROLLBACK` is issued on the *same* `client` — it queues behind the still-pending `INSERT` at the `pg` client level and cannot execute against Postgres until the server actually responds to the original `INSERT` (success, error, or some other timeout entirely outside this design's control). So `await client.query("ROLLBACK")` — which the request is synchronously waiting on before it can build its redirect/error response — is not bounded by `AUDIT_WRITE_TIMEOUT_MS` at all in this path. It's bounded by whatever eventually resolves the original hung command, which could be much longer than 500ms, or indefinite absent a Postgres-side `statement_timeout`.

This is a materially different situation from the fail-open group, which never issues a follow-up query on the same connection after a timed-out one (`writeAuditRow` uses the pool's `db.query`, not a checked-out client, and there's no rollback to attempt) — the fail-open group's 500ms bound is accurate as stated. It's also a step beyond what the design's own Risks section already accepts ("a hung audit `INSERT` inside a transaction that times out still leaves that `client` mid-transaction until Postgres itself responds; `client.release()` in the `finally` block only runs after that resolution") — that sentence is *this exact mechanism*, but the design doesn't connect it back to Decision D3's request-latency claim, which reads as if the *request* still gets its bounded 500ms regardless. It doesn't, once the rollback attempt is what's actually blocking the response.

**What I'd want before implementation:** either (a) state this plainly as a correction to D3 — the transactional group's advertised bound applies only to detecting the failure, not to the request's total latency on that path, which is a genuinely different and weaker guarantee than the fail-open group's — or (b) change the mechanics so the `ROLLBACK` attempt is itself skipped/short-circuited when the preceding query timed out (e.g., don't attempt `ROLLBACK` on a client whose last command is known to still be outstanding; just `release()` the client with an error flag and let `pg`'s pool handle it, since the connection is going to be in an indeterminate state either way). Either is fine — what I don't think is fine is shipping the current wording, because it tells the next engineer debugging a slow login that 500ms is a hard ceiling when it isn't for this specific failure mode.

---

## Finding 2 (Missing error path — `db.connect()` failure is a new, unaddressed failure mode in `/auth/callback`)

**Severity: Medium.**

Today, `GET /auth/callback` never checks out a pooled client — every DB access in this handler goes through `db.query` directly. This design adds up to two `db.connect()` calls in the same request path (one for the `resolveOrCreateAccount` + conditional audit-insert transaction, a second — nested, when a join token is present — inside `executeJoinFlow`'s `join.link_redeemed` transaction). `db.connect()` itself can reject (pool exhausted, connection refused) *before* any `try` block exists to catch it in the `teams.ts`-style pattern the design points to (`const client = await db.connect();` sits outside the `try`).

Decision D7 is explicit that it only wraps the audit `INSERT`'s own thrown error, leaving `resolveOrCreateAccount`'s UPSERT failure "unwrapped, unchanged from today" — a reasonable line to draw, since that failure mode already existed. But `db.connect()` throwing is *not* a pre-existing failure mode in this handler — it's newly introduced by this change. If it throws, it propagates unwrapped into the same `catch` block Decision D7 exists to fix, lands in `mapAuthError`'s default branch, and produces the exact "sign-in failed" misattribution D7 was built to close — just triggered by pool exhaustion instead of the audit table specifically. Worth a one-line decision either way: fold it into `AuditWriteError`'s scope (it's arguably the same "our own infra, not the IdP" story), or explicitly name it as an accepted gap the way D3 named the audit-log-table-specific monitoring gap. Silence here just means it gets discovered the first time it happens in production.

This also means it's worth confirming today's `db = new Pool({ connectionString: config.DATABASE_URL })` (`packages/backend/src/db.ts`) pool-size configuration is adequate for `/auth/callback` now potentially holding two sequential (not concurrent, but back-to-back) checkouts per request, on what is likely one of the highest-traffic routes in the app. Nothing in the design states the pool's `max` or discusses whether this change's added checkouts change the app's headroom under a concurrent-login burst — worth a sentence, even if the answer is "default pool size is fine, verified against expected login concurrency."

---

## Finding 3 (Missing implementation detail — structured `emitAuditEvent` calls must move to *after* commit, not stay where they are today)

**Severity: Medium-High — this is the specific way this change could accidentally reproduce the "log says X happened, durable record disagrees" problem it exists to close.**

Today, `auth.ts`'s structured-log calls for `first_access_created`/`role_claim_mapped` (lines 302–325) fire immediately after `resolveOrCreateAccount` returns, unconditionally, before `session.regenerate()`. `join-links.ts`'s `join.link_created` structured log (line 84) fires immediately after its `INSERT ... RETURNING` resolves.

Once `resolveOrCreateAccount`'s UPSERT and the conditional audit `INSERT` are joined into one transaction (Decision D2), those existing structured-log calls **must move to after the transaction's `COMMIT` succeeds**, not stay at their current source position. If the audit `INSERT` fails and the transaction rolls back (Decision D3's whole point — the domain write is undone too), but the structured log line was already emitted at its current position before the transaction concept existed in this code path, the pino log would report `auth.first_access_created` for an account that was never actually created. That's the precise failure mode SEC-15/SEC-12 exist to prevent, self-inflicted by this change if the reordering isn't made explicit.

The Migration Plan (steps 3, 5, 6) describes wrapping the domain write and the audit `INSERT` in a transaction, and separately (Decision D6) describes small structured-log field additions, but doesn't say in so many words "move the existing structured-log emission to after the commit." I'd want this stated as its own line in tasks.md for steps 3, 5, and 6 each, precisely because it's the kind of thing that's obvious once pointed out and easy to leave in place by default otherwise (the diff looks smaller if you don't move it).

---

## Finding 4 (Testing pitfall — two sequential `db.connect()` calls in one request will conflate index-based mock assertions)

**Severity: Medium — a real time-sink for whoever writes task 10's tests, worth flagging now rather than discovering three tasks in.**

`teams.test.ts`'s existing pattern for asserting transactional behavior is positional: `client.query.mock.calls[4]` is asserted to be the audit `INSERT`, `expect(client.query).toHaveBeenCalledTimes(6)`, etc. — this works today because each tested handler opens at most one transaction per request.

`GET /auth/callback` with a `pendingJoinToken` present will, under this design, open **two** separate transactions in the same request: one for `resolveOrCreateAccount` + `first_access_created`/`role_claim_mapped`, and a second (inside `executeJoinFlow`) for `join.link_redeemed`. `auth.test.ts` today mocks `db` with only `query`, no `connect` (unlike `teams.test.ts`, which already mocks both). When task 10 extends `auth.test.ts`'s mock to add `connect`, it needs to return a **distinct mock client per `db.connect()` invocation** — if `mockDbConnect` returns the same client object/mock across both calls, the two transactions' `BEGIN`/`INSERT`/`COMMIT` sequences land in one shared `client.query.mock.calls` array, and any attempt to reuse `teams.test.ts`'s "audit INSERT is the Nth call" style assertion will silently assert against the wrong transaction's call. Worth naming this explicitly in tasks.md's test-writing guidance rather than leaving it to be discovered via a flaky/wrong-looking assertion.

---

## Finding 5 (Type-safety regression — `writeFailOpenAuditRow`'s `operation` parameter is typed `string`, not `AuditEventName`)

**Severity: Low, easy fix.**

Every existing `emitAuditEvent` call site in the codebase is checked against the `AuditEventName` union at compile time — that's the entire mechanism `audit-logger.ts` uses to keep event names from drifting (new events get a union member with a comment, typos get caught by `tsc`). The design's `writeFailOpenAuditRow` signature (Decision D2) types `operation: string`. That's a real loosening: a typo'd operation string at a call site (`"auth.succes"`) would compile silently and only surface as a wrong value sitting in `audit_log.operation` (itself unconstrained `TEXT`, so no DB-level catch either). Given this module exists specifically to generalize a previously-hardcoded, single-event write path into a multi-event one, I'd type this parameter as `AuditEventName` (imported from `audit-logger.ts`) rather than `string` — it costs nothing and closes off exactly the class of bug shared types exist to prevent elsewhere in this codebase.

---

## Finding 6 (Reuse — three near-identical transaction-wrapping blocks, no shared skeleton proposed)

**Severity: Low — a suggestion, not a blocker.**

The transactional group's mechanics (Decision D2) get implemented independently at three call sites: `join-links.ts`'s `POST /api/teams/:teamId/join-links` (`join.link_created`), `join-links.ts`'s `GET /api/join/:token`, and `auth.ts`'s `executeJoinFlow` (`join.link_redeemed`, ×2 effectively once you count the account-resolution transaction too). Each independently reproduces `client.connect()` → `BEGIN` → domain write → `AuditWriteError`-wrapped audit `INSERT` → `COMMIT`/`ROLLBACK` → `release()`. The design already went out of its way (Decision D2's stated rationale) to avoid "a third hand-copied timeout mechanism" for the fail-open group — I'd apply the same instinct here: even a small shared helper for the transaction skeleton (open/commit/rollback/release, with the `AuditWriteError` wrap around a caller-supplied audit-insert closure) would reduce the surface for one of the three sites quietly missing `client.release()` in `finally` or forgetting the `ROLLBACK` before rethrow. Not required — `teams.ts`'s own precedent is written inline each time — but worth a second look given this design adds three more copies of the same shape in one change, not one.

---

## What I checked and found solid (no action needed)

- **Provider-agnostic constraint** (per `MEMORY.md`'s standing guidance): verified directly against `account-resolver.ts` — `mapRoleClaimToGlobalRole` maps to the closed `{engineer, engineering_manager, application_admin}` vocabulary and explicitly never logs the raw claim value; the design's new `previousRole` field reuses this same mapped vocabulary, not a raw claim. No part of this design branches on IdP identity. Consistent with the standing constraint.
- **`SessionData` has no `globalRole` field** — confirmed against `session-store.ts:95-102`. The design's claim that `idp_logout_failed` needs `resolveActorGlobalRole`'s lookup while `success`/`session_created` don't is accurate.
- **`health.ts`'s readiness check** — confirmed it's a plain `db.query("SELECT 1")`/`redis.ping()`, exactly as D3's Impact section describes, including the honestly-stated gap that a failure isolated to `audit_log` specifically wouldn't trip it.
- **`resolveOrCreateAccount` has exactly one call site** (`auth.ts:284`) — the optional `client` parameter addition is safe; no other caller needs updating.
- **`AuthErrorCategory`'s usage is narrow** — only `error-handler.ts` and `AuthErrorPage.tsx`'s `isRetryable` check consume the union meaningfully; the other `category:` values seen across the codebase (`forbidden`, `not_found`, `service_unavailable`, etc.) belong to a separate, general error-response shape, not `AuthErrorCategory`. Adding `internal_error` doesn't require touching an exhaustive switch anywhere else.
- **Migration Plan step 3's ordering** (commit before `session.regenerate()`) is correct — regenerating the session inside an open DB transaction would be a real hazard, and the design correctly keeps them sequential rather than nested.
- **No schema migration needed** — confirmed `audit_log.operation` is unconstrained `TEXT` (`8_audit_log.sql`), so all seven operation values slot in without a migration.

---

## Recommendation

Proceed, with Finding 1 resolved as an explicit decision (not left as an implicit assumption riding on D3's current wording) before Migration Plan step 6 is implemented, and Findings 2–4 added to tasks.md as concrete line items so they're addressed by design rather than by whoever hits them first in code review or in production.
