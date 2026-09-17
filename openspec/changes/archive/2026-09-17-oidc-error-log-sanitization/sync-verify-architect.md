# Sync Verification — Solution Architect

**Reviewer:** Ingrid Sollenberger (Principal Solution Architect)
**Scope:** Independent verification that `openspec/specs/auth-error-handling/spec.md`, as synced by Marcus Delgado, has no drift from the actual implementation, and that the sync itself introduced no distortion of the delta.

## Verdict

No drift found. The sync is a clean merge, and the two new/modified requirements match the shipped code exactly, scenario by scenario. `openspec validate auth-error-handling --strict` passes.

## What I checked

### 1. Sync fidelity (delta -> main spec)
Diffed `openspec/changes/oidc-error-log-sanitization/specs/auth-error-handling/spec.md` against the main spec. The main spec is the pre-existing four requirements (Distinct error messages, Error messages distinguish..., Error response format) left untouched, plus the delta's MODIFIED "Authentication event logging" requirement and ADDED "OIDC library error sanitization" requirement appended verbatim — same requirement text, same 9 scenarios under the new requirement, word-for-word. No paraphrasing, no dropped scenarios, no reordering that changes meaning. This is exactly what a MODIFIED+ADDED delta merge should produce.

### 2. Field allowlists vs. `oidc-error-sanitizer.ts`
Read `packages/backend/src/auth/oidc-error-sanitizer.ts` directly and compared each branch against the spec's per-class claims:

- `ResponseBodyError` / `AuthorizationResponseError` -> returns `errorClass, message, stack, code, error, error_description: REDACTED, cause: REDACTED`. Matches "IdP token-exchange error is sanitized" (error code preserved, `error_description` redacted-with-marker, oauth4webapi's `code` preserved).
- `WWWAuthenticateChallengeError` -> returns `errorClass, message, stack, code, cause: REDACTED` — no `error`/`error_description` keys at all. Matches "WWW-Authenticate challenge error is sanitized without a nonexistent field" (field absent, not falsely marked redacted).
- `OperationProcessingError` / `ClientError` -> returns `errorClass, message, stack, code, cause: REDACTED`. Matches "Token/claim validation failure is sanitized structurally."
- `MissingClaimError` -> returns exactly `errorClass, message, stack, claim`. Matches the spec's allowlist verbatim ("allowlisting `errorClass`, `message`, `stack`, and `claim`").
- Unrecognized class -> emits `log.error({ event: "oidc_error_sanitizer.unrecognized_class", errorClass })` as a distinct signal line, then returns `message`/`stack` redacted (`REDACTED`), `unrecognized: true`. Matches "Unrecognized error class fails closed."

The test suite (`packages/backend/src/auth/__tests__/oidc-error-sanitizer.test.ts`) exercises every one of these branches through a real `pino()` instance with a per-test canary value and asserts the canary never appears in the serialized output — this is a real implementation of the "Regression coverage against installed library versions" scenario, not aspirational.

### 3. Call sites — names and behavior
Verified all three call sites named in the "Sanitization applies uniformly across all OIDC client library call sites" scenario:

- **`routes/auth.ts` callback catch** (line ~332-340): `request.log.error({ err: sanitizeOidcError(err, request.log), correlationId, sourceIp, event: "auth.callback_error" })`, followed by `emitAuditEvent(request.log, "auth.failure", auditFields)` — including `missingClaim` in audit fields when `err instanceof MissingClaimError`.
- **`routes/auth.ts` logout catch** (line ~437-449): `request.log.error({ err: sanitizeOidcError(err, request.log), userId, sessionId, event: "auth.idp_logout_error" })`, then `emitAuditEvent(request.log, "auth.idp_logout_failed", { userId, sessionId })`, then `reply.send({ redirectUrl: "/" })`. Matches the "IdP end-session URL construction failure degrades gracefully" scenario exactly, including the fallback response shape and that local session destruction already happened before this block runs.
- **`auth/middleware.ts` `refreshSessionTokens`** (line ~105-141): sanitized `log.error` only on the final retry-exhausted path (`event: "auth.token_refresh_error"`); the revocation path does not go through `sanitizeOidcError` at all because it never reaches a `log.error` call — it short-circuits straight to `emitAuditEvent(..., "auth.token_refresh_failure", { failureType: "revoked" })`. This is consistent with the spec: the sanitization requirement only binds "before it reaches a logger," and the revoked case is classified and audited, not logged as an error.

### 4. Revoked refresh token scenario
Confirmed against `middleware.ts` lines 105-121: `isRevocation = err instanceof ResponseBodyError && err.error === "invalid_grant"`. When true, it `return`s immediately with `{ status: "revoked" }` after emitting `auth.token_refresh_failure` with `failureType: "revoked"` and `retryCount: retries` — no `await new Promise(setTimeout(...))` executes on this path since that delay only lives in the `else` branch reached after the `if (isRevocation)` block's `return`. Matches the spec's "classified as revoked immediately, with no retry delay" exactly, and matches the "pre-existing classification bug" framing (the old code evidently fell through to the generic `"transient"` path at the bottom of the loop for this same condition).

### 5. `openspec validate --strict`
Ran `openspec validate auth-error-handling --strict` from the repo root: `Specification 'auth-error-handling' is valid`, exit 0.

## Anything aspirational or missing from the spec?
None found. Every scenario in both the modified and added requirement traces to a specific line in the shipped code or the test suite. Nothing in `oidc-error-sanitizer.ts`, the three call sites, or `audit-logger.ts`'s `auth.idp_logout_failed` handling looked unaccounted for in the spec either — the spec's scope (three call sites, six recognized classes, the fail-closed default) matches the code's actual surface area.

One observation, not a defect: the spec's guarantee about future same-library IdPs ("SHALL remain correct... for identity providers added after the application's initial provider... integrated through the same OIDC client library") is architecturally the right framing per [[project_oidc_multi_provider]] — it correctly scopes the guarantee to dispatch-by-class rather than by provider identity, and correctly flags that a different client library is a separate verification burden pointed at the design record (`design.md`) rather than silently assumed. This is exactly the kind of abstraction-boundary honesty I look for; it does not overclaim provider-agnosticism it hasn't tested.
