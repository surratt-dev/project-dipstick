# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** vote-compose-recovery (GitHub issue #31)
**Branch:** agent-team/vote-compose-recovery
**Scope of review:** Tasks 1–7 (Group 8 intentionally deferred per design.md D7/tasks.md)

---

## Summary

This is a well-executed, narrowly-scoped change that does what its design says it does, and no more. I reviewed it against design.md's Decisions D1–D7 (with D3a–e) and tasks.md, read every file changed, and ran the actual test suites (not just the tests as written — I executed them). Findings below are organized by the properties I care about: boundaries, ordering/failure containment, data classification, and consistency with existing patterns. I have no blocking findings.

## What I verified, and how

- Read `design.md` and `tasks.md` in full.
- Read all five implementation files in full: `packages/shared/src/types/realtime.ts` (diff), `packages/shared/src/index.ts` (diff), `packages/backend/src/realtime/session-registration-snapshot.ts`, `packages/backend/src/realtime/websocket-routes.ts` (diff), `packages/frontend/src/realtime/voteDraft.ts`.
- Read all three new test files.
- Ran the frontend unit tests with the package's actual vitest/jsdom config (`packages/frontend`): 13/13 pass.
- Ran the full backend `realtime/` test suite (13 files, 100 tests): all pass, including the two new files (11 tests).
- Grepped for `sessionStorage`/`localStorage` usage across `packages/frontend/src` to confirm `voteDraft.ts` is the sole owner of its storage key.
- Grepped for `audit_log` writes across `packages/backend/src/realtime/` to confirm none was added for this message type.
- Diffed against `main` to confirm the change's footprint matches the Migration Plan's claimed additive-only surface.

## Ordering and failure containment (D3c) — implemented correctly

This was my primary concern going in, since design.md is explicit that this is a security-relevant ordering decision, not a style choice. `websocket-routes.ts` calls `sendSessionRegistrationSnapshot` (which wraps `buildSessionRegistrationSnapshot`) at line 116, strictly after `scheduleReauthorizationSweep` (104), `scheduleTokenRefreshMonitor` (105), and `checkAndRecordGraceRecovery` (106) — in that order, with no interleaving. The comment block directly above the call cites the design rationale rather than asserting it.

The failure containment is real, not asserted: `sendSessionRegistrationSnapshot` wraps the build call in `try/catch`, treats a `null` return (zero-row race) identically to a thrown error, logs at `warn` in both cases, and never rethrows. I verified this isn't just documentation — `websocket-routes-registration-snapshot.test.ts` has a dedicated test that forces `buildSessionRegistrationSnapshot` to throw and asserts: the sweep/refresh monitors still ran, no snapshot was sent, the socket stayed `OPEN`, and nothing appeared on a live `process.on("unhandledRejection")` listener. A second test does the same for the `null`-return case. Both pass. This is the strongest part of the implementation — the design's ordering constraint is enforced by actual code placement and tested by forcing the failure mode, not inferred from the test passing under normal conditions.

## Boundaries

- **D3d (composition with `evaluateSessionSubscriberAccess`, no new access decision):** `buildSessionRegistrationSnapshot` performs no authorization check of its own — it's a bare parameterized query. The call site in `websocket-routes.ts` only reaches it after `evaluateSessionSubscriberAccess` has already granted access and the connection is registered. A rejected connection never calls it, confirmed by the wiring test's negative case (`mockBuildSessionRegistrationSnapshot` asserted `not.toHaveBeenCalled()` when the grant is `null`).
- **Call-site discipline on `userId`:** The function trusts its caller, as designed — it does not re-derive or validate `userId`. The one call site passes `session.userId`, which is `request.session` as narrowed to `SessionData`, i.e., server-derived. The required doc comment warning a future second call site is present directly on the function declaration, as design.md mandates.
- **Self-disclosure only (D3d):** The query scopes `has_locked_in` via `v.voter_id = $2` bound to the requesting user. Test 7.3(iv) exercises this directly by asserting the bind parameter and SQL text, rather than just asserting the output shape — a real check of the scoping mechanism, not just its result.
- **Frontend locally-defined type (task 4.1's fix):** `voteDraft.ts` imports only `SessionStatus`/`SessionTopicStatus` from `@dipstick/shared` (pre-existing enum types, unrelated to this change's own Group 7 additions) and defines `RegistrationSnapshotForRestore` locally, structurally matching D3a's wire shape. It does **not** import `SessionRegistrationSnapshotPayload`. This is the correct posture per task 4.1 and preserves the stated build-order independence between Groups 4 and 7 — TypeScript's structural typing will catch drift at the eventual task 8.1 wiring point rather than requiring an artificial dependency today.

## Data classification / audit logging (D3e)

No `audit_log` row is written anywhere in this change's code path. I grepped `packages/backend/src/realtime/` for `audit_log` and confirmed the only hit inside the new/modified files is the comment in `websocket-routes.ts` explaining the absence. This is consistent with the stated precedent — ordinary WS registration is unaudited today; only the SEC-25/26 lifecycle layered on top is (`connection-reauthorization.ts`, `connection-token-refresh.ts`, both of which do write `audit_log` rows for their own concerns). The decision not to log here is recorded, not silent, matching D3e.

## Consistency with existing patterns

- The `session_registration_snapshot` send uses the same `safeSend(registry, scope, id, conn, ...)` direct-to-connection path `reauth_required` already uses in `connection-token-refresh.ts` — no new delivery mechanism introduced, as design.md requires.
- The new `WsClientMessage` variant and payload type follow the existing style of `realtime.ts` (doc comments referencing the originating decision, `SessionStatus`/`SessionTopicStatus` reuse rather than re-declaration).
- `session-registration-snapshot.ts`'s query style (one live read, no cache) matches the stated precedent of `evaluateSessionSubscriberAccess` and the delivery-time dispatcher.
- `voteDraft.ts`'s discard-by-default structure (four enumerated conditions, lock-in check last, required non-optional `payload` parameter) matches D4's enumeration exactly, including the explicit note that check order doesn't affect outcome but the lock-in check is placed last so it always wins.

## Minor observations (non-blocking)

- Running `vitest` from the repo root without each package's own config produces false failures for the frontend suite (`window is not defined`) because the jsdom environment is package-scoped. This is a pre-existing project quirk, not something this change introduced — worth flagging to whoever eventually documents a repo-wide test-running convention, but not this team's problem to fix.
- A root-level `tsc --noEmit` against `packages/backend` surfaces pre-existing type errors in several test files (`app.decorateRequest("session", null)` pattern), including in the new `websocket-routes-registration-snapshot.test.ts` — but the identical error exists in the untouched, pre-existing `websocket-routes.test.ts` it was modeled after. This is inherited baseline noise, not a defect introduced by this change, and the actual `vitest` run (which is how this codebase's CI presumably type-checks via esbuild transpilation, not strict tsc) passes cleanly.

## Non-goal / guardrail checks (Group 6)

- No `fetch`/API client usage in `voteDraft.ts` — confirmed by reading the full file; only `window.sessionStorage` calls.
- `FacilitatorReadinessGrid.tsx` does not appear in the diff against `main` at all — untouched, as task 6.2 requires.
- No toast/banner/sound/animation/console call anywhere in `voteDraft.ts`.
- No feature flag or env-gated branch anywhere in the new code.

## Verdict

Complete and correct for the scoped tasks (1–7). The implementation matches design.md's decisions faithfully, including the parts that are easy to get subtly wrong under time pressure — the ordering/failure-containment sequencing (D3c) is enforced by actual call-site placement and proven by a forced-failure test, not just asserted in a comment. Boundaries are respected: the frontend module has no backend/shared payload-type dependency (task 4.1), the backend snapshot function performs no access decision of its own (D3d), and the audit-logging omission is a recorded decision (D3e), not an oversight. I found nothing here I'd send back before this lands. Group 8's deferral is appropriately scoped — it depends on UI and issue #32 that don't exist yet, and the design/tasks documents are explicit that this is not being assumed already solved.
