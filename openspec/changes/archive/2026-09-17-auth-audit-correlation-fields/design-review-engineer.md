# Engineering Review — auth-audit-correlation-fields

Reviewer: Marcus Oyelaran (Full Stack Engineer)
Verdict: **Approve.** Implementable as written, no design changes needed.

## Verification against current code

I read `packages/backend/src/routes/auth.ts` directly rather than taking the design's line
numbers on faith. Everything checks out:

- `const correlationId = crypto.randomUUID()` is declared once at line 119, before the
  `try` block, and is in lexical scope at every site this change touches.
- `auth.callback_received` (line 171) currently emits `sourceIp`, `stateNonce`, `success`
  — no `correlationId`. Task 1.1's target is correct.
- `auth.session_created` (line 279) currently emits only `userId`, `sessionId` — no
  `sourceIp`/`correlationId`. Task 1.2's target is correct.
- `auth.success` (line 284) currently emits `userId`, `oidcSubject`, `oidcIssuer`,
  `isFirstAccess` — no `sourceIp`/`correlationId`. Task 1.3's target is correct.
- `auth.first_access_created` (227-234) and `auth.role_claim_mapped` (242-248) already
  read the line-119 binding by reference and already pass `sourceIp: request.ip`. This is
  the exact shape the three new call sites should copy — confirmed, not assumed.
- The failure path already does this correctly today: both early-return failures (missing
  `stateParam` at 135-139, state not found in Redis at 154-158) and the catch-block
  `auth.failure` (342-346, 354) all read the same `correlationId` binding. There is no
  `crypto.randomUUID()` called anywhere inside the handler body except the one at line 119
  — I grepped for it specifically since a second call site is exactly the failure mode
  this design is written to prevent.

So the design's central claim — "there is no parameter-threading problem to solve" — is
correct. This is not a refactor; it's copying three field names into three existing
object literals that already close over the right variable.

## Is the failure-path test task actually achievable?

Task 2.3 asks for a test asserting `auth.callback_received`'s `correlationId` equals
`auth.failure`'s in a scenario where validation rejects *after* `callback_received` has
already fired. I traced the control flow to confirm this is reachable:

The existing "missing claims rejection (Task 12)" describe block in `auth.test.ts` already
sets up exactly this scenario — `mockRedisGetdel` resolves to valid state data, so the
handler passes both early-return checks and reaches line 171 (`auth.callback_received`
fires), then `handleCallback`/claims validation throws `MissingClaimError`, which is caught
and routed to the `auth.failure` emit at line 354. Both emit calls execute inside the same
handler invocation and close over the same `correlationId`. Once Task 1.1 adds
`correlationId` to the `callback_received` call, this test is a direct extension of tests
that already exist — no new mocking, no new control-flow path needs to be exercised.

One clarifying note for whoever picks up Task 2.3: the two *earliest* failure branches
(missing `stateParam`, state not found in Redis) never reach `auth.callback_received` at
all — it's emitted after those checks, at line 171. So those two branches aren't valid
scenarios for this particular cross-event assertion (there's only one correlatable event on
those paths). The missing-claims tests are the right and, as far as I can tell, only
existing fixture that reaches both events in one invocation. Worth stating explicitly in
the test file's comment so a future reader doesn't wonder why Task 2.3 didn't reuse the
state-missing tests.

## Boundaries and blast radius

Clean. Confirmed the only files touched are `auth.ts` (three object literals) and its test
file. `emitAuditEvent`'s signature (`fields: Record<string, unknown>`) is untyped per-event,
so this change requires no change to `audit-logger.ts` — the Non-Goal is accurate, not just
asserted. No schema, API, or redirect-body changes. Additive-only fields on existing log
lines carry no externally observable behavior change, consistent with the Migration Plan
saying "no migration."

## Technology choices

None to evaluate — no new dependency, no new abstraction. Reusing an existing
`const` binding is the entire implementation.

## Minor observations (non-blocking)

1. **Test coverage for `role_claim_mapped` is implicitly out of scope, and that's fine.**
   AC1 names `auth.role_claim_mapped` as one of the events that must share the
   `correlationId`, but Task 2.2 only asserts identity for the new-user
   (`first_access_created`) branch, not the returning-user-with-role-claim branch. This
   isn't a gap introduced by this change — `role_claim_mapped` already emits the correct
   binding today, pre-dating this proposal — so it's not a regression risk. I'd only flag
   it if someone wants belt-and-suspenders coverage; I wouldn't block on it.

2. **Asymmetry with `join.link_rejected`/`join.link_redeemed` is a deliberate, reasonable
   scope cut.** After this change, `auth.*` events in this handler carry both `sourceIp`
   and `correlationId`; the join events (in `executeJoinFlow`, same handler) will carry
   `sourceIp` only. `correlationId` isn't threaded into `executeJoinFlow` today and this
   change doesn't add a parameter to fix that. I agree with the design's call to leave it
   as a named follow-on rather than scope-creeping issue #4 — but wanted to note it's a
   real (small) inconsistency in the audit trail post-change, not a hidden one.

3. **No behavioral test asserts `auth.callback_received` fires exactly once per
   invocation** before/after this change — not needed for this proposal, just noting it
   wasn't something to double check given the "same value across all emit sites" framing;
   the risk here is wrong-value, not double-emission, and the design correctly targets
   that.

## Summary

The design accurately reflects the current state of `auth.ts`, correctly identifies the
one binding to reuse, and correctly scopes out everything adjacent (logger signature,
join events, unrelated precision notes) that would otherwise balloon a 3-field change into
a larger refactor. The failure-path test task is achievable with the existing test
fixtures and requires no new control-flow scenario. I have no changes to request.
