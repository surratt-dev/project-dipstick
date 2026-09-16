# Implementation Review: TEAM-006 Rate Limiting (Task 3.10) — Security Sign-off Verification

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewing against:** `q6-rate-limit-decision.md` (the decision I co-signed, closing GitHub issue #13)
**Branch:** `agent-team/team-006-rate-limit-threshold`
**Files reviewed:** `packages/backend/src/routes/teams.ts`, `packages/backend/src/auth/audit-logger.ts`, `packages/backend/src/routes/__tests__/teams.test.ts`
**Test run:** `npx vitest run src/routes/__tests__/teams.test.ts` — 39/39 passing, including the 9 new task 3.10 tests.

I checked this the way I check every "the spec was implemented" claim: against the actual code, not the task-list checkbox that says COMPLETE.

---

## Findings

### 1. Actor keying — CONFIRMED, no finding

`enforceTeam006RateLimit` is called with `session.userId` (`teams.ts:930`), which comes from `request.session as unknown as SessionData` — a server-side Fastify session backed by the Redis-backed store in `session-store.ts`. It is not read from any request header, body field, or query parameter, and it is the same identity value already used two lines above it for the Application Admin DB lookup (`teams.ts:889-891`). There is no code path by which a client can influence which bucket its own requests are counted against. `request.ip` is used only as an **audit metadata field** (`actor_ip`), never as a rate-limit key — correct, and consistent with the decision's rationale (shared NAT egress makes IP the wrong trust boundary for enforcement).

**Verdict: matches Section 1 exactly.**

### 2. Sliding window correctness — CONFIRMED, no finding

The limiter is a genuine sliding window, not a fixed calendar bucket. `SLIDING_WINDOW_LUA` does `ZREMRANGEBYSCORE key -inf (now-window)` → `ZADD key now member` → `PEXPIRE` → `ZCARD` → oldest-entry lookup, all inside one Lua script, so the trim-add-count sequence is atomic against concurrent requests for the same key (Redis's single-threaded script execution gives this for free — no separate MULTI/WATCH needed, and none is used, which is fine). Each entry's `member` is `${nowMs}-${crypto.randomUUID()}`, which correctly avoids the classic bug where two requests landing in the same millisecond would collide on the same sorted-set member and undercount.

I independently traced the "gradual expiry" test (`teams.test.ts`, `"resets gradually under sliding-window semantics..."`) and it genuinely exercises boundary behavior: a request at t+5min is still rejected (all 20 original entries still in-window), and a request at t+10min+1s succeeds (those specific entries aged out) while the later t+5min entry itself would still be live. This is the actual property that matters — the exact boundary-doubling problem I flagged in the original proposal (attacker straddles a fixed bucket edge to get ~2x effective rate) is closed here because there is no fixed edge to straddle.

**Verdict: matches Section 1's sliding-window requirement, not a fixed-bucket approximation dressed up as one.**

### 3. Audit durability — CONFIRMED, no finding

On breach, `teams.ts:933-951` does a synchronous, awaited `db.query(INSERT INTO audit_log ...)` **before** the 429 is constructed and returned — this is not fire-and-forget, and if the INSERT itself throws, there is no `try/catch` swallowing it, so the request fails loudly (propagates to Fastify's default error handler) rather than silently proceeding to a 429 with no audit trail. That's the correct failure mode for an audit-integrity requirement: lose the response, never lose the record silently.

Fields present in the row: `actor_user_id`, `actor_global_role` (bonus, not required but welcome), `actor_ip`, `operation = 'team.manager_association_rate_limited'`, `team_id`, and `metadata` containing `limit_type`, `observed_count`, and `threshold`. All decision-required fields are present.

The `AuditEventName` union gets two **distinct** new members — `team.manager_association_rate_approaching` and `team.manager_association_rate_limit_exceeded` — matching Section 2/3's requirement that the early-warning event and the breach event be separately identifiable. The code comment in `audit-logger.ts` even calls out, correctly, that the structured event name is deliberately different from the DB `operation` string (`..._rate_limited` vs `..._rate_limit_exceeded`), which is exactly what Section 3 asked for.

**Verdict: matches Section 3's audit-durability and event-naming requirements.**

### 4. No lockout — CONFIRMED, no finding

I grepped the full diff for lockout/suspend/disable-account patterns; none exist. The only enforcement action on breach is the 429 response. No user or session state is mutated. Matches Section 3's explicit prohibition.

### 5. Placement — CONFIRMED, no finding

Verified the actual control flow in `teams.ts:880-976`: Application Admin authorization check (DB read + 401/403 branches) completes first, `enforceTeam006RateLimit` runs immediately after, and the 429 return happens **before** the team-existence query that follows it. This is precisely the ordering I required: unauthorized callers 403 before touching Redis, rate-limited callers 429 before touching the team-existence/precondition queries. The comment block directly above the handler even documents the ordering rationale in the same terms I gave it.

### 6. Fail-safe behavior on Redis failure — **FINDING (Medium)**: fail-closed by accident, not by design

This is the one place where "the code happens to do the right thing" and "the code was built to guarantee the right thing" diverge, and that distinction is the whole basis of my "secure defaults that don't require discipline to maintain" position.

What I found: there is no `try/catch` anywhere around `enforceTeam006RateLimit` or the `redis.eval` calls inside it, and the backend registers no `setErrorHandler`/`onError` hook (checked `app.ts`). So if `redis.eval` rejects — Redis down, network partition, timeout — the rejection propagates out of the async route handler uncaught, Fastify's default error handler catches it, and the client gets a generic 500. No `team_memberships` row gets written (the handler never reaches that code), so in effect this **does fail closed**: a broken rate limiter denies the request rather than silently waving it through.

But:
- **This is an emergent property of "nobody added error handling," not a designed one.** There is no code, comment, or test asserting "when Redis is unavailable, we deny the request." A future refactor that wraps this handler in a broad `try { ... } catch { return reply.code(200)... }` (or any error-swallowing middleware added elsewhere for unrelated reasons) would silently flip this to fail-open with zero visible change to this file and no test to catch the regression. That is exactly the kind of control I don't trust — it depends on nobody touching adjacent code carelessly, forever.
- **There is no test for this scenario.** I checked `teams.test.ts` for any `mockRedisEval` rejection case — none exists. The 9 new tests all exercise the happy path of Redis working correctly. Section 6 of the decision doesn't enumerate a Redis-failure acceptance criterion either, so this isn't a task-scope miss, but it is a coverage gap for a security-relevant failure mode that should exist before I'd call the control done.
- **No distinct signal for this condition.** If Redis becomes unreachable, every call to this endpoint will 500, indistinguishable in the logs from any other unrelated 500 on this route, unless someone is specifically watching for a spike in 500s on this path. There's no structured event (e.g. `team.manager_association_rate_limit_check_failed`) that would let monitoring distinguish "the control is denying legitimate admin traffic because its backing store is down" from an unrelated bug. Given this endpoint's whole reason for having a rate limiter is incident detection, an unannounced outage of the detector itself deserves its own signal.
- **Mitigating context, for fairness:** the same `redis` client backs the session store (`session-store.ts`), so a Redis outage already breaks session lookups app-wide before a request would even reach this handler's authorization check in most cases. This isn't a uniquely fragile dependency introduced by task 3.10 — it's riding on an existing single point of failure the application already has. That lowers the practical blast radius of this finding but doesn't resolve the core issue: the fail-closed behavior for this specific control is undocumented and untested, and I don't want to be relying on "well, session storage happens to depend on the same Redis" as the reason the security control degrades safely.

**What I'd want before closing this out:** an explicit `try/catch` around the rate-limit check that (a) logs/emits a distinct structured event on limiter failure, and (b) explicitly returns a 5xx (documenting the fail-closed choice as intentional, not incidental), plus a test asserting that behavior. This doesn't need to block the current deploy given the shared-Redis-dependency mitigation above, but it should be tracked as a fast-follow, not left as tribal knowledge about how Fastify happens to behave today.

### 7. Escalation-path placeholder text ships to real users — **FINDING (Medium)**

Section 3 of the decision requires the 429 message to give the caller three things: (a) it's a rate limit not a bug, (b) when they can resume, and (c) an escalation path if their legitimate need exceeds the limit. The decision's illustrative JSON example used `[security/support channel]` as a bracketed placeholder to show where a real channel should go.

The implementation copied that bracketed placeholder **verbatim** into the production error strings (`teams.ts:236,240,244`, `TEAM006_RATE_LIMIT_MESSAGES`). An Application Admin who gets legitimately rate-limited mid-rollout and reads the message is told to "contact [security/support channel]" — not an actual channel. That's not requirement (c) partially met with rough wording; it's requirement (c) unmet, because there is no path there to follow. This also undercuts the stated purpose of Section 4's escape hatch (a legitimate-large-rollout admin needs to know *where* to ask for the time-boxed increase), since the only in-product pointer to that process is non-functional text.

**What I'd want before closing this out:** replace the placeholder with the actual internal channel (Slack channel, ticket queue, email alias — whatever the real escalation path is) in all three message strings before this reaches production. This is a one-line-per-message fix; I'm not asking for new design work, I'm asking for the design's own requirement to actually be satisfied.

### 8. Everything else checked, no findings

- Global counter key is a single shared `dipstick:ratelimit:team-manager:global` string, correctly counted regardless of which actor is making the request — verified by the "shared global accumulation" test, which I traced by hand and confirms per-actor isolation (burst/daily) alongside shared global accumulation.
- Rejected requests still count toward the sliding windows (by design, per the code comment and Section 6's implicit "pacing under threshold doesn't dodge the daily cap" intent) — correct, this is what closes the "attacker paces just under the burst limit" gap the decision specifically worried about.
- No `teamId` or target-user dimension in the keys — matches Section 1's "no target-scoped limit" reasoning.
- Redis-backed, not in-process — matches the decision's explicit rejection of an in-process counter for multi-instance correctness.
- No new `@fastify/rate-limit` dependency added — matches the decision's explicit preference for a purpose-built limiter.
- Escape-hatch mechanism (Section 4) is correctly treated as out of scope for task 3.10 (tasks.md confirms this was never claimed as done here) — not a gap in this review, just noting I didn't go looking for it and its absence isn't a finding against 3.10.

---

## Overall Verdict

**Conditionally satisfies my Q6 co-sign.** The core security properties I required — server-resolved actor keying, true sliding-window enforcement, synchronous durable audit logging with correctly distinct event names, no lockout, and correct placement ahead of DB/precondition work — are all implemented correctly and are backed by tests that actually exercise the properties (not mocked-return-value theater; the fake Redis sorted-set backing store genuinely replays sliding-window arithmetic over simulated time). That is the majority of what Q6 was about, and it's done right.

Two things need to change before I'd sign off on task 3.10 as fully meeting the security-relevant requirements I attached to it:

1. **(Medium) Fail-safe behavior for the rate limiter itself is untested and undocumented.** It currently fails closed, but as a side effect of the absence of error handling rather than as a deliberate, guarded choice. I want an explicit catch, a distinct failure signal, and a test — not because I think it's broken today, but because "it happens to be safe as long as nobody adds a try/catch nearby" is exactly the kind of control that stops being safe the first time someone touches adjacent code for an unrelated reason.
2. **(Medium) The escalation-path text in the 429 response is a non-functional placeholder** (`[security/support channel]`) shipped as literal user-facing copy. This is a real, if small, gap against Section 3's three-part message requirement — fix before production.

Neither finding invalidates the core rate-limiting/audit engineering, which is solid. Both are fixable without touching the sliding-window logic, the audit path, or the placement — they're additive. I'd want them addressed (or explicitly accepted as tracked follow-up with an owner and date, the way Finding 2.3 was handled) before I'd call task 3.10 fully closed from a security standpoint.
