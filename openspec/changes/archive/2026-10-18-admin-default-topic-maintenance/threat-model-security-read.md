VERDICT: findings (no must-fix; two should-fix, the rest notes)

# Independent read of the task 7.2 threat-model pass: admin-default-topic-maintenance (#216)

Reviewer: Tomás Ferreira, Security Analyst. Read-only. Checked the engineer's 7.2 paragraph (tasks.md "7.2" note, design.md "As built" and the threat-model text in Rollout) against `routes/admin-default-topics.ts`, `sessions/default-topic-maintenance.ts`, `sessions/default-topic-validation.ts`, `auth/default-maintenance-denial-audit.ts`, plus `auth/denial-audit-limiter.ts`, `routes/topic-write-rate-limit.ts` (header), `app.ts` and `sessions/session-topic-snapshot.ts` for the lock. I did not run tests.

## Must-fix

None. No authorization bypass, injection, mass assignment or leak found. The M1 fix (role read in a `preParsing` hook) is present and the ordering claim in "As built" 1 is true.

## The 7.2 claims, checked one by one

| Claim | Result |
|---|---|
| CSRF relies on SameSite=Strict, the CORS allow-list and the JSON-only check; text/plain is refused by our own check | Partly overstated. See S-A. True for add, edit and reorder; not true for archive and restore. CORS does not stop a simple cross-site request from being sent. |
| Error bodies never echo values | True. `ERROR_TABLE` messages are fixed; only field label and `max` are interpolated. The error handler maps all `FST_ERR_CTP_*` and `INVALID_JSON_BODY` to fixed text, everything else to the generic 500. Two echoes exist and are acceptable: the 409 name conflict returns `conflictingTopicId` and `conflictingName` (admin-only template data), and `REORDER_ID_MISMATCH` returns the current active list (admin-only). |
| Lock hold is bounded by `lock_timeout` 3 s and `statement_timeout` 10 s | Mostly true, slightly loose. See N-A. `lock_timeout` bounds waiting for the advisory lock. `statement_timeout` is per statement, not per transaction, and no `idle_in_transaction_session_timeout` is set here, so the worst case is several statements at up to 10 s each, not 10 s. Realistic hold is milliseconds. Impact is smaller than the pass implies (see N-A). |
| Audit text is scoped to five operation names | True. `MAINTENANCE_AUDIT_OPERATIONS` has exactly five names, both reads use `operation = ANY($n)`, and `before`/`after` are only written by `writeTemplateTopics`. The denial row and the rate-limit breach row use other operation names and are excluded from the list and history reads. |
| Log events carry identifiers only | True for the success event (operation, topicId, changedFields as names, actor id/role/ip, correlationId). The failure logs record the raw `err` for unknown errors. I looked for a path where a pg error would carry prompt text: there is no CHECK constraint on `topics` text (migration 19 says so deliberately), the 23505 branch logs only `constraint`, and `AuditWriteError` keeps only the cause class name. The only residual is a not-null or driver-level error whose `detail` includes row values. Not reachable with validated, non-empty fields. Accepted. |
| Role check precedes the body for all seven routes | True. The hook runs for every route in the plugin, reads included; `handleWrite` and `handleRead` return early if the request was not admitted. The role is read live from `users.global_role`, fail closed with the generic envelope on a database error. |

## Findings

### S-A (should-fix, low to moderate): CSRF control for archive and restore is SameSite=Strict alone, and the 7.2 text over-claims

- `archive` and `restore` are registered with `bodyCarrying: false`, so `isJsonContentType` is never applied. They accept any Content-Type or none, and the custom parser tolerates an empty body. A simple cross-site `POST` with no body and no custom header needs no CORS preflight; CORS (`allowedHeaders`, `origin` allow-list) only controls whether a script may read the response, not whether the request is sent.
- There is no HTTP Origin or Referer check anywhere (the Origin check in `app.ts` is the WebSocket CSWSH check only).
- `isJsonContentType` returns true when the header is absent, so the add, edit and reorder routes are guarded by "Fastify refuses a body with no media type" rather than by this function. That still holds, but it is an indirect control.
- So for the two bodyless state-changing routes the only CSRF defence is `sameSite: "strict"` on the session cookie. Strict is site-scoped, not origin-scoped: a request from any sibling subdomain of the same registrable domain still carries the cookie. Impact is bounded (archive and restore are reversible, audited, and the last active default cannot be archived), which is why this is not must-fix.
- Recommended: require `application/json` (or a custom header such as `X-Requested-With`, which forces a preflight) on every non-GET route in this family, archive and restore included, or add an Origin allow-list check on mutating methods. Then correct the 7.2 sentence to say what is actually relied on.

### S-B (should-fix, low): record the sampled denial log as a detective-control limit

The threat-model pass does not mention it. Facts from the code:
- Per actor, the first 10 denials per minute write an `audit_log` row (`DENIAL_AUDIT_LIMIT`). Beyond that no row is written and the log-only `topic.denial_audit_suppressed` event fires at suppressed counts 1, 2, 4, 8, and so on. The exact number of denied attempts is therefore not recoverable from logs, only its order of magnitude. The sampler resets with the Redis window, so a long, slow prober (below 10 per minute) is fully recorded and a fast one is recorded for its first 10 and then sampled. That is adequate for "who probed and roughly how hard".
- When the limiter store errors, no row and no per-denial event is written; one `limiter_error` event per actor per 60 s is the only trace. Redis is also the session store (`createRedisStore(redis)`), so a Redis outage that blinds this control also stops authenticated sessions from working at all; the practical exposure is small, but the runbook alert should treat `limiter_error` as "denials unobserved".
- `lastLimiterErrorEventMs` is an unbounded in-process map (one entry per actor id). Only authenticated users reach it; negligible.
- The 403 path itself is not request-rate limited: each denied request costs one `users` query, one Redis call and the timing-floor wait, for any authenticated user. The pass says a 403-bound caller never consumes write budget, which is true, but it also means this family is not limited on denial. Same situation as the existing assign-defaults route; accept and note.
Action: add two sentences to the threat model and the runbook alert guidance. No code change.

### N-A (note): sentinel lock hold has narrower blast radius than the pass states

`lockTeamTopics` is called with the sentinel id only by the maintenance writer. The other caller (`routes/topics.ts`) locks real team ids, and the template read at team creation (`copyCanonicalDefaults`) takes no lock. So holding the sentinel lock can only delay other maintenance writes (503 `DEFAULT_MAINTENANCE_BUSY` with Retry-After); it cannot delay team creation, room open or a live session. That is the stronger and more useful statement for the threat model. A single stuck holder is bounded by the timeouts above; adding `idle_in_transaction_session_timeout` is optional hardening, not required.

### N-B (note): `listUnavailable` path is safe

On a failed post-commit list read the route returns 200 or 201 with `listUnavailable: true`, `scope`, and `changedTopicId`; the failure is logged with `err` and the correlation id (no text from the request). No data is leaked, the audit row is already committed, and a client is not invited to retry a write that happened. One check for the frontend task: it must treat the absence of `defaults` as "reload", not as "empty template", or an administrator could be tempted to re-add topics. Not a backend risk.

### N-C (note): rate-limit sharing

The five write routes share the per-actor topic-write budget (120 per 10 min, 400 per day) with real topic writes, keyed by user, not team. An administrator who also facilitates shares one budget (documented). It is per actor, so one compromised ordinary account cannot exhaust the administrator's budget. Redis failure fails closed with 503 for all maintenance writes (availability only; break-glass is database access). The limiter runs after the role check, the media-type check and the id syntax check, and before body validation, so 422s consume budget (acceptable). The GET routes are unlimited but admin-only; list cost is three queries and an unindexed `metadata->>'topicId'` sort over sentinel audit rows only (operator-written, few).

### N-D (note): custom JSON parser

Replacing Fastify's secure JSON parser means `__proto__` protection is hand-rolled by `text.includes('"__proto__"')`, which is bypassable with an escaped key (`"__proto__"`). That is harmless today: `JSON.parse` creates an own property, the body is never spread or merged, and the parse functions pick fields by name. Record the invariant ("never spread or merge `request.body` in this family") so a later edit does not turn it into a prototype-pollution sink. The literal check also rejects a legitimate prompt containing that exact quoted string; irrelevant.

### N-E (note): `request.ip` and trust

Audit rows and the log event store `request.ip`, which depends on `trustProxy: 1` being correct for the real topology. If the app is reachable directly, `X-Forwarded-For` is spoofable and audit IPs are untrustworthy. Already recorded in the design; keep the runbook line.

## Does the single-admin acceptance still hold?

Yes, with two clarifications to the wording.
1. "Single actor" is not enforced by the code. The control is the role, not an identity: any user whose IdP claim maps to `application_admin` can write, concurrently (the lock serialises them). The acceptance is really "one privileged role, no approval step". That is consistent with the decision, but the threat model should say the IdP group membership is the control and review of that group is the compensating process (already noted in design E2a).
2. A compromised administrator session can rewrite all 15 prompts and descriptions for every future team, up to the rate limit. It cannot reach existing teams, live sessions, other tables or the audit trail through these routes; text is plain-text-validated and every consumer is required to render as text (task 1.2 checklist, which I did not re-verify here); every change has a before and after in `audit_log`, so revert is possible. The residual that matters is unchanged from the design: the application database role can still UPDATE and DELETE `audit_log`, so a database-level attacker can erase the trail. Accepted and tracked as a follow-up. There is no step-up authentication or recent-login requirement for these routes; acceptable for a low-frequency, reversible, text-only capability behind SameSite and the IdP, but S-A narrows the one remaining gap in that story.

Trust boundaries: unchanged. The writer touches only `is_default = true` rows of the sentinel team, takes only the sentinel lock, and a structural test restricts other writers.

## Suggested edits to the record

1. Replace the 7.2 CSRF sentence with what is actually relied on, and decide S-A.
2. Add the sampled-log and limiter-outage limits (S-B) and the narrower lock blast radius (N-A) to the threat model.
3. Add the "never spread or merge `request.body`" invariant (N-D).
