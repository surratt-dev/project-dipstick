## Security Implementation Review — `topic-customization-lock-and-add-custom-topic` (#49/#50, `TOPIC-003`)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** shipped code — `packages/backend/src/routes/topics.ts`, `packages/backend/src/auth/standing-facilitator-access-helper.ts`, `packages/backend/src/auth/topic-lock-helper.ts`, the modified `packages/backend/src/routes/content.ts` and `packages/backend/src/routes/facilitator-sessions.ts`, the `AuditEventName` addition in `packages/backend/src/auth/audit-logger.ts`, and the three new/changed test files (`packages/backend/src/routes/__tests__/topics.test.ts`, `packages/backend/src/routes/__tests__/topics-integration.test.ts`, `packages/backend/src/auth/__tests__/topic-lock-helper.test.ts`) — cross-checked against `design.md`'s decisions and my own prior `design-review-security.md` findings (1–5).

**Overall assessment: the four decisions I was asked to re-verify against the shipped implementation are all correctly and completely built.** I found no branch reordering, no missing timing-floor call, no envelope over-disclosure, no missing or misordered audit write, and no new PII surface. This is a clean close-out of Findings 1 and 3 from design review, and a faithful implementation of Decisions 3, 9, 12, and 13 as amended. Two low-severity observations below are worth a line in the record but do not block anything.

---

### 1. Check-ordering cascade (Decision 9) — verified exact, no reopened enumeration path

Read `topics.ts` top to bottom against the four-step cascade:

1. `checkStandingFacilitatorAuthorization` — role check, then membership check, both `403`, both evaluated before any team-specific query runs (`db.query` is not called at all for the role-failure branch beyond the single auth-query; confirmed by `topics.test.ts`'s `expect(mockDbQuery).toHaveBeenCalledTimes(1)` assertion on that branch).
2. `checkTeamExists` — `404`, runs only if step 1 passed (`SELECT id FROM teams WHERE id = $1`, no `deactivated_at` filter, matching Decision 11).
3. `checkCustomizationLockGate` — `409`, runs only if step 2 passed, calls the shared `hasCompletedFirstSession`.
4. `validateAddCustomTopicBody` — `422`, runs only if step 3 passed, and only after `const { name, prompt, voteType, firstSessionDescription } = validation.data` is reached.

The handler body's control flow is a strict sequence of `if (result.rejected) return reply;` guards — there is no branch that skips ahead, and no code path that runs step *N*'s query before step *N-1* has returned a pass. This matches Decision 9 exactly, including the M2 addendum's structural note that both `403`s sit before the `404` (unlike the sibling `POST /draft`, where existence sits between the two `403`s) — confirmed intentional and behaviorally equivalent for every real caller per the FK argument in design.md, and not disturbed here.

I specifically checked for the failure mode Decision 9's "Alternatives considered" flags — validation before authorization — and it is not present: `validateAddCustomTopicBody` is called only after all three prior gates return `rejected: false`.

### 2. `applyTimingFloor` on every early-return and the `201` path — verified, no gaps

Traced every `return reply` / final response statement in the handler:

| Branch | `applyTimingFloor(startTime)` called before response? |
|---|---|
| `403 NOT_A_FACILITATOR` | Yes (`checkStandingFacilitatorAuthorization`, line 97) |
| `403 FACILITATOR_IS_TEAM_MEMBER` | Yes (line 111) |
| `404` team not found | Yes (`checkTeamExists`, line 143) |
| `409 TOPIC_CUSTOMIZATION_LOCKED` | Yes (`checkCustomizationLockGate`, line 221 — after the audit write, before the send) |
| `422` validation failure | Yes (main handler body, line 364) |
| `201` success | Yes (main handler body, line 444, after `COMMIT` and after `emitAuditEvent`, immediately before `reply.code(201).send(...)`) |

There is exactly one `startTime = Date.now()` captured once at handler entry (line 323) and threaded through every helper — no branch computes its own start time or otherwise resets the clock, which would have silently broken the floor's flattening property. This closes design-review Finding 1 completely: every one of the five terminal branches, success included, pays the same fixed floor.

`topics.test.ts`'s dedicated `"timing floor applied on every branch"` describe block exercises all five branches individually plus a loop asserting `applyTimingFloor` is called exactly once per branch (lines 634–715). As I noted in the original design review, and as `content/__tests__/timing-oracle.test.ts` itself demonstrates, a mocked-floor unit test can only assert *that the floor function is invoked once per branch* — it cannot assert a real elapsed-time invariant, since `applyTimingFloor` is mocked to a fixed resolved promise. That is not a shortfall specific to this change; it is this codebase's existing standard for this property everywhere else `applyTimingFloor` is unit-tested. The property that actually matters for production — the floor value itself is a measured p95/p99, not the 150ms placeholder — remains gated by `timing-oracle.ts`'s own `NODE_ENV === "production"` throw guard, which is unmodified and unaffected by this change. No new gap here; the implementation meets the bar this codebase has already set for itself.

### 3. Error envelope — no over-disclosure at any status code

Checked `buildErrorEnvelope`'s four call sites against Decision 4:

- `403 NOT_A_FACILITATOR` / `403 FACILITATOR_IS_TEAM_MEMBER`: `category: "forbidden"`, a fixed, generic message, a machine code, a fresh `correlationId`. Neither message nor code reveals whether the target team exists, is locked, or anything else team-specific — confirmed by the ordering in §1, these branches never reach a team-specific query.
- `404`: `category: "not_found"`, message `"Team not found."`, **no `code` field** — consistent with Decision 4, which specifies codes only for the two `403`s and the `409`; adding one here would have been scope creep, not a gap.
- `409 TOPIC_CUSTOMIZATION_LOCKED`: `category: "precondition_failed"`, the exact stable literal from Decision 4 (`"Topics cannot be customized until this team's first session is completed."`), the `code`, and a `correlationId`. No team-specific data (session count, session IDs, dates) is included — the message is the fixed string, not an interpolated one.
- `422`: `category: "invalid_request"`, a field-specific validation message (e.g., `"name is required, must be non-empty after trimming, and at most 100 characters."`) plus `field`. This describes the *rule*, not the caller's submitted value — the rejected `name`/`prompt`/etc. content is never echoed back into the error body, so a caller cannot use this endpoint to get arbitrary user-supplied text reflected into a response for any reason. No PII or cross-tenant data possible here since the body is the caller's own submission.

Confirmed by `topics.test.ts`'s explicit envelope-shape tests, including `"never ships a bare top-level { code, message } body without the error envelope"` (lines 763–776), that the corrected shape from engineer review M1 is what actually shipped, not the earlier bare `{code, message}` draft.

Category strings (`forbidden`, `not_found`, `precondition_failed`, `invalid_request`) are byte-identical to the ones already used in `action-items.ts` and `teams.ts` — confirmed by grep — so this doesn't introduce a fifth ad hoc category name into the codebase.

### 4. Audit logging — both writes present, correctly ordered, correctly scoped

- **Denial path (`topic.write_denied_locked`):** `writeLockDenialAudit` is `await`-ed inside `checkCustomizationLockGate` *before* `applyTimingFloor` and *before* `reply.code(409).send(...)`. It is a plain, unwrapped `db.query` — no `withTimeout`, matching Decision 13's stated acceptance. There is no `try/catch` around it in `checkCustomizationLockGate`; a thrown error propagates up and becomes an unhandled `500` with no `409` ever sent — i.e., it fails closed, exactly as Decision 13 requires and as `TEAM-005`'s precedent behaves. Confirmed against the real-Postgres integration test, which asserts a `topic.write_denied_locked` row exists after a real `409` (`topics-integration.test.ts` lines 124–128).
- **Success path (`topic.custom_added`):** the `INSERT INTO audit_log` runs on the same `client` inside the same `BEGIN`/`COMMIT` transaction as the topic `INSERT`, after it and before `COMMIT` (lines 400–428). A failure here rolls back the whole transaction (`catch`/`ROLLBACK`/`rethrow`), so it is impossible to end up with a committed topic row and no audit row, or vice versa — this is the exact non-repudiation guarantee Decision 8's amendment (Finding 3) asked for. Confirmed against the real-Postgres integration test, which asserts a `topic.custom_added` row with `metadata.topic_id` matching the created topic (lines 165–171).
- Both writes are also mirrored with an in-process `emitAuditEvent` call (structured logger event) — the success-path emission happens *after* `COMMIT`, which is correct: it's a log-level echo of an already-durable fact, not itself the durability mechanism, so its placement outside the transaction is not a gap.
- Both operations were added to `AuditEventName` in `audit-logger.ts` with metadata documented as `{ endpoint, attempted_operation }` and `{ topic_id }` respectively — no topic `name`, `prompt`, or `firstSessionDescription` content is written into either audit row's metadata, and no participant/vote/session content of any kind is pulled in. `actor_ip`, `actor_user_id`, `actor_global_role`, `team_id` are the same columns already used by every other `audit_log` row in this codebase — this introduces no new PII category and no new sensitive-data field. **Finding: no PII/sensitive-data exposure issue in either new audit event.**

### 5. `standing-facilitator-access-helper.ts` — verified faithful extraction, no narrowing or widening

I diffed the extraction against `facilitator-sessions.ts`'s pre-change `POST /draft` handler (`git diff main`). The SQL text moved into `evaluateStandingFacilitatorAccess` is **byte-identical** to the query `POST /draft` ran inline before this change — same `LEFT JOIN team_memberships ... AND tm.removed_at IS NULL`, same column list, same parameter order. `POST /draft` itself was refactored to call the new helper rather than keep its own copy, closing the exact drift risk Decision 9's M2 addendum names. This is as clean an extraction as this kind of refactor gets: no behavior changed for the existing endpoint, and the new endpoint (`topics.ts`) consumes the identical function, not a re-derived approximation of it.

One implementation-level judgment call, not itself a design.md decision, that I traced and consider correct: `topics.ts` treats `grant === null` (no user row at all) as `403 NOT_A_FACILITATOR`, whereas `POST /draft` treats the same condition as `401`. This is a real difference in status code between the two callers of the same helper for the one condition that, per the code's own comment, "shouldn't occur for any normal authenticated request" (the session middleware guarantees a user row exists). It has no exploitable security consequence — a caller who can trigger `grant === null` has no session/user row and gets rejected either way, with an equally generic message, and it isn't reachable via any legitimate client flow. Worth a one-line note for consistency's sake, not a finding.

### 6. Test coverage — the security-relevant scenarios are actually exercised

- **Timing floor:** covered as described in §2. The `topics.test.ts` timing-floor describe block explicitly names and tests all four early-return branches plus the `201` branch, and includes a loop-based test whose comment (lines 677–684) correctly characterizes what a mocked-floor unit test can and cannot prove — this is honest about its own limitation rather than overclaiming a real timing measurement, which I'd flag if it were missing.
- **Concurrency / advisory lock:** `topics-integration.test.ts`'s second test (lines 193–260) runs two genuinely concurrent `POST` requests against a **real Postgres instance** (not mocked), seeded with one pre-existing active topic, and asserts both succeed with distinct `displayOrder` values (`[1, 2]`) and that the final active-topic ordering is contiguous (`[0, 1, 2]`) — this is exactly the test that would have caught the original `FOR UPDATE`-on-a-row bug (a `23505`/`500`) that engineer review B1 found, and it exercises the real `pg_advisory_xact_lock` behavior under genuine concurrency (`Promise.all`), not two sequential mocked calls. The unit-test version in `topics.test.ts` (lines 572–628) is explicitly documented as a *model* of the correct post-lock outcome using two independent mock clients, not a claim of having tested real serialization — appropriately deferring the real correctness claim to the integration test, which is the right division of labor.
- **Denial-path audit write:** covered at both the unit level (`topics.test.ts` lines 250–277, asserting the `INSERT INTO audit_log` call content and the `emitAuditEvent` call) and the integration level (`topics-integration.test.ts` lines 124–128, asserting a real row lands in `audit_log` after a real `409`). Both were checked above in §4.
- Additionally: `topics-integration.test.ts`'s first test (lines 75–181) exercises the full lock lifecycle end-to-end against real Postgres — locked `GET`/`POST`, session completion, unlocked `GET`/`POST` — including the success-path audit row assertion (lines 165–171). This is a good, non-redundant complement to the unit tests: it proves the shared `hasCompletedFirstSession` function actually flips state correctly against a live DB transition, not just against mocked row counts.

### Non-findings — re-confirmed against shipped code

- Decision 12's read/write asymmetry: confirmed unchanged. `content.ts`'s diff is a two-line addition (`isCustomizationLocked` computed via the shared helper) with `evaluateTeamAccess`'s authorization logic completely untouched — the accepted asymmetry from design review is exactly what shipped, nothing wider.
- Decision 13's no-rate-limiter, no-`withTimeout` stance: confirmed. No rate-limit plugin or per-route limiter is registered for `topics.ts` in `app.ts`; no `withTimeout`/`AUDIT_WRITE_TIMEOUT_MS` import appears anywhere in `topics.ts`. Both audit writes are plain `db.query`/`client.query` calls, exactly as decided.
- Decision 11 (deactivated teams not filtered): confirmed — `checkTeamExists`'s query has no `deactivated_at` clause, and it's covered by a dedicated test (`topics.test.ts` lines 228–245).

---

### Summary for the record

Both items I flagged as wanting closed before ship in the design review — Finding 1 (timing floor) and Finding 3 (success-path audit trail) — are fully and correctly implemented, not partially. Finding 2 (read/write asymmetry) and Finding 4 (rate limiting/failure-mode silence) were resolved as accepted, on-the-record decisions (12 and 13) rather than fixes, and the shipped code matches those decisions exactly with no silent narrowing back toward "fix it anyway" or widening back toward "add a limiter after all." I have no blocking findings against this implementation. The one non-blocking observation (§5, the `401`-vs-`403` divergence on a null-grant condition that shouldn't be reachable in practice) is cosmetic and does not affect the authorization, enumeration-resistance, or audit guarantees this review was scoped to verify.
