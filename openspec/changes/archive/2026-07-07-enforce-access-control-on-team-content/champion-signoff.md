# Champion Sign-off — enforce-access-control-on-team-content

**Reviewer:** Devon Calloway, Internal Champion  
**Date:** 2026-07-07  
**Status:** Conditional sign-off — implementation is sound; open items are correctly gated, not quietly dropped

---

## Summary

I reviewed the final artifacts for this change: proposal, design, tasks, implementation reviews from Ingrid (architect) and Tomás (security), and the implementation code in `content.ts`, `em-views.ts`, and `timing-oracle.ts`. The ritual's load-bearing constraints are structurally honored. The deferred items are explicitly blocked with documented gates, not left as silent gaps.

This is the floor the rest of the application stands on. It was built correctly.

---

## Core Constraints — Status

### No-surveillance guarantee

**Honored.** The Engineering Manager access path never places `voter_id` in application memory. The EM SQL query forces `NULL::uuid AS voter_id` at the query layer, the `EMQueryResult` type structurally excludes it, and the `serializeForMemberEM` function has no code path that could expose voter identity. The attribution boundary is enforced at three independent points: the SQL query, the TypeScript type system, and the serializer. Removing any one layer still leaves two in place.

The dual-check requirement — `users.global_role` AND `team_memberships.role` — is enforced on every content request through the shared `evaluateTeamAccess` helper. A user whose global role and membership role have diverged is served the content shape appropriate to their membership role, not their global role. The E2E test at Task 11.7 verifies this explicitly.

### Simultaneous reveal — two-layer enforcement

**Honored.** Decision 9 required enforcement at two independent layers: the authorization layer (grant resolution) and the serializer layer (reveal-status check). Both are in place. The serializer's check at `row.revealStatus === 'revealed'` runs without reference to the grant object — a facilitator who is correctly authorized still receives an empty `votes` array for any topic that has not been revealed.

What I was most concerned about was whether "independent" was actually implemented or just claimed. It was actually implemented. The `layer-removal-serializer-check` and `layer-removal-auth-check` integration tests verify that removing either layer independently causes a test failure. The simultaneous reveal mechanic cannot be bypassed by manipulating only one layer. That is what the design required.

### Facilitator-from-another-team — cross-team scoping

**Honored.** A facilitator in Team B's session who requests Team A's historical data receives the exact specified message: "This data is not available in your current session." The response body contains no team ID, team name, UUID, or any identifier that confirms Team A exists. The implementation correctly detects the cross-team case (a live session for a different team) and routes to the session-context message rather than the generic forbidden message. Task 11.4 verifies that a Team B facilitator cannot reach Team A's history through the facilitator path.

### Psychological safety — denial without leaking existence

**Honored.** The authorization-before-lookup pattern is in place across all content endpoints. An unauthorized caller receives 403 before any resource query executes. The 403 response body is identical whether the team exists or not — no team ID, session ID, or existence-confirming content. Task 11.2 verifies the identical response for an unauthorized caller against an existing team and a nonexistent team.

---

## Application Admin Boundary — Option B

**Correctly implemented.** Application Admins receive 403 on all session content endpoints, unconditionally. The grant type returns `{ path: 'admin' }` for every admin caller, and the content endpoint handlers treat that grant as a denial. Every denied attempt is logged in `audit_log` with HTTP status 403 before the response is sent — including denied attempts. An admin who systematically probes session content endpoints is detectable from the audit trail before any data is served.

Admin access to administrative data (membership lists, role assignments, EM associations, topic configuration) proceeds normally with audit logging. The scope restriction is enforced at the handler level, not inside the authorization helper, which keeps the helper's contract clean.

---

## Cross-Team Denial Error Message

**Correct.** The exact text "This data is not available in your current session" is what ships. Not "You do not have access to Team A's data." The response body is reviewed: it contains a category field, the message, and a correlation ID. No team identifiers. No existence confirmation. This is the right message for the right reason — it communicates a session-scope constraint without saying anything about what was requested or whether it exists.

---

## Deferred Items — Handled with Appropriate Gates

### WebSocket delivery-time authorization (Group 9)

Group 9 is gate-blocked. No WebSocket infrastructure exists in this codebase, and the engineering lead has not yet confirmed the latency bound required before implementation begins. Tasks 9.1–9.10 are correctly left unchecked, and Tasks 11.3 and 11.10 are marked BLOCKED with explicit reasons.

This is the right disposition. My concern is what happens when the real-time layer is eventually built. Decision 5's requirements must be honored in full at that time: delivery-time checks at the moment of per-connection wire-level push, not at queue-dequeue time; revocation within the stated bound when `team_memberships.removed_at` is committed; the timer-based fallback is only acceptable with a specific named latency number, not an approximation. The person who builds the WebSocket layer must read Decision 5 before writing a line of code.

### Timing floor measurement (Tasks 6.1 and 6.3)

The production floor value (150ms) is explicitly a development placeholder. The code takes a strong position on this: a startup guard in `timing-oracle.ts` throws at application startup if `NODE_ENV === 'production'` and the placeholder value is still in place. The measurement cannot be quietly skipped. I find this acceptable — it is harder to accidentally deploy than a comment in a ticket.

### Facilitator error state UX — Priya Nair sign-off

Task 11.10 is blocked pending Priya's review of the four facilitator error state messages and recovery paths. The implementation of Error States 1–4 is done. The E2E test coverage is blocked on Priya's approval. This is the correct sequence: Priya approves the UX before tests are written against it.

### Live DB migration (Task 1.5)

Local migration verification (Task 1.5) was not marked complete. This is minor — the schema migration changes are documented and the SQL is present — but it should be verified in the target environment before production deployment.

---

## Concerns

**One concern, not a blocker for this change:** The `em-views.ts` routes were brought into conformance (using the shared `evaluateTeamAccess` helper, applying `Cache-Control: no-store` via an `onSend` hook, applying the timing floor) as part of this change. Those advisory findings from Ingrid and Tomás were resolved. What I want flagged in the record is that this pattern — a prior-change route that wasn't using the shared authorization contract — is exactly the kind of drift I warned about when I made the case for this application. The shared authorization helper exists precisely so future content endpoints don't need their own authorization logic. Anyone adding a new content endpoint must call `evaluateTeamAccess` and must not build a parallel authorization function, regardless of how narrow the case seems.

**Second concern, for the record:** The 30-minute post-session grace window was debated. I supported it because the workflow need is real — a facilitator who closes the session and immediately loses context is penalized for completing correctly. But the design correctly documents that the window cannot be shortened from within the application without a direct database write. If a facilitator account is compromised post-session, there is a 30-minute exposure window that requires a support engineer with database access to close. That is a stated design acceptance, not an oversight. The operational runbook must document the escalation path. When the timing floor measurement is completed and documented, this runbook entry should be written at the same time.

---

## Verdict

The ritual's structural constraints are preserved. The no-surveillance guarantee is enforced at multiple independent layers. The simultaneous reveal is enforced at two independent layers with tests that verify each layer is independently necessary. The facilitator cross-team boundary is correctly implemented with a message that leaks nothing. The Application Admin boundary is correctly Option B, with audit logging of every denied attempt.

The deferred items are correctly gated, not abandoned. The timing oracle production guard prevents accidental deployment of the placeholder floor value. When the WebSocket layer is eventually built, Decision 5's requirements apply in full.

I sign off on the intent being honored. Production readiness depends on the timing floor measurement being completed and documented, and on the WebSocket authorization being built to the full specification when the real-time layer exists.

— Devon Calloway
