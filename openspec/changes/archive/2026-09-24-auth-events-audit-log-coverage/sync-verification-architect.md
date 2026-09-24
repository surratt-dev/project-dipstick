# Sync Verification — Solution Architect

**Change:** auth-events-audit-log-coverage
**Scope:** Drift check between synced main specs (`auth-error-handling`, `join-link`) and shipped code in `packages/backend/src/auth/` and `packages/backend/src/routes/`.

## Result: No drift found.

I spot-checked the new/modified requirements and scenarios most likely to have architectural surface area — error classification, transactional coupling, fail-open behavior, and boundary/redaction rules — against the actual code paths.

## Checks performed

- **Error categorization for audit-write failures** — `AuditWriteError` (`auth/errors.ts`) is thrown by `withAuditTransaction` (`audit-write-transaction.ts`) on both a failed `INSERT` and a failed `db.connect()`, is classified `internal_error` by `mapAuthError` (`error-handler.ts`), and is sanitized with `message`/`stack`/`causeClass` unredacted by `sanitizeOidcError` (`oidc-error-sanitizer.ts`) — matches spec text verbatim, including the "not folded into the generic unrecognized-error branch" detail.
- **Correlation ID threading** — `routes/auth.ts`'s `GET /auth/callback` generates one `correlationId` at handler entry and threads it through `auth.callback_received`, `auth.session_created`, `auth.success`, `auth.first_access_created`/`auth.role_claim_mapped`, and the failure path's `auth.failure` — confirmed single instance, no per-emit regeneration.
- **Transactional audit writes** — `withAuditTransaction` (`audit-write-transaction.ts`) implements connect/BEGIN/domain-write/`SET LOCAL statement_timeout`/audit-INSERT/COMMIT/ROLLBACK/release exactly as described, with `TRANSACTIONAL_AUDIT_STATEMENT_TIMEOUT_MS = 400` (shorter than the fail-open group's 500ms). Verified all four call sites: `auth.ts` account resolution (`auth.first_access_created`/`role_claim_mapped`), `join-links.ts`'s two sites (`join.link_created`, `join.link_redeemed`), and `auth.ts`'s `executeJoinFlow` (`join.link_redeemed`). Structured log emissions fire only after commit at every site, matching the "never before, never after rollback" scenarios.
- **Fail-open writes** — `fail-open-audit-write.ts`'s `writeFailOpenAuditRow` and `session-invalidation-audit.ts`'s `writeAuditRow` both use the shared `withTimeout`/`AUDIT_WRITE_TIMEOUT_MS` (500ms, `audit-write-timeout.ts`) and emit `auth.audit_write_failed` with `failureMode` ("timeout" vs "error") and `sourceIp` on any failure, without rethrowing. Confirmed for `auth.success`, `auth.session_created`, `auth.idp_logout_failed`, and all four `auth.session_invalidated` call sites in `middleware.ts` + `/auth/logout`.
- **`team_id` NULL policy and `actorGlobalRole` sourcing** — confirmed `team_id` is NULL at all `auth.session_invalidated`/`auth.success`/`auth.session_created`/`auth.idp_logout_failed` sites, and populated (from `link.team_id`/`:teamId`) at all `join.link_created`/`join.link_redeemed` sites. Confirmed `actor_global_role` resolution differs by call site exactly as spec'd: parameter-passed in `auth.ts`'s account resolution and `executeJoinFlow`, already-resolved in `join-links.ts`'s POST handler, freshly `SELECT`ed in `join-links.ts`'s `GET /api/join/:token`, and via `resolveActorGlobalRole` (shared helper, no duplicated query) in `session-invalidation-audit.ts` and the `idp_logout_failed` site.
- **`sourceIp` accuracy** — confirmed `request.ip` is passed as `sourceIp`/`actorIp` at every join-audit and auth-audit call site; no `"callback"` placeholder found in `auth.ts`. `executeJoinFlow` takes `actorGlobalRole`/`sourceIp` as required (non-optional) parameters.
- **OIDC library error sanitization** — `oidc-error-sanitizer.ts` dispatches on class (`ResponseBodyError`, `AuthorizationResponseError`, `WWWAuthenticateChallengeError`, `OperationProcessingError`, `ClientError`, `MissingClaimError`, `AuditWriteError`), redacts `error_description`/`cause` with an explicit `[redacted]` marker, preserves the OAuth `error` enum and oauth4webapi's `code`, and fails closed (redacts `message`/`stack`, logs `unrecognized_class`) for unrecognized classes — matches every scenario in "OIDC library error sanitization," including the "absent, not falsely marked redacted" case for `WWWAuthenticateChallengeError`.
- **Join token log redaction** — `app.ts`'s Fastify logger `req` serializer redacts both `/api/join/<token>` and `/auth/login?joinToken=<token>` URL patterns to `[REDACTED]`, applied unconditionally at the serializer layer as specced.
- **Revoked-refresh-token classification fix** — `connection-token-refresh.ts` classifies `invalid_grant` as `"revoked"` immediately (no retry), consistent with the "Revoked refresh token classified and audited correctly" scenario.
- **Atomic OIDC state retrieval** — `routes/auth.ts` uses `redis.getdel` (single atomic command) at the callback handler, matching the join-link spec's "OIDC state retrieval is atomic" clause.
- **`previousGlobalRole` capture** — `account-resolver.ts`'s UPSERT uses a `prior` CTE to capture the pre-update `global_role` in the same statement, `NULL` for new users — matches Decision D4 and the corresponding scenarios.

## Assessment

Every requirement and scenario I traced maps to code that not only behaves as specified but frequently cites the same design-decision labels (D2–D7) the specs' own prose references, which is a good sign the delta was synced from, and stayed honest to, the actual implementation rather than an aspirational description. I found no misattribution, no missing call site, and no boundary violation (e.g., no case of a fail-open write blocking a response, no transactional write left uncoupled from its domain write).

No follow-up action needed from an architecture standpoint. This confirms my earlier concerns about authorization logic and durable audit trails are addressed at the server/database boundary, not just in application logic — consistent with my standing "security and compliance by design" review criteria.

— Ingrid Sollenberger, Solution Architect
