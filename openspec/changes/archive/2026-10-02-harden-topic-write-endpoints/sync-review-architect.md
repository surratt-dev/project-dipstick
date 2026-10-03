# Sync Review — Solution Architect (Ingrid Sollenberger)

**Change:** harden-topic-write-endpoints (#184)
**Sync commit reviewed:** 7c2b186 (branch `agent-team/184-harden-topic-write-endpoints`)
**Scope:** the synced main specs under `openspec/specs/` compared with the implementation (`git diff main..HEAD -- packages/`), plus the pre-existing strict-validation failures.

## Verdict

**No drift found. 0 must-fix, 2 nits.** The synced specs describe what the code does. Every requirement in the three new specs and every changed check-order step maps to code and to at least one test that exercises it. I ran the key unit suites (6 backend files with 326 tests, 2 frontend files with 33 tests) and the limiter, mixed-case and sliding-window integration suites against live Postgres and Redis (7 files, 47 tests). All passed and none were skipped.

## Requirement-by-requirement spot check

### topic-write-rate-limiting

| Requirement | Code | Tests | Result |
|---|---|---|---|
| One per-actor budget for 5 routes; 120/10 min, 400/24 h; one constant; ritual floor | `routes/topic-write-rate-limit.ts` `TOPIC_WRITE_LIMITS`; keys use only `userId` (no team, no IP, no global key); called in all 5 handlers in `topics.ts` | thresholds-integration (120/121st, per-actor, shared across routes and teams, 90-request baseline, 78-request fixture, floor assertion) | Match |
| Count only authorized, non-limited requests; atomic check-and-record in both windows | `CONDITIONAL_DUAL_WINDOW_LUA` tests `count < limit` on both windows before ZADD; a rejected request adds nothing and does not refresh the TTL; a 503 from a Redis error records nothing | sliding-window-limiter-integration; thresholds "422/404/409/pre-flight each add one entry"; placement "429s do not extend the window" | Match |
| After authorization and the canonical check, before team existence; no DB query; identical 429; explicit helper, no preHandler | Every handler runs `rejectNonCanonicalTeamId`, then lowercase, then auth, then `enforceTopicWriteRateLimit`, then `checkWritableTeam`. No `addHook`/preHandler. | placement-integration: enumerates the route table and asserts no `FROM teams` query on the 429; identical 429 for facilitator and admin; admin on TOPIC-007 gets 403; non-canonical id over budget gets 404 with windows unchanged | Match |
| 429 contract, longer-wait selection (daily on a tie), one audit row per episode before responding, fail-open audit, timing floor, no lockout | `classifyTopicWriteBreach` (`dailyWait >= burstWait`); episode markers sit in the same EVAL; `writeFailOpenAuditRow` runs before `reply.send`; the event is emitted on every 429 with `suppressedCount`; `applyTimingFloor` applies; messages come from `@dipstick/shared` | thresholds-integration: daily, both C2 orderings, tie, 50-request episode, audit shape, second episode, audit throw/hang, no lockout | Match |
| Fail closed with 503 (Redis error or >500 ms), `Retry-After: 30`, shared message and code, no DB write | catch branch in `enforceTopicWriteRateLimit`, using `withTimeout(…, 500)` | redis-failure-integration (error and hang, all 5 routes) | Match |
| Never applied to session runtime | Only `routes/topics.ts` imports the limiter. `sliding-window-limiter.ts` is imported only by the limiter and `teams.ts`. (`audit-logger.ts` mentions it only in a comment.) | structural test (allow-list); session-integration (room open, start and voting succeed at 100%) | Match |
| Independent of TEAM-006, which is unchanged | TEAM-006 Lua moved byte-for-byte; prefixes `topic-write:{userId}` and `team-manager:` are distinct; `teams.test.ts` has no deleted lines, only additions | independence-integration; byte-identical body tests in `teams.test.ts` | Match |

### topic-write-request-hygiene

| Requirement | Code | Tests | Result |
|---|---|---|---|
| Lowercase `teamId` right after the canonical check; template guard case-insensitive | `const teamId = rawTeamId.toLowerCase()` in all 5 handlers; `checkWritableTeam` compares with the lowercase `DEFAULT_TOPICS_TEAM_ID` | identifier-hygiene (sentinel with hex letters, uppercase path); mixed-case-integration 3.3 (audit and logs lowercase) | Match |
| Mixed-case writes serialize on one lock (and with room open) | `lockTeamTopics(client, teamId)` takes the lowercase id. The key SQL `hashtext($1::uuid::text)` also normalizes. | mixed-case-integration 3.6, 3.7 (add/restore/reorder), 3.8 (both directions) | Match |
| No 5xx for a malformed path id; topicId 404 at the topic step; no route schema | `checkTopicExistsAndActive` checks `isCanonicalUuid` first. The `content.ts` GET `/topics` gained the canonical check. `topics.ts` has no `schema`. | identifier-hygiene 3.5 (4 spellings × 3 routes); `content.test.ts` (both read routes); `topics.test.ts` M1 block | Match (see N2) |

### team-not-found-envelope

| Requirement | Code | Tests | Result |
|---|---|---|---|
| One `teamNotFoundEnvelope()` used everywhere; literal only in `error-envelope.ts` | Used by topics, content, draft session (both checks), the GET routes for team and members, and managers. A grep of non-test source finds the literal only at `error-envelope.ts:66`. | structural test; `teams.test.ts` (not_found on GET); `facilitator-sessions.test.ts` | Match |
| `ErrorCategory` includes `rate_limited` and `service_unavailable`; TEAM-006 bodies byte-identical | union extended; TEAM-006 uses `buildErrorEnvelope`, whose key order (category, code, message, correlationId) matches the old literals | `teams.test.ts` "#184 task 2.5" | Match |

### Changed check-order steps (add-custom-topic, remove-topic, restore-topic, reorder-topics, topic-annotation)

Step (1b), the topic-write rate limit, sits after (1) identity/role and before (2) team existence in all five handlers. This matches each synced spec. The timing floor covers the new 429 and 503 paths. Archive and restore answer a non-canonical `topicId` at step (4) with no query. Annotation answers it at step (5), after body validation, which matches the TOPIC-007 cascade. The new scenarios "over-budget 429 before team/template/lock/body" and "403, never 429" are covered by the enumeration-resistance and placement tests. The added `TEAM_NOT_FOUND` reason codes in add-custom-topic match `teamNotFoundEnvelope()`.

### topic-management-screen

`topicWriteRateLimit.ts` chooses copy by `error.code`. It replaces "a few minutes" only for a burst 429 with a delta-seconds `Retry-After`, and shows the singular "about 1 minute" at a minimum of 1. Reading headers cannot throw. `isTopicWritePause` excludes any 503 that does not carry the limiter's code. `TopicManagementPage.tsx` keeps the add form, the reorder draft and the definition text. It keeps the escalated archive confirmation open with an `error` field. It does not retry automatically and adds no page banner. The tests are `TopicManagementPage.rateLimit.test.tsx` (all six controls for 429 and 503, plus the k-th restore series) and `topicWriteRateLimit.test.ts`. Match.

## Nits

- **N1 (test fidelity, not drift).** The scenario "Unauthorized requests do not consume budget" specifies 200 requests that get 403. The placement test sends 5 requests under budget and 5 over budget, one per route, and asserts the windows do not change. The behaviour is the same and the evidence is equivalent. If you want literal traceability, loop to 200 or reword the scenario to "repeated requests". Optional.
- **N2 (implicit coverage).** No test sends a malformed `teamId` from a caller who would fail authorization and asserts 404 rather than 403 (scenario "Malformed teamId precedes authorization"). It is covered indirectly: the `topics.test.ts` M1 block asserts that `mockDbQuery` is never called, and authorization requires a query, so the check must run first. This behaviour predates the change. An explicit assertion would be cheap. Optional.

## Pre-existing strict-validation failures: not related to this change

`openspec validate --specs --strict` on HEAD reports 36 passed and 4 failed. I ran the same command in a scratch detached worktree of `main` (992645f) under the session scratchpad and then removed the worktree (`git worktree list` now shows only the main checkout). Main reports 33 passed and 4 failed, with the same four specs failing:

| Spec | Error (identical on main and HEAD) |
|---|---|
| manager-team-association | requirements.6: no SHALL/MUST |
| project-structure | requirements.11: no scenario |
| role-assignment | requirements.7 and .8: no SHALL/MUST |
| websocket-session-authorization | requirements.6: no SHALL/MUST |

`git diff main..HEAD` touches none of these four spec files. The three new specs and all six updated specs pass strict validation. The 3-item difference in the totals is exactly the three new specs.
