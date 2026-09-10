// ---------------------------------------------------------------------------
// WebSocket close codes — shared runtime constants (not types)
//
// design.md Decision D1b (websocket-staleness-signal): both codes originated
// in packages/backend (staleness-signal.ts, connection-token-refresh.ts) but
// must be importable from the frontend, which depends on @dipstick/shared
// only and must never depend on @dipstick/backend. Relocated here as a pure
// move — values and semantics are unchanged, only the module of record
// moves. The backend files re-export these under their original names so
// every existing backend import site is unaffected.
//
// Unlike every other export in this package, these are runtime values
// (`export const`), not `export type` — connectionHealth.ts compares
// against them directly.
// ---------------------------------------------------------------------------

/**
 * The single WebSocket close code used for every server-initiated close
 * whose cause must not be disclosed to the client: an unauthorized
 * subscription attempt and the scheduled absolute-lifetime force-close
 * (websocket-delivery-time-authorization design.md Decision D8).
 */
export const STALE_SIGNAL_CLOSE_CODE = 4000;

/**
 * The close code that follows an in-band `reauth_required` message once the
 * SEC-26 grace period expires without a fresh connection replacing this one.
 * Deliberately distinct from STALE_SIGNAL_CLOSE_CODE: this cause is
 * legitimately disclosed to the client it happens to
 * (websocket-connection-reauthorization design.md Decision D5, spec.md:107-121).
 */
export const REAUTH_GRACE_EXPIRED_CLOSE_CODE = 4001;
