# Solution Architect Implementation Review: websocket-connection-reauthorization

**Reviewer:** Ingrid Sollenberger (Solution Architect)
**Reviewing:** the implementation against design.md and tasks.md (issue #27)

## Verdict

Implementation matches the design. I traced every decision (D1–D9a, plus D3a/D3b/D3c) to concrete code and found no drift, no re-implementation of authorization logic, and no code path the Non-Goals ruled out. Full test suite green.

## Test suite and typecheck

Ran `npx vitest run` from `packages/backend`: **447 passed, 1 skipped** (the skip is `ws-pubsub-integration.test.ts`, which self-skips with an explicit message when Redis/Postgres aren't reachable — a pre-existing, correctly-behaving test, not a gap this change introduced).

Ran `npx tsc --noEmit -p tsconfig.json`: no new errors in any file this change touches. The remaining errors are pre-existing, widespread test-file strictness issues (a `decorateRequest("session", null)` typing pattern that recurs across a dozen older test files unrelated to this change, plus a handful of `noUncheckedIndexedAccess` array-access warnings in older test files) — none of these are in files this change created or modified.

## Verified against the five specific questions

1. **Conditional write usage.** `conditionallyUpdateSession` has exactly one production call site (`connection-token-refresh.ts:210`), and it's the WS-side refresh write-back. `session-store.ts`'s original unconditional `set()` (used by `createRedisStore` for `@fastify/session`) is untouched — grepped for any other write path and found none. A `false` return is handled correctly: treated identically to `"revoked"` (`recordRefreshFailureAudit` + `startGracePeriod`), never retried, never falls back to the unconditional write.
2. **No in-place recovery in the grace-period mechanism.** The grace-timer's `setTimeout` callback (`connection-token-refresh.ts:153–158`) does exactly two things: `registry.deregister` and an unconditional `conn.socket.close(REAUTH_GRACE_EXPIRED_CLOSE_CODE)` — no session re-read, no conditional branch. This is the rebuilt Decision D4 exactly as specified; no residual code path attempts to resume the original connection.
3. **Non-disclosure filter.** `content.ts`'s `fetchConnectionRecoveries` query: `WHERE operation = 'session.connection_recovered'` — an exact equality match, not a `LIKE` or prefix pattern. The `connectionRecoveries` field only exists on `FacilitatorContentView` in the shared type (`team-content-views.ts:187`) — `ParticipantContentView` and `EMContentView` don't have the field at all, so there's no type-level path for it to leak into a non-facilitator response shape. The assignment in `content.ts` is correctly gated behind `grant.path === "facilitator"`.
4. **`ws-event-dispatcher.ts` untouched.** `git diff --stat src/realtime/ws-event-dispatcher.ts` produces no output — the file is genuinely unmodified. The new Group 6 test (added to `ws-event-dispatcher.test.ts`) exercises `dispatchVoteRevealed` with live `reauthSweepTimer`/`tokenRefreshTimer` handles present on the connection object and confirms delivery is unaffected — consistent with the file never reading those fields.
5. **No ruled-out code paths introduced.** Grepped `connection-reauthorization.ts` and `connection-token-refresh.ts` for `process.env` — none found; the interval and grace-period constants are hardcoded module-locals exactly as Decision D9a requires. The pre-existing HTTP-side audit-log gap is correctly *not* retrofitted here — it's tracked separately as GitHub issue #30, referenced in tasks.md's Non-Goals-respecting task 8.6, not silently fixed as scope creep.

## Architectural boundaries

`connection-token-refresh.ts` imports `resolveActorGlobalRole`/`resolveTeamIdForAudit` from `connection-reauthorization.ts` rather than duplicating the lookup queries — confirmed via import statement and usage at both `recordRefreshFailureAudit` and `recordConnectionRecoveredAudit`. No third implementation of "resolve this user's global role for an audit row" exists. Both new modules call `evaluateSessionSubscriberAccess`/`evaluateTeamAccess` verbatim for their respective authorization checks — no parallel authorization logic anywhere in the two new files.

`RegisteredConnection`'s `fastifySessionId` naming (avoiding collision with the domain-level `sessionId` used as the registry key) and the `tokenRefreshTimer` single-handle-across-three-phases invariant are both present with the exact code comments design.md's Migration Plan specified — the documentation trail from design decision to implementation is intact, not just the behavior.

## Minor observations, not blocking

- `content.ts`'s `fetchConnectionRecoveries` and `connection-token-refresh.ts`'s `writeAuditLogRow` both independently construct `INSERT INTO audit_log` statements with the same five-column shape. This is the same class of acceptable, minor duplication design.md's own Decision D2/D3b comments already anticipated (each call site's INSERT is simple enough that a shared helper would add more indirection than it saves) — not a re-implementation of authorization or business logic, just repeated SQL shape. Not worth extracting.
- No dedicated test exercises the cross-pod aspect of the grace-recovery marker (a login landing on a different pod than the one that started the grace period) — this is inherent to the design (Redis-backed, not `ConnectionRegistry`-local) and the unit tests correctly test the marker mechanism in isolation from pod topology, which is the right unit-test boundary; a multi-pod scenario would require an integration/E2E harness this codebase doesn't have for WS infrastructure yet (same gap `ws-pubsub-integration.test.ts` already names for the archived change).
