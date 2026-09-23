# Security Implementation Review: Create Session for an Existing Team

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-09-23
**Documents reviewed:** `packages/backend/src/routes/facilitator-sessions.ts`, `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts`, `packages/backend/migrations/10_sessions_team_active_unique.sql`, `packages/shared/src/types/auth.ts`, `packages/shared/src/types/session-creation.ts`, `packages/backend/src/routes/auth.ts`, `packages/backend/src/auth/audit-logger.ts`, `packages/frontend/src/App.tsx`, `packages/frontend/src/pages/SessionCreationPage.tsx`
**Status:** SIGN-OFF — R1, R2, R3 (all REQUIRED items from the design review) are satisfied in code as implemented.

---

## Summary

My design review (`design-review-security.md`) conditioned sign-off on three items: R1 (audit the membership-conflict denial), R2 (audit the cross-team draft-session grant, same transaction as the insert), and R3 (the new endpoint's own authorization gate must be a live DB read, not derived from cached session/token state). I checked each against the actual code, not the design document's description of it. All three are implemented as specified, and the implementation goes further than the minimum I asked for in one place worth noting (test coverage of the concurrency-race resolution). No new findings beyond what was already flagged as RECOMMENDED in the design review.

---

## R1: Membership-violation rejection writes an audit record — SATISFIED

`POST /api/v1/teams/:teamId/sessions/draft`, `facilitator-sessions.ts:261-289`. When `is_member` is true, the handler writes a synchronous `INSERT INTO audit_log` (`actor_user_id`, `actor_global_role`, `actor_ip`, `operation`, `team_id`) with `operation = 'session.draft_denied_membership_conflict'`, `await`ed before the 403 response is sent, plus a matching `emitAuditEvent` structured-log call. This is not best-effort or fire-and-forget — the response cannot be sent until the write resolves (and its failure would throw and 500 the request rather than silently produce a 403 with no record, which is the correct failure mode for a security-relevant denial).

Payload check: only `actor_user_id`, `actor_global_role`, `actor_ip`, `operation`, `team_id` are written — no `metadata` column value on this row, so no risk of it accidentally carrying anything beyond the four fields I specified as the minimum. Nothing session- or vote-content-related is anywhere near this code path. No over-disclosure.

Test coverage: `facilitator-sessions.test.ts:208-244` (test 2.3/2.6/2.7) asserts the audit row is written with the correct operation string, and test 2.5 (`facilitator-sessions.test.ts:159-172`) affirmatively checks that the *other* denial branch (`global_role !== 'facilitator'`) writes no audit row — which is correct per the design (R4 was RECOMMENDED, not REQUIRED, and was knowingly left out of this branch).

## R2: Successful cross-team draft creation writes an audit record, same transaction as the insert — SATISFIED

`facilitator-sessions.ts:301-364`. The `INSERT INTO sessions` and the `session.draft_created` `INSERT INTO audit_log` both run on the same `client` (a checked-out `PoolClient`), between the same `BEGIN`/`COMMIT`. If the audit insert throws, the whole block rolls back and the session row it would otherwise have described never exists — there is no path to a committed session with a missing audit record short of a partial-commit bug in Postgres itself. The audit row carries `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`, and `metadata: { session_id }` — exactly the fields I asked for, sufficient to answer "which teams' historical data has this facilitator account accessed."

One implementation detail worth naming explicitly because it's easy to miss on a skim: `emitAuditEvent` (the structured-log counterpart) is called a second time, *after* `client.release()`, at `facilitator-sessions.ts:366-372`, using the same values captured before the transaction closed. This is consistent with this codebase's established pattern elsewhere in the same file (`team.manager_established`-style split between the durable DB row written in-transaction and the operational structured-log event written after commit) — it is not a second audit write, it is the log-side echo of the one that already committed. No concern.

Test coverage: `facilitator-sessions.test.ts:265-305` confirms the audit insert happens on the same mocked client, between the same `BEGIN`/`COMMIT` calls as the session insert (`calls[2]` in the ordered call sequence), and asserts the operation string. Tests 2.14/2.17/2.18/2.19 (`facilitator-sessions.test.ts:306-` through 462+) additionally verify the 409 rollback path — a `sessions_team_active_unique` violation rolls back cleanly and writes no phantom audit row for a session that was never actually created — and that an *unrelated* `23505` or non-`DatabaseError` failure is not misattributed to the concurrency guard. That's beyond what R1/R2 strictly required, but it's exactly the kind of "don't let the constraint-name match become a silent swallow-all" discipline I'd have flagged if it were missing, so I'm noting it as a positive rather than skipping past it.

## R3: `GET /eligible-for-session`'s 403/200 gate is a live DB read, not derived from cached session/token state — SATISFIED

`facilitator-sessions.ts:1785-1813`. The handler's first action is `SELECT global_role FROM users WHERE id = $1`, executed fresh on every request via `db.query` — not `request.session.canFacilitateSessions`, not any other value carried on the session object, not a value cached in Redis. This is the same shape as `POST /draft`'s own `global_role` check in the same file, as I asked for. I traced `request.session` (`SessionData`, `../auth/session-store.js`) usage throughout this handler and the only field read off it is `session.userId`, used solely as the query parameter — the session object is never consulted for the authorization decision itself.

I also checked the adjacent question this finding implies: does `canFacilitateSessions` itself (surfaced to the frontend) leak the raw role, or get derived from something stale? `auth.ts:619` computes it as `user.global_role === "facilitator"` inline in the `/auth/session` handler, from the same live `SELECT ... FROM users` a few lines above (`auth.ts:561`) — evaluated fresh on every call, never persisted into the Redis session blob, matching D4's commitment and my design-review acceptance of it.

Test 3.5 (`facilitator-sessions.test.ts:1823-1831`) confirms the 403 path is driven by the mocked `global_role` query result, not by session state — there is no session-shaped mock input to this test at all, only a DB row.

## AuthSession / `canFacilitateSessions` — no raw `global_role` exposure confirmed

`packages/shared/src/types/auth.ts:3-29`: `AuthSession` carries `canFacilitateSessions: boolean` as a top-level field, additive to the interface, not nested under `user`. There is no `globalRole` field anywhere on the type, and I grepped the full diff surface (`packages/frontend/src`) for any reference to `globalRole`/`global_role` — the only matches are code comments and identically-named boolean-flag usage (`canFacilitateSessions`) in `App.tsx` and `SessionCreationPage.tsx`, both of which branch on the boolean, never on a role string. `App.tsx:38` and `SessionCreationPage.tsx:77` are pure boolean checks. This is the same shape as the existing `canAssignRoles` precedent, applied consistently.

## Migration (`10_sessions_team_active_unique.sql`) — concurrency guard confirmed

The partial unique index (`draft`, `lobby`, `pre_session`, `active`, `wrap_up`) plus the `DO $$ ... RAISE EXCEPTION` pre-check inside the same implicit migration transaction is implemented exactly as the design specified, and resolves R7 from my design review (the pre-check is now a self-enforcing migration-time assertion, not a documented manual runbook step) — that was RECOMMENDED, not required for this sign-off, but it's done, so I'm noting it rather than leaving it open. The application-level handling of the resulting `23505` (`err.code === "23505" && err.constraint === "sessions_team_active_unique"`, matched on the concrete field rather than a message substring) is the correct way to consume this guard from `POST /draft`.

---

## Outstanding (non-blocking, carried from the design review)

Nothing here is new. For completeness, restating where the design review's RECOMMENDED (non-blocking) items stand post-implementation, since a couple were addressed as a side effect of the REQUIRED work:

- **R4** (distinct audit event for the `global_role !== 'facilitator'` denial) — not implemented, and I confirmed by test (2.5) that this is deliberate, not an oversight. Still just a RECOMMENDED inconsistency-cleanup item, not a blocker.
- **R5** (design states the org-wide enumeration is an intentional disclosure scope) — documentation item, out of scope for this code review.
- **R6** (design states which `session_status` values are terminal and why) — done; the migration file itself now carries this reasoning (`10_sessions_team_active_unique.sql:9-14`).
- **R7** (automated migration pre-check, not a manual runbook step) — done, see above.
- **R8** (rate limiting on `POST /draft` / `GET /eligible-for-session`) — not implemented in this diff. Still non-blocking per my original reasoning (small expected population, internal threat model), but I'd want it on record that it remains open if this endpoint's usage pattern changes materially (e.g., if the facilitator population grows or the app becomes reachable by a broader credential set).

## Sign-Off Position

R1, R2, and R3 — the three REQUIRED items from my design review — are implemented in code exactly as specified, transactionally correct, and covered by tests that would catch a regression in any of them (audit row missing, audit row outside the transaction, or the authorization gate silently switching to a cached value). I have no further blocking findings on this change. The audit-logging gap I was unwilling to sign off on at design time is closed.
