# Implementation Security Review — actionitem-updated-live-broadcast

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** Shipped code for `PATCH /api/v1/action-items/:actionItemId/status`, the new `action_item.status_changed` audit event, and the `action_item_status_updated` WebSocket broadcast path. Reviewed against my design-stage findings F1-F5 (`design-review-security.md`) and design.md's Decisions D10-D14, which claim to close them.
**Verdict:** All five design-stage findings are genuinely closed in the shipped code, not just in design prose. I have one new, non-blocking observation on rollback test depth. No new vulnerabilities found.

---

## F1 — Facilitator authorization scope (narrow query, not `evaluateTeamAccess` reused)

**Closed, verified in code.** `packages/backend/src/routes/action-items.ts:150-173` runs its own inline query with `status = ANY($3::text[])` against `ACTIVELY_FACILITATING_STATUSES = ["lobby", "pre_session", "active", "wrap_up"]` (line 24). It does not call `evaluateTeamAccess` for this check. I compared this directly against `evaluateTeamAccess`'s Path 3 (`team-content-access-helper.ts:143-194`), which additionally grants on `draft` (24h grace) and `complete` (`facilitator_access_expires_at` grace) — exactly the two windows D10 excludes. The regression tests at `action-items.test.ts:262-309` (6.1a-i, 6.1a-ii) directly construct a facilitator whose only relationship is a draft-grace or complete-grace session and assert `403`. Both pass.

## F2 — 404-vs-403 enumeration oracle

**Closed, verified in code and tests.** The lookup-then-relationship-then-authorize ordering in `action-items.ts:72-173` matches D12 exactly:
- No row → `notFound(reply)` (line 79-82)
- Row found but zero relationship (not owner, no `evaluateTeamAccess` grant, never facilitated any session for the team) → the **same** `notFound(reply)` call (line 111-116), not a separate response path. Both branches produce byte-identical bodies apart from a fresh `correlationId`, and both go through `applyTimingFloor(startTime)` first (lines 80, 114).
- Some relationship but not owner/authorized-facilitator → `403` via `forbidden()` (line 166).

I confirmed the relationship check (`hasRelationship`, lines 98-110) is self-contained and does **not** reuse the narrow `ACTIVELY_FACILITATING_STATUSES` query as its facilitator signal — it uses a separate, broader `EXISTS` over `sessions WHERE facilitator_id = $1 AND team_id = $2` with no status filter at all, exactly the fix D12 records for Ingrid Sollenberger's task-review Finding 1. Reusing D10's narrow query here would have wrongly 404'd a draft/complete-grace facilitator who actually has disclosed standing via `evaluateTeamAccess`.

The timing-safety test (`action-items.test.ts:380-405`, 6.1b(d)) is a mock-based call-count assertion — it verifies `applyTimingFloor` is invoked on both the nonexistent-item and zero-relationship branches, not that wall-clock response times are indistinguishable. That's the right granularity for a route-level test given `TIMING_FLOOR_MS`'s actual constant-time behavior is already covered by `timing-oracle.test.ts` from the enforce-access-control-on-team-content change; re-proving the floor's timing properties here would be redundant. I don't consider this a gap.

## F3 — `audit_log` write, transactional

**Closed, verified in code and tests.** `action-items.ts:266-316` opens one client (`db.connect()`), and the `action_items.status` UPDATE, the `action_item_history` INSERT, and the `audit_log` INSERT all run on that same client between `BEGIN` and `COMMIT`, with a catch-block `ROLLBACK` and `client.release()` in `finally`. `audit-logger.ts:124-135` documents the new `action_item.status_changed` `AuditEventName` and the metadata shape matches D13 (`action_item_id`, `previous_status`, `new_status`, `authorization_path`, `session_id`) — no vote-value-style sensitive payload leakage, no `resolutionNote` in the metadata (correctly excluded, matching D13's literal field list).

Test coverage (`action-items.test.ts:489-556`, 6.2/6.2a) verifies via a mocked `pg` client that a failure at the history-insert step or the audit_log-insert step produces `ROLLBACK` and never `COMMIT`, and that no audit_log row and no broadcast occur when the transaction fails. This is a mock-based unit test, not a real-Postgres rollback proof. I checked whether a real-DB equivalent exists: `action-items-integration.test.ts` is real-Postgres but only exercises the resolutionNote read-through path (task 6.3's specific claim), not transactional rollback. **This is a minor, non-blocking observation** — it matches this codebase's established testing convention elsewhere (mocked-client rollback assertions are the norm; real-Postgres tests are reserved for specific read-path claims per `facilitator-error-states-integration.test.ts`'s precedent), so I'm not asking for a change, just noting the rollback guarantee rests on the try/catch/ROLLBACK code shape being correct rather than on an assertion against Postgres's own atomicity.

## F4 — Authorization-layer boundary vs. D7's broadcast-leniency boundary

**Closed, verified in code.** The `sessionId` validation block (lines 125-145) and the facilitator-authorization block (lines 150-173) both run, and can both fail (`422`/`403`), entirely before `db.connect()`/`BEGIN` at line 266. D7's "mutation success never coupled to broadcast success" is applied only after commit, at the publish call (lines 337-356), which is wrapped in its own try/catch that logs and swallows — never affecting the response already computed. I confirmed there is no code path where a missing/invalid `sessionId` or an unauthorized facilitator reaches the transaction; both are early returns. The boundary D11 describes in prose is the actual control flow in the file, not just an assertion about it.

## F5 — Delivery-time freshness re-check (not just a publish-time snapshot)

**Closed, verified in code and tests — this is the finding I'm most satisfied with.** `ws-event-dispatcher.ts:375-405`:
1. Fast bail-out on the envelope's `sessionStatus` (stamped at publish time by `action-items.ts`'s handler, line ~340, immediately after commit) — no DB query at all if the envelope already says not-`pre_session` (line 380).
2. When the envelope says `pre_session`, exactly **one** live `SELECT status FROM sessions WHERE id = $1` runs (line 385-388), once per dispatch, before any candidate iteration — not per-candidate.
3. If that fresh read is no longer `pre_session`, the function returns before touching `registry.candidates` iteration/authorization at all (line 390).
4. Per-candidate `evaluateSessionSubscriberAccess` still runs independently for every candidate that survives step 3 (lines 392-404), unchanged from every other event in this dispatcher.

The test at `ws-event-dispatcher.test.ts:484-505` directly constructs the race F5 named — envelope says `pre_session`, fresh read says `active` — and asserts zero delivery to *both* a participant-path and a facilitator-path candidate, with exactly one DB query total (proving the suppression happens before per-candidate authorization, not after). This is a genuine race-condition test, not a status-quo assertion.

---

## Independent assessment — anything new

- **SQL injection:** every query in `action-items.ts` and the new dispatcher branch is parameterized (`$1`, `$2`, `$3::text[]`). No string concatenation or template-literal SQL anywhere in the diff. `status = ANY($3::text[])` passes the status array as a bound parameter, not interpolated.
- **Input validation on the request body:** `status`, `resolutionNote`, `sessionId` are TypeScript-typed only (no Fastify JSON-schema validation on this route) — but I traced what happens with an out-of-enum `status`: it fails both `isSameStatusNoOp` and `VALID_TRANSITIONS[currentStatus].includes(...)` and is rejected `409` before any write. An arbitrary `sessionId` is validated against a real `sessions` row scoped to the item's `team_id` and rejected `422` otherwise. I don't see a path where an unvalidated body value reaches a write. `resolutionNote` length is checked (`> 500`) before any write, matching the DB CHECK constraint. No new validation gap.
- **Timing side-channels:** covered under F2 above; no new observation beyond what's already discussed there.
- **Audit log metadata leakage:** metadata is limited to IDs, statuses, and `authorization_path` — no resolution note text, no PII beyond `actor_user_id`/`actor_ip` (which every other audited mutation in this file already carries at the same sensitivity level). Consistent with SEC-16/22's existing "no sensitive payload content in audit metadata" convention.
- **Route registration / auth coverage:** `action-items.ts` is registered in `app.ts` after `authMiddleware(app)` is installed as a global `onRequest` hook, and `/api/v1/action-items` is not in `middleware.ts`'s `PUBLIC_ROUTES` allowlist — this endpoint is not reachable unauthenticated.
- **Wire payload minimality:** confirmed via `ws-event-dispatcher.test.ts:511-536` that the delivered client-facing payload carries exactly `sessionId/actionItemId/previousStatus/newStatus/updatedAt` — no `resolutionNote`, no `resolvedInSessionId`, no `sessionStatus` (the internal envelope field). Matches D4's payload-minimalism convention and confirms the envelope-vs-wire-payload split D14 describes is real, not aspirational.

## Test run confirmation

I ran the relevant suites directly rather than trusting the reported 730-count:
- `packages/backend/src/routes/__tests__/action-items.test.ts` — 25 passed
- `packages/backend/src/routes/__tests__/action-items-integration.test.ts` — 1 passed (real Postgres)
- `packages/backend/src/realtime/__tests__/ws-event-dispatcher.test.ts` — 31 passed
- `packages/shared/src/__tests__/websocket-spec-conformance.test.ts` — 4 passed

All green.

## Conclusion

F1-F5 are closed in the code, not only in design.md's decision record. The one thing I'll flag for the record rather than block on: F3's rollback guarantee is proven by a mocked-client test, not a real-Postgres transaction test — consistent with this codebase's existing convention, so not something I'm asking to change here, just noting for whoever owns test-strategy consistency going forward. No new findings from my independent pass (injection, input validation, timing, audit metadata, route auth coverage, wire-payload minimality). I have no blocking findings on this implementation.
