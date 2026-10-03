# Design Review: harden-topic-write-endpoints (Engineer)

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Artifacts reviewed:** `proposal.md`, `design.md`, `tasks.md`, `specs/topic-write-rate-limiting`, `specs/topic-management-screen`
**Checked against:** `routes/topics.ts`, `routes/teams.ts` (TEAM-006), `routes/facilitator-sessions.ts`, `routes/content.ts`, `routes/error-envelope.ts`, `auth/audit-write-timeout.ts`, `content/timing-oracle.ts`, `migrations/8_audit_log.sql`, `routes/__tests__/helpers/real-db.ts`, `.github/workflows/integration.yml`, `frontend/src/pages/TopicManagementPage.tsx` and its test utils.

## Verdict

**Approve with required changes.** The design is implementable, and the boundaries are in the right places: a per-handler helper placed after authz, the limiter kept off the session path, and the TEAM-006 mechanism extracted rather than forked. I'd ship this shape. My required changes are not about the architecture. They are about how the code meets the existing test harness. As written, the change will break a large part of the current unit suite. It will also make the real-Redis integration lane flaky on developer machines. The threshold tests as specified would blow the 60-second suite budget.

## Is Redis available in the integration test environment?

Yes. `integration.yml` runs `redis:7-alpine` on 6380 with `REDIS_URL=redis://localhost:6380`. `helpers/real-db.ts` `probeInfra()` already probes Redis as well as Postgres, and `requireInfraOrThrow` turns an unreachable Redis into a failure under `REQUIRE_DB=1`. The real-Redis tests in 4.3, 5.7 and 5.10 therefore have a home. The plain `ci.yml` lane has no Redis, so those tests must use the same `describe.skipIf(!infraUp)` and `requireInfraOrThrow` pattern. Any test that is not real-Redis must mock the limiter (M1).

## Must fix

### M1. Every existing topic-write unit test will start returning 503
`topics.ts` does not import `redis.js` today. `topics.test.ts`, `topic-annotation.test.ts` and `topic-add-flag-parity.test.ts` mock `db.js`, `config.js` (with `REDIS_URL: "redis://test"`), the audit logger and the timing oracle, but **not `redis.js`**. Once `topics.ts` imports `topic-write-rate-limit.ts`, and that module imports `redis.js`, those files construct a real ioredis client against `redis://test`. The client uses ioredis defaults: offline queue on, `maxRetriesPerRequest: 20`. Each `eval` queues, `withTimeout(…, 500)` fires, and every write answers 503 after about 650 ms. The result is dozens of red tests plus reconnect timers left open in the workers.

**Required:** add a task (group 5, before 5.5) to mock `../topic-write-rate-limit.js` so it returns `"allowed"` in every existing unit file that imports `topics.ts`, the same way `teams.test.ts` mocks `../../redis.js` for TEAM-006. Add a guard so the next file can't forget it. One option is a shared `vi.mock` in a setup helper for these files. A minimum is a short comment block in each file.

### M2. Real-Redis integration tests share durable keys across runs (local flakiness)
Integration fixtures use fixed actor IDs, for example `b0000000-…-f01` in `topics-integration.test.ts` and `d0000000-…-f0N` in `restore-topic-integration.test.ts`. Keys under `topic-write:daily:<userId>` live for 24 h in the developer's `docker compose` Redis. CI starts with a fresh service container every run, so CI stays green. Locally, rerunning the integration suite will build up the daily window until unrelated tests start getting 429s. The most important victim is the #188 `topic-write-template-guard-structural.test.ts`, which requires a `topic.write_denied_template` row and would see a `topic.write_rate_limited` row instead.

**Required:** `real-db.ts` gains a `resetTopicWriteBudget(userId)` helper (or a `SCAN`/`DEL` of `topic-write:*` in a shared `beforeEach`), and every real-Redis file that performs topic writes calls it. Threshold and enumeration tests should use `randomUUID()` actors so they never collide.

### M3. The threshold tests as specified break the 60 s suite budget
`TIMING_FLOOR_MS` is 150. Task 5.8, driven over HTTP, comes to roughly 121 + 120 + 90 + 78 + 401 + 240 ≈ 1,050 sequential requests, about 160 s of timing floor alone, before 5.9 runs once per route and role. Task 5.8's "400 requests spread over more than 40 minutes" also needs a controlled clock.

**Required:**
- Give `enforceTopicWriteRateLimit` (and the typed Lua wrapper) an injectable `nowMs`, defaulting to `Date.now()`, so the daily test never relies on fake timers racing `applyTimingFloor`'s `setTimeout`.
- Test counting semantics (120/121, the 400/401 daily cap, shared across routes and teams, independent per actor, the 90- and 78-request fixtures) **against the limiter function and real Redis directly**, with no HTTP and no floor.
- At the route level, **pre-seed the ZSETs** (`ZADD` 119 or 399 members) and then send two requests. Use the same approach for the 5.7 "actor at 100% of both windows can still open a room" test.
- Keep HTTP-level tests to one breach per route/role combination in 5.9.

### M4. The helper signature is missing `actorGlobalRole`
`audit_log.actor_global_role` is `NOT NULL`, and the 429 path writes a row. The design's signature `enforceTopicWriteRateLimit(request, reply, { endpoint, teamId, startTime })` can get `userId` from `request.session`, but not the role. Every handler already has `authResult.actorGlobalRole`, so pass it in (`{ actorUserId, actorGlobalRole, teamId, endpoint, startTime }`). That also mirrors `TopicWriteDenialContext`, which `checkWritableTeam` and `checkCustomizationLockGate` already take. Reuse that type and add `startTime` beside it.

### M5. Frontend: the existing fetch mocks have no `headers`
`topicManagementTestUtils.tsx` `mockFetchResponse()`, `envelope()` and `unparseableResponse()` return plain objects without `headers`. If `rateLimitMessage(response, body)` calls `response.headers.get(...)` on every error, as the wording "each control's existing error path calls the helper before it falls back" suggests, it throws a TypeError. Each handler's `catch` then turns every existing 4xx test into "Network error while …".

**Required:** call the helper only when `res.status === 429` (it passes 503 through anyway), **or** read the header defensively (`res.headers?.get?.("Retry-After")`), **and** extend `mockFetchResponse` with an optional `headers` argument for the new tests. State which one you choose in task 6.1.

### M6. Task 6.4 describes a flow the UI doesn't have
`TopicManagementPage` has no batch restore. Each restore is a separate confirm dialog (`submitRestore`). On error it sets `{status:"error"}` and does **not** refetch, so "the k−1 successful restores show after the existing refetch" doesn't correspond to any code path. Reword 6.4: after k−1 sequential single restores, each of which refetched on success, a 429 on the k-th shows the server copy in that dialog's error area, and the list still shows the k−1 restored topics. Bulk restore is already a non-goal.

## Should fix

### S1. Specify the Lua contract precisely
- **Limit comparison.** TEAM-006 adds first and then tests `count > LIMIT`. The conditional script must test `count < LIMIT` *before* adding. Write this in Decision 1 so nobody "harmonises" the two scripts later and creates an off-by-one.
- **Return value.** "The oldest-entry score of the breached window" is ambiguous when both windows are breached, and task 5.3 needs the daily value then. Return `{burstCount, burstOldest, dailyCount, dailyOldest, admitted}` and let TypeScript choose the code and `Retry-After`. Keep the policy out of Lua.
- **PEXPIRE.** Refresh it on both keys only on admit. On reject, trim only.
- **Key namespace.** TEAM-006 uses `dipstick:ratelimit:team-manager:*`. Use `dipstick:ratelimit:topic-write:{<userId>}:burst|daily`. That keeps the house prefix (ops can find every limiter key with one `SCAN`) and adds a hash tag so the two-key `EVAL` stays legal if Redis is ever clustered. This costs nothing now.

### S2. A 503 doesn't guarantee "not counted"
`withTimeout` stops the caller from waiting but does not cancel the command (its own docstring says so). With the shared client's default offline queue, an `eval` issued during a brownout can run after Redis recovers and `ZADD` a request that was answered 503. That is acceptable, but the spec's counting rule ("don't count 503") should say "best effort under Redis timeout", and 5.10 should not assert window contents after a *hang*. I am **not** asking for a dedicated client with `enableOfflineQueue: false`. That would be a second connection pool for marginal gain.

### S3. Make the "after authz, before existence" placement test behavioural, not source-regex
Decision 2 cites #188's structural test as the model, but that test is **behavioural**: it enumerates routes with `onRoute` and sends real requests. Do the same here. Over-budget actor plus 403-bound role gives 403 and the windows are unchanged (proves after authz). Over-budget actor plus non-existent team gives 429 with zero `teams` queries (proves before existence). Enumerating with `onRoute` covers future topic-write routes automatically. A regex over handler source breaks on the next harmless refactor and misses calls placed inside helpers. Keep the import-graph test for the session-runtime exclusion (Decision 8). That one is genuinely structural.

### S4. Template-team audit coverage changes
Because the limiter runs before `checkWritableTeam`, an over-budget actor probing the template team gets a `topic.write_rate_limited` row, **not** `topic.write_denied_template`. That is correct for enumeration resistance, but it is a quiet change to #188's "every template write is audited as denied_template" property. Add one line to the reject-template-team spec or design, and make sure the #188 structural test runs with a fresh budget (M2).

### S5. The `rateLimitMessage` string substitution couples frontend and backend copy
Replacing "a few minutes" inside the server's message works, and 6.1 pins it in a test, but it is a string contract between two packages. The cleaner option is for the frontend to choose copy by `error.code` (`TOPIC_WRITE_BURST_LIMIT_EXCEEDED`) and add the duration, with the server message as the fallback. Not blocking. If you keep the substitution, put the burst message in `@dipstick/shared` as a constant so the "pin" is a type-level import rather than two copies of the string.

## Resolved during review (no action needed beyond editing the text)

- **Task 5.1 migration:** `audit_log.operation` is unconstrained `TEXT` (migration 8), and `team_id` is a plain `UUID` with no FK. A non-existent or template `team_id` in the 429 row inserts fine, so the "identical 429" property holds for the audit path too. No migration is needed. Change 5.1 to say so.
- **Task 2.5 byte-identity:** `buildErrorEnvelope` emits `category, code, message, correlationId` in the same key order as TEAM-006's inline 429 and 503 literals, so the byte-identical test is achievable as written.
- **`ErrorCategory`** is local to `error-envelope.ts` (not in `@dipstick/shared`), so 2.1 has no schema-drift impact on the frontend.
- **Decision 11 grep test:** besides `teams.ts` and `facilitator-sessions.ts`, `content.ts:565` also has a literal. Task 2.2 already covers it. Note that the `teams.ts` and `facilitator-sessions.ts` swaps also **add** `code: "TEAM_NOT_FOUND"` to bodies that don't have one today. Mention this in the PR callout together with the category change.
- **Decision 9 lowercase:** handlers destructure `{ teamId, topicId } = request.params`, so the change is mechanical. `topicId` doesn't need lowercasing, because it only reaches `uuid` columns.

## Hidden coupling summary

| Coupling | Where it bites | Mitigation |
|---|---|---|
| `topics.ts` → `redis.js` via the helper | Every topics unit test file | M1 |
| Durable Redis keys × fixed fixture IDs | Local integration reruns, #188 structural test | M2 |
| Timing floor × request-count tests | Suite runtime | M3 |
| Frontend copy ↔ backend copy | `rateLimitMessage` | S5 |
| Shared ioredis offline queue | 503 counting semantics | S2 |

## Tasks to add or amend

1. **New 5.4a:** mock the limiter in the existing topic unit test files (M1).
2. **New 5.4b:** add a `real-db.ts` budget-reset helper and call it from the topic-writing integration files (M2).
3. **Amend 5.2:** injectable `nowMs`; the signature carries `actorGlobalRole`; namespaced, hash-tagged keys (M3, M4, S1).
4. **Amend 4.2:** spell out the pre-add `<` comparison and the full return tuple (S1).
5. **Amend 5.6:** behavioural `onRoute` placement test (S3).
6. **Amend 5.8 and 5.7:** limiter-level tests plus ZSET pre-seeding; no 400-request HTTP loops (M3).
7. **Amend 5.1:** no migration needed.
8. **Amend 6.1 and 6.3:** guard the header read; extend `mockFetchResponse` with headers (M5).
9. **Amend 6.4:** sequential single restores (M6).
