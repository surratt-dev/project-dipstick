# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `topic-customization-lock-and-add-custom-topic` (#49/#50)
**Scope of this review:** does the shipped code match `design.md`'s 13 decisions, and are its boundaries and patterns consistent with the rest of `packages/backend/src/`. I read the diff against `HEAD`, the new files, the design/spec/tasks documents, and ran the backend test suite (`vitest run`) and `tsc --noEmit` against the whole package to check my reading against actual behavior, not just against the code as written.

**Verdict: Approved.** No blocking issues. Two items below are worth a short follow-up note in `design.md` (one documentation gap, one minor cross-endpoint inconsistency) but neither is a correctness, security, or boundary problem, and neither should hold up merging this change.

---

## 1. `topic-lock-helper.ts` — single reusable lock-check function (Decision 1)

Confirmed as designed. `hasCompletedFirstSession(teamId)` is a single exported function issuing one live, uncached `SELECT COUNT(*) ... WHERE status = 'complete'` query. I traced both call sites:

- `content.ts`'s `GET /api/v1/teams/:teamId/topics` imports and calls it directly (`const isCustomizationLocked = !(await hasCompletedFirstSession(teamId));`).
- `topics.ts`'s `checkCustomizationLockGate` imports and calls the same function.

I grepped the full diff and the new files for any inline `COUNT(*)`/`EXISTS` against `sessions.status = 'complete'` outside this one file — there is none. No caching layer wraps it anywhere (no memoization, no request-scoped cache). This matches Decision 1 and its "no caching, ever" rationale exactly, and the test file (`topic-lock-helper.test.ts`) explicitly asserts two calls for the same team each issue their own `db.query` (no memoized result).

## 2. `standing-facilitator-access-helper.ts` — genuine extraction, not re-derivation (Decision 9's M2 addendum)

Confirmed as a real extraction. I diffed `facilitator-sessions.ts` against `HEAD` specifically to check this: the SQL string that used to live inline in `POST /api/v1/teams/:teamId/sessions/draft` —

```sql
SELECT u.global_role, (tm.id IS NOT NULL) AS is_member
FROM users u
LEFT JOIN team_memberships tm
      ON tm.user_id = u.id AND tm.team_id = $2 AND tm.removed_at IS NULL
WHERE u.id = $1
```

— is byte-for-byte the query now inside `evaluateStandingFacilitatorAccess`. This is a lift-and-move, not a rewrite that happens to compute the same thing. `facilitator-sessions.ts` now imports and calls `evaluateStandingFacilitatorAccess(session.userId, teamId)` and destructures `{ globalRole: global_role, isMember: is_member }` from the result — same local variable names as before, so the rest of that handler's logic is untouched.

I ran the existing test suite for this file directly: `facilitator-sessions.test.ts` — **92 tests, all passing, unmodified**. Combined with the `git diff` showing no test-file changes for `facilitator-sessions.test.ts` in this change's diff stat, this confirms the extraction is behavior-preserving, not just structurally plausible. `topics.ts` calls the same helper for its own Task 3.1 check — one query, two callers, exactly as Decision 9's addendum requires.

## 3. `topics.ts` — cascade, timing floor, advisory lock, envelope, audit

**Cascade order (403 → 404 → 409 → 422 → 201).** Confirmed by direct code reading (`checkStandingFacilitatorAuthorization` → `checkTeamExists` → `checkCustomizationLockGate` → `validateAddCustomTopicBody` → insert transaction, each gated on the prior step's `rejected` flag) and by the test suite's dedicated ordering tests (`topics.test.ts`'s "check ordering" describe block), including the specific priority tests that matter most: a non-facilitator against a locked team gets `403` not `409`; a nonexistent team with an invalid body gets `404` not `422`; a locked, existing team with an invalid body gets `409` not `422`. All pass.

**`applyTimingFloor` on every branch, including `201`.** Verified in the code — every one of the five return paths (`403` ×2 reasons, `404`, `409`, `422`, `201`) calls `await applyTimingFloor(startTime)` before responding, with a single `startTime = Date.now()` captured once at handler entry and threaded through as a parameter (not re-read per check). The test suite has a dedicated describe block asserting this per-branch, plus an explicit "not detectably faster" test that exercises all four early-return branches with the same mocked floor call count. This matches Decision 9's Finding-1 amendment precisely.

**Advisory lock ordering (Decision 10).** Confirmed both statically and dynamically:
- Code: `pg_advisory_xact_lock(hashtext($1::text))` is the first statement inside `BEGIN`, strictly before the `MAX(display_order)` read, inside the same transaction as the `INSERT`.
- Unit test: explicitly asserts `lockIndex < maxIndex` against the mock client's call order.
- Integration test (`topics-integration.test.ts`, Task 5.7 real-Postgres variant): fires two genuinely concurrent requests (`Promise.all`) against a real Postgres instance and asserts both succeed with distinct, contiguous `displayOrder` values (`[1, 2]`) and that the `topics_team_order` unique constraint (`UNIQUE (team_id, display_order, status)`, confirmed present in `migrations/2_create_tables.sql`) is never violated. I ran this test directly against the project's local Postgres — it passes. This is the test that would have caught the original `FOR UPDATE`-on-a-row bug the design corrected; it passing is meaningful evidence the fix is real, not just plausible on paper.

**Error envelope shape (Decision 4).** `buildErrorEnvelope` returns `{ error: { category, code?, field?, message, correlationId } }`. I cross-checked this against `teams.ts` directly: `teams.ts`'s `GLOBAL_ROLE_PRECONDITION_NOT_MET` response (line ~1226) uses the identical `category` + `code` + `message` + `correlationId` shape, and `action-items.ts` uses the same `category: "precondition_failed"` value for its own terminal-state `409`. No bare top-level `{ code, message }` body exists anywhere in the new file — the test suite has an explicit regression test for this ("never ships a bare top-level `{ code, message }` body without the error envelope").

**Both audit events present, correctly scoped.** Denial (`topic.write_denied_locked`) is written via a plain `db.query` before the `409` is sent — confirmed in `checkCustomizationLockGate`, called before `applyTimingFloor`/`reply.send`. Success (`topic.custom_added`) is written on the transaction `client`, inside the same `BEGIN`/`COMMIT` block as the topics `INSERT`, using the `RETURNING id` value as `metadata.topic_id`. The integration test independently confirms both rows land in real Postgres with the expected `operation` values and metadata. `audit-logger.ts`'s `AuditEventName` union was extended with both event names and inline comments explaining precedent (`team.role_change_denied`, `session.draft_created`) — consistent with how every other audited operation in that file is documented.

## 4. `content.ts` — shared helper, snake_case preserved (Decision 1 / Decision 5 addendum)

Confirmed. The diff is minimal and surgical: one new import, one new `const isCustomizationLocked = !(await hasCompletedFirstSession(teamId));` line, and the existing `.send({ teamId, topics: result.rows })` becomes `.send({ teamId, topics: result.rows, isCustomizationLocked })`. `result.rows` itself is untouched — still the raw `vote_type`/`display_order`/`status` snake_case row shape. There's a dedicated regression test ("does not remap existing snake_case fields to camelCase") that would fail if anyone "cleaned this up" later without reading Decision 5's addendum first — a good, cheap guardrail for a decision that's easy to accidentally violate in a future PR.

## 5. The `error.field` addition — assessed

**Finding: this is a reasonable implementation-level addition, not scope creep, but it should be written down.**

Two things are true at once here:

1. `error.field` is genuinely not in Decision 4's enumerated envelope shape (`{ category, code, message, correlationId }` — no fifth key mentioned anywhere in `design.md`), and no other endpoint in this codebase's `error` envelope carries a `field` property. I grepped `routes/*.ts` and `auth/*.ts` broadly — this is the first `error.field` in the codebase.
2. But the requirement to identify the failing field is not the engineer inventing scope — it's already a literal, spec-mandated requirement that predates and is independent of Decision 4: `specs/add-custom-topic/spec.md` states plainly, "The validation error response SHALL identify which field(s) failed validation," with scenario-level assertions like "the response is `422 Unprocessable Entity` identifying `name` as the failing field." `tasks.md` Task 5.3 repeats this requirement. Neither document says *how* the field identification should appear in the response body — that's the actual gap, and it's a gap in the design/spec pair, not something the engineer added gratuitously.

Given that gap, adding an optional `field` key to the same envelope — populated only on `422`/`invalid_request` responses, absent everywhere else — is the right-sized fix: it's additive (no existing consumer of any other `error` response breaks), it doesn't create a second envelope shape, and it's exactly the kind of "extend the existing envelope for a genuinely new need" move Decision 4 itself made relative to the plainer envelope `action-items.ts`/`content.ts` use (Decision 4's own text: "`teams.ts`'s envelope-plus-`code` shape already solves the identical problem this decision exists to solve, so this decision now reuses it rather than inventing a fourth"). `error.field` is the same kind of move one layer further down.

**What I'd still ask for:** a one-paragraph addendum to Decision 4 (or a footnote) stating this explicitly — the same discipline this design already holds itself to for every other divergence from the contract's literal text. Right now, a future reader of `design.md` sees an envelope shape with four keys and then finds a fifth in the shipped code with no trail explaining why. That's a small instance of exactly the failure mode this entire design document exists to prevent ("implicit decisions are the ones that cause problems when the person who made them is no longer available to explain them") — low stakes here since the code comments in `topics.ts` do explain it inline, but the design document is the place a future engineer building `TOPIC-004`–`007` against this same envelope will look first, and today it would mislead them into thinking `field` isn't sanctioned. **Not a blocker; recommend a small doc fix, not a code change.**

## 6. Other observations while reading

**Minor, undocumented divergence: the `grant === null` (no user row) case is handled differently by the two callers of `evaluateStandingFacilitatorAccess`.** `facilitator-sessions.ts`'s `POST /draft` treats a null grant as `401` (`session_expired`, "User not found"). `topics.ts`'s `checkStandingFacilitatorAuthorization` treats the identical condition as `403` (`NOT_A_FACILITATOR`), with an inline comment reasoning that "the authenticated session middleware already guarantees a user row exists for any normal request that reaches this handler." That may well be true in practice, but if it's true, `POST /draft`'s own `401` branch for the same condition is equally dead code — and it wasn't removed. Neither `design.md` nor `tasks.md` states this divergence as a decision; it reads as an implementation-time judgment call on an edge case neither document anticipated. Low severity — this is a genuinely hard-to-reach state (would require the session to outlive the user row, e.g. a deleted user with a still-valid cookie) — but it's the same class of thing Decision 9's own M2 addendum was written to prevent for the SQL itself: two callers of one shared helper quietly disagreeing about what a given result means. Worth a one-line note in a future pass, not worth blocking on.

**Schema and migration claims verified.** `topics_team_order UNIQUE (team_id, display_order, status)` exists exactly as Decision 10 assumes (`migrations/2_create_tables.sql`). `audit_log` already has every column both audit events need (`migrations/8_audit_log.sql`) — no migration was added, matching the Migration Plan's claim.

**Test suite and typecheck.** Full backend suite: 810 passed, 3 skipped, 0 failed. The topics-specific files (`topic-lock-helper.test.ts`, `topics.test.ts`, `topics-integration.test.ts`, plus the extended `content.test.ts`) total 68 tests, all passing, including the real-Postgres concurrency test. `tsc --noEmit` surfaces a number of pre-existing strictness errors across many *other* test files in the package (null-argument and possibly-undefined patterns in `teams.test.ts`, `sessions.test.ts`, `join-links.test.ts`, etc.) — these predate this change and are not introduced by it; none of the errors are in `topics.ts`, `topic-lock-helper.ts`, or `standing-facilitator-access-helper.ts` themselves. Not this change's responsibility to fix, and not a regression it introduced.

**Boundaries and route placement (Decision 5).** `topics.ts` is new, registered in `app.ts` alongside the other route modules, and owns only the write endpoint — `content.ts`'s existing `GET` handler was not moved, matching the stated non-goal. `app.ts`'s diff is a clean two-line addition (import + register call), consistent with how every other route module is wired in.

**Decisions 6, 7, 11, 12, 13 (no row lock on the read; no realtime push; deactivated teams not filtered; read/write auth asymmetry accepted; no rate limiter) all check out as shipped exactly as stated** — I looked for any code that would contradict each of these (e.g., a `deactivated_at` filter creeping into `checkTeamExists`, a rate limiter import, a WebSocket publish call in `topics.ts`) and found none.

---

## Summary

The implementation matches `design.md` faithfully, including both corrections made mid-review (Decision 10's advisory-lock fix and Decision 4's envelope reuse) — and the corrections are demonstrably real, not just asserted: the advisory-lock fix is backed by a real-Postgres concurrency test that exercises the exact race the original mitigation failed to close, and the envelope reuse is backed by a direct structural match against `teams.ts`. The lock-check helper is genuinely singular, the authorization-query extraction is genuinely a lift (not a re-derivation), and the existing `POST /draft` endpoint's own test suite proves the extraction didn't change its behavior. The one engineer-introduced addition beyond the spec (`error.field`) is a sound, low-risk way to satisfy an already-existing spec requirement that `design.md` itself left unresolved — it should be written down as a short addendum, but it does not need to be reverted or re-reviewed before shipping. The one inconsistency I found on my own (401 vs. 403 for a null-user-row grant across the two callers of the same new helper) is minor and not worth blocking on.

No changes requested before merge.
