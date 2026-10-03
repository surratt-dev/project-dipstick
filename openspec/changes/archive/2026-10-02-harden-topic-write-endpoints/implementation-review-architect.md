# Implementation Review — Architect

**Change:** harden-topic-write-endpoints (#184)
**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** `git diff main..HEAD` (11 commits, `6078d0c`..`e6fab26`) against `design.md` Decisions 1–13 and `tasks.md`, including its "As implemented" deviations
**Verdict:** **Approve.** No must-fix findings. There are two should-fix items, both documentation and test-intent gaps rather than defects, plus a few nits.

---

## What I checked, and how

| Question | Method | Result |
|---|---|---|
| Is the limiter unreachable from session, room and voting routes? | Grepped every production importer of both limiter modules. Checked `topics.ts` for `addHook`. Checked `register-routes.ts`. Read the structural and behavioural tests. | **Confirmed.** Details below. |
| Can `d4138e6` be reverted on its own? | Ran `git revert --no-commit d4138e6` in a scratch worktree at HEAD. Then ran `teams.test.ts`, both structural tests, `tsc -p tsconfig.build.json` and eslint on `teams.ts`. Removed the worktree afterwards. | **Confirmed.** Details below. |
| Is TEAM-006 behaviour unchanged by the extraction? | Diffed the moved script and functions against the removed lines, checked which commits touch `teams.test.ts`, and read the byte-identity test. | **Confirmed.** Details below. |
| Does the code match the design (Decisions 1–13)? | Read `sliding-window-limiter.ts`, `topic-write-rate-limit.ts`, `topic-write-context.ts`, and the `topics.ts`, `content.ts`, `facilitator-sessions.ts`, `teams.ts`, `error-envelope.ts`, shared and frontend diffs. | Matches, with one undocumented extension of the Lua contract (S1). |

### 1. The limiter is not reachable from session, room or voting routes

- **Production importers** (excluding tests and `dist/`):
  - `routes/topic-write-rate-limit.ts` is imported only by `routes/topics.ts`.
  - `auth/sliding-window-limiter.ts` is imported only by `routes/topic-write-rate-limit.ts` and `routes/teams.ts`.
  - Nothing in `facilitator-sessions.ts`, `sessions/`, voting or WebSocket code imports either module.
- **`topics.ts` is imported only by `register-routes.ts`** (`app.register(topicRoutes)`). No session module imports it, so there is no transitive path either.
- **No hooks.** `topics.ts` registers no `addHook`. There are exactly five `enforceTopicWriteRateLimit(` call sites (lines 906, 1078, 1296, 1472, 1695), one per write handler. Each comes after the 403 check and before `checkWritableTeam`, as Decisions 2 and 3 require.
- **Both guards from Decision 8 are present and complementary:**
  - `topic-write-rate-limit-structural.test.ts` is an exact-match allow-list (`toEqual`, not `toContain`). It includes a non-vacuity check.
  - `topic-write-rate-limit-session-integration.test.ts` pre-seeds 120/400 entries with ZADD and proves a topic write gets 429. It then shows that advancing to the room, start and begin-voting all return 200, and that both windows are still exactly 120/400 afterwards.
  - Security asked that neither guard be dropped (F-e). Both are kept.

### 2. Commit `d4138e6` reverts cleanly on its own

- `git revert --no-commit d4138e6` applied with no conflicts. It touched exactly three files: `teams.ts`, `teams.test.ts` and `team-not-found-envelope-structural.test.ts`.
- After the revert, `teams.ts` drops the `teamNotFoundEnvelope` import (no unused import is left behind), and its three `"Team not found."` literals come back. The structural test's temporary `routes/teams.ts` allowlist entry is restored, so the guard stays green.
- On the reverted tree:
  - `teams.test.ts` (50 tests) passed.
  - `team-not-found-envelope-structural.test.ts` passed.
  - `topic-write-rate-limit-structural.test.ts` passed.
  - The build typecheck (`tsc -p tsconfig.build.json`) passed.
  - eslint on `teams.ts` passed.
  - (`tsc -p .` reports about 200 errors in test files on HEAD as well. They predate this change and are outside the build config.)
- The commit message starts with `revertible:` and names #184 m5, as task 2.4 requires. It is the last code commit; only `e6fab26` (docs and tasks) comes after it.
- The scratch worktree has been removed and `git worktree list` shows only the main checkout.

### 3. TEAM-006 behaviour is unchanged

- **Moved verbatim.** `SLIDING_WINDOW_LUA`, `recordAndCountSlidingWindow` and `retryAfterSeconds` match the removed lines in `teams.ts` character for character. That includes the global `crypto.randomUUID()` call; the new code uses an imported `randomUUID` (see N1). The only change is that they are now exported.
- **TEAM-006's own code is untouched.** Keys (`dipstick:ratelimit:team-manager:*`), thresholds, the `count > LIMIT` comparison, counting of rejected requests, and the fail-closed 503 are all unchanged.
- **No test edits in the extraction commit.** `3a26811` doesn't touch `teams.test.ts`. The suite still passes because its `vi.mock("../../redis.js")` covers the new module's `redis` import. `teams.test.ts` changes only in `1464953` (new byte-identity test, task 2.5) and `d4138e6` (new 404 assertions, task 2.4). No existing TEAM-006 assertion was edited, which supports the claim in the 7.2 checklist.
- **Response bodies are byte-identical.** The 429 and 503 bodies are built with `buildErrorEnvelope`, which emits the same key order (`category`, `code`, `message`, `correlationId`). The byte-identity test pins this against independently written literals.
- **The budgets are independent.** The two key namespaces can't collide, and `topic-write-rate-limit-independence-integration.test.ts` proves independence in both directions.

### 4. Conformance to the design and to existing patterns

- **Decision 1 (Lua contract).** The script admits on `<` before adding. It is commented as deliberately different from TEAM-006's add-then-`>` rule. It returns the nine-element tuple with no policy in Lua. A reject neither ZADDs nor PEXPIREs. Breach markers use `SET NX PX` with `INCR`. The `{userId}` hash tag is in place.
- **Decision 7a.** `classifyTopicWriteBreach` reports the longer wait and picks daily on a tie, in TypeScript.
- **Decisions 6 and 7.** The 503 comes from `withTimeout(…, 500)` and writes nothing to the DB. The episode's audit row is written through the existing `writeFailOpenAuditRow` before `reply.send`. Both paths set `no-store` and apply the timing floor.
- **Decision 9.** Each of the five handlers runs `rawTeamId.toLowerCase()` straight after `rejectNonCanonicalTeamId`.
- **Decisions 10 and 11.** The `topicId` guard sits inside both `checkTopicExists*` helpers, and annotation's inline check is gone. `teamNotFoundEnvelope()` is now defined once, in `error-envelope.ts`. `content.ts` and `facilitator-sessions.ts` changed only by the envelope swap; their check order is unchanged.
- **Decision 12.** Codes and copy live in `@dipstick/shared`. The frontend selects copy by `error.code`, calls the helper only on a 429, and reads the header defensively.
- **Pattern consistency.** The helper follows house conventions:
  - It reuses `withTimeout`, `writeFailOpenAuditRow`, `applyTimingFloor`, `buildErrorEnvelope` and `emitAuditEvent`.
  - It matches the existing `check*` helper shape: it sends the response itself and returns a sentinel.
  - It takes the shared `TopicWriteDenialContext`, now in a neutral type-only module, so it doesn't import `topics.ts`.
  - Factoring `writeCtx` once per handler, instead of building the literal three times, is a welcome cleanup with no behavioural change.
- **Recorded deviations in tasks.md (5.4b, 5.8).** These are reasonable and have no architectural impact:
  - Budgets are reset inside `buildApp` and `Fixture.cleanup` rather than in a literal `beforeEach`.
  - `checkTopicWriteBudget` is exported for limiter-level tests.
  - The over-budget GET uses `/topics/all`.
- **Ops boundary.** `docs/deployment.md` records the fail-closed Redis dependency, the key prefix, and which events are log-only and which are durable. That meets the durable-record requirement in Decision 6.

---

## Findings

### Must-fix

None.

### Should-fix

**S1. The Lua script ends breach episodes with an explicit `DEL`, and the design doesn't say so.**
`CONDITIONAL_DUAL_WINDOW_LUA` runs `DEL` on a window's breach marker whenever that window has room (lines 190–195 of the script). Decision 1 says only that the marker "expires exactly when that window next has room". The extension is sound:
- It makes "episode ends when the window has room" exact even if app-server clock skew leaves a marker TTL longer than the real gap.
- It doesn't weaken the C1 bound, because a rejected request adds nothing, so a window can't refill without an admitted request.

It is still a change to a contract that Decision 1 fixed explicitly "so nobody harmonises the two scripts later". It appears only in the code comment. Add one bullet to Decision 1 (or an "As implemented" note under task 4.2) recording the `DEL`, its purpose, and why C1 still holds. Security (Tomás) should see it, since 4.2 is `[SEC]`.

**S2. No test covers the `DEL` path itself, and the expiry test depends on wall-clock timing.**
`sliding-window-limiter-integration.test.ts`, the test titled "the marker expires when the window has room…", seeds an entry about 300 ms from leaving the window and sleeps 450 ms. That proves TTL expiry, not the `DEL`. It also leaves 150 ms of margin on a shared CI Redis.
- Add a deterministic case with an injected `nowMs`: seed a marker whose TTL is longer than the window's real room (simulating skew), call at a `nowMs` where the window has room, and assert the marker is gone and a later breach reports `burstEpisodeNew: true`.
- Optionally widen the 300/450 ms margins, or derive the expiry test from `nowMs` as well.

### Nit

**N1. The extracted module uses two different UUID sources.** `sliding-window-limiter.ts` imports `randomUUID` from `node:crypto` for the new wrapper, while the moved TEAM-006 function still calls the global `crypto.randomUUID()`. This is correct because the move had to be byte-for-byte. A short comment on the moved function would stop a later reader from "fixing" it in a way that breaks the byte-identity claim.

**N2. `AuditWriteTimeoutError` now also means the limiter timed out.** `enforceTopicWriteRateLimit` classifies `failureMode: "timeout"` with `err instanceof AuditWriteTimeoutError`, borrowed from the audit-write module. That couples the Redis-limiter path to a name that is about audit. A neutral alias such as `OperationTimeoutError` (or a comment at the import) would keep the boundary readable. No behaviour change is needed.

**N3. A breach audit row can mix fields from two windows.** When a burst episode opens while a daily episode is already open and the daily wait is longer, the row carries:
- `limit: "daily"` and `observedCount` = the daily count (the reported window),
- `windows: ["burst"]` (the window whose episode just started).

The spec allows this ("`windows` lists the windows whose episode began"). Even so, a forensic reader could misread `limit` as the window whose episode the row opens. Consider a sentence in the `audit-logger.ts` comment, or the eventual Finding 2.3 monitoring query, that says `limit` is the reported window and not necessarily the window whose episode started.

**N4. `isTopicWritePause` treats every 503 as a limiter pause.** On Topic Management, a 503 from a proxy or gateway would also be shown as a pause, using the body's message or the fallback. That is harmless, since the copy is still accurate in spirit and nothing is retried, but it is broader than the name suggests. Either narrow it to `error.code === TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE` for 503s or rename it. Low priority.

**N5. Stale TODO in `tasks.md`.** Tasks 1.1, 7.5 and 7.6 remain open by design: no issues filed, no PR. That is correct for this run. The 7.5 draft callout is accurate against the code. This is a reminder that 7.6 is a merge gate, not a review item.

---

## Architectural assessment

The boundaries I cared about most hold, and they are enforced in CI rather than just asserted:
- The limiter is a per-handler call inside one route module.
- It is reachable only through `topics.ts`.
- It sits after authorization and before any team lookup.
- It is kept out of session runtime by an exact import allow-list plus a behavioural test.

The TEAM-006 extraction is a true move, with no test edits in the extraction commit. The deliberate API change on `teams.ts` is isolated in a commit that reverts cleanly and leaves a green, type-clean tree. The two should-fix items are about keeping Decision 1's written contract in step with the code it governs. They don't block merge if they are added as a follow-up commit on this branch before the PR is raised.
