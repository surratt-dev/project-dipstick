# Security Analyst Implementation Review: websocket-connection-reauthorization

**Reviewer:** Tomás Ferreira (Security Analyst)
**Reviewing:** the implementation's security-sensitive code paths (issue #27)

## Verdict

No findings that block. The three security fixes the design review demanded (the session-resurrection race, the disclosure-boundary structural separation, the non-disclosure query filter) are all correctly implemented, and I found no new leak path in the code around them.

## Conditional write (Decision D3a) — atomicity and failure handling verified

`session-store.ts`'s `conditionallyUpdateSession` issues a single `redis.set(key, value, "EX", ttl, "XX")` call — one atomic Redis command, no read-then-write gap for a concurrent `DEL` to land in. I checked every caller: `connection-token-refresh.ts:210` is the only production call site, and its `if (!wrote)` branch routes to `recordRefreshFailureAudit` + `startGracePeriod` — the same path as an explicit `"revoked"` result — with no retry loop and no fallback to the unconditional `set()` `createRedisStore` still exposes for `@fastify/session`'s own use. `connection-token-refresh.test.ts`'s dedicated test ("a conditionallyUpdateSession rejection... is treated as a failure, not a silent success") asserts exactly this: `mockConditionallyUpdateSession` called exactly once (no retry), `reauth_required` sent, and the audit row's `failureType` is `"session_destroyed_concurrently"` — not superficial, it checks the actual downstream consequence.

## Grace-period marker — keyed correctly, no client-influenced lookup

`consumeGraceRecoveryMarker(userId)` builds its Redis key as `GRACE_MARKER_PREFIX + userId`, where `userId` is always the value the caller resolves from the *new* connection's own authenticated session (`websocket-routes.ts` passes `session.userId`, itself resolved server-side from `request.session` at connection time — never a client-supplied header or query parameter). There is no code path where a connecting client can supply an arbitrary userId to probe another user's marker. The security-boundary test in `connection-token-refresh.test.ts` explicitly asserts the delete call is scoped to the exact userId argument and checks a `user-2` lookup never touches `user-1`'s key.

`REAUTH_GRACE_EXPIRED_CLOSE_CODE` (4001) and `STALE_SIGNAL_CLOSE_CODE` (4000) are used from two different functions in two different modules (`connection-token-refresh.ts` vs. `connection-reauthorization.ts`), each hardcoded — no shared "close with code X" helper takes a cause parameter. I grepped both files for cross-calls into each other's close logic and found none; the two close paths are structurally incapable of being confused, matching Decision D5's explicit rejection of a flag-parameterized shared helper.

## Non-disclosure filter on the new facilitator query — airtight

`fetchConnectionRecoveries`'s SQL is `WHERE operation = 'session.connection_recovered'` — a plain equality match, not `LIKE 'session.%'` or any prefix pattern. I confirmed the `audit_log` table now holds two operations that must never reach this query (`session.access_revoked_live`, `session.token_refresh_failed_live`) and traced that neither can match this exact-equality clause. `content.test.ts` has a dedicated assertion (`sql.not.toContain("like")`, `sql.not.toContain("session.%")`) confirming the query text itself, not just its behavior against today's fixture data — this catches a future edit that widens the filter even if nobody updates the test fixtures to include a leak-triggering row.

## Sensitive-data exclusion in new audit_log metadata

Checked all three new `INSERT INTO audit_log` call sites (`connection-reauthorization.ts`'s revocation write, `connection-token-refresh.ts`'s failure write and recovery write). None reference `encryptedAccessToken`, `encryptedRefreshToken`, vote values, or any token material — metadata is limited to `{ scope, scopeId }` and, for the failure case, `{ failureType }`. Consistent with SEC-16/SEC-22 and with the existing `session.vote_submitted` precedent's exclusion discipline.

## Facilitator-only leak check for `connectionRecoveries`

Traced the type definition (`FacilitatorContentView` only — `ParticipantContentView`/`EMContentView` have no such field) and the single assignment site in `content.ts`, gated behind `grant.path === "facilitator"`. No other branch in `content.ts` touches `connectionRecoveries`. This is a compile-time guarantee, not just a runtime check — a non-facilitator grant path literally cannot produce a response object with this field populated without a type error.

## HTTP-side copy-back — no new concurrency window

The `refreshSessionTokens` → copy-back sequence in `authMiddleware` reads and mutates `request.session` synchronously (relative to other code in the same request handler) around a single `await`. This is the same interleaving characteristic the original inline code already had — two genuinely concurrent HTTP requests on the same session could already race on session mutation before this refactor; the extraction doesn't widen that window. The cross-request/cross-transport (HTTP vs. WS) version of this same class of race is what Decision D3c already names as a residual risk with its own mitigation (the re-check-before-refresh) — not a new gap this implementation pass introduced silently.

## Test suite verification

Ran `npx vitest run` from `packages/backend`: 447 passed, 1 skipped (pre-existing, self-skipping integration test requiring live Redis/Postgres — not a coverage gap). Spot-checked that the disclosure-boundary and conditional-write tests assert on actual call arguments and downstream state (audit row contents, close codes sent, retry counts) rather than just "no exception was thrown" — confirmed above.
