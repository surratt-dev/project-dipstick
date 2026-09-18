# Implementation-Stage Security Review — http-auth-audit-log-coverage

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** Verifying the revised design.md's promises (post design-review-security.md) against the actual shipped code, not the prose. Read: `packages/backend/src/auth/session-invalidation-audit.ts`, `packages/backend/src/auth/middleware.ts`, `packages/backend/src/routes/auth.ts`, `packages/backend/src/auth/audit-logger.ts`, `packages/backend/src/auth/__tests__/session-invalidation-audit.test.ts`, `packages/backend/src/auth/__tests__/middleware.test.ts`, `packages/backend/src/routes/__tests__/auth.test.ts`, `packages/backend/src/realtime/connection-reauthorization.ts`, `packages/backend/migrations/8_audit_log.sql`, `docs/deployment.md`, `openspec/changes/http-auth-audit-log-coverage/specs/auth-error-handling/spec.md`. Ran the actual test suite for the three touched test files (62 tests, all passing) and `tsc --noEmit` for the package, rather than trusting that "tests exist" means "tests pass."

**Bottom line: implemented as designed.** All three of my design-stage required findings landed in the real code, not just in design.md's prose, and I could not find a new gap of the shape I was asked to specifically check for (an unhandled-rejection risk paralleling the `runSweepCheck` gap). The three non-blocking items I raised at design time were also carried through into the delta spec, `docs/deployment.md`, and design.md's own D4/D7 text. I have one new, non-blocking observation about how the two touched test files diverged from the migration plan's literal mocking instructions — functionally fine, worth naming so it isn't mistaken for an oversight.

---

## Verification of the three design-stage required findings

### Finding 1 (sourceIp / correlationId on `auth.audit_write_failed` and the four structured logs) — implemented

`session-invalidation-audit.ts:113-121` emits `auth.audit_write_failed` with `sourceIp: request.ip` present in the payload, alongside `userId`, `authSessionId`, `reason`, `failureMode`. Confirmed by test (`session-invalidation-audit.test.ts:149-173`, `:175-186`): both the DB-error and the actor-role-lookup-error cases assert `sourceIp: "203.0.113.7"` in the `emitAuditEvent` call.

The four *existing* structured `auth.session_invalidated` log calls each gained `sourceIp: request.ip` as promised:
- `middleware.ts:174-179` (`absolute_timeout`)
- `middleware.ts:209-214` (`token_revoked`)
- `middleware.ts:225-230` (`refresh_failure`)
- `auth.ts:426-431` (`explicit_logout`)

All four verified directly in the code, and independently confirmed by test assertions in `middleware.test.ts` (`sourceIp: "198.51.100.5"` at lines 138, 239, 298) and `auth.test.ts` (`sourceIp: expect.any(String)` at line 1376). `correlationId` was correctly *not* added — design.md's D5 explicitly declined to invent one for these call sites, and `audit-logger.ts`'s `AuditEventName` comment for `auth.audit_write_failed` documents the same reasoning. No stray `correlationId` field appears anywhere in these payloads.

### Finding 2 (honest detectability language) — implemented, and correctly load-bearing

This was a documentation/framing finding, not a code-shape one, so what matters is whether it actually got said, precisely, everywhere the original overstatement lived. It did: design.md's Decision D5 states plainly that `auth.audit_write_failed` "is not, today, *monitored*... The original draft's... phrasing read as if a consumer existed or was assumed; none does." `docs/deployment.md`'s Logging section (line 163) restates it: "Neither `auth.audit_write_failed` nor any other `AuditEventName` in this codebase is consumed by an alert rule, anomaly-detection job, or dashboard today." The delta spec's new "Audit log write failures fail open..." requirement states the identical caveat as a normative SHALL-adjacent sentence, not just prose. I checked the codebase again for a monitoring consumer that might have appeared alongside this change — there is none; this is still an honest claim, not a new overstatement introduced during implementation.

### Finding 3 (`authSessionId`, not `sessionId`, in `audit_log.metadata`) — implemented in the real write path, not just described

This is the one I scrutinized hardest, since it's exactly the kind of fix that's easy to state in a design doc and miss in the diff. It landed correctly:

- `session-invalidation-audit.ts:100` — the write helper's exported signature parameter is named `authSessionId`.
- `session-invalidation-audit.ts:106` — `const fullMetadata = { reason, authSessionId, ...(metadata ?? {}) };` — the JSONB key written to the database is `authSessionId`, not `sessionId`.
- `session-invalidation-audit.ts:115-121` — the same field name is reused in the `auth.audit_write_failed` payload.
- Confirmed at the byte level via test: `session-invalidation-audit.test.ts:59` — `JSON.stringify({ reason: "absolute_timeout", authSessionId: "sess-1" })`, and equivalently at lines 82-86, 105-111, 128-129.

I also checked that the *other* half of D2's naming discussion was implemented correctly rather than over-applied: the pre-existing structured *log* line (`emitAuditEvent(..., "auth.session_invalidated", { userId, sessionId, reason, sourceIp })`) still uses the bare `sessionId` key, unchanged, at all four call sites (`middleware.ts:175-179, 210-214, 226-230`; `auth.ts:427-431`). That's correct and deliberate, not a leftover inconsistency — design.md's D2 explicitly scoped the rename to `audit_log.metadata` only, reasoning that the log line's pre-existing field name shouldn't be renamed out from under existing log consumers. The collision this finding cared about (an incident responder running `metadata->>'sessionId'` against `audit_log` and silently getting the wrong entity) is closed, because the column-level convention is now `authSessionId` everywhere in that table for this operation. The log-line naming is a separate surface with its own, unchanged convention, and the design was explicit that only the DB metadata needed to change.

---

## Answers to the five questions asked

**1. Does fail-open actually degrade to today's baseline without creating a new way to suppress evidence?**

Yes. `writeSessionInvalidatedAuditRow` (`session-invalidation-audit.ts:98-123`) wraps the entire write in `try/catch` and never rethrows on either an explicit DB error or a timeout — confirmed by the `resolves.toBeUndefined()` assertion at `session-invalidation-audit.test.ts:154-160`. Critically, the *unconditional* structured log call (`emitAuditEvent(..., "auth.session_invalidated", ...)`) at all four call sites is untouched by this design and sits *after* the awaited `writeSessionInvalidatedAuditRow(...)` call in the source, executing regardless of whether that call succeeded, failed, or timed out. I traced this explicitly at each of the four sites (`middleware.ts:172-179`, `:204-214`, `:220-230`; `auth.ts:425-431`) — there is no branch, no early return, and no exception path between the audit-write call and the structured-log call that could be taken only on write failure. An attacker who somehow induces the audit write to fail or hang still leaves the log-only trail intact; the realistic worst case is exactly what design.md claims — regression to today's pre-change log-only baseline, not silence. This matches the design's claim precisely and I found nothing that weakens it in the actual diff.

**2. Is `sourceIp` actually present where promised?**

Yes, confirmed at the code and test level for all five locations (the one `auth.audit_write_failed` payload, plus the four `auth.session_invalidated` structured logs) — see Finding 1 verification above.

**3. Is `metadata.authSessionId` actually used, not `sessionId`?**

Yes, confirmed at the code and test level — see Finding 3 verification above. The naming-collision fix is real, not aspirational.

**4. Is `team_id` actually NULL at all four call sites?**

Yes, and uniformly so by construction rather than by four independent decisions that happen to agree. All four call sites funnel through the same `writeSessionInvalidatedAuditRow` → `writeAuditRow` function (`session-invalidation-audit.ts:73-84`), whose `INSERT` hardcodes `team_id` as a literal SQL `NULL` in the query text itself (`VALUES ($1, $2, $3, 'auth.session_invalidated', NULL, $4)`) — not a bound parameter that could vary by caller. There is exactly one INSERT statement in this codebase for this operation; a fifth call site added later without going through this helper is the only way `team_id` could end up non-NULL or inconsistent, and none exists. `migrations/8_audit_log.sql:38` confirms `team_id UUID` is nullable, and `idx_audit_log_team` is a partial index (`WHERE team_id IS NOT NULL`) that correctly excludes these rows rather than being defeated by them. Also confirmed neither `middleware.ts` nor `auth.ts` nor `session-invalidation-audit.ts` imports `resolveTeamIdForAudit` — grepped for it across all three files, zero hits, matching Decision D7's corrected text and avoiding the unused-import/lint failure the original draft would have produced.

**5. Any new gap the design didn't anticipate — specifically, an unhandled-rejection risk like `runSweepCheck`'s?**

I looked for this specifically, since the design's own Context section (point 2) flagged `runSweepCheck`'s unhandled-rejection-risking `void` INSERT as the precedent this design was explicitly not supposed to reproduce. It didn't reproduce it, and the mechanism used to avoid it is real, not just asserted:

- `withTimeout` (`session-invalidation-audit.ts:43-59`) races the caller's promise against a `setTimeout`-backed rejection via `Promise.race`. On settlement (win or lose), its `finally` block does two things: `clearTimeout(timer!)` (no dangling timer survives the call), and `promise.catch(() => {})` — attaching a no-op handler to the raced-away promise so that if it rejects *after* the race is already decided, Node does not report it as an unhandled rejection. I traced this against both directions: if the underlying `writeAuditRow()` promise wins (resolves or rejects before the timer), the timer is cleared before it can fire, so the abandoned `timeoutPromise` never settles and can't produce an unhandled-rejection warning either. If the timer wins first, the `writeAuditRow()` promise is still in flight; the `.catch` no-op is what prevents its eventual settlement from surfacing as unhandled.
- This is exercised by a real test, not just claimed in a comment: `session-invalidation-audit.test.ts:243-261` (`withTimeout` suite) explicitly constructs the "loses the race, then rejects later" scenario and asserts it doesn't throw/warn, using `vi.advanceTimersByTimeAsync` (not `vi.advanceTimersByTime`, which the code comments correctly note would deadlock racing a mocked-hang promise against `withTimeout`'s own internal timer).
- One structural point worth naming precisely, though it does not change the "no unhandled rejection" conclusion: `writeAuditRow` performs the SELECT (`resolveActorGlobalRole`) and the INSERT *sequentially inside one async function*, which is itself the single promise raced against the timeout (`writeSessionInvalidatedAuditRow`'s call at lines 109-112). This is exactly Decision D5's corrected "one shared 500ms budget for both round trips" mechanism, not the original two-independent-timeouts draft — confirmed by the test at `session-invalidation-audit.test.ts:194-231`, which hangs the SELECT and asserts the INSERT never runs (`mockDbQuery` called exactly once) and that the whole thing resolves at the single `AUDIT_WRITE_TIMEOUT_MS` bound, not 2x it.
- I did not find a second, unrelated unhandled-rejection surface introduced by this change. `emitAuditEvent` itself (`audit-logger.ts:228-258`) is synchronous and unchanged; nothing in the new code path fires a `void`-typed async call the way `runSweepCheck` does. The one pre-existing fire-and-forget pattern this design deliberately left untouched — `middleware.ts`'s three unawaited `request.session.destroy()` calls — was already fire-and-forget before this change and is unmodified by it (Decision D6, reconfirmed by reading the diff: the `destroy()` calls are bare, no `.catch`, exactly as before). That's a pre-existing characteristic, not something this change adds to or worsens.

No new gap of the kind I was asked to check for. The one genuinely new piece of async machinery this design introduces (`withTimeout`) was built with the unhandled-rejection failure mode in mind from the start, and it's tested against it directly, not just documented against it.

---

## One new, non-blocking observation: the two touched test files diverged from the migration plan's literal mocking instructions

Design.md's Migration Plan step 7 says: "Update `middleware.test.ts` (add `db.js` and `resolveActorGlobalRole`-module mocks it does not have today)." That is not what shipped. `middleware.test.ts` instead mocks `session-invalidation-audit.js` directly at the module boundary (`middleware.test.ts:22-29`), with an explicit comment explaining why: `middleware.ts` only ever reaches `db.js`/`resolveActorGlobalRole` *transitively*, through `session-invalidation-audit.ts`, so mocking that one module is sufficient. `auth.test.ts`, conversely, does add a `db.js`-level mock with a default `{ rows: [] }` fallback (`auth.test.ts:154-162`) and lets the real `writeSessionInvalidatedAuditRow` → `resolveActorGlobalRole` → `db.query` path execute against it.

Functionally, this is fine and arguably better-factored than the literal instruction: `session-invalidation-audit.ts` already has its own dedicated, thorough unit test file that exercises the real DB-mock path, the timeout mechanics, and the fail-open behavior in detail (10 tests, all passing). Re-testing that same machinery a second time through `middleware.test.ts`'s mocks would be duplicate coverage for no additional confidence; asserting that `middleware.ts` calls the write helper with the right arguments at the right call sites (which it does, verified above) is the correct scope for that file. I re-ran the full three-file suite (62 tests) to confirm both approaches actually pass, not just that they look reasonable on paper.

I'm naming this only because a future reader comparing design.md's Migration Plan line-by-line against the diff could read the mismatch as an unaddressed task rather than a deliberate, reasonable implementation choice. Worth a one-line note in design.md or tasks.md saying so, but not worth reopening.

---

## Confirmed sound, not reopened

- **Decision D5's corrected single-timeout mechanism** (one `withTimeout` around the SELECT+INSERT sequence, not two independent ones) — implemented exactly as corrected, verified in code and by a test that specifically checks the INSERT never runs when the SELECT hangs past the shared bound.
- **Decision D2's `retryCount` plumbing through `RefreshResult`** — `middleware.ts:49-50` shows `revoked`/`transient_failure` variants now carry `retryCount: number`; `refreshSessionTokens` populates it from the `retries` local at both return sites (`middleware.ts:122`, `:152`); `connection-token-refresh.ts` (the WS-side caller) was not touched and still switches on `result.status` only, matching the design's stated compile/behavior-neutral claim for that caller.
- **`docs/deployment.md`'s enumerated at-risk-event list** — updated to 19 events, `auth.audit_write_failed` included, with the `auth.session_invalidated` partial-exception footnote worded consistently with design.md and the delta spec.
- **The delta spec** (`specs/auth-error-handling/spec.md`) — its scenarios map 1:1 onto the actual test assertions I read; nothing in it overstates what the code does or omits a promised behavior.
