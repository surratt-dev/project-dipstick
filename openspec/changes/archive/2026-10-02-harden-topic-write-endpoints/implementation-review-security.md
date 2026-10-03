# Implementation Security Review: harden-topic-write-endpoints (#184)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** `git diff main..HEAD` on `agent-team/184-harden-topic-write-endpoints`. I read these in full: `auth/sliding-window-limiter.ts`, `routes/topic-write-rate-limit.ts`, `routes/topic-write-context.ts`, and the diffs of `routes/topics.ts`, `routes/teams.ts`, `routes/content.ts`, `routes/facilitator-sessions.ts`, `routes/error-envelope.ts` and `auth/audit-logger.ts`. I also read the unchanged helpers they depend on (`auth/fail-open-audit-write.ts`, `auth/audit-write-timeout.ts`, `routes/uuid.ts`, `redis.ts`) and the placement, threshold, Redis-failure and structural tests. I checked all of it against design.md ("Security-sensitive tasks"), tasks.md and my design co-sign conditions C1–C4.
**Verdict:** **Approve.** No must-fix findings. There are two should-fix items, both Low, and three nits. The co-signed design is implemented as I signed it.

---

## Verification of the requested properties

| # | Property | Result | Evidence |
|---|---|---|---|
| V1 | The limiter runs after authorization and before the team lookup, so a 429 can't be used to tell whether a team exists | **Pass** | In all five handlers the order is: `rejectNonCanonicalTeamId`, then lowercase, then the authz helper, then `enforceTopicWriteRateLimit`, then `checkWritableTeam`. The admission path makes no DB query; the only DB write is the breach audit INSERT, which never reads `teams`. A placement test enumerates every route and spies on `db.query` for `FROM teams` (placement test lines 78–124). The identical-429 test covers existing, missing and template teams for both roles, and 403 is never 429. The 403 that comes before the limiter (`FACILITATOR_IS_TEAM_MEMBER`) was already there and can't be used to tell whether a team exists. |
| V2 | Per-actor keying on the provider-independent `userId` | **Pass** | `topicWriteRateLimitKeys(session.userId)` is the internal `users.id`. There is no IdP claim or IP in the key, so this is safe with multiple IdPs. The keys are `dipstick:ratelimit:topic-write:{<userId>}:…`, with a hash tag so all four keys share one slot (F-b). |
| V3 | Lua atomicity | **Pass** | One `EVAL` covers trim, count, admission, `ZADD` to both windows, and marker `SET NX PX`/`INCR`. There is no read-then-write between round trips. |
| V4 | Rejected requests aren't counted | **Pass** | `burstCount < burstLimit AND dailyCount < dailyLimit` is tested **before** the `ZADD`. A reject adds nothing and does not refresh the window TTLs. A test checks this at the script level and at the route level. A 503 from a Redis error isn't counted (test asserts the windows are `[1, 1]`). A 503 from a timeout may be counted later, as C3 accepted. |
| V5 | C1: one audit row per breach episode | **Pass** | The marker is `SET NX PX <oldest+window−now>` in the same script. Later 429s `INCR` the marker (the TTL is kept) and report a suppressed count. The marker is `DEL`eted when the window has room, so the episode ends exactly then. Tests: 50 over-budget requests open one episode with suppressed count 49, and a route-level test shows one row per episode and a second row after a new episode. The row goes through `writeFailOpenAuditRow` before the response, and a failed or timed-out write still gives a 429, never a 5xx. Over-budget actors can't flood `audit_log`: the number of rows is bounded by the number of admitted requests. |
| V6 | C2: `Retry-After` is the larger of the two waits | **Pass** | `classifyTopicWriteBreach` computes a wait only for windows at their limit and picks daily when `dailyWait >= burstWait`. Both of my fixtures are tested (daily wait longer, burst wait longer), plus a tie. Because only admitted requests are recorded, "oldest entry + window" is exactly when the window next has room. |
| V7 | Fail closed on Redis error or timeout | **Pass** | `withTimeout(…, 500)` wraps the whole check. Any rejection gives `503 TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE` with `Retry-After: 30`, `no-store` and the timing floor. There is no DB write on this path and the raw Redis error isn't logged. `withTimeout` attaches a `.catch` to the losing promise, so there are no unhandled rejections. The test covers both modes (throws and hangs) on all five routes, with timing bounds and no rows written. |
| V8 | Identifier canonicalization | **Pass** | `teamId` must match the canonical UUID pattern (either case) and is then lowercased before any query in all five handlers. A non-UUID `topicId` gets 404 inside `checkTopicExistsAndActive` and `checkTopicExistsAndArchived` before the `SELECT`, at the same point in the cascade as before. Reorder body entries were already validated and lowercased. `content.ts` `GET /teams/:teamId/topics` now gives 404 before `evaluateTeamAccess` (it used to give a 22P02 500). The template guard test uses a hex-letter sentinel and checks that the constant is lowercase (F-d). |
| V9 | The `TEAM_NOT_FOUND` envelope leaks nothing new | **Pass** | `teamNotFoundEnvelope()` returns a fixed category, code and message plus a random `correlationId`. In `teams.ts` and `facilitator-sessions.ts` only the body changes. The status, the check order and when the 404 is reached are unchanged. The TEAM-006 429 and 503 bodies keep the same fields; only the shared builder changed. A structural test pins the message literal to one file. |
| V10 | Audit rows carry the required fields | **Pass** | `actor_user_id`, `actor_global_role` (from the authz result), `actor_ip`, `operation`, `team_id` (lowercase, unverified) and metadata `{limit, windows, observedCount, endpoint, team_verified:false}`, matching the spec. The route test checks the full row shape and that an UPPERCASE path gives a lowercase `team_id`. |
| V11 | No new error path skips the timing floor where it used to apply | **Pass** | The 429 and 503 apply the floor. The new `topicId` 404s and the new `content.ts` 404 apply it. The annotation route's `topicId` 404 moved into the helper, which still applies the floor. The `teams.ts` and `facilitator-sessions.ts` 404s had no floor before and still have none, which is unchanged and out of scope. Thrown 500 paths are still exempt (F7, deferred). |
| V12 | Limiter stays out of session runtime | **Pass** | A structural allow-list covers both modules, and the room-open, start and begin-voting test passes with both windows at 100%. |

---

## Findings

### Must-fix

None.

### Should-fix

**S1 (Low): if the limiter call times out but Redis later runs the `EVAL` and rejects, the breach episode can be left without an audit row.**
On the 503 timeout path the `EVAL` isn't cancelled (C3). If the queued script runs later and finds the window full, it does `SET NX` on the breach marker and opens an episode, but the request has already returned 503 and writes no row. Every later 429 in that episode finds the marker, `INCR`s it and writes no row. The result is a whole episode, up to 10 min (burst) or 24 h (daily), with no durable `topic.write_rate_limited` row. The structured `topic.write_rate_limit_exceeded` events still carry `episodeStarted:false` and the suppressed count, so the trail is degraded, not lost. Exploiting this needs Redis latency above 500 ms at the moment the actor goes over budget, and an attacker can't easily cause that. This is in the same class as the accepted risk "marker set but audit write fails". **Required:** add one line to design.md Risks recording this variant as accepted. A code fix is optional. One option: the 503 timeout path emits `topic.write_rate_limit_check_failed` with `failureMode: "timeout"`, which already exists and is enough to correlate. No code change is required.

**S2 (Low, pre-existing, follow-up): `topicId` is not lowercased, so audit metadata and responses repeat the caller's spelling.**
`teamId` is now canonical everywhere (Decision 9). `topicId` from the path is not lowercased. It goes unchanged into `topic.archived` (`topics.ts:1207`), `topic.restored` (`:1377`) and `topic.annotation_updated` (`:1818`) metadata as `topic_id`, and into the annotation response body. The `topics` row is still found correctly because Postgres compares `uuid` values case-insensitively. But a forensic query on `metadata->>'topic_id' = '<lowercase>'` won't find a write made on an UPPERCASE path. This is the same gap Decision 9 closed for `team_id`, now on the JSONB side. It isn't a regression and it isn't in #184's acceptance criteria. **Required:** add it to the 1.1 follow-up list as an 11th item ("lowercase `topicId` after the canonical check on TOPIC-004/005/007"), or fix it here with one line in each handler if the team prefers. I won't block on either choice.

### Nits

**N1: the breach row's `limit` and `observedCount` can describe a different window from `windows`.** Example: a burst episode is already open and still the longer wait, and the daily window breaches now. The row records `windows:["daily"]` but `limit:"burst"` and the burst count. That is accurate, since `limit` is the reported window, but it's confusing to someone reading the row during an investigation. Either record the observed count of each window listed in `windows`, or document in the `audit-logger.ts` comment that `limit` and `observedCount` describe the reported (longer-wait) window.

**N2: there is no regression test that the `SET … PX` TTL is an integer.** `nowMs` is always an integer from `Date.now()`, so this works today. If a future caller passed a fractional `nowMs`, `PX` would reject it inside the script and every topic write would fail closed with 503. That fails safe, but it would be a confusing outage. A `Math.floor` in `admitConditionalDualWindow`, or a comment, is enough.

**N3: the identical-429 claim is about the response body, not timing.** The first 429 of an episode includes a synchronous INSERT (up to 500 ms) and later 429s don't. That depends only on the actor's own history, not on the team, so it gives no way to tell whether a team exists. Recording this so nobody "fixes" it by padding.

---

## Status of my design conditions

| Condition | Status |
|---|---|
| C1 one audit row per breach episode | **Met in code and tests** (V5). S1 is a narrow variant to document. |
| C2 `Retry-After` is the larger of the two waits | **Met** (V6). |
| C3 a timed-out call may still be counted | **Met.** The spec wording and the helper comment match the behaviour. |
| C4 blast-radius wording | **Met.** Decision 5, Risks, and the `TOPIC_WRITE_LIMITS` comment all say annotation and definition overwrites need a DB restore. |
| F-a `team_verified:false` | **Met.** |
| F-b key namespace and hash tag | **Met.** |
| F-d sentinel constant is lowercase | **Met.** |
| Deferrals filed before merge (1.1, ten issues) | **Still open.** Task 1.1 and merge gate 7.6 are unchecked. My co-sign on the deferrals still depends on these being filed before merge. Add S2 to that list. |

## Summary

The limiter is implemented as designed and co-signed. It is keyed per actor on the internal `userId`, placed after authorization and before any team lookup, and admits, records and opens breach episodes in a single atomic script. Rejected requests aren't counted, durable audit rows are bounded per breach episode, `Retry-After` is the larger of the two waits, and it fails closed with a 500 ms bound and the timing floor on every new exit. Canonicalization and the shared `TEAM_NOT_FOUND` envelope disclose nothing new. Approve. Before merge: document S1 in Risks, put S2 on the follow-up list, and file the 1.1 issues.
