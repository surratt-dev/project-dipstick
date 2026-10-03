# Design Security Review: harden-topic-write-endpoints (#184)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** `design.md`, `proposal.md`, `specs/topic-write-rate-limiting/spec.md` (read in full; other spec deltas spot-checked), checked against the source findings in `archive/2026-09-30-reorder-topics/implementation-review-security.md` (L1, L2, I1, I2/F5) and the current code on this branch: `routes/teams.ts` (TEAM-006 limiter), `routes/topics.ts`, `auth/audit-write-timeout.ts`, `auth/account-resolver.ts`, `redis.ts`, `migrations/8_audit_log.sql`.
**Verdict:** **Approve with conditions.** The design closes my F5, L1 (test), and L2 (`topicId`) findings, and puts the limiter in the right place. One condition (C1) is a real gap that the counting-rule change opens up, and I am making it a condition of my co-sign. The other conditions are spec corrections and accuracy fixes. None of them reopens a decision the proposal treats as non-negotiable.

---

## Rate-limit co-sign

The proposal dropped the separate decision record and moved my sign-off here. This is the record. Each item below is co-signed as written unless a condition is attached.

| # | Decision | Co-sign | Notes |
|---|---|---|---|
| R1 | **Burst 120 per rolling 10 min, per actor** | **Co-signed** | 120 is 12/min sustained. That is above any human clicking pace and well below scripted abuse. It leaves 30 requests over the 90-request two-team fixture. |
| R2 | **Daily 400 per rolling 24 h, per actor** | **Co-signed** | This is the real cap on what one compromised credential can do: about 400 destructive writes a day. I accept that ceiling. The limiter isn't the main control against a stolen credential. Authorization, the audit trail and session revocation are. The limiter only bounds the damage. See C4 about how the design describes the blast radius. |
| R3 | **Floors: burst ≥ 100, daily ≥ 200** | **Co-signed** | I accept that the floors limit security as well as anyone else. During an incident the response is to revoke the session or demote the role, not to tune the limiter, so a floor doesn't take away a tool I need. |
| R4 | **Per-actor bucket keyed on `session.userId`, not IP; no global limit** | **Co-signed** | Verified: `userId` is the internal `users.id`, resolved from `(oidc_subject, oidc_issuer)` (`account-resolver.ts:118-151`). It doesn't depend on any one provider, so it is safe with multiple IdPs. A person who holds identities at two IdPs gets two budgets. Each identity still has to hold the facilitator role separately, so I accept that. I **support** having no global limit. A global bucket on a facilitator-wide route would let one actor exhaust it and lock out every other facilitator. That is a cross-actor DoS, a worse failure than the one it would prevent. |
| R5 | **Requests rejected with 429 or 503 are not counted** (departs from TEAM-006; open question 2) | **Co-signed on condition C1** | Not counting 429s doesn't raise the number of writes an attacker gets: successful writes stay capped at R1/R2. The "cheap probing" risk only reveals the actor's own budget. The new problem is that every 429 does a synchronous `audit_log` INSERT, and with 429s uncounted nothing bounds how many of those an over-budget actor can trigger. C1 fixes that. With C1 in place, **I do not require the frontend to disable controls until `Retry-After`**, and that fallback task stays out of scope. |
| R6 | **Fail closed: 503 on Redis error or after a 500 ms timeout** | **Co-signed** (C3 is a spec-wording fix) | This is right for a security control. It matches TEAM-006, and the session store already depends on Redis without a timeout, so a Redis outage takes these routes down regardless. The 500 ms bound is new protection against a slow Redis, not new fragility. One constant is fine. I don't need a p99 measurement before shipping. |
| R7 | **Limiter after authz and non-canonical-`teamId` 404, before team existence** | **Co-signed** | This is the only placement that is both enumeration-safe and fair to the budget. Before authz, a 403-bound caller would see a 429 and burn budget. After the team lookup, a 429 would arrive only for existing teams. Placing it here also bounds every *DB-writing* denial that comes after it: the template-team 404 row (`topic.write_denied_template`) and the lock 409 row (`topic.write_denied_locked`) are now reachable only by counted requests. A per-handler helper with a structural test is a better design than a plugin `preHandler`. |

**Co-sign summary:** R1–R4, R6 and R7 co-signed as written. R5 co-signed **conditional on C1**. C2 and C3 correct the spec text of the 429/503 contract I am co-signing. They must be fixed before implementation starts, but they don't change any number.

---

## Conditions

### C1 (Medium, condition of the R5 co-sign): put a bound on durable 429 audit writes

Today a 403 on these routes writes no audit row (`topics.ts:97-131`). Under this design, every 429 does a synchronous `INSERT INTO audit_log`, and because 429s aren't counted, an over-budget facilitator (or a script holding their cookie) can make unlimited inserts at whatever rate they can send requests. At 100 req/s that is about 8.6 M rows a day. That loads the shared Postgres, and worse, it buries the one forensic signal the design relies on ("every 429 is a durable audit row") under its own noise. TEAM-006 has the same per-429 insert, but it is admin-only and counts its rejections. This route has neither protection.

**Required:** write one durable `topic.write_rate_limited` row per actor per breached window **per breach episode**, not one per request. For example, do an atomic `SET NX` on `…:breach-audited:<userId>:<window>` with TTL = `Retry-After`, preferably inside the same Lua script. Later 429s in the same episode emit only the structured event `topic.write_rate_limit_exceeded`, which goes to logs and not the DB, and carries a suppressed count. Change the spec scenario "exactly one `topic.write_rate_limited` audit row exists for that request" to "the first 429 of an episode writes exactly one row; later 429s in the same episode write none". Add a test: 50 requests over budget produce one row.

### C2 (Low, spec correctness): `Retry-After` when both windows are breached

The spec says that when both windows are full, the response uses the daily window's `Retry-After`, and that this value is greater than 600. Neither holds in general. Counterexample: 280 requests 23 h 59 min ago, then 120 now. Both windows are full, the daily `Retry-After` is about 60 s and the burst `Retry-After` is about 600 s. A client that waits 60 s gets a second 429, and the daily message ("You can continue tomorrow") is false. **Required:** when both windows are breached, `Retry-After = max(burst, daily)`, and the code and message come from the window with the longer wait. Update the "Both windows breached" scenario to use a fixture where the daily wait really does dominate, and add one where the burst wait does. Since 429s are uncounted, an early retry costs nothing. This is about the contract being honest, not about exposure.

### C3 (Low, spec accuracy): a timed-out limiter call can still be counted

`withTimeout` stops the caller waiting. It doesn't cancel the command (`audit-write-timeout.ts:30-31`). `redis.ts` creates the client with ioredis defaults: offline queue on, retries per request. A request that got a 503 on timeout, or that was queued during a disconnect, can still run its `EVAL` later and record an entry. That fails safe (it over-counts, never under-counts). But the requirement "a request rejected with `503` … SHALL NOT be counted" is a guarantee the design can't keep. **Required:** reword it to "a 503 caused by a Redis *error* is not counted; a 503 caused by a *timeout* may be recorded if Redis later runs the command", or give the limiter its own client or per-command settings that make the guarantee true. The first option is fine.

### C4 (Low, documentation): the blast-radius statement overstates recoverability

Decision 5 and Risks say the blast radius is "one team's list, which restore can recover". That holds for archive, add and reorder. It doesn't hold for **annotations and definitions**: TOPIC-007 overwrites the text, and the audit row deliberately leaves the text out (`topics.ts:1811-1822`, `{ topic_id, action, length }`). Under R2, a compromised credential can wipe annotations across roughly 30 teams a day, and the only way back is a DB restore. I still co-sign R2. The threshold isn't the right control for this. But the design must say it accurately, so nobody later loosens the limits on the strength of "restore can recover it". **Required:** correct the sentence in Decision 5 and in the Risks bullet.

---

## Findings and recommendations (not conditions)

- **F-a (Low): the 429 audit row's `team_id` is caller-chosen and unverified.** There is no FK (`8_audit_log.sql:38`), so an over-budget actor can write arbitrary canonical UUIDs into `audit_log.team_id`. The design says so, which is good. Add `team_verified: false` (or similar) to the metadata so that a forensic query filtering on `team_id` doesn't read this as activity on a real team.
- **F-b (Low): key namespace.** TEAM-006 keys live under `dipstick:ratelimit:…`. The design proposes `topic-write:burst:<userId>`. On a *shared* Redis the keys should stay under the application's namespace: use `dipstick:ratelimit:topic-write:{<userId>}:burst|daily`. The `{…}` hash tag keeps both keys in one slot, so the single two-key `EVAL` keeps working if this ever runs on Redis Cluster.
- **F-c (Info): clock source.** The sliding window uses the app server's `Date.now()` (inherited from TEAM-006). With several backend instances, clock skew blurs the window edges by the skew. That is acceptable at these thresholds. Recorded so the choice isn't left implicit.
- **F-d (Info): template guard test.** Swapping in a hex-letter sentinel (Decision 9) is the right proof. Also assert that `DEFAULT_TOPICS_TEAM_ID` itself is lowercase canonical. The lowercase compare is only case-insensitive if the constant is lowercase too.
- **F-e (Info): structural test limits.** An import-graph test won't see re-exports or dynamic `import()`. Together with the behavioural room-open test (Decision 8), that is enough. Keep both. Don't let either be dropped as redundant.
- **Envelope swap on `teams.ts` 404s:** security-neutral. Only the body changes. Status, check order and reachability stay the same, so nothing new is disclosed. The same analysis as `TEAM_NOT_FOUND` in my reorder review applies.
- **`topicId` guard inside `checkTopicExists*` (Decision 10):** correct. It runs at the topic-existence step, with no query and no reordering. It closes L2 for archive and restore.
- **Identical 429 for existing, missing and template teams:** verified as a design property. The admission check makes no DB query and depends only on the actor's own history. The 503 is enumeration-safe for the same reason. Task 5.9 must cover both roles, as written.

---

## Deferred or implicit security decisions

The proposal makes these deferrals explicitly, and I accept them, **provided each one is filed as an issue under task 1.1 before merge**:

| Item | Status | My position |
|---|---|---|
| F7 (thrown 500 paths skip the timing floor) | Deferred | Accept. Informational. The only inputs that reach these paths depend on the caller's own input. |
| I1 (`no-store` on Fastify 400/415 rejections) | Deferred | Accept. They carry no data. |
| `teams.ts` `GET /:teamId` and `/members` canonical-UUID boundary | Deferred | Accept, as Low. This is my L2 class (an authenticated user can trigger a 500) on a non-topic route. It needs its own issue, not a line in another one. |
| `teams.ts` 401/403 `invalid_request` category | Deferred | Accept. Cosmetic. |
| 80% early-warning event | Deferred | Accept. |

These decisions are **implicit** in the design. I'm recording them here so they become explicit:

1. **Nobody consumes the 429 audit rows.** The design says "new alerting infrastructure" is a non-goal and relies on "every breach is a durable audit row". A row nobody queries detects nothing. That is acceptable for a Low item, but the detection claim should read "available for investigation", not "detected". Link it to the existing monitoring follow-up (TEAM-006's Finding 2.3) so topic-write breaches are included when that work lands.
2. **Authorization itself is unthrottled.** Callers bound for a 403 still run `evaluateStandingFacilitatorAccess` (a DB query) on every request, with no limit. That has always been true, and it is true on every authenticated route, so it isn't this change's job. It does mean the limiter protects writes and not the DB as a whole, and the design shouldn't suggest otherwise.
3. **The fail-closed dependency on the shared Redis goes to Ops only through the PR description.** Acceptable. Also add one line to the deployment or operations docs: the PR description is gone once it merges.
4. **Clock source and key namespace** (F-b, F-c above).

---

## Summary

The limiter design is sound. It is keyed per actor on a provider-independent internal user ID, placed after authorization and before any team lookup so it can't be used to tell whether a team exists, applied atomically and only when both windows have room, fails closed with a bounded timeout, and stays out of session runtime, with CI enforcing that. I co-sign the numbers (120/10 min, 400/24 h, floors ≥ 100/≥ 200), the per-actor bucket with no global limit, the fail-closed 503 at 500 ms, and the cascade placement. I co-sign not counting 429s **on condition that durable 429 audit writes are bounded per breach episode (C1)**. C2–C4 correct the spec and the design text. Approve with conditions.
