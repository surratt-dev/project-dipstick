// ---------------------------------------------------------------------------
// Generic client-facing staleness signal — backend mechanism
//
// websocket-delivery-time-authorization: tasks.md Group 9 (9.1-9.3),
// design.md's cause-of-revocation non-disclosure principle.
//
// STATUS: the mechanism below is implemented and unit-tested. Task 9.3
// (tasks.md) is a HARD GATE requiring Priya Nair's (Facilitator SME)
// sign-off on the actual client-visible signal — its wording, visual
// treatment, and confirmation that it reads identically for a rejected
// subscription and an ordinary network hiccup — before any real pilot
// team's first live session. That sign-off has NOT happened as part of this
// change (Priya Nair is not available for a live UX review in this
// implementation pass). This module implements the backend-side building
// block the signal depends on; it does not close the gate. Per Executive
// review (Rachel Okonkwo, recorded in design.md), this gate has the same
// teeth as Group 8's SEC-25/26 tracking gate — WebSocket delivery-time
// authorization MAY go live in a non-pilot environment before this gate is
// satisfied, but no real team runs a live session until it is.
//
// THE MECHANISM: every WebSocket close this application initiates for a
// reason it must not disclose (an unauthorized subscription attempt, or the
// scheduled 90-minute absolute-lifetime force-close) uses the SAME close
// code, STALE_SIGNAL_CLOSE_CODE. This is deliberate, not an oversight: if
// "rejected because your access was revoked" and "closed because your
// connection hit its absolute lifetime" used different close codes, a
// sufficiently curious client could infer *which* happened by inspecting
// the code — which is exactly the surveillance-adjacent disclosure
// design.md's non-goals rule out ("Disclosing the cause of revocation to
// the affected connection... telling a removed connection why its events
// stopped would itself be a surveillance-adjacent behavior"). A single,
// uninformative code, combined with the fact that ordinary network
// failures also surface to a WebSocket client as an unexpected close with
// no application-level reason, means a correctly-built client cannot
// distinguish "you were revoked," "your connection aged out," and "the
// network blipped" from the close event alone — which is precisely the
// "reads identically" property task 9.1's signal is required to have.
//
// What is explicitly NOT built here (out of scope for this change, and for
// this backend-only implementation pass in particular):
//   - The actual client-rendered banner/message text and visual treatment
//     — Priya Nair's Design-stage deliverable (task 9.1), not resolved by
//     this module.
//   - Any periodic liveness heartbeat — that is SEC-25's mechanism
//     (design.md Decision D8, tasks.md Group 8), a distinct, explicitly
//     out-of-scope concern from this staleness signal. This module closes
//     connections it is already closing anyway (rejection, force-expiry)
//     uniformly; it does not add any new closing behavior or polling.
// ---------------------------------------------------------------------------

/**
 * The single WebSocket close code used for every server-initiated close
 * whose cause must not be disclosed to the client: an unauthorized
 * subscription attempt (connection-time or subscription-time rejection)
 * and the scheduled absolute-lifetime force-close (design.md Decision D8).
 *
 * A well-behaved client treats this code — and, per task 9.1's requirement,
 * any other unexpected close or network failure — identically: a generic
 * "your view may be stale, refresh to continue" signal. It never attempts
 * to distinguish which case occurred, because the server does not tell it.
 */
export const STALE_SIGNAL_CLOSE_CODE = 4000;
