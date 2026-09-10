## Why

`websocket-delivery-time-authorization` closed the window at the moment an event is pushed: every content-access event is now re-checked against the database at delivery time, no caching, no exceptions. What it cannot do is reach a connection that receives nothing — a facilitator sitting in a quiet pre-session lobby, or a participant waiting for a reveal, whose team membership is revoked or whose token expires generates no push and so triggers no check. That gap stopped being theoretical when `session-lifecycle-transitions` (issue #26) wired all four content-access events to real production triggers: a real facilitator with revoked access, sitting in a real quiet lobby, is now a live possibility this system does not notice until the 90-minute absolute lifetime closes it — not "eventually," a defined interval, per BRD SEC-25/SEC-26/SEC-27.

## What Changes

- Add a periodic per-connection re-authorization sweep (SEC-25/SEC-27) that re-evaluates every registered WebSocket connection — session-scoped and team-scoped alike — against current database state every 5 minutes, reusing the identical `evaluateSessionSubscriberAccess`/`evaluateTeamAccess` authorization functions the delivery-time path already calls. A connection that fails the check is closed with `STALE_SIGNAL_CLOSE_CODE` (4000), indistinguishable from any other server-initiated close, per the existing non-disclosure guarantee.
- Add a silent token-refresh mechanism (SEC-26) for active WebSocket connections, modeled on `authMiddleware`'s existing refresh/retry/revocation-distinction logic, so a connection's underlying auth token is kept live for up to the full 90-minute session ceiling without interrupting the participant. On refresh failure past retries, the client is explicitly notified that re-authentication is required (a legitimately disclosed, client's-own-token signal, distinct from revocation non-disclosure) and given a ~30-second grace period to complete it before the connection is terminated.
- Extend `ConnectionRegistry`'s `RegisteredConnection` with the session-id reference needed to re-fetch current `SessionData` from the Redis-backed session store, enabling the SEC-26 refresh path to operate on a long-lived WS connection that has no live HTTP request object.
- Preserve in-flight client state across both mechanisms: a composed-but-unsubmitted vote must survive a silent refresh or a non-revocation sweep cycle without being lost or forcing re-entry.
- Preserve the 90-minute absolute connection lifetime as a separate, unmodified axis: a successful token refresh must never reset or extend `sessionCreatedAt`.
- Surface a generic, non-disclosing "a reconnect occurred" signal in facilitator-visible session history/diagnostics when a connection silently recovers, without revealing cause.
- **BREAKING**: None. This is additive to the already-shipped delivery-time authorization and connection registry; no existing client-facing contract changes except the new, explicitly-disclosed SEC-26 re-authentication-required signal.

## Capabilities

### New Capabilities
- `websocket-connection-reauthorization`: Periodic re-authorization of open WebSocket connections (SEC-25/SEC-27) and token-expiry/silent-refresh handling for active connections (SEC-26), including the non-disclosure boundary between revocation closes and legitimate re-auth prompts, in-flight state preservation, and facilitator-visible diagnostic traces for silent recoveries.

### Modified Capabilities
- `websocket-session-authorization`: No requirement-level change. This effort is additive — it adds a periodic check point alongside the existing delivery-time check point — and does not alter any existing requirement or scenario in that spec. Not listed as modified; called out here for the reviewer's benefit.

## Impact

- **Affected code:** `packages/backend/src/realtime/connection-registry.ts` (extend `RegisteredConnection`), `packages/backend/src/realtime/websocket-routes.ts` (new periodic timer, sibling to `scheduleForceClose`), `packages/backend/src/realtime/staleness-signal.ts` (reused `STALE_SIGNAL_CLOSE_CODE` for SEC-25 closes; new, distinct signal for SEC-26 re-auth-required), `packages/backend/src/auth/middleware.ts` (refresh/retry/revocation logic adapted for the WS path), `packages/backend/src/auth/session-store.ts` (read path for `SessionData` from a WS connection).
- **Affected specs:** New `websocket-connection-reauthorization` capability spec. No changes to `websocket-session-authorization`.
- **Dependencies:** None new — reuses existing Postgres, Redis session store, and OIDC provider integration.
- **Client-visible impact:** A new, legitimately-disclosed "please re-authenticate" signal on SEC-26 grace-period expiry (UX design deferred to Design stage / Facilitator SME). No visible change on the SEC-25 revocation path — it remains indistinguishable from any other silent close.
