# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `http-auth-audit-log-coverage`
**Scope of this review:** does the shipped code match `design.md`'s decisions, and does it respect this codebase's existing module boundaries and patterns. I am not re-litigating scope (Decisions D1/D3/D4 were mine to weigh in on at design time and I did) — this is a verification pass against what was actually built.

## Verdict

**Approved.** This is a clean, small, well-bounded change. Every decision I care about — the module boundary, the single-timeout mechanism, the naming fix, the import discipline — was carried through into the code exactly as decided, and the tests assert the specific properties that made the design review non-trivial (the 500ms-not-1000ms bound, in particular). I have one non-blocking observation below; nothing here should hold up archiving.

## Targeted verification

**1. Single 500ms timeout wraps SELECT+INSERT together, not two independent timeouts.**
Confirmed. `session-invalidation-audit.ts`'s `writeAuditRow()` (lines 73–84) performs the `resolveActorGlobalRole` SELECT and the `INSERT` sequentially inside one `async` function; `writeSessionInvalidatedAuditRow` wraps the single call to `writeAuditRow()` in exactly one `withTimeout(..., AUDIT_WRITE_TIMEOUT_MS)` (lines 108–112). There is no second `withTimeout` anywhere in the module. `middleware.test.ts`'s hang test (5.6) exercises this directly: it hangs the SELECT, advances fake timers by exactly `AUDIT_WRITE_TIMEOUT_MS`, and asserts the INSERT never ran (`mockDbQuery` called once) — this is the right test to distinguish "one shared budget" from "two independent budgets," and it passes against the shipped mechanism. This is exactly Decision D5's corrected design, not the ~1000ms version the design review caught.

**2. `retryCount` crosses the `RefreshResult` boundary at both return sites.**
Confirmed. `middleware.ts`'s `RefreshResult` type (lines 47–51) carries `retryCount: number` on both `revoked` and `transient_failure` variants. Both corresponding return statements are populated from the function's own `retries` local: line 122 (`return { status: "revoked", retryCount: retries }`, using the same `retries` value already fed into that branch's `emitAuditEvent` call) and line 152 (`return { status: "transient_failure", retryCount: retries }`, using the post-loop `retries` value, also already used in the preceding `emitAuditEvent`). The two `onRequest` call sites in `authMiddleware` read `result.retryCount` off the narrowed union inside their respective `switch` cases (lines 207, 223) and pass it through to `writeSessionInvalidatedAuditRow`'s `metadata`. Tests assert the exact values at both sites (`retryCount: 0` for immediate revocation, `retryCount: 3` for exhausted retries) and confirm `connection-token-refresh.ts` needs no change since it switches on `status` only.

**3. `authSessionId` (not `sessionId`) used consistently to avoid the collision.**
Confirmed, and confirmed correctly scoped. The write-path parameter, the `audit_log.metadata` field, and the `auth.audit_write_failed` payload all use `authSessionId` — in `session-invalidation-audit.ts` and in `audit-logger.ts`'s `AuditEventName` documentation for the new event. This is *not* applied to the pre-existing structured-log `emitAuditEvent(..., "auth.session_invalidated", { userId, sessionId, ... })` calls at all four sites — those correctly keep the field name `sessionId`, per Decision D2's own reasoning (that field name is pre-existing and unchanged; only the *new* DB-row metadata gets the disambiguated name). A reviewer skimming the four call sites without the design doc in hand could plausibly read this as an inconsistency ("why does the log say `sessionId` but the DB row say `authSessionId` for the same value?") — it isn't one, it's a deliberate boundary between old and new surface, but it's worth flagging as the one place a future maintainer might "fix" this into a false consistency. Non-blocking; the design doc and the spec delta both state the reasoning clearly enough that this should survive a casual read.

**4. No import-duplication regression.**
Confirmed. `resolveActorGlobalRole` is imported in exactly one place across this change's new/modified files: `session-invalidation-audit.ts` (from `connection-reauthorization.js`). Neither `middleware.ts` nor `auth.ts` imports it, or `db.js`, for this purpose — both import only `writeSessionInvalidatedAuditRow` from the new module. `resolveTeamIdForAudit` is imported nowhere in this change, matching Decision D7's corrected wording (the original draft's "imported but never called" would have been an unused-import lint failure; the shipped code doesn't import it at all). This is the boundary I asked for at design time — `routes/auth.ts` reaches the new module without ever acquiring a dependency on `auth/middleware.ts` — and it's exactly what's in the diff.

**5. `sourceIp` present on `auth.audit_write_failed` and all four existing structured logs.**
Confirmed on all five. `writeSessionInvalidatedAuditRow`'s catch block includes `sourceIp: request.ip` in the `auth.audit_write_failed` payload. The four pre-existing `emitAuditEvent(..., "auth.session_invalidated", ...)` calls each gained `sourceIp: request.ip`: `middleware.ts` lines 178, 213, 229 (absolute-timeout, token-revoked, refresh-failure) and `auth.ts` line 430 (explicit-logout). Tests assert this at every site (`expect.objectContaining({ ..., sourceIp: expect.any(String) })` / literal IP values). This closes the exact gap the design doc named relative to the immediately preceding `sourceIp`/`correlationId` completeness commit.

**6. `team_id` is `NULL` at all four call sites, including logout.**
Confirmed. `writeAuditRow`'s `INSERT` hardcodes `team_id` as a SQL literal `NULL` (not a bound parameter), so this is structurally uniform across all four call sites by construction — there is no code path in this module that could produce a non-NULL value. `auth.ts`'s logout test (`writes team_id as a literal NULL, with no team lookup query issued`, task 5.7) additionally asserts no `FROM sessions` lookup query is issued at all, which is the right test for Decision D4 — it doesn't just check the output value, it checks that no lookup exists to later start feeding a real value into that column without a corresponding design/spec update.

## Boundary and pattern consistency

- **Module placement.** `session-invalidation-audit.ts` sits in `packages/backend/src/auth/`, alongside `audit-logger.ts` and `middleware.ts`, both of which it either extends or is imported by. This matches the design's own stated rationale (avoid a `routes/` → `auth/middleware.ts` edge) and doesn't introduce a new cross-directory dependency shape — both call sites already imported from `auth/` before this change.
- **Fail-open pattern is new, not borrowed incorrectly.** The design was explicit that this departs from `content.ts`'s awaited/fail-closed precedent, and the code matches: no rethrow, catch-and-log via a dedicated `AuditEventName`. Nothing in the diff pretends to reuse a pattern that doesn't have this behavior.
- **`AuditEventName` documentation convention.** The new `auth.audit_write_failed` entry in `audit-logger.ts` follows the file's existing inline-comment convention (what fires it, why it's log-only, its payload shape) — consistent with how `team.manager_association_rate_limit_check_failed` and the `session.*` events are documented above it.
- **`docs/deployment.md`.** The Logging section's at-risk-event count and enumeration were updated to 19 events, with `auth.audit_write_failed` added and `auth.session_invalidated` correctly marked as a partial exception (log-only fallback on write failure, not full log-only) rather than moved out of the at-risk list entirely — it's still log-only *when the DB write fails*, which is the right framing.
- **Spec delta matches shipped behavior.** I compared `specs/auth-error-handling/spec.md`'s new/modified requirements and scenarios against the code line-by-line (field names, NULL handling, timeout/error distinction, the token-refresh-success/failure exclusion) — no drift found. Task 6.1 is legitimately closed, not just checked off.

## Non-blocking observations

1. **`authSessionId` vs. `sessionId` field-name split** (noted in point 3 above) is correct as designed but is the one spot in this change where a future "cleanup" pass could reintroduce the exact collision Decision D2 exists to prevent. Worth a one-line comment at one of the four call sites (or in the `writeSessionInvalidatedAuditRow` doc comment, which already exists and could gain one clause) making explicit that the log's `sessionId` and the DB row's `authSessionId` are the same value under intentionally different names — cheap insurance, not required for this change to ship.
2. Everything else I'd normally flag (query cancellation on timeout, monitoring for `auth.audit_write_failed`, the wider `auth.ts`/`join-links.ts` gap) is already named as an accepted trade-off or filed as a follow-on issue (#131, #132, #133) in the design and tasks docs. I have no new risk to add to that list.

## Summary against my own review criteria

- Architectural decisions made explicitly: yes — D5's timeout-mechanism correction and D7's import-scope correction both read as decisions with stated rationale, not silent fixes, and both are verifiable in the diff.
- Clear system boundaries: yes — the new module is the sole place `resolveActorGlobalRole` is reached from this change's call sites, and `routes/auth.ts` does not acquire a dependency on `auth/middleware.ts`.
- Security/auditability by design: yes — fail-open behavior is bounded, distinguishable (timeout vs. error), and paired with a detectability signal whose limits (not monitored) are stated honestly rather than implied.
- Operability: yes — the deployment doc's at-risk-event list is kept current, and the design is honest that this doesn't add monitoring, only a monitorable signal.

No changes requested.
