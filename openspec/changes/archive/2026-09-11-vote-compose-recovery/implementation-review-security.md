# Security Review — vote-compose-recovery (GitHub issue #31)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Branch reviewed:** `agent-team/vote-compose-recovery`
**Scope:** Security-relevant decisions D3, D3d, D3e of `design.md`, and the fifth `Risks / Trade-offs` entry (vote content persisting in `sessionStorage`), verified against the actual implementation, not just the design prose.

## Summary

Sign-off granted. This is the kind of change I wish crossed my desk more often — the design document states its own threat-relevant decisions explicitly (D3d's self-disclosure boundary, D3e's deliberate no-audit-log call, the sessionStorage risk entry naming its own residuals), and the implementation matches what was written, not an approximation of it. I found no findings that block this change. Two items are recorded below as non-blocking observations for whoever builds the compose UI wiring later (task 8.1) — they are inherited scope, not new issues introduced here.

## D3 / D3d — `buildSessionRegistrationSnapshot` and the registration payload

**Claim under test:** `userId` passed into `buildSessionRegistrationSnapshot` is server-derived and non-spoofable, and the query returns only the calling user's own vote/lock-in status.

**Verified at the call site.** `packages/backend/src/realtime/websocket-routes.ts:79,84,116` (`GET /ws/sessions/:sessionId`):

```ts
const session = request.session as unknown as SessionData;
...
const grant = await evaluateSessionSubscriberAccess(session.userId, sessionId);
if (grant === null) { socket.close(CLOSE_UNAUTHORIZED); return; }
...
await sendSessionRegistrationSnapshot(session.userId, sessionId, conn, request.log);
```

`session.userId` comes from `request.session`, populated by `@fastify/session`'s cookie-backed store. I traced where `SessionData.userId` is ever assigned: only `packages/backend/src/routes/auth.ts` (OIDC callback, `user.id` from the verified identity provider claims) writes it. No route reads `userId` from a query param, header, or request body and assigns it to `request.session`. `authMiddleware` (`packages/backend/src/auth/middleware.ts`) runs as an `onRequest` hook ahead of this route handler and 401s outright if `session.userId` is falsy — there is no path into the WS handler with an unauthenticated or client-influenced `userId`. This satisfies the call-site discipline the design document calls out explicitly (D3c's "Call-site discipline" note) and the code comment on `buildSessionRegistrationSnapshot`'s declaration correctly documents the same constraint for future call sites.

**Self-scoping of the query.** `packages/backend/src/realtime/session-registration-snapshot.ts:46-53`:

```sql
SELECT s.status AS session_status, s.current_topic_id, st.status AS topic_status,
       (v.id IS NOT NULL) AS has_locked_in
FROM sessions s
LEFT JOIN session_topics st ON st.id = s.current_topic_id
LEFT JOIN votes v ON v.session_topic_id = s.current_topic_id AND v.voter_id = $2
WHERE s.id = $1
```

The `votes` join is bound to `v.voter_id = $2` (the caller's `userId`), so the only fact the query can ever surface about the `votes` table is a boolean — whether a row exists for *this* voter on the current topic. There is no code path in this function that can return another participant's vote value, another participant's lock-in status, or vote content of any kind (no `vote_value` column is even selected). This matches D3d's stated claim exactly. Unit tests (`session-registration-snapshot.test.ts`, case "(iv)") assert the query is parameterized with the connecting `userId` as `$2` and that `v.voter_id = $2` appears in the SQL text — a reasonable unit-level check given the actual isolation guarantee lives in the SQL itself, not application logic that could drift.

`buildSessionRegistrationSnapshot` itself performs no access check — by design, and correctly documented as such in both `design.md` and the function's own doc comment. It is not a second authorization boundary; it is a data-shaping function that trusts its caller, and the caller (the one call site above) satisfies that trust correctly.

## D3d — no leak before the access grant

**Claim under test:** the snapshot is only ever built/sent after `evaluateSessionSubscriberAccess` grants access; there is no reachable path where it's sent before that gate resolves.

Confirmed by direct code reading: the `grant === null` branch returns immediately, closing the socket before `connectionRegistry.register`, the timer scheduling calls, or `sendSessionRegistrationSnapshot` are ever reached — all of it is sequential `await`-chained code inside a single async IIFE, not concurrent branches that could race. There is exactly one path through this handler after a successful grant, and the snapshot send is the last operation on it before the `close`/`error` listeners are attached.

This is also enforced by a regression test, not just a design claim: `websocket-routes-registration-snapshot.test.ts` ("a connection rejected by evaluateSessionSubscriberAccess receives no session_registration_snapshot and the snapshot is never built") mocks a rejected grant and asserts both zero messages received and that `buildSessionRegistrationSnapshot` was never called. A second test in the same file verifies ordering the other direction — a successful registration receives the snapshot as the *first* message, before a subsequent unrelated session-scoped event. I ran both tests along with the full suite; all pass (see Verification below).

**Failure containment, verified against the design's ordering requirement.** D3c requires the snapshot call to run strictly after `scheduleReauthorizationSweep`, `scheduleTokenRefreshMonitor`, and `checkAndRecordGraceRecovery`, and to never let a failure in it prevent those from running or surface as an unhandled rejection. The implementation matches: `sendSessionRegistrationSnapshot` is called last, after all three, and is itself wrapped in `try/catch` with a `log.warn` on failure and no rethrow (`websocket-routes.ts:184-228`). The test suite includes a dedicated case that mocks `buildSessionRegistrationSnapshot` to throw and asserts the sweep/monitor calls still ran, no message was sent, the socket stayed open, and `process.on("unhandledRejection", ...)` recorded nothing. This is exactly the property the design calls for.

## D3e — no audit_log row for `session_registration_snapshot`

Confirmed absent. `grep` for `audit_log` and `emitAuditEvent` across `packages/backend/src/realtime/*.ts` shows both used in `connection-reauthorization.ts` and `connection-token-refresh.ts` (the SEC-25/26 revocation/refresh/grace-recovery lifecycle, which the design says remains audited) but neither appears in `session-registration-snapshot.ts` or in the `sendSessionRegistrationSnapshot` wiring added to `websocket-routes.ts`. The only mention of `audit_log` near this code is a comment explaining the decision, not a call. This matches D3e precisely: a stated decision not to log, not an oversight, and consistent with the existing precedent that ordinary WS registration itself has never been audited.

I don't have a standing objection to this decision. My usual default (see my persona notes on auditability) is to push back on unaudited access to sensitive data, but D3e's framing is correct: this is a passive read of state the participant already has standing to see via other unaudited means (the same registration itself, and the lock-in submission `ON CONFLICT` path), not a new action. If a future change ever makes `hasLockedInVote` (or an equivalent) available for a participant to query about *another* participant, that would change the calculus and should get its own audit consideration at that time — not retroactively applied here.

## Fifth risk entry — vote content in `sessionStorage`

**Claim under test:** the persisted key/data stays single-tab, single-key, never transmitted, and vote values are never logged.

`packages/frontend/src/realtime/voteDraft.ts` confirmed:

- Single key: `VOTE_DRAFT_STORAGE_KEY = "dipstick:vote-draft"`, referenced everywhere storage is touched (`persistDraft`'s `setItem`, `restoreDraft`'s `getItem`/`removeItem`). `grep -r sessionStorage packages/frontend/src` returns only this module and its test — no second read/write site exists anywhere in the frontend.
- Never transmitted: no `fetch`/`XMLHttpRequest`/WebSocket send appears anywhere in this module. The design's Non-Goals section states this explicitly ("never transmitted to the backend") and the code has no network call of any kind.
- No logging of vote values: `grep` for `console\.` in `voteDraft.ts` and its test returns nothing in the implementation file. No error-reporting/RUM/Sentry/Bugsnag/Datadog tooling exists anywhere in the frontend or backend today (confirmed by a case-insensitive repo grep), consistent with the design's own note that this is a forward-looking concern for whoever adds such tooling later, not a currently-live gap.
- Read-once-then-clear: `restoreDraft` reads and immediately `removeItem`s the key in the same step, before any discard/restore branch runs, gated by a module-scope `restoreAttempted` flag so a second registration in the same page load is a no-op that never touches storage. This matches D2 and is covered by unit tests I ran directly (`restore-once-per-load gate` describe block, 2 tests, both passing).

The design document's own risk entry already names the two residual properties correctly (same-origin JS-readability beyond full-page XSS; browser session-restore/crash-recovery features not reliably honoring "cleared on tab close"). I have nothing to add beyond what's already on record there — these are accepted, named residuals of a `sessionStorage`-based design, not gaps the implementation introduced or failed to account for.

## Verification performed

- Read `design.md` in full, with particular attention to D3/D3a-D3e, D4, and the fifth risk entry.
- Read `session-registration-snapshot.ts`, the diff to `websocket-routes.ts`, `voteDraft.ts`, and the diff to `packages/shared/src/types/realtime.ts` / `index.ts` in full.
- Traced `session.userId` provenance through `auth/middleware.ts` and `routes/auth.ts` to confirm it is set only at OIDC callback and never from client-controlled input.
- Grepped for `audit_log`/`emitAuditEvent` across `packages/backend/src/realtime/` to confirm no new audit row was added for this message type.
- Grepped for `sessionStorage` across `packages/frontend/src` to confirm single call-site ownership, and for `console.`/error-reporting tooling to confirm no vote-value logging exists.
- Ran the relevant automated tests directly, using each package's own vitest config (not the bare CLI, which lacks jsdom for the frontend suite):
  - `packages/backend/src/realtime/__tests__/session-registration-snapshot.test.ts` — 6/6 passing, including the `voter_id = $2` self-scoping assertion.
  - `packages/backend/src/realtime/__tests__/websocket-routes-registration-snapshot.test.ts` — 5/5 passing, including the pre-grant no-leak case and the failure-containment/no-unhandled-rejection case.
  - `packages/frontend/src/realtime/__tests__/voteDraft.test.ts` (run from `packages/frontend` with its own `vitest.config.ts`, jsdom environment) — 13/13 passing.

## Findings

None blocking. No findings of any severity against the four items in scope for this review.

## Non-blocking observations (forward-looking, not action items against this change)

1. **Task 8.1 (compose UI wiring) inherits the `sessionStorage` exposure boundary as a design constraint, not a suggestion.** When that UI is built, `persistDraft`'s call site must not be widened to write on anything other than the compose value itself, and no second read site should be introduced. This is already stated as a hard property in `design.md`'s Risks section; I'm noting it here only so it's visible to whoever picks up task 8.1 without needing to re-read the full design doc.
2. **The open question about a live "topic changed" push (design.md Open Questions, first bullet) has a mild security-adjacent edge, not a vulnerability:** a connected-but-idle participant whose topic advances has no live signal to that effect until their next registration. This cannot cause a stale restore under the current mechanism (D2's once-per-load gate means `restoreDraft` only ever runs once, at mount, against the registration payload available at that time — it does not re-run later against a stale in-memory copy), so I have no objection to it being out of scope here. Flagging only so it's not silently assumed solved when the compose UI is built.

## Sign-off

Approved from a security standpoint. D3/D3d's self-disclosure boundary, D3e's no-audit-log decision, and the sessionStorage risk entry are all implemented exactly as designed, verified against actual code (not design intent alone), and backed by passing tests that would catch a regression in any of the three. No changes required before this merges.
