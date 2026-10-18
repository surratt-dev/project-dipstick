# Implementation security review: admin-default-topic-maintenance (#216)

Reviewer: Tomás Ferreira, Security Analyst. Verified against the code on branch `agent-team/216-admin-default-topic-maintenance` (uncommitted), not against the design's claims. I did not run the test suite; findings come from reading the code, Fastify's request lifecycle, and the tests that exist.

Files reviewed: `routes/admin-default-topics.ts`, `sessions/default-topic-maintenance.ts`, `sessions/default-topic-validation.ts`, `auth/default-maintenance-denial-audit.ts`, the `audit-logger.ts` and `fail-open-topic-audit.ts` diffs, `register-routes.ts`, `app.ts`, `auth/audit-write-transaction.ts`, `routes/topic-write-rate-limit.ts`, `docs/deployment.md` section for #216.

## Verdict

No SQL injection, mass assignment, privilege bypass, or text-in-log leak. Authorization is a live DB role read on all seven routes. The writer is parameterized, locked, and audit-atomic. There is one must-fix: the "403 before anything else" ordering (E2) is not true for a non-admin caller on body-carrying routes, because Fastify rejects some requests before the handler runs. Everything else is should-fix or note.

## MUST-FIX

### M1. Non-admin callers can get 413 / 400 / 415 before the 403, with non-envelope bodies (E2 ordering violated)

Fastify's lifecycle is onRequest, then preParsing, then body parse (content-type parser and `bodyLimit`), then preValidation, preHandler and the handler. `authMiddleware` is an onRequest hook, so 401 is correct. The admin check lives inside the handler (`authorizeAdmin`, `admin-default-topics.ts:333` and `:398`). That means, for a logged-in non-admin:

- A body over 16 KiB gets Fastify's 413 `FST_ERR_CTP_BODY_TOO_LARGE`, not 403.
- A malformed JSON body with `Content-Type: application/json` gets Fastify's 400 `FST_ERR_CTP_INVALID_JSON_BODY` (and an empty body with a JSON content type on archive/restore gets 400 `FST_ERR_CTP_EMPTY_JSON_BODY`), not 403. The default error handler echoes the parser's message.
- `application/x-www-form-urlencoded`, `application/xml` and the like get Fastify's built-in 415, not 403. Only `text/plain` reaches the handler, because Fastify has a default parser for it.
- None of these carry the `{error:{category,code,correlationId}}` envelope. They carry no `no-store` unless the header was set earlier, and they bypass the timing floor and the denial audit. A non-admin probing the admin API therefore leaves no `topic.default_maintenance_denied` row for these attempts.

Impact: low data exposure, but the design, the file header comment (check order) and the spec all state that the live role read comes immediately after authentication and that non-admins always see the identical 403. Probing attempts also go unaudited, which is the S6 detective control. Evidence the gap is untested: the authz test file has no test of a non-admin sending an oversize, malformed or form-encoded body (grep for `content-type` / `413` / `415` in `admin-default-topics-authz-integration.test.ts` returns nothing). The 413 and form-encoded-415 tests in the routes test file are admin-only, so they pass either way.

Required fix, either of:
1. Add a `preParsing` (or `onRequest`, after `authMiddleware`) hook scoped to the plugin that runs `authorizeAdmin` and sends the 403 before the body is read. This is the cleanest option and also makes the role read happen exactly once per request. `bodyLimit` then only applies to admins.
2. Or register a plugin-scoped `setErrorHandler` that maps Fastify parser errors (400/413/415) to the envelope and still runs the role read first. This is weaker, because the body is read first and the 403 still comes second.

Add tests that a non-admin gets 403 (with the denial row written) for: 20 KiB body, `{bad json`, form-encoded body, and `application/xml`. Also assert that an admin gets an envelope-shaped error for malformed JSON (see S2 below).

## SHOULD-FIX

### S1. Admin malformed-JSON and empty-body errors are not in the error envelope
Same cause as M1 (Fastify parser errors). Result for an admin: a 400 `{statusCode,error,message}` with a parser message, no correlation id, no timing floor. No test covers it (grep for `malformed`/`{not json` finds none for these routes). Fix with the same hook or an error handler as M1. Also decide whether POST archive/restore should remove `bodyLimit` and tolerate an absent body (they use `bodyCarrying:false` but a client sending `Content-Type: application/json` with no body gets 400).

### S2. `authorizeAdmin` has no failure handling
`db.query` for the role (`admin-default-topics.ts:226`) is outside any try/catch. If the DB is down, the throw reaches Fastify's default handler: a 500 in Fastify's shape. In Fastify's default handler a 5xx error message is returned in the body, which can include driver text. All other failure paths in this file use the generic envelope. Wrap the role read in the same try/catch and use `sendMaintenanceError` (generic `DEFAULT_MAINTENANCE_FAILED`, logged raw). Fail closed is already the behavior (no access granted), so this is hygiene, not an authorization hole. Same applies to the uncaught `recordMaintenanceDenial` path: it is documented never to throw, and it only contains awaited fail-open code, so I accept it.

### S3. U+2028 / U+2029 allowed in `firstSessionDescription`
`isPlainText` skips the `LINE_SEPARATORS` check for the description (`default-topic-validation.ts:130`). The design permits only `\n` as a non-printing character there. U+2028/2029 are Zl/Zp, not Cc/Cf, so nothing else rejects them. They are inert in React text rendering but are legacy line terminators in JS string literals and some log or CSV consumers. Reject them for all three fields (allow only `\n`). Also note `\r` is rejected as Cc, so CRLF-pasted text fails PROMPT_FORMAT_INVALID; this is safe, but confirm the UX intent.

### S4. Duplicate-name key is weaker than a database guarantee
Uniqueness is only the JS check `trim().toLowerCase()` inside the advisory lock (`nameKey`). Under the lock this is race-safe, but it is not enforced in the database for the sentinel and treats NFC/NFD forms and look-alike characters as different names. If a duplicate ever reached the table, the 23505 branch would only be reachable via the position index, which is a different constraint. Acceptable given a single admin and the lock; record it as an accepted limitation rather than a guarantee. (The migrations only add normalized uniqueness for `teams`, not `topics`.)

### S5. Plain-text guard is a denylist with known gaps (documented, but state them)
Verified present: lone surrogates, Cc, Cf (covers NUL, bidi controls, zero-width space/joiner, BOM), `<[A-Za-z/!]`, named/numeric entities with `;`, `http(s)://`, `www.`, and `](`. Not covered, and I consider acceptable only because E4a makes the control "render as text": bare `javascript:`/`mailto:`/`ftp:` schemes, `&#60` without a semicolon, Hangul filler U+3164 / U+115F / U+2800 / NBSP (non-Cc/Cf invisibles), private-use code points, and homoglyph spoofing. Action: add a one-line note in E4a listing these gaps, and confirm (task 7.2) that every consumer of template text (the TEAM-001 copy, the first-session screen, the admin list, `defaultTopicsNotActive`) renders as text with no `dangerouslySetInnerHTML` or markdown renderer. That consumer check is the real XSS control, and I did not verify the frontend in this review.

### S6. Audit `before`/`after` stores admin-authored text (accepted exception) with no tamper protection
Implemented as designed: `JSON.stringify(metadata)` is bound as a parameter. Retention exemption and break-glass redaction are in `docs/deployment.md`. Residual: the app DB role can still `UPDATE/DELETE audit_log` (design recorded it as an assumption). Keep the follow-up issue filed. History reads return `before`/`after` to admins only (behind the same live role check).

### S7. Rate limit placement
`enforceTopicWriteRateLimit` runs after the 403 and 404 and before body validation, with the sentinel as `teamId`. This matches the shared per-actor budget and means a 403-bound caller never consumes budget. But the budget is shared with real topic writes by the same admin (120 per 10 min, 400 per day). An admin who is also a facilitator could be locked out of maintenance, or the reverse. Acceptable; note it in the runbook. The read routes (GET list, GET history) have no rate limit at all; each costs 3 queries (list) with an unindexed `metadata->>'topicId'` sort. Admin-only, so low risk.

## Verified OK

**Authz order and 403 (inside the handler):** every route, reads included, calls `authorizeAdmin` first. The role is read live from `users.global_role` (not from the session), compared with `isApplicationAdmin` (`role === "application_admin"`). A missing users row gives role `unknown` and 403. The 403 runs `applyTimingFloor`. The topic-id syntax check (404) and the rate limit come after the role check, so a non-admin cannot probe ids or consume budget. Subject to M1 for the pre-handler cases.

**Media type:** `isJsonContentType` compares the media type before `;`, lowercased, exactly to `application/json`, for POST add, PUT order and PATCH. `+json` types are refused. Missing header passes, which is safe because Fastify then refuses any body with no content type, and an absent body is only valid on PATCH/archive/restore where it yields a no-op or no body.

**Mass assignment:** the body is never spread. `parseAdd` and `parseEdit` pick `name`, `prompt`, `firstSessionDescription`, `voteType` by name; `status`, `is_default`, `team_id`, `display_order`, `id` and `archived_by` in a body are ignored. `__proto__` keys are rejected by Fastify's JSON parser. The INSERT hard-codes `team_id = sentinel`, `status = 'active'`, `is_default = true`. `vote_type` is checked against the three-value allow-list and cast `::vote_type`. Edit refuses a changed `voteType` inside the lock.

**Injection:** every value is a bind parameter. The only interpolated SQL is `SET LOCAL lock_timeout/statement_timeout` with module constants. Reorder ids are canonical-UUID checked, lowercased, deduplicated, length-capped at 15 before per-element work, then passed as `uuid[]` and also compared with the DB's own active set.

**Ids come from DB rows:** edit, archive and restore look the row up by id inside the lock with `is_default = true` and the sentinel team (`requireDefault`), then act on `row.id`. `changedTopicId` is the DB id. Error bodies never echo the rejected value (fixed messages, field label and max only). Restore's name conflict returns the conflicting default's id and name, which is admin-only template data and intended by the BA condition.

**Locking and timeouts:** `lockTeamTopics(sentinel)` is taken first, with `lock_timeout 3s` and `statement_timeout 10s` set `LOCAL`. 55P03/57014 map to 503 with `Retry-After`. The shared advisory key serializes against room open and the other topic writes using the same helper. The audit insert's own 400 ms timeout wraps in `AuditWriteError`, so it surfaces as a generic 500 with rollback (not as BUSY).

**Audit atomicity:** one audit row per effective write, in the same transaction through `withAuditTransaction`; a failed insert rolls back the domain change. No-ops write no row. Backstop runs before the audit insert and its failure rolls back. The list and the log emission happen after COMMIT, and the emit is wrapped in try/catch so a logging failure cannot turn a committed write into a 5xx.

**Log carries no prompt text:** the `emitAuditEvent` call after commit passes only `operation`, `topicId`, `changedFields` (field names), actor id/role/ip, `correlationId`. No `before`/`after`. A test (`default-topic-writer-integration.test.ts` around line 769 checks that the event has no `before`) covers this. Error logging on 500s logs the raw `err` object but the writer's pg errors carry no bound values, except that a unique violation is logged with only `constraint` and `correlationId` (good). The `removed` generic `request.log.error({err})` fallback could log a pg error whose `detail` contains key values for a 23505 on `display_order`, but those are integers, not text; the name is not a unique column.

**Denial audit module:** metadata is method plus route template (from `request.routeOptions.url`, not the raw URL), correlation id, http status and reason. `team_id` is NULL. The per-actor limiter bounds rows; suppression events are log-only, logged at counts 1, 2, 4, 8, and once per minute per actor for limiter outages. It is fail-open and never throws; the 403 is sent regardless. `request.ip` relies on `trustProxy: 1` (recorded in the design). Note the memory map `lastLimiterErrorEventMs` is unbounded per actor in-process (one entry per distinct actor id that ever hit a limiter error); negligible, since only authenticated users reach it.

**audit-logger / fail-open-topic-audit diffs:** type-only changes (new event names, `teamId: string | null`). The comment states the scoped text exception and that the log carries none. The `topic.default_` vs `topic.defaults_assigned` LIKE hazard is handled with `ANY($n)` everywhere I read (`readTemplateList`, `readTemplateHistory`).

## Design S1 to S6 dispositions, verified in code

- S1 (retention, redaction, reader check): runbook text present; the only readers are `readTemplateList` and `readTemplateHistory`, both using `ANY`. Done. Residual DB-role tamper risk recorded (S6 above).
- S2 (log carries ids only): implemented and tested.
- S3 (CSRF reliance on SameSite=Strict, CORS allow-list, JSON-only): cookie is `sameSite: "strict"`; CORS is allow-listed with credentials. The JSON-only gate is partial: `text/plain` and malformed JSON handling is not reached for non-admins (M1). Otherwise as designed.
- S4 (detective control, alert guidance): structured `info` event and runbook alert text present. Done.
- S5 (inert text, Cc/Cf and lone surrogates, mass assignment, ids from DB, no echo): implemented; see S3 and S5 above for the two small gaps.
- S6 (suppressed count and family, limiter-outage blind spot): implemented as designed. One gap: M1 means pre-handler rejections of non-admin callers are not audited at all.

## Summary of required actions

1. MUST: M1, move the admin role check ahead of body parsing (preParsing hook), and add the non-admin oversize, malformed and unsupported-media-type tests.
2. SHOULD: S1 and S2, envelope-shape parser errors and guard the role read; S3, reject U+2028/2029 in the description.
3. NOTE: S4, S5, S7, record in the design or runbook.
