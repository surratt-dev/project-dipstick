# Security Review of the Implementation: zero-topic-team-recovery (#200)

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Scope: the uncommitted diff on `agent-team/200-zero-topic-team-recovery`. I read `routes/topics.ts` (assign-defaults handler and `checkAssignDefaultsAuthorization`), `auth/assign-defaults-audit.ts`, `auth/denial-audit-limiter.ts`, `auth/fail-open-topic-audit.ts`, the `content.ts` refactor and `canAssignDefaults`, `role-map.ts` (`isApplicationAdmin`), `sessions/default-topics.ts`, `lockTeamTopics`, and `app.ts` (cookie, CORS, trustProxy). I did not run the test suite and did not read the test files in detail; where I say "tested" below I mean I saw the file names, not that I verified the assertions.

## Verdict

Approve. No blocking findings. All five sign-off conditions from `design-review-security.md` are met in code. I have four non-blocking items (N1 to N4), none of which should hold the merge.

## 1. Conditions from the design review

| Cond. | Requirement | Result | Evidence |
|---|---|---|---|
| S1 | Role read live from `users`, missing row is a non-admin | Met | `checkAssignDefaultsAuthorization` runs `SELECT global_role FROM users WHERE id = $1` per request. It does not read the session or a token claim. A missing row gives `null`, and `isApplicationAdmin(null)` is false, so the result is 403 `NOT_AN_ADMIN`. |
| S2 | Transaction-scoped lock, released on every path, isolation stated, count after lock | Met | `LOCK_TEAM_TOPICS_SQL` is `pg_advisory_xact_lock`, so COMMIT or ROLLBACK releases it. The 409 path issues an explicit ROLLBACK. The catch path issues `ROLLBACK` with a swallowed error. `finally` always calls `client.release()`. The count is a fresh statement after the lock at the default READ COMMITTED. A concurrency integration test file exists. |
| S3 | Bound on denial-audit writes | Met | `denial-audit-limiter.ts` allows 10 rows per actor per minute with its own key namespace. Beyond the bound, or on a Redis error or timeout, no row and no per-denial event are written. A log-only `topic.denial_audit_suppressed` is emitted once per window for the bound and on every store error. The shared sliding-window script keeps counting suppressed denials, so a continuous prober stays suppressed. The 403 itself is unchanged. |
| I1 | CSRF/CORS posture | Met | `app.ts` has `sameSite: "strict"` on the session cookie and a single-origin CORS allowlist with `credentials: true`. The route is not an exception. design.md D-section records this. Authentication comes from the global `onRequest` hook in `auth/middleware.ts`, so a 401 precedes the handler and the denial row cannot be written for an unauthenticated caller. |
| S4 | Empty-template 500 durably recorded | Met (via the post-rollback row option) | After the ROLLBACK, `recordFailure` writes a fail-open `topic.defaults_assign_failed` row on the pool, so it survives the rollback. Metadata holds `endpoint`, `http_status`, `reason` and `correlation_id`. No template id and no topic text. The correlation id also joins the `request.log.error` line. |

## 2. Other items from the design review

- S5 (zero-active chain): `zero-topic-invariant-integration.test.ts` exists. I did not verify its coverage of each admin path. Pre-production review item.
- S6 (no body, no overrides): the handler declares only `Params`, reads no `request.body` or `request.query`, and passes no source team id to `copyCanonicalDefaults` (the `sourceTeamId` seam is not used). Confirmed by reading the handler.
- S7 (`canAssignDefaults` UX only): the flag is `isApplicationAdmin(decision.actorGlobalRole) && activeResult.rows.length === 0 && !isTemplateTeam(teamId)`, using the same exported predicate as the endpoint. Nothing on the server reads the flag back from a client. The endpoint authorizes independently. Note `decision.actorGlobalRole` on the read path comes from the existing access decision, which is the pre-existing TOPIC-002 behaviour, and only affects what a button shows.
- Lock-gate regression: `assign-defaults-lock-gate-source.test.ts` exists, which is the permanent source test I asked for (design review section 1, I8).
- Template-team guard: `checkWritableTeam` returns the same `teamNotFoundEnvelope()` for a missing team and for the template team, so an admin cannot tell them apart. The template denial is audited as `topic.write_denied_template`.
- Check order: non-canonical id (404), then authorization (403), then rate limit, then team lookup. Non-admins get an identical 403 for existing, missing and template teams, since authorization precedes lookup. Good.
- Timing: `applyTimingFloor` runs before the 403, 404, 409, 500 and 201 sends. The denial audit and limiter work happen before the floor, so their time is absorbed in it.
- Error envelopes: all bodies are fixed strings with codes (`NOT_AN_ADMIN`, `TEAM_HAS_ACTIVE_TOPICS`, `DEFAULT_TOPICS_UNAVAILABLE`, `ASSIGN_DEFAULTS_FAILED`). The catch never rethrows, so Fastify's default handler cannot echo `err.message`. The generic failure body does not include the database error. `DefaultTopicsUnavailableError` carries no ids. The template id appears only in the server log line. The 201 body is `{ topicCount }`.
- Success audit: inserted in the same transaction as the copy, parameterized, fail-closed (a failed insert rolls back the assignment). Metadata is `topic_count` plus `correlation_id`. This implements my earlier recommendation to carry the correlation id. `emitAuditEvent` after COMMIT is wrapped in try/catch so a notification failure cannot turn a committed success into a 5xx, and the code comments name the row as the system of record.
- Denial and failure SQL: constant text, numbered placeholders, explicit casts, `SQLSTATE`-only error logging (`sqlstateOf`). No request data is interpolated. The TOPIC-002 refactor moves the identical SQL into the shared helper, so the cast rules cannot fork.
- Response header: `Cache-Control: no-store` is set first on every exit.

## 3. Findings

### Blocking

None.

### Non-blocking

**N1. Dynamic import in `recordDenial` is outside any try/catch.** `await import("./denial-audit-limiter.js")` and `admitDenialAudit` run before the fail-open write. `admitDenialAudit` catches its own errors, but a failed module import would reject out of `recordDenial` and turn the 403 into a 500. This is theoretical (the module is local and the first load happens in production on the first denial, after which it is cached), and the comment gives a sound test-isolation reason. Suggest wrapping the import and limiter call in a try/catch that falls into the `limiter_error` log-only path, so that "an audit problem never changes the response" holds literally, as the file header claims.

**N2. Suppression of a prober relies on Redis.** When Redis is down, every denial is suppressed (log-only `limiter_error`, one event per denial). That is the safe direction for table growth, but during a Redis outage non-admin probing of this endpoint leaves no `audit_log` rows, and the log volume for `topic.denial_audit_suppressed` is unbounded. The topic-write limiter already fails closed on the same outage for admins, so the endpoint is degraded either way. Record in the runbook that denial rows are best-effort and absent during a Redis outage, and that the suppression events are the signal. Not a code change.

**N3. No durable record for the generic `ASSIGN_DEFAULTS_FAILED` 500.** Only the empty-template failure gets an audit row; constraint drift, a failed success-audit insert or connection loss are `request.log.error` only. This matches the design (D-section limits the durable record to the empty-template case), and the transaction left no state behind. Mention in the runbook that the correlation id in the 500 body is the search key. Recommend, not required.

**N4. Carried-forward items for the pre-production review.** (a) `request.ip` depends on `trustProxy: 1` in `app.ts`, so `actor_ip` on these rows is only as good as the proxy hop count in each deployment. (b) The 403 path performs one DB read plus one Redis call per request and is not covered by the topic-write limiter by design; the cost is bounded and cheap, but I will include the route in the load check. (c) Topic text copied from the template is escaped at render in the consumers I have reviewed so far; I will re-test with a hostile template row. (d) Runbook: a future bulk repair script must apply the same zero-active precondition and write one audit row per team with an operator actor (design review observation 9).

## 4. Threat model update

Add to the threat model: "an `application_admin` may write the canonical topic set into a locked team with zero active topics, via one endpoint, with live role check, advisory lock, and audit on success, denial and empty-template failure". Residual risk is low. Blast radius of one compromised admin remains every team (#208), unchanged.
