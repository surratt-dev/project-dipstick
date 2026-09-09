# Implementation Security Review: session-lifecycle-transitions

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** the actual committed working-tree implementation on `agent-team/session-lifecycle-transitions` (uncommitted changes against `main` at `b09881f`), cross-checked against `design.md` and my own design-stage review (`design-review-security.md`). I read the real handler code in `facilitator-sessions.ts` and `sessions.ts`, the diffs to `audit-logger.ts`, `ws-pubsub.ts`, `ws-event-dispatcher.ts`, the shared type diffs, and the tests that exercise the code paths in question — not just tasks.md's claims about them.
**Verdict:** No exploitable authorization bypass, no information disclosure, and no premature-publish defect found in the shipped code. One audit-logging completeness gap (structured-log operational path silently skipped for the two new SESSION-012 transitions) and one testing gap (design.md's explicitly-required concurrent-race integration test for Decision D5 does not exist — only a single-request simulation does) — both named below with the concrete evidence. Everything else I was asked to re-verify holds.

---

## 1. Authorization boundaries (SESSION-012, SESSION-004/005) — facilitator-id AND team-id, confirmed in the shipped code

**SESSION-012** (`POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance`, `facilitator-sessions.ts:1125-1196`) performs both checks as two explicit, sequential `if` blocks before anything else runs:

```ts
// facilitator-sessions.ts:1165-1183
if (sr.team_id !== teamId) {
  return reply.code(403).send({
    error: { category: "forbidden" as const, message: "Session does not belong to this team.", ... },
  });
}

if (sr.facilitator_id !== userSession.userId) {
  return reply.code(403).send({
    error: { category: "forbidden" as const, message: "Only the facilitator can advance the session's topic.", ... },
  });
}
```

This matches the existing `advance`/`complete` handlers' two-check pattern exactly, closing the spec gap I flagged in design review (design-review-security.md §5). Confirmed by test `4.12: a facilitator of a different session's team is rejected with 403 (team-id cross-check)` (`facilitator-sessions.test.ts:945-961`), which asserts `mockDbConnect` was never called — the team-mismatch short-circuits before any transaction is opened, not just before a specific query.

**Reveal** (`POST /api/v1/teams/:teamId/sessions/:sessionId/reveal`) uses a different but equally sound mechanism: it folds the team-id check into the initial `SELECT` itself —

```ts
// facilitator-sessions.ts:918-921
`SELECT id, team_id, facilitator_id, status, current_topic_id
 FROM sessions
 WHERE id = $1 AND team_id = $2`,
[sessionId, teamId],
```

— so a session that exists but belongs to a different team returns zero rows and falls into the existing "session not found for this team" non-recoverable path (`facilitator-sessions.ts:927-937`), identical in shape to a genuinely-missing session. This is a query-filter cross-check rather than an explicit `if`, but it is a real team-id check, it runs before the facilitator check (line 962), and it does not distinguish "wrong team" from "no such session" in its response — no enumeration leak. Facilitator-id check follows at line 962, before either new precondition path can be reached.

**SESSION-004/005** (`start`, `begin-voting`) take only `:sessionId`, not `:teamId`, in their URLs — there is no second identifier to cross-check against, so the single `sessionRow.facilitator_id !== session.userId` check (lines 440, 582) is the complete authorization boundary for these two, matching design.md's D1 and my design-stage finding that there was nothing further to require here.

## 2. Auth-before-precondition ordering — verified against the real handler, not a mock that assumes it

I confirmed the two required tests exist and, more importantly, that they exercise the actual route handler through `app.inject()` against the real Fastify app, with only the database layer mocked (this file's own established convention, used identically by every other test in this suite) — not a re-implementation of the ordering logic in test code.

- `3.13: a non-facilitator's reveal against an already-revealed topic returns the generic 403, never already_revealed` (`facilitator-sessions.test.ts:845-867`): mocks the session row to return `facilitator_id: "other-facilitator"` while the requester is `"facilitator-1"`. Asserts `res.statusCode === 503` (the existing recoverable `reveal_failure` shape, not `already_revealed`) and, critically, `expect(mockDbConnect).not.toHaveBeenCalled()` — proving the transaction that contains the `already_revealed` precondition check is never entered when authorization fails. This is not a semantic assertion about the response body alone; it's a control-flow assertion that the precondition code path was structurally unreachable.
- `4.12(2): a non-facilitator's advance against a not-yet-revealed topic returns the generic 403, never advance_blocked` (`facilitator-sessions.test.ts:964-981`): same pattern for SESSION-012 — asserts `403` and `errorState !== "advance_blocked"`.

I also read the handler code directly to confirm the ordering these tests are asserting is real, not incidental to the mock setup: in both handlers, the facilitator-id `if` block (`facilitator-sessions.ts:964`, `:1175`) appears lexically and executes before the `topicId`/transaction code that can produce the `already_revealed`/`advance_blocked` body (`:1049`, `:1220`). There is no code path that reaches the conditional-`UPDATE` precondition check before the facilitator check has already passed. This closes the exact ordering hazard Decision D3 named.

## 3. Audit logging — DB row correct and complete; structured-log (operational alert) path has a gap for SESSION-012

**DB row (`audit_log` table, the authoritative record per this file's own convention):** I checked every new/modified transition and confirm the audit `INSERT` sits inside the same `BEGIN`/`COMMIT` block as the state-transition write in all five cases (`start`, `begin-voting`, reveal, SESSION-012 topic-to-topic, SESSION-012 wrap-up-entry). Fields match the `audit_log` schema in every case I checked: `actor_user_id`, `actor_global_role`, `actor_ip`, `operation`, `team_id`, `metadata` are all populated; `recordRevealTriggeredAudit` (lines 32-64) additionally matches the exact shape my design review verified against `8_audit_log.sql`.

**Wrap-up-entry metadata gap, closed:** the wrap-up branch's `session.state_changed` `INSERT` (`facilitator-sessions.ts:1351-1368`) now includes `completed_session_topic_id` alongside `prior_status`/`new_status`, exactly the fix I required in design review (design-review-security.md §3). Confirmed both in the code and in test assertion `facilitator-sessions.test.ts:1030`:
```ts
expect.arrayContaining([expect.stringContaining("completed_session_topic_id")]),
```

**Stale comment, corrected:** `audit-logger.ts`'s `AuditEventName` block no longer says `session.reveal_triggered` is "BLOCKED on GitHub issue #26" — it now reads "wired to a real state-transition commit by session-lifecycle-transitions (GitHub issue #26 resolved)" (lines 55-58), and `session.topic_advanced` is documented with its actual metadata shape (lines 70-76).

**Gap I found, not previously flagged:** every other state-transition endpoint in this file calls `emitAuditEvent()` (the structured-log operational-alert path, distinct from the `audit_log` DB row) immediately after its transaction commits — `draft→lobby` (line 372), `start` (line 500), `begin-voting` (line 693), `complete` (line 837), and the reveal handler internally via `recordRevealTriggeredAudit` (line 57). **SESSION-012's two branches do not.** I grepped every `emitAuditEvent` call site in the file:

```
5:import { emitAuditEvent } from "../auth/audit-logger.js";
57:  emitAuditEvent(logger, "session.reveal_triggered", {
372:    emitAuditEvent(request.log, "session.state_changed", {
500:    emitAuditEvent(request.log, "session.state_changed", {
693:    emitAuditEvent(request.log, "session.state_changed", {
837:    emitAuditEvent(request.log, "session.state_changed", {
```

Neither the topic-to-topic branch (which writes `session.topic_advanced` to `audit_log` at lines 1300-1316) nor the wrap-up-entry branch (which writes `session.state_changed` at lines 1351-1368) is followed by a corresponding `emitAuditEvent` call. The DB row still commits — this is not a lost audit record, and it is not an authorization or disclosure defect — but per this file's own stated convention ("the DB row is the authoritative record; these are the operational alert path"), `session.topic_advanced` events and topic-advance-triggered `session.state_changed` events will not appear in the structured log stream that an operator's alerting/SIEM pipeline would be watching, only in the database. Given how central "auditability as a security control" is to how these events get *noticed* in an incident, not just reconstructed after the fact, I'd ask that this be closed before this ships: add `emitAuditEvent(request.log, "session.topic_advanced", {...})` and `emitAuditEvent(request.log, "session.state_changed", {...})` calls mirroring the existing four, after each branch's `COMMIT`.

## 4. Publish-after-commit ordering — re-verified against the actual code, not just the architect review

I did not take the architect review's word for this; I checked the control flow directly. In all four new/modified call sites in `facilitator-sessions.ts` (reveal → `publishVoteRevealed`, SESSION-012 topic-to-topic → `publishTopicHistoryUpdate`, SESSION-012 wrap-up-entry → `publishSessionStateChange` + `publishTopicHistoryUpdate`), the `publish*` call is placed **lexically after** the closing brace of the `try { ... } catch { ROLLBACK; throw; } finally { client.release(); }` block that owns the transaction — not merely after the `COMMIT` statement inside the `try`. This matters: it means any exception thrown at any point inside the transaction, including a failure of `COMMIT` itself, takes the `catch` branch, rolls back, and rethrows — which propagates past the publish call entirely (Fastify's handler function never reaches that line). There is no code path in this file where a rollback is followed by a publish call. I confirmed this by reading the reveal handler (lines 1040-1115) and both branches of SESSION-012 (lines 1210-1421) directly, not by re-reading the architect's summary of them.

`ws-pubsub.ts` and `ws-event-dispatcher.ts` were also modified in this change — I diffed them against `main` and found the changes are **comment-only** (updating stale "TODO(#26)" / "BLOCKED" language to describe the now-real call sites). No logic in `publishVoteRevealed`, `publishTopicHistoryUpdate`, `dispatchVoteRevealed`, or `dispatchTopicHistoryUpdate` changed. This confirms the publish/dispatch/authorization layer this change was scoped not to touch (design.md's Non-Goals) was in fact not touched.

## 5. Implementation-time deviations — the `BeginVotingResponse` topics join is a genuinely separate, harmless field

I checked this specifically because a join that widens what an endpoint returns is exactly the kind of change that can quietly cross a data-classification boundary.

`SESSION-005`'s first-topic query (`facilitator-sessions.ts:623-627`) joins `session_topics` to `topics` for exactly one column, `topics.first_session_description` — a static, team-catalog description of a topic shown to participants encountering it for the first time. I grepped every reference to `first_session_description`/`firstSessionDescription` across `packages/backend/src` and `packages/shared/src`: it appears only in this one query, the shared type declarations (`packages/shared/src/types/topic.ts`, `session.ts`), and the migration/seed SQL. It is never read by `vote-revealed-payload.ts`, `content.ts`, or any code path that calls `serializeForFacilitator`/`serializeForMemberParticipant` — those two functions exist specifically to enforce the pre-reveal/post-reveal vote-value visibility boundary, and this field carries no vote data and no participant-identifying data. `BeginVotingResponse` itself is returned only from the facilitator-only `/begin-voting` endpoint, gated by the `facilitator_id !== session.userId` check at line 582, before this query even runs. This is not a boundary crossing — it's an unrelated, low-sensitivity catalog field added to a response that was already facilitator-only and already outside the serializer boundary's scope (that boundary governs vote-value data, not session-phase metadata).

The other three implementation-time additions I checked are all additive `RETURNING`/follow-up reads that don't change a `WHERE` clause, a lock, or who can reach them — consistent with what design.md described as safe:
- `StartSessionResponse`'s `updatedAt`/`hasOpenItems` fields are populated from data already being fetched (`facilitator-sessions.ts:134-145`), not a new query.
- SESSION-012's extended `RETURNING id, topic_name, completed_at` (line 1228) and `RETURNING wrap_up_started_at` (line 1346) are additive columns off the same already-locked row from the same already-authorized precondition `UPDATE`.
- `TopicAdvanceBlockedResponse`'s follow-up `SELECT id FROM session_topics ...` (lines 1240-1244) runs only after both the team-id and facilitator-id checks have already passed (§2 above) and only after the precondition `UPDATE` has already rolled back — same non-locking, response-content-only pattern as the reveal endpoint's `already_revealed` follow-up read, and subject to the same ordering guarantee.

## 6. GitHub issue #27 (SEC-25/SEC-26) — the flag stands, with concrete evidence from the shipped code

I re-read issue #27 directly (still `OPEN`, still targeted at the Q4 2026 placeholder, no labels or reprioritization applied) and re-checked the two functions whose behavior this flag depends on. `evaluateSessionSubscriberAccess` and `evaluateTeamAccess` (in `ws-event-dispatcher.ts`) are unchanged by this diff — confirmed above (§4) that the only edits to that file are comments. Nothing in this change introduces a new long-lived unauthenticated or under-authenticated state: no new WebSocket message type, no new connection-lifetime exemption, no new caching of an authorization decision across messages.

What has concretely changed, now that I can point at shipped code instead of a design intent: `publishVoteRevealed` is called from a real, committed, precondition-guarded write (`facilitator-sessions.ts:1104-1107`, reached only after a real `session_topics` row transitions `voting → revealed`), and `publishTopicHistoryUpdate` is called from a real, committed write in both SESSION-012 branches (`:1394-1400`, `:1412-1418`). Before this change these two `publish*` functions were called only from unit tests against stubs (`ws-pubsub.test.ts`) — there was no production code path that invoked them. That is the change in kind I flagged at design time: **an idle WebSocket connection sitting inside the 90-minute absolute-lifetime bound, held by a user whose delegated authorization should have been re-challenged sooner than that bound, will now actually receive real vote values or real topic-advance content the first time a reveal or advance fires** — where previously there was no live trigger path in production for it to receive anything through. The per-message check (`evaluateSessionSubscriberAccess`/`evaluateTeamAccess`) still correctly blocks a connection whose team membership was *revoked*, since that check re-reads live DB state on every dispatch; the residual exposure issue #27 tracks — a connection whose grant still evaluates true but whose *token* may be stale (SEC-26) or which has gone unchallenged for a shorter interval than the 90-minute absolute bound would ideally allow (SEC-25) — is unchanged in kind but, as of this change shipping, no longer theoretical. I'm restating my design-review recommendation: reprioritize issue #27 alongside this change's rollout rather than leaving it at Q4 2026, since the gap it tracks now has a real, exercised trigger path behind it.

## 7. Testing gap: Decision D5's required concurrent-race integration test does not exist

Not one of the six things I was asked to re-verify, but I checked the vote lock-in/reveal race fix's test coverage while I was in that code, since design.md was explicit that it needed its own test ("a reveal request and a lock-in request for the same session_topic_id, issued concurrently... needs its own integration test, not a re-run of Decision D2's test with different table names").

The only test covering this (`sessions.test.ts:360-396`, `2.3: rejects lock-in with 422 when session_topics.status is 'revealed' at the in-transaction row lock`) is a single-request unit test against a mocked `pg` client — it asserts that *if* the row-lock `SELECT` returns `status: 'revealed'`, the handler correctly rejects with `422` and rolls back. It does not, and structurally cannot, exercise two actual concurrent transactions racing for the same row lock, because this test suite has no real Postgres instance (stated explicitly in `session-lifecycle-e2e.test.ts`'s header comment — this is a codebase-wide testing-infrastructure constraint, not something unique to this change). The code fix itself is correct — I re-verified the `SELECT ... FOR UPDATE` / conditional-`UPDATE` interaction against Postgres's actual locking semantics at design time and nothing in the shipped code changes that mechanism — but the specific test design.md required as a named acceptance condition for this decision is not present. I'd recommend a real-Postgres integration test (even a narrowly-scoped one, run outside this suite's mocked convention) before production rollout, given this is the fix for an FR-4.7 violation (a vote admitted into an already-revealed topic's result set).

---

## Summary

| # | Finding | Severity | Action needed |
|---|---|---|---|
| 1 | Authorization boundaries (SESSION-012, reveal) | — | Confirmed correct. SESSION-012 uses two explicit checks; reveal folds team-id into its initial SELECT. Both verified against actual code and tests. |
| 2 | Auth-before-precondition ordering | — | Confirmed correct against the real handler (not a mock assuming it). `mockDbConnect` assertions prove the precondition transaction is structurally unreachable pre-auth. |
| 3 | Audit logging | **Gap** | DB `audit_log` rows (authoritative) are correct and complete, including the wrap-up `completed_session_topic_id` fix. **`emitAuditEvent` (structured-log/operational-alert path) is never called for either SESSION-012 branch**, unlike every other transition in this file. Recommend adding it before ship. |
| 4 | Publish-after-commit ordering | — | Re-verified directly against code, not the architect review. All four new call sites sit outside the transaction's try/catch/finally; no rollback-then-publish path exists. `ws-pubsub.ts`/`ws-event-dispatcher.ts` changes are comment-only. |
| 5 | Implementation-time deviations | — | `BeginVotingResponse`'s `topics` join is a low-sensitivity catalog field, confined to a facilitator-only endpoint, outside the serializer boundary's scope (which governs vote-value data). No boundary crossing. Other three deviations are additive reads with no authorization or locking change. |
| 6 | Issue #27 (SEC-25/SEC-26) | Contextual, not a new gap | Confirmed `evaluateSessionSubscriberAccess`/`evaluateTeamAccess` unchanged (comment-only diffs). This change gives issue #27's gap its first real production trigger path — `publishVoteRevealed`/`publishTopicHistoryUpdate` are now called from committed writes, not just tests. Restating recommendation to reprioritize #27 (still open, still Q4 2026 placeholder) alongside this change's rollout. |
| 7 | Decision D5's required concurrent-race test | **Gap** | Only a single-request row-lock simulation exists (`sessions.test.ts:360`), not the true concurrent integration test design.md named as a required acceptance condition. Recommend a real-Postgres test before production rollout, given this closes an FR-4.7 violation. |
