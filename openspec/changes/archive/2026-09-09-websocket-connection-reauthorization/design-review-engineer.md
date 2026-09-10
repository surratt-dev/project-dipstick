# Full Stack Engineer Design Review — websocket-connection-reauthorization

Reviewer: Marcus Oyelaran
Scope: design.md, proposal.md, tasks.md, checked against the actual current state of `packages/backend/src/realtime/` and `packages/backend/src/auth/`.

## Summary

The two-mechanism split (D1), the delivery-time-independence argument (D8), and the two-close-code non-disclosure boundary (D5) are sound and I'd sign off on them as written. Function names, import paths, and the `middleware.ts` line range design.md cites all check out against the real code.

But there are five places where the design describes behavior that the current codebase has no mechanism for, or where the described mechanism can't produce the claimed result. Three of them are blocking — they need a design decision before Group 1/3/5 tasks can be implemented as written, not just an implementation detail to sort out later. `tasks.md` didn't drift from `design.md` on any of these — it faithfully mirrors design.md's gaps, which is actually useful: fix these at the design level and tasks.md mostly follows.

## Blocking issues

### 1. Decision D9's recovery-detection has no state to check against

D9 and task 5.3 both say: at registration time, "check whether the immediately preceding connection for that `(userId, sessionId)` pair was deregistered via a `REAUTH_GRACE_EXPIRED_CLOSE_CODE` close." I checked — nothing in `connection-registry.ts`, `websocket-routes.ts`, or `staleness-signal.ts` records *why* a connection was deregistered. `ConnectionRegistry.deregister()` (`connection-registry.ts:66`) just does `set.delete(conn)`; once that happens the `RegisteredConnection` object has no other referent and there is no data structure anywhere — not in the registry, not elsewhere — that remembers the close code after the fact. `grep` for `closeReason`/`lastClose` across `realtime/` returns nothing.

This means D9's mechanism is not implementable as written. It needs a new piece of per-pod state — e.g., a short-lived `Map<"${userId}:${sessionId}", { closedAt: number, code: number }>` with its own cleanup/TTL — that neither the Decisions section nor the Migration Plan names. That's a third piece of registry-adjacent state this design introduces silently. It also inherits `ConnectionRegistry`'s per-pod-only nature, which raises a case the design never names: a reconnect that lands on a **different** pod than the one that closed it never sees the "preceding connection," so the diagnostic trace fires or doesn't fire depending on load-balancer routing — nondeterministic from an operator's point of view. Worth naming explicitly as a limitation (the way the archived design's D8 named what it couldn't do), not silently absorbed.

### 2. Decision D9's "no new endpoint" claim is false — audit_log has zero read paths today

D9: "This becomes queryable through the same facilitator-role session-history/session-detail read path `content.ts` already serves — no new endpoint." I grepped the entire backend for `FROM audit_log` / `SELECT.*audit_log` — there are zero matches. Every existing `audit_log` touch point (`content.ts`, `facilitator-sessions.ts`, `em-views.ts`, `teams.ts`, `sessions.ts`) is an `INSERT`. `content.ts`'s facilitator-facing responses are built from `team-content-serializers.ts` against `sessions`/`votes`/`action_items` — never `audit_log`. Today `audit_log` is genuinely write-only.

So Decision D9's mechanism requires **new** query code — at minimum, a query added to whatever `content.ts` handler serves facilitator session-history/detail, to also select `session.connection_recovered` rows and merge them into the response shape. That's real, unscoped work; "no new endpoint" is true only in the narrow sense that no new route is added, but it understates what Migration Plan step 5 / task 5.4 actually requires. Recommend either scoping this properly (name the specific `content.ts` handler and what changes) or, if that's too much for this pass, deferring D9's read-path to a follow-on and shipping only the write side now.

### 3. `refreshSessionTokens`'s contract is underspecified in a way that could silently break the HTTP path

Two related gaps in D3:

- **Mutation vs. return value.** The current inlined code (`middleware.ts:62-67`) mutates `session` in place (`session.encryptedAccessToken = ...`) — the same object reference as `request.session`. `@fastify/session` auto-persists `request.session` via its `onSend` hook, which is *why* today's code needs no explicit `store.set()` call on the HTTP path. D3's discriminated result (`{status: "refreshed"; session: SessionData}`) doesn't state whether `refreshSessionTokens` mutates its input in place (preserving the HTTP auto-persist behavior — the "pure refactor" claim in Risk 2 requires this) or returns a fresh object (which would silently break HTTP-side persistence unless `authMiddleware` is also changed to copy the returned fields back onto `request.session` — a *new* behavior, not a pure refactor). This needs to be stated explicitly: mutate in place, return the same reference.
- **Missing `sessionId` for audit parity.** The code being extracted currently emits `auth.token_refresh_success`/`auth.token_refresh_failure` with `sessionId: request.session.sessionId` in the fields (`middleware.ts:72, 86, 111`). `refreshSessionTokens(session: SessionData, log: FastifyBaseLogger)` has no way to reproduce that field — `SessionData` doesn't carry the Fastify session id. Either the signature needs a third `sessionId: string` parameter, or these two audit emits move out of the extracted function and get duplicated at both call sites — which contradicts Risk 2's claim of "identical audit events." Given D3 already adds `conn.sessionId` to `RegisteredConnection` for exactly this value, passing it into `refreshSessionTokens` is the natural fix — worth stating explicitly rather than leaving it to be discovered during task 1.1.

## Moderate issues

### 4. `audit_log`'s NOT NULL columns aren't accounted for in task 5.3

Migration `8_audit_log.sql` makes `actor_user_id` and `actor_global_role` `NOT NULL` (`team_id` is nullable). Every existing call site (`facilitator-sessions.ts:331-335`, `content.ts:73-85`) does a fresh `SELECT global_role FROM users WHERE id = $1` before the insert to populate `actor_global_role`. Task 5.3's `session.connection_recovered` write doesn't mention this lookup — "no other fields" in D9/5.3 is about the `metadata` JSONB payload (correctly, per the disclosure concern), but `actor_global_role` is a separate top-level required column, not metadata, and needs its own query or a threaded-through value. Small fix, but worth naming so it isn't discovered mid-implementation as a fifth ad hoc inline `SELECT global_role` (Marcus would rather see this reuse an existing helper if one exists, or explicitly accept the duplication).

### 5. Naming collision: two different "sessionId"s live on the same object

D3 is careful to warn that `conn.sessionId` (Fastify session id) is "not to be confused with the WS route's `:sessionId` path parameter" — but D9's own prose then writes "(userId, sessionId) pair" for the recovery-detection audit event without saying which one it means. Given the WS route path param is what keys `ConnectionRegistry` and is presumably what a facilitator cares about, this is almost certainly the route param, not `conn.sessionId` — but the fact that the design's own text conflates the two names it explicitly flagged as confusable is a sign the field should be renamed to something unambiguous (e.g. `httpSessionId` or `fastifySessionId`) before implementation, not just annotated with a comment.

### 6. Grace-period recovery (D4) is structurally unreachable for the "revoked" sub-case

D3 funnels both `"revoked"` and `"transient_failure"` into the same `reauth_required` + 30s grace-period path. D4's recovery check re-reads `SessionData` for the *same* session id and checks if `tokenExpiresAt` moved. But a genuine OIDC revocation means the user must go through a fresh login — which (per the existing HTTP behavior at `middleware.ts:83`, `request.session.destroy()`) produces a **new** session id, not an update to the old one. So the grace-period recovery check can, by construction, only ever succeed for `"transient_failure"` — never for `"revoked"`. That's probably fine behaviorally (revoked users simply don't recover in-place, which is correct), but the design should say this outright rather than presenting one recovery path that quietly only works for one of the two cases it's declared to handle.

### 7. Single `tokenRefreshTimer` field reused across two phases — works, but should be stated as deliberate

`RegisteredConnection` (task 1.5) gets exactly one `tokenRefreshTimer` field, but D3/D4 describe three sequential phases per connection (wait-for-expiry timer → on failure, grace-period timer → on success, reschedule). Reusing one field across phases is safe here because each new `setTimeout` is only ever scheduled from inside the previous one's own fire callback (never while the prior timer is still pending), so there's no leaked handle. But this is a nonobvious invariant to preserve correctly during implementation and neither design.md nor tasks.md states it — worth a one-line comment in the design ("this field is reassigned at each phase transition; safe because transitions only happen from within a fired timer's own callback, never concurrently") so a future change to this code doesn't accidentally introduce a second in-flight timer under the same field.

## Validated as sound

- **Timer model (the specific question I was asked to check):** `setInterval` for the SEC-25 sweep is a reasonable, idiomatic choice, and it composes safely with the existing pattern. `scheduleForceClose`'s existing precedent (`websocket-routes.ts:138-152`) already calls `deregister()` explicitly from the timer callback *and* relies on the socket's `"close"` event handler to call `deregister()` again — i.e., double-deregistration is already the norm today, and `ConnectionRegistry.deregister()` is already idempotent (`Set.delete` on a missing entry, `clearTimeout`/`clearInterval` after `delete conn.forceCloseTimer` no-ops). D2/D3's proposed `reauthSweepTimer`/`tokenRefreshTimer` fit this precedent cleanly, provided task 1.6's extension of `deregister()` (clearing all three timer handles) actually ships — it's correctly scoped in tasks.md.
- D2's admin-path rejection rule for team-scoped sweeps matches `ws-event-dispatcher.ts`'s `dispatchTopicHistoryUpdate` (`ws-event-dispatcher.ts:261-267`) exactly.
- The `middleware.ts` line citation (~51-123) for the refresh loop is accurate.
- Risk 3's characterization of `session-store.ts`'s `set()` as a full-overwrite `SETEX` (no partial update) is accurate — the race analysis holds.
- The new `reauth_required` `WsClientMessage` variant fits cleanly into the existing discriminated union in `realtime.ts`.

## tasks.md drift check

No meaningful drift found — tasks.md tracks design.md's decisions faithfully, including the gaps above (task 5.3 inherits D9's missing-state problem, task 5.4 inherits the false "no new endpoint" premise, task 1.1 inherits the underspecified `refreshSessionTokens` contract). Fixing items 1-3 at the design level should be done before Group 1/3/5 tasks are treated as ready to implement; the task text itself won't need much rewording once the design decisions are tightened.
