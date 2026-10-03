## Context

GitHub #184 collects the findings deferred from the reorder-topics reviews: L1 (case-sensitive lock key), L2 (a non-UUID `teamId` returns 500), F5 (topic writes have no rate limit), F7 (thrown paths skip the timing floor), I1 (framework rejections are sent without `no-store`) and m5 (inconsistent `TEAM_NOT_FOUND`). Since then #175, #176 and #188 have landed:

- **L1 is fixed in code.** `lockTeamTopics()` uses `hashtext($1::uuid::text)` and is the only way the lock is taken. That covers four topic writes plus room open in `facilitator-sessions.ts`. What's missing is the end-to-end uppercase-path test the issue asked for.
- **L2 is fixed for `teamId`** by `rejectNonCanonicalTeamId()` (404, timing floor, no query). It is **not** fixed for `topicId` on archive and restore: `checkTopicExistsAndActive` / `checkTopicExistsAndArchived` pass the raw value into a `uuid` column, Postgres raises 22P02, and the request returns 500.
- The template guard `ctx.teamId === DEFAULT_TOPICS_TEAM_ID` is a string compare. It is safe only because the sentinel contains no hex letters.
- The only rate limiter in the codebase is TEAM-006's, inline in `teams.ts`. It is a Redis sliding window driven by a Lua script, keyed on `userId`, fails closed, and counts rejected requests. Q6 rejected `@fastify/rate-limit`.
- `ErrorCategory` has no `rate_limited` or `service_unavailable`. TEAM-006 works around that with inline literals.
- The frontend never reads response headers. Topic-write `fetch` calls are made inline in `TopicManagementPage.tsx`, and each control already has its own error region that shows `error.message`.

Stakeholders: facilitators and admins doing post-first-session tailoring (UX of a 429), security (thresholds, fail-closed, enumeration), and the ritual itself (session runtime must not be touched). The full reasoning is in `exploration-notes.md` §6 and the two explore reviews.

## Goals / Non-Goals

**Goals:**
- One per-actor budget across the five topic-write routes, sized so that legitimate tailoring, including restoring the whole baseline on two teams, never hits it.
- Close the remaining 5xx-on-malformed-id gap and make the template guard case-insensitive by construction.
- Prove L1 end-to-end with mixed-case concurrent requests.
- One `TEAM_NOT_FOUND` envelope in the backend.
- A 429 or 503 on Topic Management reads as a pause and loses nothing.

**Non-Goals:**
- Any change to `facilitator-sessions.ts` beyond the envelope swap. Specifically, no limiter, timeout or hook on room open, advance, voting or WebSocket paths.
- Any change to TEAM-006 thresholds or semantics, including its practice of counting rejected requests.
- A Fastify route-param schema for ids. Reordering malformed-`teamId` 404 to come after 403 (#175 M1 stands).
- The `invalid_request` category on `teams.ts` 401/403 responses. Follow-up issue (task 1.1).
- A bulk "Restore default topics" action. Follow-up issue (task 1.1).
- F7 (timing floor on thrown paths) and I1 (`no-store` on Fastify framework rejections). Both are informational in #184, carry no data and serve none of its acceptance criteria. Follow-up issue (task 1.1).
- A canonical-UUID boundary on `teams.ts` `GET /:teamId` and `/members`. Not a topic route. Follow-up issue (task 1.1).
- An 80% early-warning event. Follow-up issue (task 1.1); every breach episode is already audited.
- A separate co-signed threshold decision record. The values are pinned in the spec, and security co-signed them in the Stage 3 design security review (`design-review-security.md`, R1–R7).
- Disabling buttons with a live countdown. Not needed while rejected requests aren't counted (see Decision 4); security confirmed it is not required once C1 is in place.
- New alerting infrastructure. Breach-episode audit rows are **available for investigation**; nothing queries them yet, so they detect nothing on their own. Topic-write breaches are to be included when TEAM-006's Finding 2.3 monitoring work lands (follow-up issue, task 1.1).
- Throttling authorization itself. A 403-bound caller still runs `evaluateStandingFacilitatorAccess` (one DB query) on every request, as on every authenticated route. The limiter protects topic **writes**, not the database as a whole.
- A global (cross-actor) topic-write limit.
- Auditing 403 denials on topic endpoints, bidi/zero-width checks on topic text, and URL-encoding `teamId` in Topic Management fetch paths (raised in the #184 follow-up comment; none is an acceptance criterion). Follow-up issues (task 1.1).

## Decisions

### 1. Extract the sliding-window mechanism; add a separate conditional script for topic writes
`SLIDING_WINDOW_LUA`, `recordAndCountSlidingWindow` and `retryAfterSeconds` move from `teams.ts` to `src/auth/sliding-window-limiter.ts` unchanged. A second Lua script, `CONDITIONAL_DUAL_WINDOW_LUA`, lives next to them. In one `EVAL` it trims both windows (burst and daily), counts both, and `ZADD`s the request to both **only if both are under their limit**.

The Lua contract is fixed here so nobody "harmonises" the two scripts later:
- **Comparison.** The conditional script admits when `burstCount < burstLimit AND dailyCount < dailyLimit`, tested **before** the add. TEAM-006's script adds first and then tests `count > LIMIT`. The two are deliberately different; aligning them would create an off-by-one.
- **Return tuple.** `{ admitted, burstCount, burstOldestMs, dailyCount, dailyOldestMs, burstEpisodeNew, dailyEpisodeNew, burstSuppressed, dailySuppressed }`. The script returns **mechanism only**: it never chooses a code, message or `Retry-After`. TypeScript does that (Decision 7a).
- **Expiry.** On admit, both window keys get `PEXPIRE` = window length. On reject, the script trims only and does not refresh the window TTLs.
- **Breach-episode markers (security C1).** On reject, for each window that is at its limit, the script runs `SET <marker> 1 NX PX <oldest + windowMs − now>`. If the `SET` succeeds, that window's `…EpisodeNew` flag is 1. If the marker already exists, the script runs `INCR` on it, which keeps its TTL, and returns the value as `…Suppressed`. The marker expires exactly when that window next has room, which ends the episode.
- **Episode end is also explicit (as implemented; architect implementation review S1).** On every call, before the admit test, the script `DEL`s the marker of each window whose trimmed count is below its limit. The TTL normally removes the marker at that same moment; the `DEL` keeps "the episode ends when the window has room" exact when app-server clock skew leaves a marker TTL longer than the real gap. C1 still holds: a rejected request adds nothing, so a window can only regain room through time passing, and a new episode can only open after that window has had room (bounded by admitted requests, as before). The marker TTL is computed from an integer `nowMs` (the wrapper floors it), since `PX` rejects a fractional value.
- **Clock.** `now` is passed in from the app server (`nowMs`, injectable, default `Date.now()`), as TEAM-006 does. With several backend instances, clock skew blurs the window edges by the skew. That is acceptable at these thresholds (security F-c).
- *Alternative:* reuse TEAM-006's script (`ZADD` first, then count). Rejected because a facilitator who clicks again on a 429 would push their own wait further out. That is the "the tool is broken" spiral (Decision 4).
- *Alternative:* `@fastify/rate-limit`. Rejected as in Q6: it adds a new dependency, it runs as a plugin hook *before* authz, and it is not on-prem-minimal.
- Keys (engineer S1, security F-b): `dipstick:ratelimit:topic-write:{<userId>}:burst`, `…:daily`, `…:breach-audited:burst` and `…:breach-audited:daily`. They keep the house `dipstick:ratelimit:` prefix, so ops can find every limiter key with one `SCAN`. They differ from TEAM-006's `dipstick:ratelimit:team-manager:` keys, so the two budgets cannot collide. The `{<userId>}` hash tag puts all four keys in one slot, so the multi-key `EVAL` stays legal if Redis is ever clustered.

### 2. Per-handler helper called right after authorization, not a plugin `preHandler`
`enforceTopicWriteRateLimit(request, reply, ctx, startTime, nowMs = Date.now())` is called in each of the five handlers immediately after the identity/role check. `ctx` is the existing `TopicWriteDenialContext` (`actorUserId`, `actorGlobalRole`, `teamId`, `endpoint`, `attemptedOperation`), which `checkWritableTeam` and `checkCustomizationLockGate` already take. `actorGlobalRole` is required because `audit_log.actor_global_role` is `NOT NULL` and the session doesn't carry it; every handler already has it in `authResult` (engineer M4). The helper returns `"allowed"` or sends the 429/503 itself (with the audit row when one is due, timing floor and `no-store`). A plugin-level `preHandler` would run before authz. A 403-bound caller would then burn budget and could see a 429 instead of the 403, which breaks the documented cascade. The cost is five explicit call sites.

Placement is proven **behaviourally**, as #188's template-guard test does, not with a regex over handler source (engineer S3). The test enumerates topic-write routes with `onRoute`, so a future route is covered automatically. For each route, (a) an over-budget actor with a 403-bound role gets 403 and the windows are unchanged, which proves the call comes after authz; and (b) an over-budget authorized actor on a non-existent team gets 429 with zero `teams` queries, which proves it comes before existence. The session-runtime exclusion (Decision 8) stays an import-graph test, because that property really is structural.

### 3. Cascade position: after 403, before any team lookup
The order is: non-canonical `teamId` 404 → authz 403 → **limiter 503/429** → existence and template 404 → lock 409 → body/topic 404/422. The limiter makes no DB query and its answer depends only on the actor's own history, so the 429 is identical for an existing, a non-existent and the template team. It cannot be used to tell whether a team exists. This was verified: `evaluateStandingFacilitatorAccess` `LEFT JOIN`s membership, so both `facilitator` and `application_admin` pass authz on a non-existent UUID, which means the identical-429 test can be written for both roles.

### 4. Counting rule: count authorized requests; don't count 429/503
Counted: everything that passes authz and isn't limited, including the archive pre-flight and requests that later fail with 404/409/422. This deliberately departs from TEAM-006. TEAM-006 is an admin-only route with a far lower legitimate volume, while topic writes sit inside a facilitator's tailoring flow. **Security co-signed this (R5) on condition C1**: because uncounted 429s are otherwise unbounded, the durable audit writes they trigger are bounded per breach episode (Decision 7). With C1 in place, the frontend does not need to disable controls until `Retry-After`.

"Not counted" for a 503 is best effort (security C3, engineer S2). A 503 caused by a Redis **error** is not counted. A 503 caused by the 500 ms **timeout** may still be recorded: `withTimeout` stops the caller waiting but doesn't cancel the command, and the shared ioredis client's offline queue can run the `EVAL` after Redis recovers. That fails safe (over-count, never under-count). We are not adding a dedicated client with `enableOfflineQueue: false`; a second connection pool isn't worth this marginal gain.

### 5. Thresholds: 120 per 10 minutes and 400 per 24 hours, per actor, no global limit
Sizing (12 defaults): the exact tailoring-plus-pre-session fixture is 78 requests, a two-team baseline restore in one sitting is 90, and a three-team day is about 190. The ritual floor is burst ≥ 100 (the 90-request two-team sitting plus about 10% margin) and daily ≥ 200. The values are written into the spec and defined once in `TOPIC_WRITE_LIMITS`, whose comment cites use case 08 and `Feature Sets.md` §8, so nobody can tighten the numbers without seeing what they protect. No global limit: a global bucket on a facilitator-wide route would let one actor lock out every other facilitator, which is a worse failure than the one it prevents. The per-actor daily cap bounds what a single compromised credential can do: about 400 destructive writes a day. Not all of that is recoverable (security C4). Archive, add and reorder can be undone through restore, archive and reorder. **Annotation and definition overwrites (TOPIC-007) cannot be undone**: the audit row deliberately leaves out the text (`{ topic_id, action, length }`), so wiping annotations across about 30 teams a day can only be recovered from a database restore. The limiter only bounds that damage. The primary controls against a stolen credential are authorization, the audit trail and session revocation. Nobody should loosen these limits on the belief that "restore can recover it".

### 6. Fail closed on Redis error or after a 500 ms timeout
Every authenticated route already needs Redis for the session, so failing closed adds no new fragility. `redis.ts` sets no `commandTimeout`, so the `eval` call is wrapped in `withTimeout(…, 500)` (from `auth/audit-write-timeout.ts`) to keep a hung Redis from stalling the request. The 503 says the change wasn't saved, earlier changes are kept, and to try again shortly. This is acceptable only because the limiter is never on the session path (Decision 8). The new fail-closed dependency on the shared Redis is recorded in `docs/deployment.md` (task 7.4) as well as the PR description, because the PR description stops being read once the PR merges.

### 7. One durable 429 audit row per breach episode, written synchronously before the response
This departs from TEAM-006's one row per 429 (security C1). TEAM-006 can afford a row per 429 because it is admin-only and counts its rejections. Here 429s are uncounted (Decision 4), so a row per 429 would let an over-budget actor, or a script holding their cookie, trigger unlimited `audit_log` INSERTs: about 8.6 M rows a day at 100 req/s. That would load the shared Postgres and bury the forensic signal in its own noise.

- **Episode.** An episode on a window starts with the first 429 that finds that window at its limit and no breach marker. It ends when the marker expires, which is exactly when that window next has room (Decision 1).
- **First 429 of an episode** (`burstEpisodeNew` or `dailyEpisodeNew` is 1): write **one** durable `audit_log` row (`topic.write_rate_limited`) before `reply.send`. Its metadata is `{ limit, windows, observedCount, endpoint, team_verified: false }`. `windows` lists the windows whose episode just started. `team_verified: false` marks `team_id` as the lowercase, caller-supplied path value that was never checked against `teams` (there is no FK), so a forensic query on `team_id` doesn't read it as activity on a real team (security F-a). Also emit the structured event `topic.write_rate_limit_exceeded`.
- **Later 429s in the same episode:** no DB write. Only `topic.write_rate_limit_exceeded` is emitted (to logs), carrying `suppressedCount` from the marker counter.
- **Bound.** A new episode on a window can only start after that window has had room again. The first request to find it with room is admitted and counted. So rows per actor are bounded by admitted requests, at most about 2 × 401 a day, whatever the request rate.
- **Fail-open audit path, unchanged.** The row goes through the existing path, bounded by `AUDIT_WRITE_TIMEOUT_MS` (500 ms). If it fails or times out, the request still answers 429 and `auth.audit_write_failed` is emitted. That episode then has no row; the marker is not rolled back, and `auth.audit_write_failed` is the record. A failing audit must never turn a 429 into a 500. The 503 path emits `topic.write_rate_limit_check_failed` and writes nothing to the DB.

### 7a. Which window the 429 reports
The window with the **longer wait** wins (security C2). `Retry-After = max(burstWait, dailyWait)` over the windows that are at their limit, rounded up to whole seconds, minimum 1. The `error.code` and message come from the window that produced that maximum, and daily wins a tie. The original rule ("both full gives daily, and `Retry-After` > 600") was wrong in general. Counterexample: 280 requests 23 h 59 min ago and 120 now. Both windows are full, the daily wait is about 60 s and the burst wait is about 600 s. A client that waited 60 s would get a second 429. TypeScript makes this choice from the Lua return tuple. Lua stays policy-free.

The daily copy ("You can continue tomorrow") is still conservative when a daily-dominant wait happens to be short, for example when the oldest daily entry is about to expire and the burst window isn't full. That errs toward waiting longer, never toward a second 429. It was the proposal's answer to BA R6, so I'm leaving it as is (see disposition).

### 8. Session-runtime exclusion enforced in CI
A structural test asserts that the topic-write limiter helper module (`routes/topic-write-rate-limit.ts`) is imported only by `routes/topics.ts` and tests, and that `sliding-window-limiter.ts` is imported only by that helper, `routes/teams.ts` and tests. Neither may appear in `facilitator-sessions.ts` or any session, voting or WebSocket module. A behavioural real-Redis test takes an actor to 100% of both windows by **pre-seeding the ZSETs** (not by sending 400 requests), and then opens a room and advances a session. A reviewer checkbox is not enough for the property I care about most. An import-graph test can't see re-exports or dynamic `import()`, and the behavioural test can't see a path it doesn't drive. Together they are enough. Neither may be dropped as redundant (security F-e).

### 9. Lowercase `teamId` at entry
`const teamId = request.params.teamId.toLowerCase()` runs right after `rejectNonCanonicalTeamId`, in all five handlers. The lock was already canonical. This change makes audit, logs, limiter metadata and the template compare canonical as well. A unit test swaps the sentinel for a hex-letter ID to prove the template guard holds for every spelling. A second assertion pins `DEFAULT_TOPICS_TEAM_ID` itself as lowercase canonical (it is `00000000-0000-0000-0000-000000000001` today), because the lowercase compare is only case-insensitive if the constant is lowercase too (security F-d).

Because the limiter runs before `checkWritableTeam`, an over-budget actor who probes the template team gets a breach-episode `topic.write_rate_limited` row (or no row, later in the episode), **not** `topic.write_denied_template` (engineer S4). This is a deliberate, narrow change to #188's property that every template write is audited as `denied_template`. That property now holds for every **in-budget** template write. The per-route cascade spec deltas already say that no `topic.write_denied_template` row is written for an over-budget actor. Enumeration resistance requires it.

### 10. `topicId` guard inside `checkTopicExists*`
`isCanonicalUuid(topicId)` moves into both helpers and answers 404 `TOPIC_NOT_FOUND` with no query. This fixes archive and restore in one place. Annotation's inline check becomes redundant and is removed. The guard stays at the topic-existence step, so it does not reorder the cascade.

### 11. One `teamNotFoundEnvelope()` in `error-envelope.ts`
This enforces m5 by construction: a grep test fails on any `"Team not found."` literal outside that file. On `teams.ts` this is an envelope swap only: the category change from `invalid_request` to `not_found` is an intentional API change, flagged in the PR and kept in its own commit. Task 1.2 confirms that no frontend code branches on the old category; if something does, that branch is updated in the same commit. The swap is not deferrable, because #184's AC4 requires every team-not-found 404 to be consistent; it is the last code commit (task 2.4) so it can be reverted alone. The `teams.ts` GET routes keep their current check order, and their canonical-UUID boundary is deferred. On the topic read side, `GET /teams/:teamId/topics` gains the same boundary `/topics/all` already has, because #184's acceptance criterion covers any topic route.

### 12. Frontend: reuse each control's error region; read `Retry-After`
The burst and daily messages live once, in `@dipstick/shared`, as `TOPIC_WRITE_RATE_LIMIT_MESSAGES`, and the backend imports them from there (engineer S5). The frontend selects copy by `error.code`, not by matching strings in the server message. A small helper, `rateLimitMessage(response, body)`, does this: for `TOPIC_WRITE_BURST_LIMIT_EXCEEDED` with a parseable `Retry-After`, it renders the shared burst message with "a few minutes" replaced by "about N minute(s)". Otherwise it returns the server's `error.message`. The copy contract between frontend and backend is now a type-level import, not two copies of a string pinned by a test.

The helper is called **only when `res.status === 429`** (engineer M5). A 503's message is passed through as is, so there's nothing for the helper to do. As well, it reads the header defensively (`res.headers?.get?.("Retry-After")`), because the existing test doubles in `topicManagementTestUtils.tsx` have no `headers`. `mockFetchResponse` gains an optional `headers` argument for the new tests. Without these guards, every existing 4xx component test would throw inside the handler, and the `catch` would turn it into "Network error while …". This adds no new chrome and no auto-retry. The existing state handling already keeps drafts, with one exception: the archive confirm call currently drops the escalated `awaiting_open_items_confirmation` state on any error, so that state gains an `error` field (task 6.5). Component tests lock all of this in for 429 and 503.

### 13. Test harness: mock the limiter in unit tests, isolate real-Redis budgets, test counting at the limiter level
The design has to meet the existing test harness, not only the production code (engineer M1–M3):
- **Unit tests mock the limiter.** `topics.test.ts`, `topic-annotation.test.ts` and `topic-add-flag-parity.test.ts` mock `db.js` and `config.js` (`REDIS_URL: "redis://test"`) but not `redis.js`. Once `topics.ts` imports the helper, they would build a real ioredis client against `redis://test`. Every write would then answer 503 after the 500 ms timeout, and reconnect timers would leak into the workers. Each of these files mocks `../topic-write-rate-limit.js` to return `"allowed"`, as `teams.test.ts` mocks `../../redis.js` for TEAM-006. The mock lives in one shared setup helper. As a guard, a structural test fails if any unit test file (one that isn't real-Redis) imports `topics.ts` without that helper.
- **Real-Redis tests isolate budgets.** Integration fixtures use fixed actor IDs, and `docker compose` Redis keeps daily keys for 24 h. Local reruns would build up budget until unrelated tests, the #188 template-guard structural test first among them, see 429s. `helpers/real-db.ts` gains `resetTopicWriteBudget(userId)`, which deletes all four of the actor's keys. Every real-Redis file that does topic writes calls it in `beforeEach`. Threshold and enumeration tests use `randomUUID()` actors. CI's `integration.yml` already runs `redis:7-alpine` and `probeInfra()` already probes Redis, so these tests use the existing `describe.skipIf(!infraUp)` and `requireInfraOrThrow` pattern.
- **Counting is tested at the limiter, not over HTTP.** With `TIMING_FLOOR_MS = 150`, the HTTP fixtures add up to about 1,050 sequential requests, roughly 160 s of floor alone, which breaks the 60 s suite budget. Counting semantics (120/121, 400/401, shared across routes and teams, independent per actor, the 90- and 78-request fixtures, both C2 fixtures, the C1 episode bound) are tested against the limiter function and real Redis directly, with an injected `nowMs`. That way no fake timer races `applyTimingFloor`'s `setTimeout`. Route-level tests pre-seed the ZSETs (`ZADD` 119 or 399 members) and then send two requests. HTTP tests are limited to one breach per route/role combination (5.9) plus the placement test (Decision 2).
- **No assertion on window contents after a hang** (C3). The hang test asserts the 503 and unchanged topic rows only.

## Security-sensitive tasks

These tasks need security review (Tomás or delegate) of the diff, not just the outcome. They are marked `[SEC]` in tasks.md.

| Task | Why it is security-sensitive |
|---|---|
| 2.4 `teams.ts` envelope swap | Changes 404 bodies on authz-adjacent routes. Must not change check order. |
| 2.5 TEAM-006 envelope swap | Touches a reviewed limiter's responses. Bodies must stay byte-identical. |
| 3.1–3.3 Lowercase `teamId` / template guard | Protects the template team, and therefore every new team's defaults, from case-variant bypass. |
| 3.4–3.5 `topicId` guard | Removes a 500 and must not move the 404 earlier in the cascade. |
| 3.6–3.8 Mixed-case lock serialization, including room open | Proves the last-active-topic invariant under concurrency. |
| 3.9 Topic read-route `teamId` boundary | Removes a 500 and must answer before any query. |
| 4.1–4.3 Limiter extraction and conditional Lua script, including breach-episode markers | Atomicity and correctness of the counting rule and the C1 audit bound. Must not change TEAM-006 behaviour. |
| 5.2–5.5 Limiter helper, 429/503 paths, handler wiring | Fail-closed behaviour, timeout bound, episode-bounded audit-before-respond, `Retry-After` selection, timing floor and cascade placement. |
| 5.6–5.7 Behavioural placement and session-runtime exclusion | Enforces the anti-enumeration placement and the session-runtime constraint. |
| 5.9 Identical-429 / 403-never-429 tests | The enumeration-resistance acceptance tests. |

Tasks that are not security-sensitive: 1.x (follow-up issues and a grep), 2.1–2.3 and 2.6 (type widening, mechanical envelope swaps and a grep test), 5.1 (event names), 5.4a–5.4b (test harness), 5.8, 5.10 and 5.11 (threshold and independence tests; reviewed with the limiter but low-risk on their own), 6.x (frontend copy and state), 7.x.

The thresholds, the no-global-limit choice and the counting-rule departure from TEAM-006 were co-signed by security in the Stage 3 design security review (R1–R7). R5 is conditional on C1, which Decisions 1 and 7 satisfy.

## Risks / Trade-offs

- [The limiter call times out (503) but Redis runs the queued `EVAL` later, finds the window full and opens a breach episode, so that whole episode (up to 10 min burst / 24 h daily) has no `topic.write_rate_limited` row] → Accepted (security implementation review S1), same class as "marker set but audit write fails". The 503 emits `topic.write_rate_limit_check_failed` with `failureMode: "timeout"`, and every later 429 in the episode emits `topic.write_rate_limit_exceeded` with `episodeStarted: false` and the suppressed count, so the trail is degraded, not lost. Needs Redis latency above 500 ms at the moment the actor goes over budget.
- [The first 429 of an episode is slower than later ones (it includes the synchronous audit INSERT)] → Accepted (security implementation review N3). The difference depends only on the actor's own history, never on the team, so it reveals nothing about team existence. Do not pad it away.
- [The thresholds are too tight for a real facilitator] → The ritual floor in the spec (≥ 100 / ≥ 200), the 90-request baseline-restore and 78-request tailoring fixtures, and a durable audit row for every breach episode. A confirmed legitimate hit is treated as a threshold bug.
- [The thresholds are too loose to stop abuse] → The per-actor daily cap bounds a compromised credential to about 400 destructive writes a day. Archive, add and reorder are recoverable through the UI. **Annotation and definition overwrites are not**; they need a DB restore (Decision 5). Security can lower the values in one constant, as long as they stay above the floor. The primary controls are authorization, the audit trail and session revocation.
- [The limiter accidentally lands on session runtime, for example via a future refactor to a plugin hook] → The structural import test and the behavioural room-open test in CI (Decision 8).
- [Redis latency makes topic writes fail closed during a Redis brownout] → The 500 ms bound and a 503 that tells the facilitator to try again shortly. Session runtime is unaffected. Ops: the new fail-closed dependency is in the PR description and, durably, in `docs/deployment.md` (task 7.4).
- [Not counting 429s lets an attacker probe the limit cheaply, or flood `audit_log`] → Probing reveals only the actor's own budget. Durable audit rows are bounded per breach episode (Decision 7); later 429s are logged with a suppressed count.
- [A 503 on timeout is later counted] → Accepted; it fails safe (over-count). The spec says "best effort" (Decision 4).
- [The breach marker is set but the audit row write fails] → That episode has no row; `auth.audit_write_failed` is the record. Same fail-open trade-off as every other audit row on this path.
- [API consumers rely on `invalid_request` for `teams.ts` 404s] → The frontend grep (task 1.2), the PR callout, its own revertible commit and the updated `teams.test.ts` assertions. The PR callout also notes that the `teams.ts` and `facilitator-sessions.ts` swaps **add** `code: "TEAM_NOT_FOUND"` to bodies that have no code today.
- [The TEAM-006 extraction subtly changes behaviour] → Its script is moved byte-for-byte, its tests pass with edits to import paths only, and a test proves the two budgets are independent.
- [Local integration reruns go flaky from durable budgets] → `resetTopicWriteBudget` and `randomUUID()` actors (Decision 13).

## Migration Plan

- No schema migration. Verified: `audit_log.operation` is unconstrained `TEXT` and `team_id` is a plain `UUID` with no FK (`migrations/8_audit_log.sql`), so a 429 row with a non-existent or template `team_id` inserts fine.
- Deploy the backend and frontend together. A frontend without 429 handling still shows the server's plain-language `error.message`, so either order of deploy degrades gracefully.
- Rollback: revert the change. Keys under `dipstick:ratelimit:topic-write:` expire on their own (window keys: TTL = window length; breach markers: TTL = time until the window has room).

## Open Questions

None open. Both earlier questions (threshold and fail-closed sign-off; not counting 429s) were settled in the Stage 3 design security review. See the disposition below.

## Design review disposition

Reviews: `design-review-engineer.md` (Marcus Oyelaran, approve with required changes) and `design-review-security.md` (Tomás Ferreira, approve with conditions). I checked each claim against the code on this branch before acting on it. All the claims I checked held.

### Security co-sign conditions

| Item | Disposition | Where |
|---|---|---|
| R1–R4, R6, R7 | Co-signed as written. No change. | — |
| R5 (uncounted 429s) | Co-signed on C1. C1 satisfied, so R5 stands. | Decision 4 |
| **C1** Bound durable 429 audit writes | **Satisfied.** One row per actor per window per breach episode. The `SET NX PX` marker is set in the same `EVAL`. Later 429s are logged with a suppressed count. Rows per actor are bounded by admitted requests. The spec scenario is reworded, and there's a test that 50 over-budget requests give one row. | Decisions 1, 7; spec; tasks 4.2, 4.3, 5.3, 5.8 |
| **C2** `Retry-After` when both windows are breached | **Satisfied.** `max(burst, daily)`; code and message come from the longer wait; ties go to daily. The spec has two fixtures, one where daily dominates and one where burst dominates. | Decision 7a; spec; tasks 5.3, 5.8 |
| **C3** A timed-out call may still be counted | **Satisfied** by rewording the spec (the reviewer's preferred option). No dedicated client. | Decision 4; spec; task 5.10 |
| **C4** The blast-radius statement overstates recoverability | **Satisfied.** Decision 5 and Risks now say annotation and definition overwrites need a DB restore. | Decision 5; Risks |

**No security condition needs human escalation.** One residual note, not a condition: the daily message "You can continue tomorrow" is conservative when the daily wait is short. I kept it because it errs toward waiting longer, and it was the proposal's resolution of BA R6. If product wants exact wording, that is a copy change to one shared constant.

### Security findings and implicit decisions

| Item | Disposition |
|---|---|
| F-a `team_verified: false` in 429 metadata | Accepted (Decision 7, spec). |
| F-b Key namespace and hash tag | Accepted (Decision 1, task 5.2). |
| F-c Clock source | Recorded (Decision 1). |
| F-d Assert the sentinel constant is lowercase | Accepted (Decision 9, task 3.2). |
| F-e Keep both structural and behavioural session tests | Accepted (Decision 8). |
| Implicit 1: nobody consumes 429 rows | Non-Goals now say "available for investigation". Linked to Finding 2.3 through a follow-up issue. |
| Implicit 2: authorization is unthrottled | Stated as a Non-Goal. |
| Implicit 3: Ops learn of the fail-closed dependency only through the PR | Accepted. `docs/deployment.md` line added (task 7.4). |

### Engineer review

| Item | Disposition |
|---|---|
| **M1** Unit tests would 503 | Accepted. Shared limiter mock plus a guard test (Decision 13, task 5.4a). |
| **M2** Durable keys × fixed fixture IDs | Accepted. `resetTopicWriteBudget` and `randomUUID()` actors (Decision 13, task 5.4b). |
| **M3** Suite budget | Accepted. Injectable `nowMs`, limiter-level counting tests, ZSET pre-seeding, one HTTP breach per route/role (Decision 13, tasks 5.2, 5.7, 5.8). |
| **M4** `actorGlobalRole` missing from the signature | Accepted. The helper takes `TopicWriteDenialContext` plus `startTime` (Decision 2, task 5.2). |
| **M5** Fetch mocks have no `headers` | Accepted, both options: call the helper only on 429 and read the header defensively; `mockFetchResponse` gains `headers` (Decision 12, tasks 6.1, 6.3). |
| **M6** Task 6.4 describes a non-existent flow | Accepted. 6.4 and the screen spec scenario now describe sequential single restores (tasks 6.4; `topic-management-screen` spec). |
| S1 Lua contract | Accepted in full (Decision 1, task 4.2). |
| S2 A 503 isn't guaranteed uncounted | Accepted. Same fix as C3. |
| S3 Behavioural placement test | Accepted (Decision 2, task 5.6, spec). |
| S4 Template-team audit coverage | Accepted. Stated in Decision 9. The per-route cascade spec deltas already state that no `denied_template` row is written over budget. #188's structural test runs with a fresh budget (M2). |
| S5 Frontend/backend copy coupling | Accepted, the cleaner option: messages move to `@dipstick/shared`, and the frontend chooses by `error.code` (Decision 12, task 6.1, spec). |
| Resolved items (5.1 needs no migration, byte identity, `ErrorCategory` is local, `content.ts` literal, lowercase is mechanical) | Text updated (Migration Plan, Risks, task 5.1). |

### Proposed follow-up issues (task 1.1; to be filed before merge, not filed by this review)

1. "Bulk 'Restore default topics' action on Topic Management" (milestone priority, per the executive review)
2. "Apply timing floor to thrown 500 paths on topic writes (F7)"
3. "Send `Cache-Control: no-store` on Fastify 400/415 framework rejections (I1)"
4. "Canonical-UUID boundary for `GET /api/v1/teams/:teamId` and `/members` (authenticated 500 on malformed id)" (its own issue, at the security reviewer's request)
5. "Use a consistent error category for `teams.ts` 401/403 responses (currently `invalid_request`)"
6. "80% early-warning event for the topic-write rate limiter"
7. "Include `topic.write_rate_limited` breach episodes in TEAM-006 Finding 2.3 monitoring and alerting"
8. "Audit 403 denials on topic endpoints (e.g. repeated `FACILITATOR_IS_TEAM_MEMBER`)" (from the #184 follow-up comment; tasks review BA §4)
9. "Reject bidi and zero-width characters in topic name and prompt" (from the #184 follow-up comment; #195 covers team definitions only)
10. "`encodeURIComponent` the `teamId` in `TopicManagementPage.tsx` fetch paths" (from the #184 follow-up comment)
11. "Canonicalize `topicId` (lowercase) after the canonical check on TOPIC-004/005/007, so audit metadata `topic_id` and responses use one spelling" (security implementation review S2)
