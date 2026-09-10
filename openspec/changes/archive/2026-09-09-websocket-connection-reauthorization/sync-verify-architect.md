# Solution Architect Spec-Code Sync Verification — websocket-connection-reauthorization

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Final verification that the living spec docs match the actual, tested implementation before Stage 7 (Archive).

## Method

Read in full: the new living spec (`openspec/specs/websocket-connection-reauthorization/spec.md`), the amended requirement in `openspec/specs/websocket-session-authorization/spec.md` (Idle-connection re-authorization, SEC-25), `design.md`, and `tasks.md`. Cross-checked every SHALL/scenario against `connection-reauthorization.ts`, `connection-token-refresh.ts`, `content.ts`'s `fetchConnectionRecoveries`, and `audit-logger.ts`. Ran the full backend test suite directly.

## Findings

### 1. Requirement-to-code traceability — no drift found

Every SHALL requirement and scenario in the living spec traces to real, tested code:

- **Periodic re-authorization sweep (SEC-25/SEC-27):** `connection-reauthorization.ts`'s `scheduleReauthorizationSweep`/`runSweepCheck` reuses `evaluateSessionSubscriberAccess`/`evaluateTeamAccess` verbatim, rejects `admin`-path grants for team scope, closes with `STALE_SIGNAL_CLOSE_CODE`, and writes the `session.access_revoked_live` audit_log row exactly as described. `REAUTHORIZATION_INTERVAL_MS = 5 * 60 * 1000` is a module-local constant, not read from environment.
- **Silent token refresh (SEC-26):** `connection-token-refresh.ts` implements the re-read-before-refresh check, `conditionallyUpdateSession` (existence-gated `SET...XX`) for write-back, the `session.token_refresh_failed_live` audit row on revoked/transient-failure/concurrent-destruction, the `reauth_required` disclosed signal, the ~30s grace period (`GRACE_PERIOD_MS`), and `REAUTH_GRACE_EXPIRED_CLOSE_CODE = 4001`, distinct from `STALE_SIGNAL_CLOSE_CODE`.
- **Disjointness (two close codes, two modules):** confirmed structurally — the two audit/signal paths live in separate modules with no shared parameterized helper.
- **Diagnostic trace / facilitator read path:** `content.ts`'s `fetchConnectionRecoveries` filters with an explicit equality match, `WHERE operation = 'session.connection_recovered'` — never a wildcard/prefix — matching the spec's non-disclosure requirement precisely.
- **Frontend-deferred items correctly marked as open, not shipped:** the reauth_required UX, the readiness-grid uniform treatment, and vote-compose-state persistence across a SEC-26 reload are each explicitly framed as "Open, not yet built" / "Known gap, not covered by this requirement" in the spec, not stated as shipped SHALLs. All three point to the correct GitHub issues.

**GitHub issue verification (`gh issue view`):**
- #31 (compose-state persistence across SEC-26 reload) — open, content matches.
- #32 (reauth_required UX, Open Question 1) — open, content matches.
- #33 (readiness-grid uniform treatment, Open Question 2) — open, content matches.
- #27 (parent issue, SEC-25/SEC-26 companion effort) — open, content matches the cross-reference in both spec files.

### 2. Decision D9a gap — found present, fixed directly

Confirmed the flagged gap: the spec's SEC-25 sweep requirement explicitly stated non-configurability ("This interval is a fixed, module-local constant and is not exposed as an admin-configurable setting or environment override"), but the SEC-26 requirement (refresh threshold, retry budget, grace period) carried no equivalent explicit statement — only tasks.md 8.3 and design.md Decision D9a covered it, not the living spec itself.

**Fixed:** added an explicit sentence to the "Silent token refresh for active WebSocket connections" requirement in `spec.md` stating the refresh threshold, retry budget/backoff delay, and grace period are fixed, module-local constants, not exposed as an admin-configurable setting, environment override, or operational kill switch — mirroring the SEC-25 interval's existing phrasing and consistent with tasks.md 8.3's verification scope across Groups 1–5.

**Note:** while making this edit, discovered a concurrent agent (evidently another sync-verification pass running in parallel on the same file) had independently added an equivalent sentence to the same requirement moments earlier. My first edit landed on top of that change and produced a duplicate statement of the same fact in two adjacent paragraphs. I caught this on re-read and removed the redundant sentence, leaving the single, correctly-placed statement intact. The spec is now internally coherent with no duplication.

### 3. Cross-reference consistency — no contradictions

`websocket-session-authorization/spec.md`'s "Idle-connection re-authorization (SEC-25)" requirement (~line 214) correctly references GitHub issue #27, frames the resolution identically ("resolved by the `websocket-connection-reauthorization` capability"), and its own text is explicitly preserved as "an accurate, standing statement of what delivery-time checks do and do not do on their own" rather than rewritten — consistent with the new spec's framing that this is a companion effort, not a redefinition. No contradictions found between the two documents.

### 4. Test suite

Ran `npx vitest run` directly: **449 passed, 1 skipped (450 total)**, 34 test files passed, 1 file's one test skipped (requires live Redis/Postgres, predates this change — `ws-pubsub-integration.test.ts`). Matches the spec's and design's stated figures exactly.

## Verdict

No unresolved drift between the living specs and the implementation. The one gap found (D9a's SEC-26-constants non-configurability not explicitly stated in the living spec) has been fixed directly in `spec.md`. All three deferred-to-frontend items are correctly marked as open/not-yet-built and point to verified, matching GitHub issues. Test suite is green at the stated count.

**This change is ready for Stage 7 (Archive).**
